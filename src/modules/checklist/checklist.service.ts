/**
 * Checklists — the plan you make before the day starts, and the plan you make
 * for a body of work that will not fit in one day.
 *
 * Same three-phase shape as the other services, minus the third phase: there
 * is no file behind a checklist, so it is
 *
 *   1. sync, before the transaction — validate and normalise
 *   2. sync, inside one transaction — the plan and every task, together
 *
 * "Together" is the point. A checklist may not exist without at least one
 * task, so creating one is a single atomic write of a parent row and its
 * children; a create that failed halfway would leave exactly the empty plan
 * the rule forbids.
 *
 * Three rules are enforced here and nowhere else, because they are the ones a
 * schema constraint cannot express:
 *
 *   - one plan per calendar day (the unique index catches the race; this
 *     catches it early enough to say something useful)
 *   - a plan is never empty — not at create, and not by deleting tasks down
 *     to zero
 *   - a task may only be dragged past another task of the *same* priority.
 *     The matrix orders the groups; the user orders what is inside one.
 *
 * See docs/03-architecture.md#transactions and docs/04-data-model.md.
 */

import type { ChecklistRepository, UnitOfWork } from '../../core/ports/repositories'
import type {
  AddChecklistTaskInput,
  Checklist,
  ChecklistDetail,
  ChecklistKind,
  ChecklistListInput,
  ChecklistStats,
  ChecklistStatsInput,
  ChecklistSummary,
  ChecklistTask,
  ChecklistTaskNode,
  CreateChecklistInput,
  DayProgress,
  EisenhowerQuadrant,
  MoveChecklistTaskInput,
  NewChecklistTask,
  Progress,
  TaskPriority,
  TaskStatus,
  UpdateChecklistInput,
  UpdateChecklistTaskInput,
} from '../../shared/types'
import { AppError, ErrorCode } from '../../shared/errors'
import { newId, nowIso } from '../../core/domain/ids'
import {
  CHECKLIST_TITLE_MAX,
  DEFAULT_QUADRANT,
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  DESCRIPTION_MAX,
  MAX_TASKS_PER_CHECKLIST,
  TASK_TITLE_MAX,
  compareTasks,
  groupKeyOf,
  isChecklistKind,
  isDayString,
  isEisenhowerQuadrant,
  isTaskPriority,
  isTaskStatus,
  statusFromChildren,
} from '../../core/domain/checklist'

const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 500

/** Enough for a month of daily plans plus every module plan on the dashboard. */
const STATS_LIMIT = 400

export class ChecklistService {
  constructor(
    private readonly checklists: ChecklistRepository,
    private readonly uow: UnitOfWork,
  ) {}

  // --------------------------------------------------------------- queries

  list(input: ChecklistListInput = {}): ChecklistSummary[] {
    const kind = input.kind === undefined ? undefined : requireKind(input.kind)
    const from = input.from === undefined ? undefined : requireDay(input.from)
    const to = input.to === undefined ? undefined : requireDay(input.to)

    const found = this.checklists.list(kind, from, to, clampLimit(input.limit))
    return this.summarise(found)
  }

  get(id: string): ChecklistDetail {
    return this.detail(this.require(id))
  }

  /** The plan for one calendar day, or null when that day has none yet. */
  findByDay(day: string): ChecklistDetail | null {
    const found = this.checklists.findByDay(requireDay(day))
    return found ? this.detail(found) : null
  }

  require(id: string): Checklist {
    const found = this.checklists.findById(id)
    if (!found) {
      throw new AppError(ErrorCode.CHECKLIST_NOT_FOUND, `no checklist with id ${id}`, { id })
    }
    return found
  }

  count(): number {
    return this.checklists.count()
  }

