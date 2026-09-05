/**
 * Pure checklist rules: the closed sets, how priority becomes an order, and
 * what counts as a day.
 *
 * No storage, no Electron — the same constraint as the rest of `src/core`.
 * The Vietnamese labels for these values live in the renderer, because they
 * are display text and this layer has no language.
 */

import type {
  ChecklistKind,
  ChecklistTask,
  EisenhowerQuadrant,
  TaskPriority,
  TaskStatus,
} from '../../shared/types'

/** Mirrors the `CHECK` constraints in migration 4; kept in step by hand. */
export const CHECKLIST_KINDS: readonly ChecklistKind[] = ['daily', 'module']
export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done']
export const TASK_PRIORITIES: readonly TaskPriority[] = ['high', 'normal']
export const EISENHOWER_QUADRANTS: readonly EisenhowerQuadrant[] = [
  'do',
  'schedule',
  'delegate',
  'eliminate',
]

export const DEFAULT_TASK_STATUS: TaskStatus = 'todo'
export const DEFAULT_TASK_PRIORITY: TaskPriority = 'normal'

/**
 * The quadrant a task falls into when nobody chose one.
 *
 * `schedule` — important but not urgent — rather than `do`: a task nobody has
 * classified is not evidence that it is on fire, and defaulting to the top
 * quadrant would fill it with everything and make the matrix meaningless.
 */
export const DEFAULT_QUADRANT: EisenhowerQuadrant = 'schedule'

/**
 * How the groups stack, smallest first.
 *
 * This is the "automatic sorting" the module checklist promises, and it is
 * expressed once, here, so the repository's `ORDER BY`, the service's tree
 * builder and any future report cannot disagree about it.
 */
export const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1 }

export const QUADRANT_RANK: Record<EisenhowerQuadrant, number> = {
  do: 0,
  schedule: 1,
  delegate: 2,
  eliminate: 3,
}

/** Task limits. A plan longer than this is a project, not a checklist. */
export const CHECKLIST_TITLE_MAX = 200
export const TASK_TITLE_MAX = 200
export const DESCRIPTION_MAX = 2000
export const MAX_TASKS_PER_CHECKLIST = 500

export function isChecklistKind(value: unknown): value is ChecklistKind {
  return value === 'daily' || value === 'module'
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return value === 'high' || value === 'normal'
}

export function isEisenhowerQuadrant(value: unknown): value is EisenhowerQuadrant {
  return (
    typeof value === 'string' && (EISENHOWER_QUADRANTS as readonly string[]).includes(value)
  )
}

/**
 * `2026-09-05` and nothing else.
 *
 * A calendar day, not an instant: the plan for the 5th belongs to the 5th in
 * the user's own timezone, and storing it as a UTC timestamp would move it to
 * the 4th for anyone east of Greenwich after 17:00. The round-trip check
 * rejects `2026-02-31`, which the regular expression alone would accept.
 */
export function isDayString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * Which priority group a task belongs to, as a number.
 *
 * Sub-tasks have no priority of their own — they inherit the standing of the
 * task they break down — so they all share rank 0 and are ordered purely by
 * `sortOrder`. That is also what makes the drag rule trivially true for them:
 * every sibling is in the same group.
 */
export function rankOf(task: Pick<ChecklistTask, 'parentId' | 'priority' | 'quadrant'>): number {
  if (task.parentId !== null) return 0
  if (task.quadrant !== null) return QUADRANT_RANK[task.quadrant]
  if (task.priority !== null) return PRIORITY_RANK[task.priority]
  return PRIORITY_RANK[DEFAULT_TASK_PRIORITY]
}

/**
 * The group two tasks must share before one may be dragged past the other.
 * Compared as a string so a `daily` task and a `module` task can never be
 * judged equal by their rank number colliding.
 */
export function groupKeyOf(
  task: Pick<ChecklistTask, 'parentId' | 'priority' | 'quadrant'>,
): string {
  if (task.parentId !== null) return 'child'
  if (task.quadrant !== null) return `q:${task.quadrant}`
  if (task.priority !== null) return `p:${task.priority}`
  return `p:${DEFAULT_TASK_PRIORITY}`
}

/**
 * The order tasks are always presented in: priority group first, then the
 * user's own arrangement inside it, then creation time as the tie-break so
 * two tasks added in the same second never swap places between renders.
 */
export function compareTasks(a: ChecklistTask, b: ChecklistTask): number {
  const byRank = rankOf(a) - rankOf(b)
  if (byRank !== 0) return byRank
  const byOrder = a.sortOrder - b.sortOrder
  if (byOrder !== 0) return byOrder
  return a.createdAt.localeCompare(b.createdAt)
}

/**
 * A parent's status follows its break-down, because the alternative is a big
 * task marked *Đã xong* sitting above three sub-tasks that are not.
 *
 *   every child done          -> done
 *   any child done or doing   -> doing
 *   otherwise                 -> todo
 */
export function statusFromChildren(children: readonly Pick<ChecklistTask, 'status'>[]): TaskStatus {
  if (children.length === 0) return DEFAULT_TASK_STATUS
  if (children.every((child) => child.status === 'done')) return 'done'
  if (children.some((child) => child.status !== 'todo')) return 'doing'
  return 'todo'
}
