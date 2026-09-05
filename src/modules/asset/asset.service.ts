/**
 * Getting files into and out of the vault.
 *
 * The ordering rule that shapes this file: **copy to disk first, write the
 * database second.** A file copy is not part of the SQLite transaction, so one
 * of the two has to go first, and the failure modes are not symmetric.
 *
 *   copy then insert  -> a crash leaves an unreferenced file in the vault.
 *                        Harmless: it wastes disk and nothing points at it.
 *   insert then copy  -> a crash leaves a row pointing at a file that is not
 *                        there. The UI shows an item that cannot be opened.
 *
 * The first is a wart, the second is a broken record. So: copy, then insert,
 * and unwind the copies if the insert fails.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import type { AssetRepository, AssetStore } from '../../core/ports/repositories'
import type { Asset, ComposedDocument, PickedFile } from '../../shared/types'
import { AppError, ErrorCode } from '../../shared/errors'
import { extensionOf } from '../../core/domain/slug'
import { classifyAsset, MAX_ASSET_BYTES, mimeForExtension } from '../../core/domain/asset-kind'
import { newId, nowIso } from '../../core/domain/ids'
import {
  documentFilename,
  isEditableKind,
  MAX_COMPOSED_BYTES,
} from '../../core/domain/text-document'

/** A file copied into the vault but not yet recorded in the database. */
export interface StagedAsset {
  asset: Asset
  /** Undo handle used if the transaction that would record it fails. */
  relPath: string
}

export class AssetService {
  constructor(
    private readonly assets: AssetRepository,
    private readonly store: AssetStore,
  ) {}

  /** Validates a path chosen in the file dialog, before anything is copied. */
  async describe(sourcePath: string): Promise<PickedFile> {
    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(sourcePath)
    } catch (cause) {
      throw new AppError(ErrorCode.ASSET_UNREADABLE, `cannot read ${sourcePath}`, {
        sourcePath,
        cause: String(cause),
      })
    }

    if (!stat.isFile()) {
      throw new AppError(ErrorCode.ASSET_UNREADABLE, `not a regular file: ${sourcePath}`, {
        sourcePath,
      })
    }
    if (stat.size > MAX_ASSET_BYTES) {
      throw new AppError(ErrorCode.ASSET_TOO_LARGE, `file exceeds the size limit`, {
        sourcePath,
        sizeBytes: stat.size,
        limit: MAX_ASSET_BYTES,
      })
    }