  /**
   * The dashboard's numbers.
   *
   * Computed from the rows rather than from a stored counter: a percentage in
   * a column is one more thing that can drift, and a month of plans is a few
   * hundred rows — cheaper to tally than to keep in step.
   */
  stats(input: ChecklistStatsInput): ChecklistStats {
    const from = requireDay(input.from)
    const to = requireDay(input.to)
    if (from > to) {
      throw new AppError(ErrorCode.CHECKLIST_DAY_INVALID, 'the range ends before it starts', {
        from,
        to,
      })
    }

    const daily = this.checklists.list('daily', from, to, STATS_LIMIT)
    // Module plans are not filtered by the range on purpose; see the comment
    // on `ChecklistStats.module`.
    const module = this.checklists.list('module', undefined, undefined, STATS_LIMIT)

    const byId = this.tasksByChecklist([...daily, ...module])

    const days: DayProgress[] = []
    let dailyDone = 0
    let dailyTotal = 0
    let dailyCompleted = 0

    for (const plan of daily) {
      const progress = progressOf(byId.get(plan.id) ?? [])
      dailyDone += progress.done
      dailyTotal += progress.total
      if (isComplete(progress)) dailyCompleted += 1

      // `day` is non-null for every `daily` row — the CHECK in migration 4
      // guarantees it — but the type does not know that.
      if (plan.day !== null) {
        days.push({ day: plan.day, checklistId: plan.id, ...toCounts(progress) })
      }
    }

    let moduleDone = 0
    let moduleTotal = 0
    let moduleCompleted = 0

    for (const plan of module) {
      const progress = progressOf(byId.get(plan.id) ?? [])
      moduleDone += progress.done
      moduleTotal += progress.total
      if (isComplete(progress)) moduleCompleted += 1
    }

    return {
      from,
      to,
      daily: {
        checklistCount: daily.length,
        completedCount: dailyCompleted,
        taskTotal: dailyTotal,
        taskDone: dailyDone,
        percent: percentOf(dailyDone, dailyTotal),
        // Ascending, so the dashboard's bars read left to right as a week does.
        days: days.sort((a, b) => a.day.localeCompare(b.day)),
      },
      module: {
        checklistCount: module.length,
        completedCount: moduleCompleted,
        taskTotal: moduleTotal,
        taskDone: moduleDone,
        percent: percentOf(moduleDone, moduleTotal),
      },
    }
  }

  // -------------------------------------------------------------- commands

  /**
   * Creates the plan and everything in it, in one transaction.
   *
   * The day check is done before the insert so the user is told *which* plan
   * already owns the date, rather than being handed a constraint violation.
   * The unique index is still the authority — two windows creating the plan
   * for the same day at the same moment is exactly what it is there for.
   */
  create(input: CreateChecklistInput): ChecklistDetail {
    const kind = requireKind(input.kind)
    const at = nowIso()

    const day = kind === 'daily' ? requireCreateDay(input.day) : null
    const title = kind === 'module' ? requireTitle(input.title) : rejectTitle(input.title)

    const seeds = input.tasks ?? []
    if (seeds.length === 0) {
      throw new AppError(ErrorCode.CHECKLIST_EMPTY, 'a checklist needs at least one task')
    }
    assertTaskBudget(countSeeds(seeds), 0)

    if (day !== null && this.checklists.findByDay(day) !== null) {
      throw new AppError(ErrorCode.CHECKLIST_DAY_TAKEN, `${day} already has a checklist`, { day })
    }

    const checklist: Checklist = {
      id: newId(),
      kind,
      day,
      title,
      description: normaliseDescription(input.description ?? null),
      // A daily plan is due at the end of its own day, which the day already
      // says; a second date on it could only contradict the first.
      dueAt: kind === 'module' ? normaliseDue(input.dueAt ?? null) : null,
      createdAt: at,
      updatedAt: at,
    }

    this.uow.run(() => {
      this.checklists.insert(checklist)

      seeds.forEach((seed, index) => {
        const parent = this.writeTask(checklist, seed, null, index, at)

        ;(seed.children ?? []).forEach((child, childIndex) => {
          this.writeTask(checklist, child, parent.id, childIndex, at)
        })

        // The big task's own state is whatever its break-down says, so a
        // wizard that pre-ticked two of three sub-tasks lands on `doing`
        // rather than on whatever the parent was typed as.
        if ((seed.children ?? []).length > 0) {
          this.syncParent(parent.id, at)
        }
      })
    })

    return this.detail(checklist)
  }

