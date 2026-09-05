/**
 * Markdown -> sanitised HTML.
 *
 * One function, used by both places that render Markdown: the viewer for a
 * stored `.md` asset, and the review pane of the note editor. Parsing and
 * sanitising stay welded together — there is deliberately no exported
 * "parse without sanitising", because that is the shape of the bug this
 * arrangement exists to prevent.
 *
 * See docs/07-security.md and docs/05-ipc-contract.md#rendering.
 */

import DOMPurify, { type Config as PurifyConfig } from 'dompurify'
import { marked } from 'marked'

/**
 * Sanitiser profile.
 *
 * The HTML being cleaned comes from the user's own files and their own typing,
 * so this is not defending against a remote attacker so much as against a
 * malformed or booby-trapped document. Anything that can execute or phone out
 * is dropped; `data:` images survive because that is how mammoth embeds
 * pictures.
 */
export const PURIFY_CONFIG: PurifyConfig = {
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
  ALLOW_DATA_ATTR: false,
}

/** Markdown source -> HTML safe to hand to `dangerouslySetInnerHTML`. */
export function renderMarkdown(source: string): string {
  // `marked.parse` is synchronous unless async options are enabled.
  const raw = marked.parse(source, { async: false, gfm: true, breaks: false })
  return DOMPurify.sanitize(raw, PURIFY_CONFIG)
}

/** Already-HTML (mammoth's `.docx` conversion) -> the same guarantee. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG)
}
