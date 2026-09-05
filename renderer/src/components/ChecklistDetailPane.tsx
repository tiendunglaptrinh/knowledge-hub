'use client'

import {
  ArrowLeft,
  CalendarDays,
  Check,
  CornerDownRight,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'

import type {
  ChecklistDetail,
  ChecklistTaskNode,
  EisenhowerQuadrant,
  TaskPriority,
} from '@shared/types'
import { describeDue, fromDateTimeLocal, toDateTimeLocal } from '@/lib/format'
import {
  CHECKLIST_KIND_META,
  DEADLINE_ICON,
  PRIORITY_META,
  PRIORITY_ORDER,
  QUADRANT_META,
  QUADRANT_ORDER,
  TASK_STATUS_META,
  formatDayLong,
  nextStatus,
  progressLabel,
  progressTone,
} from '@/lib/checklists'
import { useVault } from '@/lib/store'
import {
  Button,
  ConfirmDialog,
  Field,
  Modal,
  ProgressBar,
  ProgressRing,
  inputClass,
} from './ui'

/** Due-date chip colours, shared with the notes list. */
const DUE_TONE: Record<string, string> = {
  overdue: 'bg-danger/15 text-danger',
  today: 'bg-amber-400/15 text-amber-300',
  soon: 'bg-accent-soft text-accent',
  later: 'bg-surface-2 text-ink-3',
}

/**
 * One plan, open.
 *
 * Tasks are grouped by priority and the groups are drawn in the order the
 * service already sorted them into — the component never re-sorts. That is
 * deliberate: the ranking is a domain rule (`src/core/domain/checklist.ts`),
 * and a second copy of it here would be a second thing to keep in step.
 *
 * Reordering is drag-and-drop *within* a group. The gesture is refused at the
 * drop target rather than at the drag source, so a task dragged towards a
 * higher group simply finds nowhere to land — no error, no dialog, and the
 * matrix stays the thing that decides what comes first.
 */
export function ChecklistDetailPane({ checklist }: { checklist: ChecklistDetail }) {
  const { closeChecklist, deleteChecklist, busy } = useVault()

  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const daily = checklist.kind === 'daily'
  const meta = CHECKLIST_KIND_META[checklist.kind]
  const KindIcon = meta.icon
  const heading = daily && checklist.day ? formatDayLong(checklist.day) : (checklist.title ?? '')
  const due = checklist.dueAt ? describeDue(checklist.dueAt) : null

  const groups = daily
    ? PRIORITY_ORDER.map((value) => ({
        key: value,
        meta: PRIORITY_META[value],
        tasks: checklist.tasks.filter((task) => task.priority === value),
      }))
    : QUADRANT_ORDER.map((value) => ({
        key: value,
        meta: QUADRANT_META[value],
        tasks: checklist.tasks.filter((task) => task.quadrant === value),
      }))

  // A task whose rank column is empty — an older row, or one whose kind was
  // read defensively — would otherwise be filtered into no group at all and
  // disappear. It goes at the end rather than nowhere.
  const grouped = new Set(groups.flatMap((group) => group.tasks.map((task) => task.id)))
  const ungrouped = checklist.tasks.filter((task) => !grouped.has(task.id))

  return (
    <div id={`pane-checklist-${checklist.id}`} className="flex h-full flex-col">
      <header className="flex items-start gap-4 border-b border-surface-3 px-6 py-4">
        <button
          id="btn-close-checklist"
          onClick={closeChecklist}
          title="Quay lại bảng điều khiển"
          aria-label="Quay lại bảng điều khiển"
          className="mt-1 rounded-md p-1.5 text-ink-3 transition hover:bg-surface-2 hover:text-ink-1"
        >
          <ArrowLeft className="size-4" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <KindIcon className="size-3.5 shrink-0" style={{ color: meta.color }} aria-hidden />
            <span className="text-xs text-ink-3">{meta.label}</span>
            {due && (
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${DUE_TONE[due.tone]}`}
              >
                <DEADLINE_ICON className="size-3" aria-hidden />
                {due.label}
              </span>
            )}
          </div>

          <h2 className="break-words text-lg font-semibold text-ink-1">{heading}</h2>

          {checklist.description && (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-2">
              {checklist.description}
            </p>
          )}

          <div className="mt-3 flex items-center gap-3">
            <ProgressBar
              id={`progress-checklist-${checklist.id}`}
              percent={checklist.progress.percent}
              tone={progressTone(checklist.progress.percent)}
              label={progressLabel(checklist.progress)}
              className="max-w-md"
            />
            <span className="shrink-0 text-xs tabular-nums text-ink-3">
              {progressLabel(checklist.progress)}
            </span>
          </div>
        </div>

        <ProgressRing
          percent={checklist.progress.percent}
          tone={progressTone(checklist.progress.percent)}
          size={52}
          label={progressLabel(checklist.progress)}
        />

        <div className="flex shrink-0 items-center gap-1">
          <Button id="btn-edit-checklist" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            Sửa
          </Button>
          <Button id="btn-delete-checklist" variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <AddTaskForm checklist={checklist} />

        {groups.map((group) => (
          <TaskGroup
            key={group.key}
            label={group.meta.label}
            hint={group.meta.hint}
            color={group.meta.color}
            count={group.tasks.length}
          >
            {group.tasks.map((task) => (
              <TaskRow key={task.id} checklist={checklist} task={task} />
            ))}
          </TaskGroup>
        ))}

        {ungrouped.length > 0 && (
          <TaskGroup
            label="Chưa phân loại"
            hint="Không có mức ưu tiên"
            color="#a3b0c9"
            count={ungrouped.length}
          >
            {ungrouped.map((task) => (
              <TaskRow key={task.id} checklist={checklist} task={task} />
            ))}
          </TaskGroup>
        )}
      </div>

      {editing && <ChecklistMetaDialog checklist={checklist} onClose={() => setEditing(false)} />}

      {confirmDelete && (
        <ConfirmDialog
          id="modal-confirm-delete-checklist"
          title="Xoá checklist?"
          subject={heading}
          consequence={`Toàn bộ ${checklist.progress.total} việc trong checklist này bị xoá cùng nó.`}
          confirmLabel="Xoá checklist"
          confirmId="btn-confirm-delete-checklist"
          cancelId="btn-cancel-delete-checklist"
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false)
            await deleteChecklist(checklist.id)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Groups and rows
// ---------------------------------------------------------------------------

function TaskGroup({
  label,
  hint,
  color,
  count,
  children,
}: {
  label: string
  hint: string
  color: string
  count: number
  children: React.ReactNode
}) {
  // An empty quadrant is drawn as nothing rather than as an empty heading: a
  // matrix with four labels and one task under them reads as three failures.
  if (count === 0) return null

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">{label}</h3>
        <span className="text-[11px] text-ink-3">{hint}</span>
      </div>
      <ul className="grid gap-2">{children}</ul>
    </section>
  )
}

function TaskRow({
  checklist,
  task,
}: {
  checklist: ChecklistDetail
  task: ChecklistTaskNode
}) {
  const { addChecklistTask, updateChecklistTask, deleteChecklistTask, moveChecklistTask, busy } =
    useVault()

  const [editing, setEditing] = useState(false)
  const [addingChild, setAddingChild] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dropSide, setDropSide] = useState<'before' | 'after' | null>(null)

  const daily = checklist.kind === 'daily'
  const status = TASK_STATUS_META[task.status]
  const StatusIcon = status.icon
  const done = task.status === 'done'
  const due = task.dueAt ? describeDue(task.dueAt) : null
  const rank = daily
    ? task.priority
      ? PRIORITY_META[task.priority]
      : null
    : task.quadrant
      ? QUADRANT_META[task.quadrant]
      : null

  /** The group two tasks must share before one may be dropped on the other. */
  const groupKey = daily ? `p:${task.priority}` : `q:${task.quadrant}`

  return (
    <li
      id={`task-${task.id}`}
      draggable={!editing}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.setData('application/x-kb-group', groupKey)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        // `types` is readable during dragover; the *value* is not, which is a
        // deliberate browser restriction. The group therefore travels as a
        // custom MIME type, so a drag from another group finds no match here
        // and the row never offers itself as a target.
        if (!event.dataTransfer.types.includes('application/x-kb-group')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'

        const box = event.currentTarget.getBoundingClientRect()
        setDropSide(event.clientY < box.top + box.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={(event) => {
        event.preventDefault()
        const side = dropSide ?? 'before'
        setDropSide(null)

        const movedId = event.dataTransfer.getData('text/plain')
        const movedGroup = event.dataTransfer.getData('application/x-kb-group')
        if (!movedId || movedId === task.id) return
        // The service refuses a cross-group move anyway; refusing it here as
        // well means the user never sees an error for a gesture the UI should
        // simply not have accepted.
        if (movedGroup !== groupKey) return

        void moveChecklistTask({ id: movedId, targetId: task.id, position: side })
      }}
      className={`rounded-xl border bg-surface-1 transition
        ${done ? 'border-surface-3/60' : 'border-surface-3 hover:border-accent/40'}
        ${dropSide === 'before' ? 'border-t-2 border-t-accent' : ''}
        ${dropSide === 'after' ? 'border-b-2 border-b-accent' : ''}`}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <GripVertical
          className="mt-1 size-4 shrink-0 cursor-grab text-ink-3 active:cursor-grabbing"
          aria-hidden
        />

        <Tick
          id={`btn-task-done-${task.id}`}
          done={done}
          busy={busy}
          label={task.title}
          onToggle={() =>
            void updateChecklistTask({ id: task.id, status: done ? 'todo' : 'done' })
          }
        />

        <div className="min-w-0 flex-1">
          {editing ? (
            <TaskEditor
              task={task}
              onDone={() => setEditing(false)}
            />
          ) : (
            <>
              <p
                className={`break-words text-sm font-medium leading-snug text-ink-1 ${done ? 'line-through opacity-60' : ''}`}
              >
                {task.title}
              </p>

              {task.description && (
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-3">
                  {task.description}
                </p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  id={`btn-task-status-${task.id}`}
                  onClick={() =>
                    void updateChecklistTask({ id: task.id, status: nextStatus(task.status) })
                  }
                  disabled={busy}
                  title={`${status.label} — bấm để chuyển sang “${TASK_STATUS_META[nextStatus(task.status)].label}”`}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition hover:brightness-110 disabled:opacity-40"
                  style={{ background: `${status.color}22`, color: status.color }}
                >
                  <StatusIcon className="size-3" aria-hidden />
                  {status.label}
                </button>

                {rank && (
                  <RankPicker
                    id={`select-task-rank-${task.id}`}
                    daily={daily}
                    value={daily ? task.priority : task.quadrant}
                    color={rank.color}
                    label={rank.label}
                    disabled={busy}
                    onChange={(value) =>
                      void updateChecklistTask(
                        daily
                          ? { id: task.id, priority: value as TaskPriority }
                          : { id: task.id, quadrant: value as EisenhowerQuadrant },
                      )
                    }
                  />
                )}

                {due && (
                  <span
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      done ? 'bg-surface-2 text-ink-3' : DUE_TONE[due.tone]
                    }`}
                  >
                    <DEADLINE_ICON className="size-3" aria-hidden />
                    {due.label}
                  </span>
                )}

                {task.children.length > 0 && (
                  <span className="text-[10px] tabular-nums text-ink-3">
                    {task.progress.done}/{task.progress.total} việc nhỏ
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            id={`btn-add-subtask-${task.id}`}
            label={`Thêm việc nhỏ cho ${task.title}`}
            onClick={() => setAddingChild((current) => !current)}
          >
            <Plus className="size-3.5" />
          </IconButton>
          <IconButton
            id={`btn-edit-task-${task.id}`}
            label={`Sửa việc ${task.title}`}
            onClick={() => setEditing((current) => !current)}
          >
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton
            id={`btn-delete-task-${task.id}`}
            label={`Xoá việc ${task.title}`}
            danger
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </div>

      {(task.children.length > 0 || addingChild) && (
        <div className="border-t border-surface-3 px-3 py-2">
          <ul className="grid gap-1">
            {task.children.map((child) => (
              <SubtaskRow key={child.id} task={child} />
            ))}
          </ul>

          {addingChild && (
            <InlineAdd
              id={`input-subtask-${task.id}`}
              placeholder="Việc nhỏ…"
              onCancel={() => setAddingChild(false)}
              onSubmit={async (title) => {
                await addChecklistTask({ checklistId: checklist.id, parentId: task.id, title })
                setAddingChild(false)
              }}
            />
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          id={`modal-confirm-delete-task-${task.id}`}
          title="Xoá việc này?"
          subject={task.title}
          consequence={
            task.children.length > 0
              ? `${task.children.length} việc nhỏ bên trong cũng bị xoá.`
              : 'Việc này bị xoá khỏi checklist.'
          }
          confirmLabel="Xoá việc"
          confirmId={`btn-confirm-delete-task-${task.id}`}
          cancelId={`btn-cancel-delete-task-${task.id}`}
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false)
            await deleteChecklistTask(task.id)
          }}
        />
      )}
    </li>
  )
}

/**
 * A sub-task: a checkbox, a title and a delete.
 *
 * It offers no rank of its own and no break-down — it inherits the standing of
 * the task it belongs to, which is what keeps the drag rule meaningful, and a
 * sub-task of a sub-task is a sign the plan wanted to be a module checklist.
 */
function SubtaskRow({ task }: { task: ChecklistTaskNode }) {
  const { updateChecklistTask, deleteChecklistTask, busy } = useVault()
  const [editing, setEditing] = useState(false)
  const done = task.status === 'done'
  const due = task.dueAt ? describeDue(task.dueAt) : null

  return (
    <li className="group flex items-start gap-2 rounded-lg px-1.5 py-1 transition hover:bg-surface-2">
      <CornerDownRight className="mt-1 size-3 shrink-0 text-ink-3" aria-hidden />

      <Tick
        id={`btn-subtask-done-${task.id}`}
        done={done}
        busy={busy}
        small
        label={task.title}
        onToggle={() => void updateChecklistTask({ id: task.id, status: done ? 'todo' : 'done' })}
      />

      <div className="min-w-0 flex-1">
        {editing ? (
          <TaskEditor task={task} onDone={() => setEditing(false)} />
        ) : (
          <>
            <span
              className={`block break-words text-xs leading-relaxed text-ink-1 ${done ? 'line-through opacity-60' : ''}`}
            >
              {task.title}
            </span>
            {task.description && (
              <span className="mt-0.5 block whitespace-pre-wrap break-words text-[11px] text-ink-3">
                {task.description}
              </span>
            )}
            {due && (
              <span
                className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                  done ? 'bg-surface-2 text-ink-3' : DUE_TONE[due.tone]
                }`}
              >
                <DEADLINE_ICON className="size-3" aria-hidden />
                {due.label}
              </span>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton
          id={`btn-edit-subtask-${task.id}`}
          label={`Sửa việc nhỏ ${task.title}`}
          onClick={() => setEditing((current) => !current)}
        >
          <Pencil className="size-3" />
        </IconButton>
        {/*
          No confirmation here, unlike a top-level task: a sub-task holds
          nothing else, it is one line the user typed a moment ago, and a
          dialog for every line would make breaking a task down feel expensive.
        */}
        <IconButton
          id={`btn-delete-subtask-${task.id}`}
          label={`Xoá việc nhỏ ${task.title}`}
          danger
          onClick={() => void deleteChecklistTask(task.id)}
        >
          <Trash2 className="size-3" />
        </IconButton>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** Inline editor for one task's title, note and deadline. */
function TaskEditor({ task, onDone }: { task: ChecklistTaskNode; onDone: () => void }) {
  const { updateChecklistTask, busy } = useVault()

  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [dueLocal, setDueLocal] = useState(toDateTimeLocal(task.dueAt))

  async function save() {
    if (title.trim().length === 0) return
    const ok = await updateChecklistTask({
      id: task.id,
      title,
      description: description.trim().length > 0 ? description : null,
      dueAt: fromDateTimeLocal(dueLocal),
    })
    if (ok) onDone()
  }

  return (
    <div className="grid gap-2">
      <input
        id={`input-edit-task-${task.id}`}
        className={`${inputClass} py-1.5`}
        value={title}
        autoFocus
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
          if (event.key === 'Escape') onDone()
        }}
      />
      <textarea
        id={`input-edit-task-description-${task.id}`}
        className={`${inputClass} min-h-[56px] resize-y text-xs`}
        value={description}
        maxLength={2000}
        placeholder="Mô tả ngắn (không bắt buộc)"
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <input
          id={`input-edit-task-due-${task.id}`}
          type="datetime-local"
          className={`${inputClass} py-1.5 text-xs`}
          value={dueLocal}
          onChange={(event) => setDueLocal(event.target.value)}
        />
        <Button
          id={`btn-save-task-${task.id}`}
          variant="primary"
          onClick={() => void save()}
          disabled={busy || title.trim().length === 0}
        >
          <Check className="size-4" />
          Lưu
        </Button>
        <Button id={`btn-cancel-task-${task.id}`} variant="ghost" onClick={onDone}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}

/** Title, description and deadline of the plan itself. */
function ChecklistMetaDialog({
  checklist,
  onClose,
}: {
  checklist: ChecklistDetail
  onClose: () => void
}) {
  const { updateChecklist, busy } = useVault()

  const daily = checklist.kind === 'daily'
  const [title, setTitle] = useState(checklist.title ?? '')
  const [description, setDescription] = useState(checklist.description ?? '')
  const [dueLocal, setDueLocal] = useState(toDateTimeLocal(checklist.dueAt))

  const canSubmit = daily || title.trim().length > 0

  async function submit() {
    if (!canSubmit) return
    const ok = await updateChecklist({
      id: checklist.id,
      ...(daily ? {} : { title, dueAt: fromDateTimeLocal(dueLocal) }),
      description: description.trim().length > 0 ? description : null,
    })
    if (ok) onClose()
  }

  return (
    <Modal
      id="modal-edit-checklist"
      title="Sửa thông tin checklist"
      onClose={onClose}
      footer={
        <>
          <Button id="btn-cancel-edit-checklist" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            id="btn-save-checklist"
            variant="primary"
            onClick={submit}
            disabled={busy || !canSubmit}
          >
            {busy ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </>
      }
    >
      {daily ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-3">
          <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
          Checklist ngày được đặt tên bằng chính ngày của nó, và ngày đó không đổi được — mỗi ngày
          chỉ có một checklist. Nếu cần kế hoạch cho ngày khác, hãy tạo checklist cho ngày đó.
        </p>
      ) : (
        <>
          <Field id="edit-checklist-title" label="Tiêu đề">
            <input
              id="edit-checklist-title"
              className={inputClass}
              value={title}
              autoFocus
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>

          <Field id="edit-checklist-due" label="Hạn chót (không bắt buộc)">
            <div className="flex items-center gap-2">
              <input
                id="edit-checklist-due"
                type="datetime-local"
                className={inputClass}
                value={dueLocal}
                onChange={(event) => setDueLocal(event.target.value)}
              />
              {dueLocal.length > 0 && (
                <Button
                  id="btn-clear-edit-checklist-due"
                  variant="ghost"
                  onClick={() => setDueLocal('')}
                >
                  Xoá
                </Button>
              )}
            </div>
          </Field>
        </>
      )}

      <Field id="edit-checklist-description" label="Mô tả ngắn">
        <textarea
          id="edit-checklist-description"
          className={`${inputClass} min-h-[80px] resize-y`}
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Adding
// ---------------------------------------------------------------------------

/** The always-visible "add one more" row at the top of an open plan. */
function AddTaskForm({ checklist }: { checklist: ChecklistDetail }) {
  const { addChecklistTask, busy } = useVault()

  const daily = checklist.kind === 'daily'
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [quadrant, setQuadrant] = useState<EisenhowerQuadrant>('schedule')

  async function submit() {
    const trimmed = title.trim()
    if (trimmed.length === 0) return

    const ok = await addChecklistTask({
      checklistId: checklist.id,
      title: trimmed,
      ...(daily ? { priority } : { quadrant }),
    })
    if (ok) setTitle('')
  }

  return (
    <div className="mb-5 rounded-xl border border-surface-3 bg-surface-1 p-3">
      <div className="flex items-start gap-2">
        <input
          id="input-new-task"
          className={inputClass}
          value={title}
          maxLength={200}
          placeholder={daily ? 'Thêm việc cho ngày này…' : 'Thêm đầu việc cho module…'}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
        <Button
          id="btn-submit-new-task"
          variant="primary"
          className="shrink-0 whitespace-nowrap"
          onClick={() => void submit()}
          disabled={busy || title.trim().length === 0}
        >
          <Plus className="size-4" />
          Thêm việc
        </Button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {daily
          ? PRIORITY_ORDER.map((value) => (
              <MiniChip
                key={value}
                id={`btn-new-task-priority-${value}`}
                meta={PRIORITY_META[value]}
                active={priority === value}
                onClick={() => setPriority(value)}
              />
            ))
          : QUADRANT_ORDER.map((value) => (
              <MiniChip
                key={value}
                id={`btn-new-task-quadrant-${value}`}
                meta={QUADRANT_META[value]}
                active={quadrant === value}
                onClick={() => setQuadrant(value)}
              />
            ))}
      </div>
    </div>
  )
}

function InlineAdd({
  id,
  placeholder,
  onSubmit,
  onCancel,
}: {
  id: string
  placeholder: string
  onSubmit: (title: string) => void | Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState('')

  return (
    <div className="mt-1.5 flex items-center gap-2 pl-5">
      <input
        id={id}
        className={`${inputClass} py-1.5 text-xs`}
        value={value}
        autoFocus
        maxLength={200}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && value.trim().length > 0) void onSubmit(value.trim())
          if (event.key === 'Escape') onCancel()
        }}
      />
      <button
        id={`${id}-submit`}
        onClick={() => value.trim().length > 0 && void onSubmit(value.trim())}
        disabled={value.trim().length === 0}
        className="rounded-lg border border-surface-3 px-2.5 py-1.5 text-xs text-ink-2 transition
          hover:border-ink-3 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Thêm
      </button>
      <button
        id={`${id}-cancel`}
        onClick={onCancel}
        aria-label="Huỷ"
        className="rounded p-1 text-ink-3 transition hover:text-ink-1"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

function Tick({
  id,
  done,
  busy,
  label,
  small,
  onToggle,
}: {
  id: string
  done: boolean
  busy: boolean
  label: string
  small?: boolean
  onToggle: () => void
}) {
  return (
    <button
      id={id}
      onClick={onToggle}
      disabled={busy}
      role="checkbox"
      aria-checked={done}
      aria-label={`${done ? 'Bỏ đánh dấu' : 'Đánh dấu đã xong'}: ${label}`}
      title={done ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu đã xong'}
      className={`mt-0.5 flex shrink-0 items-center justify-center rounded-md border transition
        disabled:opacity-40
        ${small ? 'size-4' : 'size-5'}
        ${
          done
            ? 'border-success bg-success text-on-accent'
            : 'border-surface-3 text-transparent hover:border-success'
        }`}
    >
      <Check className={small ? 'size-2.5' : 'size-3.5'} aria-hidden />
    </button>
  )
}

function IconButton({
  id,
  label,
  danger,
  onClick,
  children,
}: {
  id: string
  label: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`rounded p-1 text-ink-3 transition hover:bg-surface-2 ${
        danger ? 'hover:text-danger' : 'hover:text-ink-1'
      }`}
    >
      {children}
    </button>
  )
}

function MiniChip({
  id,
  meta,
  active,
  onClick,
}: {
  id: string
  meta: { label: string; hint: string; color: string }
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      aria-pressed={active}
      title={meta.hint}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition
        ${active ? 'text-ink-1' : 'border-surface-3 text-ink-3 hover:border-ink-3'}`}
      style={active ? { background: `${meta.color}26`, borderColor: meta.color } : undefined}
    >
      {meta.label}
    </button>
  )
}

/**
 * The rank as a native `<select>` styled to look like the chip beside it.
 *
 * A native control rather than a custom menu: it is keyboard-navigable and
 * screen-reader-legible for free, and re-ranking a task is the one edit that
 * *moves* the row — so the control that does it should be the boring one.
 */
function RankPicker({
  id,
  daily,
  value,
  color,
  label,
  disabled,
  onChange,
}: {
  id: string
  daily: boolean
  value: string | null
  color: string
  label: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: `${color}22`, color }}
      title={daily ? 'Độ ưu tiên' : 'Ma trận Eisenhower'}
    >
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        aria-label={daily ? `Độ ưu tiên: ${label}` : `Ma trận Eisenhower: ${label}`}
        onChange={(event) => onChange(event.target.value)}
        className="cursor-pointer appearance-none bg-transparent pr-1 text-[10px] font-medium outline-none"
        style={{ color }}
      >
        {(daily ? PRIORITY_ORDER : QUADRANT_ORDER).map((option) => {
          const meta = daily
            ? PRIORITY_META[option as TaskPriority]
            : QUADRANT_META[option as EisenhowerQuadrant]
          return (
            <option key={option} value={option} className="bg-surface-1 text-ink-1">
              {meta.label}
            </option>
          )
        })}
      </select>
    </span>
  )
}