  /** Metadata only. Tasks are added, edited and moved one at a time. */
  update(input: UpdateChecklistInput): ChecklistDetail {
    const current = this.require(input.id)

    // A daily plan's identity is its day, and its day is not editable: moving
    // one to another date would either collide with that date's plan or
    // silently rewrite history. Delete it and make the other day's plan.
    const title =
      input.title === undefined
        ? current.title
        : current.kind === 'daily'
          ? rejectTitle(input.title)
          : requireTitle(input.title)

    const next: Checklist = {
      ...current,
      title,
      description:
        input.description === undefined
          ? current.description
          : normaliseDescription(input.description),
      dueAt:
        input.dueAt === undefined
          ? current.dueAt
          : current.kind === 'daily'
            ? null
            : normaliseDue(input.dueAt),
      updatedAt: nowIso(),
    }

    this.uow.run(() => this.checklists.update(next))
    return this.detail(next)
  }

  delete(id: string): { id: string } {
    this.require(id)
    // The tasks go with it: ON DELETE CASCADE in migration 4.
    this.uow.run(() => this.checklists.delete(id))
    return { id }
  }

  // ----------------------------------------------------------------- tasks

  addTask(input: AddChecklistTaskInput): ChecklistDetail {
    const checklist = this.require(input.checklistId)
    const at = nowIso()

    const parent = input.parentId ? this.requireTask(input.parentId) : null
    if (parent !== null) {
      if (parent.checklistId !== checklist.id) {
        throw new AppError(
          ErrorCode.CHECKLIST_TASK_NOT_FOUND,
          'the parent task belongs to another checklist',
          { parentId: parent.id },
        )
      }
      if (parent.parentId !== null) {
        throw new AppError(
          ErrorCode.CHECKLIST_TASK_NESTING_TOO_DEEP,
          'a sub-task cannot own sub-tasks',
          { parentId: parent.id },
        )
      }
    }

    const children = parent === null ? (input.children ?? []) : []
    assertTaskBudget(1 + children.length, this.checklists.countTasks(checklist.id))

    this.uow.run(() => {
      const base = this.checklists.nextSortOrder(checklist.id, parent?.id ?? null)
      const created = this.writeTask(checklist, input, parent?.id ?? null, base, at)

      children.forEach((child, index) => {
        this.writeTask(checklist, child, created.id, index, at)
      })

      if (children.length > 0) this.syncParent(created.id, at)
      // A new sub-task is not done, so the parent it was added to cannot
      // still be — that is the whole reason to add one.
      if (parent !== null) this.syncParent(parent.id, at)

      this.touch(checklist, at)
    })

    return this.get(checklist.id)
  }

