/**
 * Maps a file extension to a viewer kind and a MIME type.
 *
 * `AssetKind` is derived at read time, never persisted. That is deliberate:
 * teaching the app to render a new format must be a change to this table plus
 * a renderer component — never a database migration over existing rows.
 * See docs/04-data-model.md#derived-not-stored.
 */

import type { AssetKind } from '../../shared/types'

interface FormatSpec {
  kind: AssetKind
  mime: string
}

/** Extension (lowercase, no dot) -> how to treat it. */
const FORMATS: Record<string, FormatSpec> = {
  // rendered as HTML from Markdown source
  md: { kind: 'markdown', mime: 'text/markdown' },
  markdown: { kind: 'markdown', mime: 'text/markdown' },
  mdx: { kind: 'markdown', mime: 'text/markdown' },

  // rendered by Chromium's built-in PDF viewer
  pdf: { kind: 'pdf', mime: 'application/pdf' },

  // converted to HTML by mammoth in the main process
  docx: {
    kind: 'word',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },

  // shown as-is in a <pre>
  txt: { kind: 'text', mime: 'text/plain' },
  log: { kind: 'text', mime: 'text/plain' },
  csv: { kind: 'text', mime: 'text/csv' },
  json: { kind: 'text', mime: 'application/json' },
  yaml: { kind: 'text', mime: 'text/yaml' },
  yml: { kind: 'text', mime: 'text/yaml' },
  sql: { kind: 'text', mime: 'text/plain' },
  java: { kind: 'text', mime: 'text/x-java-source' },
  ts: { kind: 'text', mime: 'text/plain' },
  tsx: { kind: 'text', mime: 'text/plain' },
  js: { kind: 'text', mime: 'text/javascript' },
  py: { kind: 'text', mime: 'text/x-python' },
  sh: { kind: 'text', mime: 'text/x-shellscript' },
  html: { kind: 'text', mime: 'text/plain' }, // as source, never executed
  xml: { kind: 'text', mime: 'text/xml' },

  // shown in an <img>
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  bmp: { kind: 'image', mime: 'image/bmp' },
}

/**
 * Formats with no in-app viewer. They are stored and listed like anything
 * else; the detail pane offers "open with the system application" instead.
 * Legacy .doc is here on purpose — mammoth reads the OOXML .docx container
 * only, and silently mis-rendering a binary .doc is worse than not trying.
 */
const FALLBACK: FormatSpec = { kind: 'other', mime: 'application/octet-stream' }

export function classifyAsset(ext: string): AssetKind {
  return (FORMATS[ext.toLowerCase()] ?? FALLBACK).kind
}

export function mimeForExtension(ext: string): string {
  return (FORMATS[ext.toLowerCase()] ?? FALLBACK).mime
}

/** Extensions offered in the native file dialog, grouped for readability. */
export const FILE_DIALOG_FILTERS = [
  {
    name: 'Tài liệu',
    extensions: ['pdf', 'docx', 'md', 'markdown', 'txt', 'csv', 'json', 'yaml', 'yml'],
  },
  { name: 'Hình ảnh', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
  { name: 'Tất cả tệp', extensions: ['*'] },
] as const

/** Hard ceiling per uploaded file: 200 MB. */
export const MAX_ASSET_BYTES = 200 * 1024 * 1024

/** Text-ish assets above this size are not indexed for full-text search. */
export const MAX_INDEXED_TEXT_BYTES = 2 * 1024 * 1024
