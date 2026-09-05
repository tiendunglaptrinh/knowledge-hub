/**
 * The vault — every uploaded file, on disk, outside the database.
 *
 * Layout:
 *
 *   <dataDir>/
 *     knowledge.db
 *     assets/
 *       2026/08/<itemId>/
 *         item.json                     sidecar, see below
 *         owasp-top-10.pdf
 *         spring-boot.md
 *
 * Why this shape:
 *   - year/month keeps any single directory small enough for a file manager
 *     to open comfortably, without needing a hashed fan-out nobody can read
 *   - one directory per item means deleting an item is one `rm -r`, and a
 *     human browsing the vault sees related files together
 *   - files are named after the document, slugged. The display name lives in
 *     `assets.filename` and is untouched; this is the name a person finds
 *     when they open the folder, and it has to be boring on every platform
 *
 * `item.json` is a sidecar, not a source of truth. SQLite is authoritative;
 * the sidecar exists so that a lost or corrupted index can be rebuilt from the
 * vault alone, and so the files remain meaningful if this app disappears.
 * See docs/06-storage-layout.md#recovery.
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { AssetStore } from '../../core/ports/repositories'
import { AppError, ErrorCode } from '../../shared/errors'
import { slugFilename } from '../../core/domain/slug'
import { monthDir, resolveInVault } from './vault-path'

/** Enough suffixes for any real directory; a guard against an infinite loop. */
const MAX_NAME_ATTEMPTS = 500