  /**
   * Edits one task.
   *
   * Two knock-on effects, both of which exist so the tree can never show a
   * state that contradicts itself:
   *
   *   - ticking a big task ticks its whole break-down, and un-ticking it
   *     un-ticks the whole break-down. The user asked for the big task to be
   *     tickable; leaving three open sub-tasks under a finished parent would
   *     make the progress bar disagree with the checkbox.
   *   - changing a sub-task recomputes its parent. All done means done, any
   *     movement means `doing`.
   */
  updateTask(input: UpdateChecklistTaskInput): ChecklistDetail {
    const current = this.requireTask(input.id)
    const checklist = this.require(current.checklistId)
    const at = nowIso()

    const priority =
      input.priority === undefined
        ? current.priority
        : current.parentId !== null || checklist.kind !== 'daily'
          ? current.priority
          : requirePriority(input.priority)

    const quadrant =
      input.quadrant === undefined
        ? current.quadrant
        : current.parentId !== null || checklist.kind !== 'module'
          ? current.quadrant
          : requireQuadrant(input.quadrant)

    const status = input.status === undefined ? current.status : requireStatus(input.status)

    const next: ChecklistTask = {
      ...current,
      title: input.title === undefined ? current.title : normaliseTaskTitle(input.title),
      description:
        input.description === undefined
          ? current.description
          : normaliseDescription(input.description),
      dueAt: input.dueAt === undefined ? current.dueAt : normaliseDue(input.dueAt),
      status,
      priority,
      quadrant,
      // Ticking an already-done task keeps the original completion time rather
      // than moving it, exactly as a note does.
      doneAt: status === 'done' ? (current.doneAt ?? at) : null,
      updatedAt: at,
    }

    // Moving to another priority group puts the task at the end of the group
    // it arrives in. Any other position would be a guess, and the group it
    // left has no memory of where it used to sit.
    const regrouped = groupKeyOf(next) !== groupKeyOf(current)

    this.uow.run(() => {
      this.checklists.updateTask(
        regrouped
          ? { ...next, sortOrder: this.checklists.nextSortOrder(checklist.id, next.parentId) }
          : next,
      )

      if (input.status !== undefined) {
        if (current.parentId === null) this.cascadeToChildren(current.id, status, at)
        else this.syncParent(current.parentId, at)
      }

      this.touch(checklist, at)
    })

    return this.get(checklist.id)
  }

  /**
   * Removes a task and its break-down.
   *
   * Refuses to remove the last top-level task: an empty checklist is the state
   * `create` exists to prevent, and reaching it by deletion instead would make
   * the rule a formality. Delete the plan itself if that is what is meant.
   */
  deleteTask(id: string): ChecklistDetail {
    const task = this.requireTask(id)
    const checklist = this.require(task.checklistId)
    const at = nowIso()

    if (task.parentId === null) {
      const roots = this.checklists
        .tasksFor(checklist.id)
        .filter((candidate) => candidate.parentId === null)

      if (roots.length <= 1) {
        throw new AppError(
          ErrorCode.CHECKLIST_EMPTY,
          'this is the last task; delete the checklist instead',
          { checklistId: checklist.id },
        )
      }
    }

    this.uow.run(() => {
      this.checklists.deleteTask(id)
      if (task.parentId !== null) this.syncParent(task.parentId, at)
      this.touch(checklist, at)
    })

    return this.get(checklist.id)
  }

  /**
   * Drag-and-drop, with the one restriction the matrix implies.
   *
   * Both tasks must be siblings and carry the same priority. A task cannot be
   * dragged above one that outranks it — not because the UI forbids the
   * gesture, but because the resulting order would be re-sorted away on the
   * next read and the move would look like it silently failed.
   */
  moveTask(input: MoveChecklistTaskInput): ChecklistDetail {
    const moved = this.requireTask(input.id)
    const target = this.requireTask(input.targetId)
    const checklist = this.require(moved.checklistId)
    const at = nowIso()

    if (moved.id === target.id) return this.get(checklist.id)

    if (target.checklistId !== moved.checklistId || target.parentId !== moved.parentId) {
      throw new AppError(
        ErrorCode.CHECKLIST_TASK_MOVE_INVALID,
        'a task can only be reordered among its own siblings',
        { id: moved.id, targetId: target.id },
      )
    }

    if (groupKeyOf(moved) !== groupKeyOf(target)) {
      throw new AppError(
        ErrorCode.CHECKLIST_TASK_PRIORITY_MISMATCH,
        'a task can only be reordered within its own priority group',
        { from: groupKeyOf(moved), to: groupKeyOf(target) },
      )
    }

    const siblings = this.checklists
      .tasksFor(checklist.id)
      .filter((candidate) => candidate.parentId === moved.parentId)
      .sort(compareTasks)

    const without = siblings.filter((candidate) => candidate.id !== moved.id)
    const targetIndex = without.findIndex((candidate) => candidate.id === target.id)
    const index = input.position === 'after' ? targetIndex + 1 : targetIndex
    without.splice(index, 0, moved)

    this.uow.run(() => {
      // Renumbered across the whole sibling set, not just the group: the list
      // is already in rank order, so consecutive numbers keep every group
      // contiguous and leave no gaps for a later insert to fall into.
      without.forEach((sibling, position) => {
        if (sibling.sortOrder === position) return
        this.checklists.updateTask({ ...sibling, sortOrder: position, updatedAt: at })
      })
      this.touch(checklist, at)
    })

    return this.get(checklist.id)
  }

