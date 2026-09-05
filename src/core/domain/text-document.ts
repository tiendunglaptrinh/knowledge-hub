/**
 * Text a user typed here, on its way to becoming a file in the vault.
 *
 * Two features share this: a **note**, which is its own entity, and a
 * **composed document**, which is an ordinary asset on an item whose bytes came
 * from the editor rather than from the file dialog. Once written, a composed
 * document is indistinguishable from an uploaded `.md` — same table, same
 * viewer, same search index. That is the point: the application should not
 * grow a second class of document just because of where the bytes came from.
 *
 * The filename rules live in `src/shared/text-format.ts` because the renderer
 * needs them too, to show the user what their file will be called while they
 * are still naming it.
 */

import type { AssetKind } from '../../shared/types'

export {
  documentFilename,
  extensionForFormat,
  TEXT_FORMAT_EXTENSION,
} from '../../shared/text-format'

/**
 * Whether the editor can open an asset.
 *
 * Derived from the kind, so it follows `classifyAsset` and needs no column. A
 * `.docx` is deliberately excluded: mammoth converts one way only, and writing
 * back an approximation of a Word document would silently destroy formatting
 * the user never asked us to touch.
 */
export function isEditableKind(kind: AssetKind): boolean {
  return kind === 'markdown' || kind === 'text'
}

/**
 * Ceiling on a document typed in the editor: 5 MB of text.
 *
 * Far below `MAX_ASSET_BYTES`, because this is not a file someone brought — it
 * is something typed into a textarea, and a five-megabyte one means something
 * has gone wrong (a paste loop, a generated dump) rather than that someone
 * wrote a long essay.
 */
export const MAX_COMPOSED_BYTES = 5 * 1024 * 1024
