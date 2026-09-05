/**
 * The one path check.
 *
 * Both halves of the vault — `assets/` and `notes/` — resolve every path they
 * touch through this function. It lives on its own because it is the single
 * security-critical line in the storage layer, and a second copy of it is a
 * second place to get it wrong.
 *
 * See docs/07-security.md#path-traversal.
 */

import path from 'node:path'

import { AppError, ErrorCode } from '../../shared/errors'

/**
 * Vault-relative path -> absolute path, refusing anything that would land
 * outside the vault root.
 *
 * `relPath` reaches us from the database and, via the `app://asset/...`
 * protocol handler, from the renderer — so `../../../etc/passwd` has to be
 * impossible, not merely unlikely.
 */
export function resolveInVault(rootDir: string, relPath: string): string {
  const absolute = path.resolve(rootDir, relPath)
  const prefix = rootDir + path.sep

  if (absolute !== rootDir && !absolute.startsWith(prefix)) {
    throw new AppError(ErrorCode.VAULT_PATH_ESCAPE, `path escapes the vault: ${relPath}`, {
      relPath,
    })
  }
  return absolute
}

/**
 * `<prefix>/YYYY/MM`, always with forward slashes so the value is identical on
 * Windows and Linux.
 *
 * The month comes from the entity's own `createdAt`, never from the clock, so
 * a thing created in August stays in `2026/08` however often it is edited.
 */
export function monthDir(prefix: string, createdAt: string): string {
  const date = new Date(createdAt)
  const stamp = Number.isNaN(date.getTime()) ? new Date() : date
  const year = String(stamp.getUTCFullYear())
  const month = String(stamp.getUTCMonth() + 1).padStart(2, '0')
  return `${prefix}/${year}/${month}`
}