  // ------------------------------------------------------------- internals

  private requireTask(id: string): ChecklistTask {
    const found = this.checklists.findTaskById(id)
    if (!found) {
      throw new AppError(ErrorCode.CHECKLIST_TASK_NOT_FOUND, `no task with id ${id}`, { id })
    }
    return found
  }

  /** Inserts one task row from a seed. Callers supply the position. */
  private writeTask(
    checklist: Checklist,
    seed: NewChecklistTask,
    parentId: string | null,
    position: number,
    at: string,
  ): ChecklistTask {
    const status = seed.status === undefined ? DEFAULT_TASK_STATUS : requireStatus(seed.status)

    const task: ChecklistTask = {
      id: newId(),
      checklistId: checklist.id,
      parentId,
      title: normaliseTaskTitle(seed.title),
      description: normaliseDescription(seed.description ?? null),
      dueAt: normaliseDue(seed.dueAt ?? null),
      status,
      // A sub-task carries neither: it inherits the standing of the task it
      // breaks down, which is what keeps the drag rule true for its siblings.
      priority:
        parentId !== null || checklist.kind !== 'daily'
          ? null
          : seed.priority === undefined
            ? DEFAULT_TASK_PRIORITY
            : requirePriority(seed.priority),
      quadrant:
        parentId !== null || checklist.kind !== 'module'
          ? null
          : seed.quadrant === undefined
            ? DEFAULT_QUADRANT
            : requireQuadrant(seed.quadrant),
      sortOrder: position,
      doneAt: status === 'done' ? at : null,
      createdAt: at,
      updatedAt: at,
    }

    this.checklists.insertTask(task)
    return task
  }

  /** Ticking or un-ticking a big task carries its whole break-down with it. */
  private cascadeToChildren(parentId: string, status: TaskStatus, at: string): void {
    // `doing` is left to spread upwards only: a parent can be in progress
    // while its sub-tasks have not started, and forcing three sub-tasks into
    // `doing` would claim work that has not begun.
    if (status === 'doing') return

    const children = this.childrenOf(parentId)
    for (const child of children) {
      if (child.status === status) continue
      this.checklists.updateTask({
        ...child,
        status,
        doneAt: status === 'done' ? (child.doneAt ?? at) : null,
        updatedAt: at,
      })
    }
  }

  /** Recomputes a big task's state from its break-down. */
  private syncParent(parentId: string, at: string): void {
    const parent = this.checklists.findTaskById(parentId)
    if (!parent) return

    const children = this.childrenOf(parentId)
    if (children.length === 0) return

    const status = statusFromChildren(children)
    if (status === parent.status) return

    this.checklists.updateTask({
      ...parent,
      status,
      doneAt: status === 'done' ? (parent.doneAt ?? at) : null,
      updatedAt: at,
    })
  }

  private childrenOf(parentId: string): ChecklistTask[] {
    const parent = this.checklists.findTaskById(parentId)
    if (!parent) return []
    return this.checklists
      .tasksFor(parent.checklistId)
      .filter((candidate) => candidate.parentId === parentId)
  }

  /**
   * Bumps the plan's `updatedAt` when something below it changes, the same way
   * `ItemRepository.touch` does for an item whose asset moved.
   */
  private touch(checklist: Checklist, at: string): void {
    this.checklists.update({ ...checklist, updatedAt: at })
  }