    const filename = path.basename(sourcePath)
    return { path: sourcePath, filename, ext: extensionOf(filename), sizeBytes: stat.size }
  }

  /**
   * Copies files into the vault and returns rows ready to insert. Nothing is
   * written to the database here — that is the caller's transaction to run.
   */
  async stage(
    itemId: string,
    itemCreatedAt: string,
    sourcePaths: string[],
    startSortOrder: number,
  ): Promise<StagedAsset[]> {
    const staged: StagedAsset[] = []

    try {
      let sortOrder = startSortOrder

      for (const sourcePath of sourcePaths) {
        const picked = await this.describe(sourcePath)
        const assetId = newId()

        const stored = await this.store.put({
          sourcePath,
          assetId,
          itemId,
          itemCreatedAt,
          filename: picked.filename,
        })

        staged.push({
          relPath: stored.relPath,
          asset: {
            id: assetId,
            itemId,
            filename: picked.filename,
            ext: picked.ext,
            mime: mimeForExtension(picked.ext),
            sizeBytes: stored.sizeBytes,
            relPath: stored.relPath,
            checksum: stored.checksum,
            sortOrder: sortOrder++,
            createdAt: nowIso(),
          },
        })
      }
    } catch (error) {
      // One bad file must not leave the others half-imported.
      await this.discard(staged)
      throw error
    }

    return staged
  }

  /**
   * The same thing for documents typed in the editor: write the bytes, return
   * rows ready to insert, leave the transaction to the caller.
   *
   * Deliberately produces an ordinary `Asset`. A composed `.md` and an
   * uploaded `.md` are the same row, in the same directory, with the same
   * checksum discipline — the editor is a way of *making* a file, not a second
   * kind of thing to keep track of.
   */
  async compose(
    itemId: string,
    itemCreatedAt: string,
    documents: ComposedDocument[],
    startSortOrder: number,
  ): Promise<StagedAsset[]> {
    const staged: StagedAsset[] = []

    try {
      let sortOrder = startSortOrder

      for (const document of documents) {
        const filename = normaliseComposedName(document.filename, document.format)
        assertWithinTextLimit(document.content)

        const assetId = newId()
        const ext = extensionOf(filename)

        const stored = await this.store.putText({
          assetId,
          itemId,
          itemCreatedAt,
          filename,
          contents: document.content,
        })

        staged.push({
          relPath: stored.relPath,
          asset: {
            id: assetId,
            itemId,
            filename,
            ext,
            mime: mimeForExtension(ext),
            sizeBytes: stored.sizeBytes,
            relPath: stored.relPath,
            checksum: stored.checksum,
            sortOrder: sortOrder++,
            createdAt: nowIso(),
          },
        })
      }
    } catch (error) {
      await this.discard(staged)
      throw error
    }

    return staged
  }

  /**
   * Rewrites a stored document, and the only place in the application where an
   * asset's bytes change after they are written.
   *
   * The file goes first, exactly as it does on create: if the row update then
   * failed, the recorded size and checksum would be stale — wrong metadata
   * about a file that is correct, which is recoverable — rather than a row
   * describing bytes that were never written.
   */
  async rewriteText(assetId: string, content: string): Promise<Asset> {
    const asset = this.requireEditable(assetId)
    assertWithinTextLimit(content)

    const written = await this.store.replaceText(asset.relPath, content)
    this.assets.updateContent(asset.id, written.sizeBytes, written.checksum)

    return { ...asset, sizeBytes: written.sizeBytes, checksum: written.checksum }
  }

  /**
   * A PDF, an image or a `.docx` has no round trip: mammoth converts one way,
   * and writing back an approximation would destroy formatting nobody asked us
   * to touch. The editor is offered for Markdown and plain text only, and the
   * service refuses the rest rather than trusting the UI to have hidden it.
   */
  requireEditable(id: string): Asset {
    const asset = this.require(id)

    if (!isEditableKind(classifyAsset(asset.ext))) {
      throw new AppError(
        ErrorCode.ASSET_NOT_EDITABLE,
        `only markdown and text assets can be edited, not .${asset.ext}`,
        { id, ext: asset.ext },
      )
    }
    return asset
  }

  /** Removes staged copies after a failed transaction. Never throws. */
  async discard(staged: StagedAsset[]): Promise<void> {
    await Promise.allSettled(staged.map((s) => this.store.remove(s.relPath)))
  }

  require(id: string): Asset {
    const asset = this.assets.findById(id)
    if (!asset) {
      throw new AppError(ErrorCode.ASSET_NOT_FOUND, `no asset with id ${id}`, { id })
    }
    return asset
  }

  listForItem(itemId: string): Asset[] {
    return this.assets.listForItem(itemId)
  }

  nextSortOrder(itemId: string): number {
    return this.assets.nextSortOrder(itemId)
  }

  /**
   * Database row first this time, then the file.
   *
   * The reasoning inverts for deletion: if the row is gone and the file
   * removal fails, the result is an orphaned file — the harmless case again.
   */
  async delete(id: string): Promise<{ id: string; relPath: string }> {
    const asset = this.require(id)
    this.assets.delete(id)
    await this.store.remove(asset.relPath)
    return { id, relPath: asset.relPath }
  }

  /** Absolute path, for `shell.openPath` and `shell.showItemInFolder`. */
  absolutePath(asset: Asset): string {
    return this.store.resolve(asset.relPath)
  }
}

/** `'  Ôn tập  '` + markdown -> `'Ôn tập.md'`. Rejects a name with nothing in it. */
function normaliseComposedName(raw: string, format: ComposedDocument['format']): string {
  const filename = documentFilename(raw ?? '', format)

  // `documentFilename` always appends an extension, so an empty name would
  // arrive here as a bare `.md` — a hidden file with no name.
  if (filename.startsWith('.')) {
    throw new AppError(ErrorCode.ASSET_NAME_REQUIRED, 'document name is empty')
  }
  return filename
}

function assertWithinTextLimit(content: string): void {
  const sizeBytes = Buffer.byteLength(content, 'utf8')

  if (sizeBytes > MAX_COMPOSED_BYTES) {
    throw new AppError(ErrorCode.ASSET_TOO_LARGE, 'document exceeds the text size limit', {
      sizeBytes,
      limit: MAX_COMPOSED_BYTES,
    })
  }
}
