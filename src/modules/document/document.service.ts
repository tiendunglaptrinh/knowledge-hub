/**
 * Turns a stored file into something the renderer can display, and into plain
 * text for the search index.
 *
 * This runs in the main process, not the renderer. Two reasons:
 *   - mammoth is a large CommonJS tree; keeping it out of the renderer bundle
 *     keeps the UI's first paint fast
 *   - conversion touches the filesystem, which a hardened renderer cannot do
 *
 * Adding a format means a case here plus a branch in the viewer component.
 * Nothing else changes — the kind is derived, never stored.
 * See docs/04-data-model.md#derived-not-stored.
 */

import type { AssetStore } from '../../core/ports/repositories'
import type { Asset, AssetKind, RenderedAsset } from '../../shared/types'
import { AppError, ErrorCode } from '../../shared/errors'
import { classifyAsset, MAX_INDEXED_TEXT_BYTES } from '../../core/domain/asset-kind'

/** Loaded lazily so startup does not pay for a converter that may go unused. */
type Mammoth = typeof import('mammoth')
let mammothModule: Mammoth | null = null

function mammoth(): Mammoth {
  mammothModule ??= require('mammoth') as Mammoth
  return mammothModule
}

export class DocumentService {
  constructor(private readonly store: AssetStore) {}

  async render(asset: Asset): Promise<RenderedAsset> {
    const kind = classifyAsset(asset.ext)

    if (!(await this.store.exists(asset.relPath))) {
      throw new AppError(
        ErrorCode.ASSET_FILE_MISSING,
        `file is indexed but missing from the vault: ${asset.relPath}`,
        { assetId: asset.id, relPath: asset.relPath },
      )
    }

    switch (kind) {
      case 'markdown':
      case 'text':
        // Markdown is sent as source, not HTML. The renderer converts it, so
        // the sanitiser and the parser sit on the same side of the boundary
        // and there is no window where unsanitised HTML exists in the DOM.
        return { asset, kind, text: await this.store.readText(asset.relPath), warnings: [] }

      case 'word':
        return this.renderWord(asset)

      case 'pdf':
      case 'image':
        // Streamed by the app:// protocol handler rather than copied through
        // IPC — a 50 MB PDF should not be base64'd into a message.
        return { asset, kind, url: assetUrl(asset.relPath), warnings: [] }

      case 'other':
      default:
        return { asset, kind: 'other', warnings: [] }
    }
  }

  private async renderWord(asset: Asset): Promise<RenderedAsset> {
    try {
      const buffer = await this.store.read(asset.relPath)
      // `convertToHtml` returns semantic HTML plus a list of things it could
      // not map. Images become data: URIs, which the renderer's CSP allows.
      const result = await mammoth().convertToHtml({ buffer })

      return {
        asset,
        kind: 'word',
        html: result.value,
        warnings: result.messages.map((m) => m.message),
      }
    } catch (cause) {
      // A .doc renamed to .docx is the common case here: mammoth reads the
      // OOXML zip container only.
      throw new AppError(
        ErrorCode.ASSET_RENDER_FAILED,
        `could not convert Word document ${asset.filename}`,
        { assetId: asset.id, cause: String(cause) },
      )
    }
  }

  /**
   * Plain text for the full-text index. Best-effort by design: a format we
   * cannot read contributes nothing to the index rather than failing the
   * upload that triggered it.
   *
   * PDF is deliberately absent — extracting text from PDF needs a parser
   * heavy enough to deserve its own decision. Until then a PDF is findable by
   * its title, summary and tags. See docs/11-roadmap.md.
   */
  async extractText(asset: Asset): Promise<string> {
    if (asset.sizeBytes > MAX_INDEXED_TEXT_BYTES) return ''

    const kind: AssetKind = classifyAsset(asset.ext)
    try {
      switch (kind) {
        case 'markdown':
        case 'text':
          return await this.store.readText(asset.relPath)
        case 'word': {
          const buffer = await this.store.read(asset.relPath)
          const result = await mammoth().extractRawText({ buffer })
          return result.value
        }
        default:
          return ''
      }
    } catch {
      return ''
    }
  }
}

/** Vault-relative path -> the URL the renderer loads it from. */
export function assetUrl(relPath: string): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/')
  return `app://asset/${encoded}`
}