  private detail(checklist: Checklist): ChecklistDetail {
    const tasks = this.checklists.tasksFor(checklist.id)
    return { ...checklist, tasks: toTree(tasks), progress: progressOf(tasks) }
  }

  private summarise(found: Checklist[]): ChecklistSummary[] {
    const byId = this.tasksByChecklist(found)

    return found.map((checklist) => {
      const tasks = byId.get(checklist.id) ?? []
      return {
        ...checklist,
        progress: progressOf(tasks),
        taskCount: tasks.filter((task) => task.parentId === null).length,
      }
    })
  }

  /** One query for every plan on screen, rather than one query per card. */
  private tasksByChecklist(found: Checklist[]): Map<string, ChecklistTask[]> {
    const byId = new Map<string, ChecklistTask[]>()
    for (const task of this.checklists.tasksForMany(found.map((c) => c.id))) {
      const bucket = byId.get(task.checklistId)
      if (bucket) bucket.push(task)
      else byId.set(task.checklistId, [task])
    }
    return byId
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Flat rows -> the two-level tree the UI renders, sorted by priority rank and
 * then by the user's own arrangement. Orphans — a sub-task whose parent was
 * removed between the two reads — are surfaced as top-level tasks rather than
 * dropped, because a task nobody can see is a task nobody will do.
 */
function toTree(tasks: readonly ChecklistTask[]): ChecklistTaskNode[] {
  const roots = new Map<string, ChecklistTaskNode>()
  const orphans: ChecklistTask[] = []

  for (const task of tasks) {
    if (task.parentId === null) {
      roots.set(task.id, { ...task, children: [], progress: leafProgress(task) })
    }
  }

  for (const task of tasks) {
    if (task.parentId === null) continue
    const parent = roots.get(task.parentId)
    if (parent) parent.children.push({ ...task, children: [], progress: leafProgress(task) })
    else orphans.push(task)
  }

  for (const orphan of orphans) {
    roots.set(orphan.id, {
      ...orphan,
      parentId: null,
      children: [],
      progress: leafProgress(orphan),
    })
  }

  const ordered = [...roots.values()].sort(compareTasks)
  for (const root of ordered) {
    root.children.sort(compareTasks)
    if (root.children.length > 0) {
      root.progress = tally(root.children.map((child) => child.status))
    }
  }
  return ordered
}

function leafProgress(task: Pick<ChecklistTask, 'status'>): Progress {
  return tally([task.status])
}

function tally(statuses: readonly TaskStatus[]): Progress {
  const done = statuses.filter((status) => status === 'done').length
  return { total: statuses.length, done, percent: percentOf(done, statuses.length) }
}

/**
 * A plan's progress, counted over *leaf* tasks only.
 *
 * Breaking one big task into three sub-tasks must not make the day look four
 * tasks long, and a big task must not count as finished separately from the
 * work that finishes it.
 */
function progressOf(tasks: readonly ChecklistTask[]): Progress {
  const parents = new Set<string>()
  for (const task of tasks) {
    if (task.parentId !== null) parents.add(task.parentId)
  }

  const leaves = tasks.filter((task) => !parents.has(task.id))
  return tally(leaves.map((task) => task.status))
}

function percentOf(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((done / total) * 100)
}

function isComplete(progress: Progress): boolean {
  return progress.total > 0 && progress.done === progress.total
}

function toCounts(progress: Progress): { total: number; done: number; percent: number } {
  return { total: progress.total, done: progress.done, percent: progress.percent }
}

function countSeeds(seeds: readonly NewChecklistTask[]): number {
  return seeds.reduce((sum, seed) => sum + 1 + (seed.children?.length ?? 0), 0)
}

function assertTaskBudget(adding: number, existing: number): void {
  if (existing + adding > MAX_TASKS_PER_CHECKLIST) {
    throw new AppError(
      ErrorCode.CHECKLIST_TOO_MANY_TASKS,
      `a checklist holds at most ${MAX_TASKS_PER_CHECKLIST} tasks`,
      { max: MAX_TASKS_PER_CHECKLIST, existing, adding },
    )
  }
}

function normaliseTitleText(raw: string): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ')
}

function requireTitle(raw: string | undefined): string {
  const title = normaliseTitleText(raw ?? '')
  if (title.length === 0) {
    throw new AppError(ErrorCode.CHECKLIST_TITLE_REQUIRED, 'checklist title is empty')
  }
  if (title.length > CHECKLIST_TITLE_MAX) {
    throw new AppError(
      ErrorCode.CHECKLIST_TITLE_TOO_LONG,
      `checklist title exceeds ${CHECKLIST_TITLE_MAX} characters`,
      { max: CHECKLIST_TITLE_MAX, actual: title.length },
    )
  }
  return title
}

/**
 * A daily plan is titled by its date. Accepting a second name for it would
 * mean two answers to "which day is this?", so an attempt to set one is an
 * error rather than a value quietly thrown away.
 */
function rejectTitle(raw: string | undefined | null): null {
  if (raw !== undefined && raw !== null && normaliseTitleText(raw).length > 0) {
    throw new AppError(
      ErrorCode.CHECKLIST_TITLE_NOT_ALLOWED,
      'a daily checklist is named by its date',
    )
  }
  return null
}

function normaliseTaskTitle(raw: string): string {
  const title = normaliseTitleText(raw)
  if (title.length === 0) {
    throw new AppError(ErrorCode.CHECKLIST_TASK_TITLE_REQUIRED, 'task title is empty')
  }
  if (title.length > TASK_TITLE_MAX) {
    throw new AppError(
      ErrorCode.CHECKLIST_TASK_TITLE_TOO_LONG,
      `task title exceeds ${TASK_TITLE_MAX} characters`,
      { max: TASK_TITLE_MAX, actual: title.length },
    )
  }
  return title
}

/**
 * Kept as typed, minus the surrounding whitespace: a description may contain
 * line breaks, and collapsing them the way a title does would ruin a
 * three-line note about what the task actually involves.
 */
function normaliseDescription(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const text = raw.trim()
  if (text.length === 0) return null
  return text.length > DESCRIPTION_MAX ? text.slice(0, DESCRIPTION_MAX) : text
}

/** Same treatment as a note's due date; see `NoteService.normaliseDue`. */
function normaliseDue(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim().length === 0) return null

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(ErrorCode.CHECKLIST_DUE_INVALID, `not a usable date: ${raw}`, { dueAt: raw })
  }
  return parsed.toISOString()
}

