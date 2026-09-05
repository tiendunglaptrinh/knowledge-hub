/**
 * How a typed document's format becomes a filename.
 *
 * In `src/shared` rather than `src/core/domain` because **both** processes need
 * the answer and they must not disagree: the main process uses it to name the
 * file it writes, and the editor uses it to show the user, live, what that file
 * will be called. A second implementation in the renderer would be a promise
 * the main process is free to break.
 *
 * Pure, no imports beyond the type — the same constraint as the rest of
 * `src/shared`.
 */

import type { TextFormat } from './types'

/** The extension each format is stored with. */
export const TEXT_FORMAT_EXTENSION: Record<TextFormat, string> = {
  markdown: 'md',
  text: 'txt',
}

/** Extensions that mean "this is one of ours", for the swap in `documentFilename`. */
const OWN_EXTENSIONS = new Set(['md', 'markdown', 'txt'])

export function extensionForFormat(format: TextFormat): string {
  return TEXT_FORMAT_EXTENSION[format]
}

/**
 * A display name plus a format -> the filename to store.
 *
 *   ('Ôn tập buổi 3', markdown)   -> 'Ôn tập buổi 3.md'
 *   ('ghi-chu.md',    markdown)   -> 'ghi-chu.md'          (already right)
 *   ('ghi-chu.txt',   markdown)   -> 'ghi-chu.md'          (format won)
 *   ('Spring v1.2',   markdown)   -> 'Spring v1.2.md'      (not an extension)
 *
 * Only *our own* extensions are swapped. `v1.2` ends in something that looks
 * like an extension and is not one; appending blindly would give
 * `ghi-chu.txt.md` for the third case. Both are the kind of small wrongness a
 * user notices immediately in a file manager.
 */
export function documentFilename(rawName: string, format: TextFormat): string {
  const name = (rawName ?? '').trim().replace(/\s+/g, ' ')
  const target = extensionForFormat(format)

  const dot = name.lastIndexOf('.')
  const existing = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''

  const stem = OWN_EXTENSIONS.has(existing) ? name.slice(0, dot) : name
  return `${stem}.${target}`
}