export class FsAssetStore implements AssetStore {
  readonly rootDir: string
  readonly assetsDir: string

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir)
    this.assetsDir = path.join(this.rootDir, 'assets')
  }

  /** Creates the vault directories. Called once during startup. */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.assetsDir, { recursive: true })
      // Prove writability now, with a clear error, rather than at the moment
      // the user first tries to save something.
      const probe = path.join(this.rootDir, '.write-probe')
      await fs.writeFile(probe, '')
      await fs.rm(probe, { force: true })
    } catch (cause) {
      throw new AppError(
        ErrorCode.VAULT_UNWRITABLE,
        `vault directory is not writable: ${this.rootDir}`,
        { dataDir: this.rootDir, cause: String(cause) },
      )
    }
  }

  async put(input: {
    sourcePath: string
    assetId: string
    itemId: string
    itemCreatedAt: string
    filename: string
  }): Promise<{ relPath: string; sizeBytes: number; checksum: string }> {
    const dir = this.itemDirFor(input.itemId, input.itemCreatedAt)
    await fs.mkdir(path.join(this.rootDir, dir), { recursive: true })

    // Copy rather than move: the user's original file is theirs and must
    // survive the import.
    const relPath = await this.writeUnique(dir, input.filename, (absolute) =>
      fs.copyFile(input.sourcePath, absolute, fs.constants.COPYFILE_EXCL),
    )

    const absolute = this.resolve(relPath)
    const [stat, checksum] = await Promise.all([fs.stat(absolute), sha256(absolute)])

    return { relPath, sizeBytes: stat.size, checksum }
  }

  async putText(input: {
    assetId: string
    itemId: string
    itemCreatedAt: string
    filename: string
    contents: string
  }): Promise<{ relPath: string; sizeBytes: number; checksum: string }> {
    const dir = this.itemDirFor(input.itemId, input.itemCreatedAt)
    await fs.mkdir(path.join(this.rootDir, dir), { recursive: true })

    const buffer = Buffer.from(input.contents, 'utf8')

    const relPath = await this.writeUnique(dir, input.filename, (absolute) =>
      fs.writeFile(absolute, buffer, { flag: 'wx' }),
    )

    return { relPath, sizeBytes: buffer.byteLength, checksum: sha256OfBuffer(buffer) }
  }

  async replaceText(
    relPath: string,
    contents: string,
  ): Promise<{ sizeBytes: number; checksum: string }> {
    const absolute = this.resolve(relPath)
    const buffer = Buffer.from(contents, 'utf8')

    // Temp file in the same directory, then rename. A rename within one
    // filesystem is atomic, so `assets/` keeps the property the backup advice
    // in docs/06-storage-layout.md depends on: a file being read while it is
    // being edited is either wholly the old version or wholly the new one.
    const temporary = `${absolute}.${crypto.randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, buffer, { flag: 'wx' })
      await fs.rename(temporary, absolute)
    } catch (cause) {
      await fs.rm(temporary, { force: true })
      throw cause
    }

    return { sizeBytes: buffer.byteLength, checksum: sha256OfBuffer(buffer) }
  }

  /**
   * Writes into `dirRel` under a slugged version of `filename`, retrying with
   * `-2`, `-3`, … until a name is free. Returns the vault-relative path used.
   *
   * The uniqueness test is the write itself — `write` must fail with `EEXIST`
   * rather than overwrite, which is why both callers pass an exclusive flag.
   * Checking `fs.access` first and then writing would leave a window between
   * the two; here there is none, and the check costs no extra syscall.
   *
   * Earlier versions prefixed every stored file with its asset id, which made
   * collisions impossible for free. It also made the vault unbrowsable, which
   * works directly against the point of storing plain files at all.
   */
  private async writeUnique(
    dirRel: string,
    filename: string,
    write: (absolute: string) => Promise<void>,
  ): Promise<string> {
    const slug = slugFilename(filename)
    const dot = slug.lastIndexOf('.')
    const stem = dot > 0 ? slug.slice(0, dot) : slug
    const suffix = dot > 0 ? slug.slice(dot) : ''

    for (let n = 1; n <= MAX_NAME_ATTEMPTS; n += 1) {
      const candidate = n === 1 ? slug : `${stem}-${n}${suffix}`
      const relPath = `${dirRel}/${candidate}`

      try {
        await write(this.resolve(relPath))
        return relPath
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException)?.code !== 'EEXIST') throw cause
      }
    }

    throw new AppError(
      ErrorCode.ASSET_UNREADABLE,
      `could not find a free filename for ${filename} after ${MAX_NAME_ATTEMPTS} attempts`,
      { filename, dirRel },
    )
  }

  /**
   * Vault-relative path -> absolute path. Every filesystem access in this
   * class goes through here; the check itself lives in `vault-path.ts`,
   * shared with the note store.
   */
  resolve(relPath: string): string {
    return resolveInVault(this.rootDir, relPath)
  }

  async read(relPath: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolve(relPath))
    } catch (cause) {
      throw this.missing(relPath, cause)
    }
  }

  async readText(relPath: string): Promise<string> {
    try {
      return await fs.readFile(this.resolve(relPath), 'utf8')
    } catch (cause) {
      throw this.missing(relPath, cause)
    }
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relPath))
      return true
    } catch {
      return false
    }
  }

  async remove(relPath: string): Promise<void> {
    await fs.rm(this.resolve(relPath), { force: true })
  }

  async removeItemDir(itemId: string, itemCreatedAt: string): Promise<void> {
    const dir = this.resolve(this.itemDirFor(itemId, itemCreatedAt))
    await fs.rm(dir, { recursive: true, force: true })
  }

  async writeSidecar(itemId: string, itemCreatedAt: string, payload: unknown): Promise<void> {
    const dir = this.resolve(this.itemDirFor(itemId, itemCreatedAt))
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'item.json'), JSON.stringify(payload, null, 2), 'utf8')
  }

  /**
   * `assets/YYYY/MM/<itemId>`, always with forward slashes so the value stored
   * in the database is identical on Windows and Linux.
   */
  private itemDirFor(itemId: string, itemCreatedAt: string): string {
    return `${monthDir('assets', itemCreatedAt)}/${itemId}`
  }

  private missing(relPath: string, cause: unknown): AppError {
    return new AppError(
      ErrorCode.ASSET_FILE_MISSING,
      `file is indexed but not present in the vault: ${relPath}`,
      { relPath, cause: String(cause) },
    )
  }
}

/**
 * Streamed so that a 200 MB PDF does not have to be held in memory just to be
 * fingerprinted.
 */
async function sha256(absolutePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  await pipeline(createReadStream(absolutePath), hash)
  return hash.digest('hex')
}

/**
 * The same digest for content already in memory. A typed document is bounded
 * at 5 MB, so there is nothing to stream.
 */
function sha256OfBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/** Exported for the recovery tooling described in docs/06-storage-layout.md. */
export { sha256 }
