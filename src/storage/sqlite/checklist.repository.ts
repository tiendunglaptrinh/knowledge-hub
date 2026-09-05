import type { Checklist, ChecklistKind, ChecklistTask } from '../../shared/types'
import type { ChecklistRepository } from '../../core/ports/repositories'
import type { Db } from '../database'
import {
  toChecklist,
  toChecklistTask,
  type ChecklistRow,
  type ChecklistTaskRow,
} from './rows'

/** Bind object for UPDATE — `createdAt` and `kind` are immutable. */
type ChecklistUpdateParams = Omit<Checklist, 'createdAt' | 'kind'>
type TaskUpdateParams = Omit<ChecklistTask, 'createdAt' | 'checklistId'>

/**
 * Coarse ordering only.
 *
 *   1. dated plans by day, newest first — today is what you came here for
 *   2. undated (module) plans by recency
 *
 * Within a plan, tasks come back grouped by parent and by `sort_order`; the
 * priority rank that decides the *groups* is applied by the service, for the
 * reason given on `ChecklistRepository`.
 */
const CHECKLIST_SELECT = `
  SELECT c.* FROM checklists c
   {{WHERE}}
   ORDER BY (c.day IS NULL) ASC, c.day DESC, c.updated_at DESC
   LIMIT ?
`

function listSql(where: string): string {
  return CHECKLIST_SELECT.replace('{{WHERE}}', where)
}

/**
 * SQLite-backed checklists.
 *
 * Four prepared list statements rather than one assembled per call, matching
 * `SqliteNoteRepository`: the two filters (kind, day range) are independent,
 * and preparing the combinations up front leaves no code path where a value
 * could be interpolated instead of bound.
 */
export class SqliteChecklistRepository implements ChecklistRepository {
  private readonly stmt

