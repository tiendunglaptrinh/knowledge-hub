/**
 * Notes — the things you write here, rather than the files you brought.
 *
 * Structurally the simplest service in the application: one table, no assets,
 * no category, no tags. It still follows the same three-phase shape as
 * `ItemService`, because the reason for that shape has not changed:
 *
 *   1. sync, before the transaction — validate and normalise
 *   2. sync, inside one transaction — the row and its index entry, together
 *   3. async, after commit — the Markdown/text mirror in the vault, best-effort
 *
 * See docs/03-architecture.md#transactions.
 */

import type { NoteRepository, NoteStore, UnitOfWork } from '../../core/ports/repositories'
import type {
  CreateNoteInput,
  Note,
  NoteFormat,
  NoteKind,
  NoteListInput,
  NoteSummary,
  UpdateNoteInput,
} from '../../shared/types'
import { AppError, ErrorCode } from '../../shared/errors'
import { newId, nowIso } from '../../core/domain/ids'
import {
  DEFAULT_NOTE_FORMAT,
  DEFAULT_NOTE_KIND,
  KIND_REQUIRING_DUE_DATE,
  isNoteFormat,
  isNoteKind,
  noteFilename,
  toNoteFile,
} from '../../core/domain/note'

const TITLE_MAX = 200
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 500

export class NoteService {
  constructor(
    private readonly notes: NoteRepository,
    private readonly store: NoteStore,
    private readonly uow: UnitOfWork,
  ) {}

  // -------------------------------------------------------------- queries

  list(input: NoteListInput = {}): NoteSummary[] {
    const kind = input.kind === undefined ? undefined : requireKind(input.kind)
    const query = input.query?.trim()

    return this.notes.list(
      kind,
      query === undefined || query.length === 0 ? undefined : query,
      clampLimit(input.limit),
    )
  }

  get(id: string): Note {
    return this.require(id)
  }

  require(id: string): Note {
    const note = this.notes.findById(id)
    if (!note) {
      throw new AppError(ErrorCode.NOTE_NOT_FOUND, `no note with id ${id}`, { id })
    }
    return note
  }

  count(): number {
    return this.notes.count()
  }

  // -------------------------------------------------------------- commands

  async create(input: CreateNoteInput): Promise<Note> {
    const kind = input.kind === undefined ? DEFAULT_NOTE_KIND : requireKind(input.kind)
    const at = nowIso()

    const note: Note = {
      id: newId(),
      title: normaliseTitle(input.title),
      kind,
      format: input.format === undefined ? DEFAULT_NOTE_FORMAT : requireFormat(input.format),
      content: input.content ?? '',
      dueAt: normaliseDue(input.dueAt ?? null, kind),
      doneAt: null,
      relPath: '',
      createdAt: at,
      updatedAt: at,
    }

    this.uow.run(() => {
      this.notes.insert(note)
      this.notes.reindex(note.id, note.title, note.content)
    })

    return { ...note, relPath: await this.mirror(note) }
  }

  async update(input: UpdateNoteInput): Promise<Note> {
    const current = this.require(input.id)

    const kind = input.kind === undefined ? current.kind : requireKind(input.kind)

    // `dueAt` has three states and they are all meaningful: absent leaves the
    // date alone, null clears it, a string sets it. Collapsing the first two
    // would make every metadata edit silently drop the deadline.
    const dueAt = input.dueAt === undefined ? current.dueAt : normaliseDue(input.dueAt, kind)
    if (dueAt === null && kind === KIND_REQUIRING_DUE_DATE) {
      throw new AppError(ErrorCode.NOTE_DUE_REQUIRED, 'a deadline note needs a due date', { kind })
    }

    // Ticking an already-done note keeps the original completion time rather
    // than moving it, so "finished last Tuesday" stays true.
    const doneAt =
      input.done === undefined
        ? current.doneAt
        : input.done
          ? (current.doneAt ?? nowIso())
          : null

    const next: Note = {
      ...current,
      title: input.title === undefined ? current.title : normaliseTitle(input.title),
      kind,
      format: input.format === undefined ? current.format : requireFormat(input.format),
      content: input.content === undefined ? current.content : input.content,
      dueAt,
      doneAt,
      updatedAt: nowIso(),
    }

    this.uow.run(() => {
      this.notes.update(next)
      this.notes.reindex(next.id, next.title, next.content)
    })

    return { ...next, relPath: await this.mirror(next) }
  }

  async delete(id: string): Promise<{ id: string }> {
    const note = this.require(id)

    this.uow.run(() => {
      this.notes.removeFromIndex(id)
      this.notes.delete(id)
    })

    // After the commit, and deliberately not swallowed the way `mirror` is: a
    // file left behind after a delete is a copy of content the user asked to
    // destroy, which is worth reporting rather than hiding.
    await this.store.remove(note.id, note.createdAt, note.relPath || undefined)
    return { id }
  }

  // -------------------------------------------------------------- internals

  /**
   * Writes the note's file in the vault and records where it landed. Returns
   * the new path, or the old one if the write failed.
   *
   * Failure is swallowed: the mirror is a recovery aid, and losing it must not
   * lose the note the user just wrote. That is also why `rel_path` is set
   * *after* the transaction in its own small update rather than inside it —
   * the path is not known until the file exists, and a note with no file is a
   * valid state.
   */
  private async mirror(note: Note): Promise<string> {
    try {
      const relPath = await this.store.write({
        noteId: note.id,
        noteCreatedAt: note.createdAt,
        filename: noteFilename(note),
        contents: toNoteFile(note),
        previousRelPath: note.relPath || undefined,
      })

      if (relPath !== note.relPath) this.notes.setRelPath(note.id, relPath)
      return relPath
    } catch {
      // intentionally swallowed — see the doc comment
      return note.relPath
    }
  }
}

function normaliseTitle(raw: string): string {
  const title = (raw ?? '').trim().replace(/\s+/g, ' ')

  if (title.length === 0) {
    throw new AppError(ErrorCode.NOTE_TITLE_REQUIRED, 'note title is empty')
  }
  if (title.length > TITLE_MAX) {
    throw new AppError(ErrorCode.NOTE_TITLE_TOO_LONG, `note title exceeds ${TITLE_MAX} characters`, {
      max: TITLE_MAX,
      actual: title.length,
    })
  }
  return title
}

/**
 * Anything the caller sends is re-expressed as an ISO-8601 UTC string, so a
 * value from a browser `datetime-local` field and one from a future importer
 * end up identical in the column — which matters, because the list is ordered
 * by string comparison on it.
 */
function normaliseDue(raw: string | null, kind: string): string | null {
  if (raw === null || raw.trim().length === 0) {
    if (kind === KIND_REQUIRING_DUE_DATE) {
      throw new AppError(ErrorCode.NOTE_DUE_REQUIRED, 'a deadline note needs a due date', { kind })
    }
    return null
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(ErrorCode.NOTE_DUE_INVALID, `not a usable date: ${raw}`, { dueAt: raw })
  }
  return parsed.toISOString()
}

function requireKind(value: string): NoteKind {
  if (!isNoteKind(value)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `unknown note kind: ${value}`, { kind: value })
  }
  return value
}

function requireFormat(value: string): NoteFormat {
  if (!isNoteFormat(value)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `unknown note format: ${value}`, {
      format: value,
    })
  }
  return value
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_LIST_LIMIT
  return Math.min(Math.trunc(value), MAX_LIST_LIMIT)
}