function requireCreateDay(raw: string | undefined): string {
  if (raw === undefined || raw.trim().length === 0) {
    throw new AppError(ErrorCode.CHECKLIST_DAY_REQUIRED, 'a daily checklist needs a date')
  }
  return requireDay(raw)
}

function requireDay(raw: string): string {
  const day = raw.trim()
  if (!isDayString(day)) {
    throw new AppError(ErrorCode.CHECKLIST_DAY_INVALID, `not a calendar day: ${raw}`, { day: raw })
  }
  return day
}

function requireKind(value: string): ChecklistKind {
  if (!isChecklistKind(value)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `unknown checklist kind: ${value}`, {
      kind: value,
    })
  }
  return value
}

function requireStatus(value: string): TaskStatus {
  if (!isTaskStatus(value)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `unknown task status: ${value}`, {
      status: value,
    })
  }
  return value
}

function requirePriority(value: string): TaskPriority {
  if (!isTaskPriority(value)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `unknown task priority: ${value}`, {
      priority: value,
    })
  }
  return value
}

function requireQuadrant(value: string): EisenhowerQuadrant {
  if (!isEisenhowerQuadrant(value)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `unknown Eisenhower quadrant: ${value}`, {
      quadrant: value,
    })
  }
  return value
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_LIST_LIMIT
  return Math.min(Math.trunc(value), MAX_LIST_LIMIT)
}