  constructor(private readonly db: Db) {
    const inRange = `c.day IS NOT NULL AND c.day >= ? AND c.day <= ?`

    this.stmt = {
      listAll: db.prepare<[number], ChecklistRow>(listSql('')),
      listByKind: db.prepare<[string, number], ChecklistRow>(listSql('WHERE c.kind = ?')),
      listInRange: db.prepare<[string, string, number], ChecklistRow>(
        listSql(`WHERE ${inRange}`),
      ),
      listByKindInRange: db.prepare<[string, string, string, number], ChecklistRow>(
        listSql(`WHERE c.kind = ? AND ${inRange}`),
      ),

      findById: db.prepare<[string], ChecklistRow>(`SELECT * FROM checklists WHERE id = ?`),
      findByDay: db.prepare<[string], ChecklistRow>(`SELECT * FROM checklists WHERE day = ?`),

      insert: db.prepare<Checklist>(`
        INSERT INTO checklists
          (id, kind, day, title, description, due_at, created_at, updated_at)
        VALUES
          (@id, @kind, @day, @title, @description, @dueAt, @createdAt, @updatedAt)
      `),

      update: db.prepare<ChecklistUpdateParams>(`
        UPDATE checklists
           SET day = @day, title = @title, description = @description,
               due_at = @dueAt, updated_at = @updatedAt
         WHERE id = @id
      `),

      delete: db.prepare<[string]>(`DELETE FROM checklists WHERE id = ?`),
      count: db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM checklists`),

      tasksFor: db.prepare<[string], ChecklistTaskRow>(`
        SELECT * FROM checklist_tasks
         WHERE checklist_id = ?
         ORDER BY sort_order ASC, created_at ASC
      `),

      findTaskById: db.prepare<[string], ChecklistTaskRow>(
        `SELECT * FROM checklist_tasks WHERE id = ?`,
      ),

      insertTask: db.prepare<ChecklistTask>(`
        INSERT INTO checklist_tasks
          (id, checklist_id, parent_id, title, description, due_at, status,
           priority, quadrant, sort_order, done_at, created_at, updated_at)
        VALUES
          (@id, @checklistId, @parentId, @title, @description, @dueAt, @status,
           @priority, @quadrant, @sortOrder, @doneAt, @createdAt, @updatedAt)
      `),

      updateTask: db.prepare<TaskUpdateParams>(`
        UPDATE checklist_tasks
           SET parent_id = @parentId, title = @title, description = @description,
               due_at = @dueAt, status = @status, priority = @priority,
               quadrant = @quadrant, sort_order = @sortOrder, done_at = @doneAt,
               updated_at = @updatedAt
         WHERE id = @id
      `),

      deleteTask: db.prepare<[string]>(`DELETE FROM checklist_tasks WHERE id = ?`),

      countTasks: db.prepare<[string], { n: number }>(
        `SELECT COUNT(*) AS n FROM checklist_tasks WHERE checklist_id = ?`,
      ),

      // COALESCE, because MAX over no rows is NULL and the first task of a
      // group has to land at 0 rather than at NaN.
      nextSortOrderRoot: db.prepare<[string], { next: number }>(`
        SELECT COALESCE(MAX(sort_order) + 1, 0) AS next
          FROM checklist_tasks
         WHERE checklist_id = ? AND parent_id IS NULL
      `),

      nextSortOrderChild: db.prepare<[string, string], { next: number }>(`
        SELECT COALESCE(MAX(sort_order) + 1, 0) AS next
          FROM checklist_tasks
         WHERE checklist_id = ? AND parent_id = ?
      `),
    }
  }

  list(
    kind: ChecklistKind | undefined,
    from: string | undefined,
    to: string | undefined,
    limit: number,
  ): Checklist[] {
    // A half-open range is treated as no range at all: "from the 1st" with no
    // end is ambiguous enough that guessing would be worse than ignoring it.
    const ranged = from !== undefined && to !== undefined

    const rows = ranged
      ? kind === undefined
        ? this.stmt.listInRange.all(from, to, limit)
        : this.stmt.listByKindInRange.all(kind, from, to, limit)
      : kind === undefined
        ? this.stmt.listAll.all(limit)
        : this.stmt.listByKind.all(kind, limit)

    return rows.map(toChecklist)
  }

  findById(id: string): Checklist | null {
    const row = this.stmt.findById.get(id)
    return row ? toChecklist(row) : null
  }

  findByDay(day: string): Checklist | null {
    const row = this.stmt.findByDay.get(day)
    return row ? toChecklist(row) : null
  }

  insert(checklist: Checklist): void {
    this.stmt.insert.run(checklist)
  }

  update(checklist: Checklist): void {
    const { createdAt: _createdAt, kind: _kind, ...params } = checklist
    this.stmt.update.run(params)
  }

  delete(id: string): void {
    // The tasks go with it through ON DELETE CASCADE, which is only armed
    // because `foreign_keys = ON` is set when the connection opens.
    this.stmt.delete.run(id)
  }

  count(): number {
    return this.stmt.count.get()?.n ?? 0
  }

  tasksFor(checklistId: string): ChecklistTask[] {
    return this.stmt.tasksFor.all(checklistId).map(toChecklistTask)
  }

  /**
   * The one statement that cannot be prepared in the constructor: the number
   * of placeholders depends on how many plans the dashboard is tallying. The
   * ids are still *bound*, never interpolated — only the `?, ?, ?` is built.
   */
  tasksForMany(checklistIds: readonly string[]): ChecklistTask[] {
    if (checklistIds.length === 0) return []

    const placeholders = checklistIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare<string[], ChecklistTaskRow>(
        `SELECT * FROM checklist_tasks
          WHERE checklist_id IN (${placeholders})
          ORDER BY sort_order ASC, created_at ASC`,
      )
      .all(...checklistIds)

    return rows.map(toChecklistTask)
  }

  findTaskById(id: string): ChecklistTask | null {
    const row = this.stmt.findTaskById.get(id)
    return row ? toChecklistTask(row) : null
  }

  insertTask(task: ChecklistTask): void {
    this.stmt.insertTask.run(task)
  }

  updateTask(task: ChecklistTask): void {
    const { createdAt: _createdAt, checklistId: _checklistId, ...params } = task
    this.stmt.updateTask.run(params)
  }

  deleteTask(id: string): void {
    this.stmt.deleteTask.run(id)
  }

  countTasks(checklistId: string): number {
    return this.stmt.countTasks.get(checklistId)?.n ?? 0
  }

  nextSortOrder(checklistId: string, parentId: string | null): number {
    const row =
      parentId === null
        ? this.stmt.nextSortOrderRoot.get(checklistId)
        : this.stmt.nextSortOrderChild.get(checklistId, parentId)
    return row?.next ?? 0
  }
}
