/**
 * Pure note rules: the closed sets, and how a note becomes a file.
 *
 * No storage, no Electron — the same constraint as the rest of `src/core`.
 * The Vietnamese labels for these kinds live in the renderer, because they are
 * display text and this layer has no language.
 */

import type { Note, NoteFormat, NoteKind } from '../../shared/types'
import { extensionForFormat } from '../../shared/text-format'

/**
 * Every kind, in the order the UI offers them. Mirrors the `CHECK` constraint
 * in migration 2 — the two are kept in step by hand, and `NoteKind` makes a
 * disagreement between this list and the type a compile error.
 */
export const NOTE_KINDS: readonly NoteKind[] = [
  'study',
  'daily',
  'deadline',
  'task',
  'idea',
  'meeting',
  'snippet',
  'other',
]

export const NOTE_FORMATS: readonly NoteFormat[] = ['markdown', 'text']

/** The kind assigned when the caller does not choose one. */
export const DEFAULT_NOTE_KIND: NoteKind = 'study'
export const DEFAULT_NOTE_FORMAT: NoteFormat = 'markdown'

/**
 * The only kind that insists on a date.
 *
 * A note labelled *Hạn chót* with no deadline is not a deadline; it also
 * cannot do the one thing the label promises, which is to sort itself to the
 * top of the list before the date arrives.
 */
export const KIND_REQUIRING_DUE_DATE: NoteKind = 'deadline'

export function isNoteKind(value: unknown): value is NoteKind {
  return typeof value === 'string' && (NOTE_KINDS as readonly string[]).includes(value)
}

export function isNoteFormat(value: unknown): value is NoteFormat {
  return value === 'markdown' || value === 'text'
}

export function noteExtension(format: NoteFormat): string {
  return extensionForFormat(format)
}

/** `Ôn tập Spring Security` -> `Ôn tập Spring Security.md`. */
export function noteFilename(note: Pick<Note, 'title' | 'format'>): string {
  return `${note.title}.${noteExtension(note.format)}`
}

/**
 * The note as it is written to disk: YAML front matter, then the body.
 *
 * Front matter rather than a JSON sidecar because a note is *already* a text
 * file — a second file beside it to say what it is would be worse than the
 * convention every Markdown tool already understands. A `.txt` note carries
 * the same header: it costs four lines and keeps one recovery format instead
 * of two.
 *
 * Values use YAML's single-quoted style, where the only escape is a doubled
 * `''`. That is enough here because every field is either an ISO timestamp, a
 * value from a closed set, or a title that has already had its whitespace
 * collapsed to single spaces — so none of them can contain a line break.
 */
export function toNoteFile(note: Note): string {
  const front = [
    '---',
    `id: ${quote(note.id)}`,
    `title: ${quote(note.title)}`,
    `kind: ${quote(note.kind)}`,
    `format: ${quote(note.format)}`,
    `dueAt: ${note.dueAt === null ? 'null' : quote(note.dueAt)}`,
    `doneAt: ${note.doneAt === null ? 'null' : quote(note.doneAt)}`,
    `createdAt: ${quote(note.createdAt)}`,
    `updatedAt: ${quote(note.updatedAt)}`,
    '---',
    '',
  ].join('\n')

  return `${front}${note.content}\n`
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
