import type { Note, NoteKind, NoteSummary } from '../../shared/types'
import type { NoteRepository } from '../../core/ports/repositories'
import type { Db } from '../database'
import { toNote, toNoteSummary, type NoteRow, type NoteSummaryRow } from './rows'
import { toMatchExpression } from './fts'

/** Bind object for UPDATE — `createdAt` is immutable, so it is not bound. */
type NoteUpdateParams = Omit<Note, 'createdAt'>

/** Characters of the body kept for the card preview. */
const EXCERPT_CHARS = 280

/**
 * Ordering, in one place.
 *
 *   1. open before done              — a ticked-off note is history
 *   2. dated before undated          — a deadline is the reason to look here
 *   3. earliest due first            — overdue floats to the very top
 *   4. most recently edited          — for everything the above cannot separate
 *
 * `length(content)` is counted in SQLite rather than after mapping so the body
 * of a long note never crosses the repository boundary just to be measured.
 */
const NOTE_SUMMARY_SELECT = `
  SELECT n.id, n.title, n.kind, n.format, n.due_at, n.done_at, n.rel_path,
         n.created_at, n.updated_at,
         substr(n.content, 1, ${EXCERPT_CHARS}) AS excerpt,
         length(n.content)                      AS content_length
    FROM notes n
   {{WHERE}}
   ORDER BY (n.done_at IS NOT NULL) ASC,
            (n.due_at IS NULL)      ASC,
            n.due_at                ASC,
            n.updated_at            DESC
   LIMIT ?
`

function listSql(where: string): string {
  return NOTE_SUMMARY_SELECT.replace('{{WHERE}}', where)
}

/**
 * SQLite-backed notes.
 *
 * Four list statements rather than one built by string concatenation: the two
 * filters (kind, free text) are independent, and preparing the four
 * combinations once beats assembling SQL per call — and leaves no code path
 * where a value could be interpolated instead of bound.
 */
export class SqliteNoteRepository implements NoteRepository {
  private readonly stmt

  constructor(db: Db) {
    const matched = `n.id IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?)`

    this.stmt = {
      listAll: db.prepare<[number], NoteSummaryRow>(listSql('')),

      listByKind: db.prepare<[string, number], NoteSummaryRow>(listSql('WHERE n.kind = ?')),

      listMatching: db.prepare<[string, number], NoteSummaryRow>(listSql(`WHERE ${matched}`)),

      listByKindMatching: db.prepare<[string, string, number], NoteSummaryRow>(
        listSql(`WHERE n.kind = ? AND ${matched}`),
      ),

      findById: db.prepare<[string], NoteRow>(`SELECT * FROM notes WHERE id = ?`),

      insert: db.prepare<Note>(`
        INSERT INTO notes
          (id, title, kind, format, content, due_at, done_at, rel_path, created_at, updated_at)
        VALUES
          (@id, @title, @kind, @format, @content, @dueAt, @doneAt, @relPath, @createdAt, @updatedAt)
      `),

      update: db.prepare<NoteUpdateParams>(`
        UPDATE notes
           SET title = @title, kind = @kind, format = @format, content = @content,
               due_at = @dueAt, done_at = @doneAt, rel_path = @relPath,
               updated_at = @updatedAt
         WHERE id = @id
      `),

      delete: db.prepare<[string]>(`DELETE FROM notes WHERE id = ?`),

      count: db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM notes`),

      setRelPath: db.prepare<[string, string]>(`UPDATE notes SET rel_path = ? WHERE id = ?`),

      indexDelete: db.prepare<[string]>(`DELETE FROM notes_fts WHERE note_id = ?`),

      indexInsert: db.prepare<[string, string, string]>(
        `INSERT INTO notes_fts (note_id, title, content) VALUES (?, ?, ?)`,
      ),
    }
  }

  list(kind: NoteKind | undefined, query: string | undefined, limit: number): NoteSummary[] {
    // An unsearchable query (punctuation only) must return nothing rather than
    // silently degrading to "every note", which would look like a bug.
    const expression = query === undefined ? null : toMatchExpression(query)
    if (query !== undefined && expression === null) return []

    const rows =
      expression === null
        ? kind === undefined
          ? this.stmt.listAll.all(limit)
          : this.stmt.listByKind.all(kind, limit)
        : kind === undefined
          ? this.stmt.listMatching.all(expression, limit)
          : this.stmt.listByKindMatching.all(kind, expression, limit)

    return rows.map(toNoteSummary)
  }

  findById(id: string): Note | null {
    const row = this.stmt.findById.get(id)
    return row ? toNote(row) : null
  }

  insert(note: Note): void {
    this.stmt.insert.run(note)
  }

  update(note: Note): void {
    const { createdAt: _createdAt, ...params } = note
    this.stmt.update.run(params)
  }

  delete(id: string): void {
    this.stmt.delete.run(id)
  }

  count(): number {
    return this.stmt.count.get()?.n ?? 0
  }

  /**
   * Records where the mirror landed, after it has landed. Separate from
   * `update` because writing the file is best-effort and happens *after* the
   * transaction — so this is the one write that is allowed to be late.
   */
  setRelPath(id: string, relPath: string): void {
    this.stmt.setRelPath.run(relPath, id)
  }

  reindex(noteId: string, title: string, content: string): void {
    this.stmt.indexDelete.run(noteId)
    this.stmt.indexInsert.run(noteId, title, content)
  }

  removeFromIndex(noteId: string): void {
    this.stmt.indexDelete.run(noteId)
  }
}
