'use client'

import { ArrowLeft, ArrowRight, Check, CornerDownRight, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import type {
  ChecklistKind,
  EisenhowerQuadrant,
  NewChecklistTask,
  TaskPriority,
} from '@shared/types'
import { fromDateTimeLocal } from '@/lib/format'
import {
  CHECKLIST_KIND_META,
  PRIORITY_META,
  PRIORITY_ORDER,
  QUADRANT_META,
  QUADRANT_ORDER,
  formatDayLong,
  todayDay,
} from '@/lib/checklists'
import { useVault } from '@/lib/store'
import { Button, Field, Modal, inputClass } from './ui'

/**
 * The create wizard: choose the kind, add the tasks, confirm.
 *
 * Three steps rather than one long form, because that is the order the user
 * described the job in — *"tôi nhấn nút tạo checklist và add task theo trình
 * tự, xác nhận tạo checklist"* — and because the middle step is not a field.
 * It is a list being assembled, and a list being assembled needs somewhere to
 * put each entry as it is finished.
 *
 * Nothing is written until the last step. A checklist and its tasks are
 * created by a single IPC call precisely so that a half-built plan can be
 * abandoned without leaving anything behind — and so that the "at least one
 * task" rule can be checked against the whole thing rather than against a row
 * that already exists.
 */
export function ChecklistDialog({
  defaultKind = 'daily',
  onClose,
}: {
  defaultKind?: ChecklistKind
  onClose: () => void
}) {
  const { createChecklist, dailyChecklists, busy } = useVault()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [kind, setKind] = useState<ChecklistKind>(defaultKind)

  const [day, setDay] = useState(todayDay())
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueLocal, setDueLocal] = useState('')

  const [drafts, setDrafts] = useState<DraftTask[]>([])
  const [touched, setTouched] = useState(false)

  const daily = kind === 'daily'

  /**
   * The day already has a plan.
   *
   * Checked here against the list the dashboard already holds so the user is
   * stopped on step 1 rather than on the confirm button. `ChecklistService`
   * checks it again against the database, which is the authority — this is
   * only the courtesy.
   */
  const dayTaken = useMemo(
    () => daily && dailyChecklists.some((existing) => existing.day === day),
    [daily, dailyChecklists, day],
  )

  const metaError = daily
    ? day.trim().length === 0
      ? 'Hãy chọn ngày cho checklist.'
      : dayTaken
        ? 'Ngày này đã có checklist. Hãy mở checklist đó và thêm việc vào.'
        : undefined
    : title.trim().length === 0
      ? 'Checklist module cần có tiêu đề.'
      : undefined

  const canLeaveStep1 = metaError === undefined
  const canSubmit = canLeaveStep1 && drafts.length > 0

  function addDraft(draft: DraftTask) {
    setDrafts((current) => [...current, draft])
  }

  function removeDraft(key: string) {
    setDrafts((current) => current.filter((draft) => draft.key !== key))
  }

  function addChild(key: string, childTitle: string) {
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key
          ? { ...draft, children: [...draft.children, { key: newKey(), title: childTitle }] }
          : draft,
      ),
    )
  }

  function removeChild(key: string, childKey: string) {
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key
          ? { ...draft, children: draft.children.filter((child) => child.key !== childKey) }
          : draft,
      ),
    )
  }

  async function submit() {
    setTouched(true)
    if (!canSubmit) return

    const ok = await createChecklist({
      kind,
      ...(daily ? { day } : { title }),
      description: description.trim().length > 0 ? description : undefined,
      dueAt: daily ? null : fromDateTimeLocal(dueLocal),
      tasks: drafts.map((draft) => toNewTask(draft, kind)),
    })
    if (ok) onClose()
  }

  return (
    <Modal
      id="modal-checklist"
      size="lg"
      title={`Checklist mới — bước ${step}/3`}
      onClose={onClose}
      footer={
        <>
          {step > 1 && (
            <Button
              id="btn-checklist-back"
              variant="ghost"
              onClick={() => setStep((current) => (current === 3 ? 2 : 1))}
            >
              <ArrowLeft className="size-4" />
              Quay lại
            </Button>
          )}

          <Button id="btn-cancel-checklist" variant="subtle" onClick={onClose}>
            Huỷ
          </Button>

          {step < 3 ? (
            <Button
              id="btn-checklist-next"
              variant="primary"
              disabled={step === 1 ? !canLeaveStep1 : drafts.length === 0}
              onClick={() => {
                setTouched(true)
                if (step === 1 && canLeaveStep1) setStep(2)
                else if (step === 2 && drafts.length > 0) setStep(3)
              }}
            >
              Tiếp tục
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button
              id="btn-submit-checklist"
              variant="primary"
              onClick={submit}
              disabled={busy || !canSubmit}
            >
              <Check className="size-4" />
              {busy ? 'Đang tạo…' : 'Xác nhận tạo checklist'}
            </Button>
          )}
        </>
      }
    >
      <Steps current={step} />

      {step === 1 && (
        <>
          <Field
            id="checklist-kind-picker"
            label="Loại checklist"
            hint={CHECKLIST_KIND_META[kind].hint}
          >
            <div id="checklist-kind-picker" className="grid grid-cols-2 gap-2">
              {(['daily', 'module'] as const).map((value) => {
                const meta = CHECKLIST_KIND_META[value]
                const Icon = meta.icon
                const selected = kind === value

                return (
                  <button
                    key={value}
                    id={`btn-checklist-kind-${value}`}
                    onClick={() => setKind(value)}
                    aria-pressed={selected}
                    className={`flex flex-col gap-1.5 rounded-xl border px-4 py-3 text-left transition
                      ${
                        selected
                          ? 'border-accent bg-accent-soft text-ink-1'
                          : 'border-surface-3 text-ink-2 hover:border-ink-3'
                      }`}
                  >
                    <Icon className="size-5" style={{ color: meta.color }} aria-hidden />
                    <span className="text-sm font-medium text-ink-1">{meta.label}</span>
                    <span className="text-xs leading-relaxed text-ink-3">{meta.hint}</span>
                  </button>
                )
              })}
            </div>
          </Field>

          {daily ? (
            <Field
              id="checklist-day"
              label="Ngày"
              hint={
                day.trim().length > 0 && !dayTaken
                  ? `Checklist cho ${formatDayLong(day)}. Checklist ngày không có tiêu đề — ngày chính là tên của nó.`
                  : undefined
              }
              error={touched ? metaError : undefined}
            >
              <input
                id="checklist-day"
                type="date"
                className={inputClass}
                value={day}
                onChange={(event) => setDay(event.target.value)}
                onBlur={() => setTouched(true)}
              />
            </Field>
          ) : (
            <>
              <Field
                id="checklist-title"
                label="Tiêu đề"
                error={touched ? metaError : undefined}
                hint="Tên khối công việc, ví dụ: Module thanh toán — giai đoạn 1"
              >
                <input
                  id="checklist-title"
                  className={inputClass}
                  value={title}
                  autoFocus
                  maxLength={200}
                  placeholder="Ví dụ: Module thanh toán — giai đoạn 1"
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={() => setTouched(true)}
                />
              </Field>

              <Field
                id="checklist-due"
                label="Hạn chót (không bắt buộc)"
                hint="Mốc phải xong toàn bộ module. Bỏ trống nếu chưa chốt."
              >
                <div className="flex items-center gap-2">
                  <input
                    id="checklist-due"
                    type="datetime-local"
                    className={inputClass}
                    value={dueLocal}
                    onChange={(event) => setDueLocal(event.target.value)}
                  />
                  {dueLocal.length > 0 && (
                    <Button
                      id="btn-clear-checklist-due"
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

          <Field
            id="checklist-description"
            label="Mô tả ngắn (không bắt buộc)"
            hint="Một hai câu nhắc lại mục tiêu của checklist này."
          >
            <textarea
              id="checklist-description"
              className={`${inputClass} min-h-[72px] resize-y`}
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </>
      )}

      {step === 2 && (
        <TaskComposer
          kind={kind}
          drafts={drafts}
          onAdd={addDraft}
          onRemove={removeDraft}
          onAddChild={addChild}
          onRemoveChild={removeChild}
        />
      )}

      {step === 3 && (
        <Review
          kind={kind}
          day={day}
          title={title}
          description={description}
          dueLocal={dueLocal}
          drafts={drafts}
        />
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Draft model
// ---------------------------------------------------------------------------

interface DraftChild {
  key: string
  title: string
}

interface DraftTask {
  key: string
  title: string
  description: string
  dueLocal: string
  priority: TaskPriority
  quadrant: EisenhowerQuadrant
  children: DraftChild[]
}

/**
 * A key for React's list reconciliation only — the real id is minted by the
 * main process when the plan is written, because nothing in a draft exists
 * yet. `crypto.randomUUID` is available in the renderer for the same reason
 * `newId` uses it in `src/core`.
 */
function newKey(): string {
  return globalThis.crypto.randomUUID()
}

/** The draft as the IPC contract wants it; the kind decides which rank ships. */
function toNewTask(draft: DraftTask, kind: ChecklistKind): NewChecklistTask {
  return {
    title: draft.title,
    description: draft.description.trim().length > 0 ? draft.description : undefined,
    dueAt: fromDateTimeLocal(draft.dueLocal),
    ...(kind === 'daily' ? { priority: draft.priority } : { quadrant: draft.quadrant }),
    children: draft.children.map((child) => ({ title: child.title })),
  }
}

// ---------------------------------------------------------------------------
// Step 2 — building the list
// ---------------------------------------------------------------------------

function TaskComposer({
  kind,
  drafts,
  onAdd,
  onRemove,
  onAddChild,
  onRemoveChild,
}: {
  kind: ChecklistKind
  drafts: DraftTask[]
  onAdd: (draft: DraftTask) => void
  onRemove: (key: string) => void
  onAddChild: (key: string, title: string) => void
  onRemoveChild: (key: string, childKey: string) => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueLocal, setDueLocal] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [quadrant, setQuadrant] = useState<EisenhowerQuadrant>('schedule')
  const [detailed, setDetailed] = useState(false)

  const daily = kind === 'daily'

  function commit() {
    const trimmed = title.trim()
    if (trimmed.length === 0) return

    onAdd({
      key: newKey(),
      title: trimmed,
      description,
      dueLocal,
      priority,
      quadrant,
      children: [],
    })

    // The rank is deliberately *not* reset: someone entering four urgent tasks
    // in a row should not have to pick "Cao" four times.
    setTitle('')
    setDescription('')
    setDueLocal('')
  }

  return (
    <>
      <div className="mb-4 rounded-xl border border-surface-3 bg-surface-0 p-3">
        <div className="flex items-start gap-2">
          <input
            id="input-task-title"
            className={inputClass}
            value={title}
            autoFocus
            maxLength={200}
            placeholder={daily ? 'Việc lớn cần làm hôm nay…' : 'Một đầu việc của module…'}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit()
              }
            }}
          />
          <Button id="btn-add-task" variant="primary" onClick={commit} disabled={title.trim().length === 0}>
            <Plus className="size-4" />
            Thêm
          </Button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {daily
            ? PRIORITY_ORDER.map((value) => (
                <RankChip
                  key={value}
                  id={`btn-task-priority-${value}`}
                  meta={PRIORITY_META[value]}
                  active={priority === value}
                  onClick={() => setPriority(value)}
                />
              ))
            : QUADRANT_ORDER.map((value) => (
                <RankChip
                  key={value}
                  id={`btn-task-quadrant-${value}`}
                  meta={QUADRANT_META[value]}
                  active={quadrant === value}
                  onClick={() => setQuadrant(value)}
                />
              ))}

          <button
            id="btn-toggle-task-detail"
            onClick={() => setDetailed((current) => !current)}
            aria-expanded={detailed}
            className="ml-auto rounded-full border border-surface-3 px-3 py-1.5 text-xs text-ink-2 transition hover:border-ink-3"
          >
            {detailed ? 'Ẩn chi tiết' : 'Mô tả & hạn'}
          </button>
        </div>

        {detailed && (
          <div className="mt-2.5 grid gap-2">
            <textarea
              id="input-task-description"
              className={`${inputClass} min-h-[60px] resize-y`}
              value={description}
              maxLength={2000}
              placeholder="Mô tả ngắn (không bắt buộc)"
              onChange={(event) => setDescription(event.target.value)}
            />
            <input
              id="input-task-due"
              type="datetime-local"
              className={inputClass}
              value={dueLocal}
              onChange={(event) => setDueLocal(event.target.value)}
            />
          </div>
        )}
      </div>

      {drafts.length === 0 ? (
        <p id="empty-draft-tasks" className="px-1 py-6 text-center text-sm text-ink-3">
          Chưa có việc nào. Một checklist phải có ít nhất một việc — thêm việc đầu tiên ở trên.
        </p>
      ) : (
        <ol id="list-draft-tasks" className="grid gap-2">
          {drafts.map((draft, index) => (
            <DraftRow
              key={draft.key}
              index={index}
              draft={draft}
              kind={kind}
              onRemove={() => onRemove(draft.key)}
              onAddChild={(childTitle) => onAddChild(draft.key, childTitle)}
              onRemoveChild={(childKey) => onRemoveChild(draft.key, childKey)}
            />
          ))}
        </ol>
      )}
    </>
  )
}

function DraftRow({
  index,
  draft,
  kind,
  onRemove,
  onAddChild,
  onRemoveChild,
}: {
  index: number
  draft: DraftTask
  kind: ChecklistKind
  onRemove: () => void
  onAddChild: (title: string) => void
  onRemoveChild: (childKey: string) => void
}) {
  const [childTitle, setChildTitle] = useState('')
  const meta = kind === 'daily' ? PRIORITY_META[draft.priority] : QUADRANT_META[draft.quadrant]
  const Icon = meta.icon

  function commitChild() {
    const trimmed = childTitle.trim()
    if (trimmed.length === 0) return
    onAddChild(trimmed)
    setChildTitle('')
  }

  return (
    <li className="rounded-xl border border-surface-3 bg-surface-2 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 w-5 shrink-0 text-xs tabular-nums text-ink-3">{index + 1}.</span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm text-ink-1">{draft.title}</p>
          {draft.description.trim().length > 0 && (
            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-3">
              {draft.description}
            </p>
          )}
          <span
            className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: `${meta.color}22`, color: meta.color }}
          >
            <Icon className="size-3" aria-hidden />
            {meta.label}
          </span>
        </div>

        <button
          id={`btn-remove-draft-${draft.key}`}
          onClick={onRemove}
          aria-label={`Bỏ việc ${draft.title}`}
          title="Bỏ việc này"
          className="rounded p-1 text-ink-3 transition hover:bg-surface-3 hover:text-danger"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {draft.children.length > 0 && (
        <ul className="mt-2 grid gap-1 border-l border-surface-3 pl-4">
          {draft.children.map((child) => (
            <li key={child.key} className="flex items-center gap-2 text-xs text-ink-2">
              <CornerDownRight className="size-3 shrink-0 text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1 break-words">{child.title}</span>
              <button
                id={`btn-remove-draft-child-${child.key}`}
                onClick={() => onRemoveChild(child.key)}
                aria-label={`Bỏ việc nhỏ ${child.title}`}
                className="rounded p-0.5 text-ink-3 transition hover:text-danger"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-2 pl-4">
        <input
          id={`input-draft-child-${draft.key}`}
          className={`${inputClass} py-1.5 text-xs`}
          value={childTitle}
          placeholder="Chia nhỏ: thêm việc con…"
          maxLength={200}
          onChange={(event) => setChildTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitChild()
            }
          }}
        />
        <button
          id={`btn-add-draft-child-${draft.key}`}
          onClick={commitChild}
          disabled={childTitle.trim().length === 0}
          className="rounded-lg border border-surface-3 px-2.5 py-1.5 text-xs text-ink-2 transition
            hover:border-ink-3 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Thêm
        </button>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — what is about to be created
// ---------------------------------------------------------------------------

function Review({
  kind,
  day,
  title,
  description,
  dueLocal,
  drafts,
}: {
  kind: ChecklistKind
  day: string
  title: string
  description: string
  dueLocal: string
  drafts: DraftTask[]
}) {
  const subtasks = drafts.reduce((sum, draft) => sum + draft.children.length, 0)

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-surface-3 bg-surface-0 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          {CHECKLIST_KIND_META[kind].label}
        </p>
        <h3 className="mt-1 text-base font-semibold text-ink-1">
          {kind === 'daily' ? formatDayLong(day) : title}
        </h3>
        {description.trim().length > 0 && (
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
            {description}
          </p>
        )}
        {kind === 'module' && dueLocal.length > 0 && (
          <p className="mt-1.5 text-xs text-ink-3">
            Hạn chót: {new Date(dueLocal).toLocaleString('vi-VN')}
          </p>
        )}
      </div>

      <p className="text-sm text-ink-2">
        <strong className="text-ink-1">{drafts.length}</strong> việc lớn
        {subtasks > 0 && (
          <>
            {' '}
            và <strong className="text-ink-1">{subtasks}</strong> việc nhỏ
          </>
        )}{' '}
        sẽ được tạo. Sau khi xác nhận, bạn vẫn có thể thêm, sửa hoặc sắp xếp lại chúng.
      </p>

      <ol className="grid gap-1.5">
        {drafts.map((draft, index) => {
          const meta =
            kind === 'daily' ? PRIORITY_META[draft.priority] : QUADRANT_META[draft.quadrant]

          return (
            <li
              key={draft.key}
              className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="w-5 shrink-0 text-xs tabular-nums text-ink-3">{index + 1}.</span>
              <span className="min-w-0 flex-1">
                <span className="break-words text-ink-1">{draft.title}</span>
                {draft.children.length > 0 && (
                  <span className="ml-1.5 text-xs text-ink-3">
                    (+{draft.children.length} việc nhỏ)
                  </span>
                )}
              </span>
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: `${meta.color}22`, color: meta.color }}
              >
                {meta.label}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

const STEP_LABELS = ['Loại & thông tin', 'Thêm việc', 'Xác nhận']

function Steps({ current }: { current: number }) {
  return (
    <ol id="checklist-steps" className="mb-5 flex items-center gap-2">
      {STEP_LABELS.map((label, index) => {
        const step = index + 1
        const done = step < current
        const active = step === current

        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition
                ${
                  active
                    ? 'bg-accent text-on-accent'
                    : done
                      ? 'bg-success/20 text-success'
                      : 'bg-surface-2 text-ink-3'
                }`}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : step}
            </span>
            <span
              className={`truncate text-xs ${active ? 'text-ink-1' : 'text-ink-3'}`}
            >
              {label}
            </span>
            {step < STEP_LABELS.length && <span className="h-px flex-1 bg-surface-3" />}
          </li>
        )
      })}
    </ol>
  )
}

function RankChip({
  id,
  meta,
  active,
  onClick,
}: {
  id: string
  meta: { label: string; hint: string; icon: typeof Plus; color: string }
  active: boolean
  onClick: () => void
}) {
  const Icon = meta.icon

  return (
    <button
      id={id}
      onClick={onClick}
      aria-pressed={active}
      title={meta.hint}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition
        ${active ? 'border-transparent text-ink-1' : 'border-surface-3 text-ink-2 hover:border-ink-3'}`}
      style={active ? { background: `${meta.color}26`, borderColor: meta.color } : undefined}
    >
      <Icon className="size-3.5" style={{ color: meta.color }} aria-hidden />
      {meta.label}
    </button>
  )
}
