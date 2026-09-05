'use client'

/**
 * Shared primitives.
 *
 * Deliberately hand-written rather than pulled from a component library: the
 * app needs a button, a modal, a text field and an empty state, and the whole
 * set is shorter than the configuration a library would need.
 *
 * Every interactive element takes an `id`. Those ids are the selectors any
 * future UI test will use, so changing one is a breaking change.
 * See docs/08-ui-guide.md#element-ids.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Binary,
  BookOpen,
  Brain,
  Briefcase,
  Code2,
  Database,
  FileText,
  FlaskConical,
  Folder,
  Globe,
  GraduationCap,
  Languages,
  Lightbulb,
  Minus,
  Plus,
  RotateCcw,
  Server,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'

import { parseTags } from '@/lib/format'
import { formatScale } from '@/lib/prefs'

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/**
 * The icon set a category may choose from.
 *
 * An explicit map, not a dynamic lookup into `lucide-react`: importing the
 * whole package to resolve a name at runtime would pull roughly a thousand
 * components into the bundle to render one.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Folder,
  Code2,
  Brain,
  Languages,
  BookOpen,
  Database,
  Server,
  Shield,
  Terminal,
  Globe,
  GraduationCap,
  Lightbulb,
  FlaskConical,
  Briefcase,
  Sparkles,
  Binary,
}

export function CategoryIcon({
  name,
  className,
  color,
}: {
  name: string
  className?: string
  color?: string
}) {
  const Icon = CATEGORY_ICONS[name] ?? Folder
  return <Icon className={className} style={color ? { color } : undefined} aria-hidden />
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'danger-solid' | 'subtle'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  // `text-on-accent` rather than `text-surface-0`: the label has to contrast
  // with the *button*, and on the light theme surface-0 is white-on-blue.
  primary: 'bg-accent text-on-accent hover:brightness-110 font-medium',
  subtle: 'bg-surface-2 text-ink-1 hover:bg-surface-3',
  ghost: 'text-ink-2 hover:text-ink-1 hover:bg-surface-2',
  // Quiet enough to sit in a toolbar without shouting.
  danger: 'text-danger hover:bg-danger/10',
  // For the confirm step only, where the button must read as the point of no
  // return rather than as one more option.
  'danger-solid': 'bg-danger text-on-accent hover:brightness-110 font-medium',
}

export function Button({
  id,
  children,
  onClick,
  variant = 'subtle',
  disabled,
  type = 'button',
  title,
  className = '',
}: {
  id: string
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
  className?: string
}) {
  return (
    <button
      id={id}
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition
        disabled:cursor-not-allowed disabled:opacity-45 ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  id,
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  id: string
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /**
   * `lg` is for a dialog that is a workflow rather than a form — the checklist
   * wizard builds a list inside itself, and at `md` the list it is building is
   * narrower than the row it will become.
   */
  size?: 'md' | 'lg'
}) {
  // Escape closes. Registered on the document because focus may be anywhere
  // inside the dialog, including a native input.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        // Only a click that both starts and ends on the backdrop dismisses;
        // a drag that began inside the dialog must not close it.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full overflow-hidden rounded-[14px] border border-surface-3 bg-surface-1 shadow-2xl
          ${size === 'lg' ? 'max-w-3xl' : 'max-w-xl'}`}
      >
        <header className="flex items-center justify-between border-b border-surface-3 px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            id={`${id}-close`}
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-md p-1 text-ink-3 transition hover:bg-surface-2 hover:text-ink-1"
          >
            <X className="size-4" />
          </button>
        </header>

        {/*
          The body scrolls, which means anything placed low in a form can fall
          below the fold. Put a dialog's primary action near the top — see the
          note in ItemDialog.
        */}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex justify-end gap-2 border-t border-surface-3 bg-surface-1 px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

/**
 * The one way this application asks "are you sure?".
 *
 * Every destructive action routes through it: deleting an item, a file, a
 * category or a note. Three properties make it hard to dismiss by reflex,
 * which is the entire point:
 *
 *   - it names the thing. Not "delete this item?" but the actual title, so a
 *     click on the wrong row is visible before it is irreversible
 *   - it says what else goes with it — attached files, the note's copy in the
 *     vault — and that there is no undo
 *   - the confirm button is not where the button that opened it was, so a
 *     double-click cannot carry through onto it
 *
 * It is an in-app modal rather than `dialog.showMessageBox`: a native dialog
 * steals focus from the whole desktop and looks like something that happened
 * *to* the user rather than something they are doing.
 */
export function ConfirmDialog({
  id,
  title,
  subject,
  consequence,
  confirmLabel,
  confirmId,
  cancelId,
  busy,
  onConfirm,
  onCancel,
}: {
  id: string
  title: string
  /** The thing being destroyed, quoted back verbatim. */
  subject: string
  /** What else disappears with it. One sentence. */
  consequence: string
  confirmLabel: string
  confirmId: string
  cancelId: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      id={id}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button id={cancelId} variant="subtle" onClick={onCancel}>
            Huỷ
          </Button>
          <Button id={confirmId} variant="danger-solid" onClick={onConfirm} disabled={busy}>
            <Trash2 className="size-4" />
            {busy ? 'Đang xoá…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3.5">
        <div className="shrink-0 rounded-xl bg-danger/10 p-2.5">
          <AlertTriangle className="size-5 text-danger" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="break-words text-sm text-ink-1">
            <span className="font-medium">{subject}</span>
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{consequence}</p>
          <p className="mt-2 text-xs text-danger">Thao tác này không hoàn tác được.</p>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Form field
// ---------------------------------------------------------------------------

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>
      )}
    </div>
  )
}

export const inputClass =
  'w-full rounded-lg border border-surface-3 bg-surface-0 px-3 py-2 text-sm text-ink-1 ' +
  'placeholder:text-ink-3 transition focus:border-accent focus:outline-none'

// ---------------------------------------------------------------------------
// Tag input
// ---------------------------------------------------------------------------

/**
 * Tags, as chips you can see and delete one at a time.
 *
 * It replaces a plain comma-separated text field. That field worked, but it made
 * the user do the parser's job in their head: with `spring, di, backend` on one
 * line there is no way to tell whether the trailing space matters, whether a
 * typo three tags ago is still there, or which characters will survive. Nothing
 * confirmed a tag had been *accepted* until the item was saved.
 *
 * A tag is committed the moment its separator is typed — `,` — and also on
 * `Enter`, on `Tab`, and on blur, because a half-typed tag left in the box when
 * the user moves to the Save button should be kept, not silently dropped. From
 * then on it is a chip with an `×`.
 *
 * Deliberately not a free-text field that merely *looks* like chips: `value` is
 * a `string[]`, so the caller holds exactly what will be sent over IPC and
 * `parseTags` is no longer in the submit path.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  /** Matches the `tags.name` column's practical limit; see docs/04-data-model.md. */
  maxLength = 60,
}: {
  /** The inner text field takes this id, so `Field`'s label still points at it. */
  id: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  maxLength?: number
}) {
  const [draft, setDraft] = useState('')
  /** Index of a chip to flash because the user retyped it. */
  const [duplicate, setDuplicate] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  function flashDuplicate(index: number) {
    setDuplicate(index)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setDuplicate(null), 1100)
  }

  /**
   * Commits whatever is in the draft. Splits on the separators too, so pasting
   * `spring, di, backend` yields three chips rather than one long tag — the old
   * field's format stays a valid thing to paste in.
   */
  function commit(raw: string): void {
    const parts = parseTags(raw)
    if (parts.length === 0) {
      setDraft('')
      return
    }

    const next = [...value]
    let lastDuplicate: number | null = null

    for (const part of parts) {
      const trimmed = part.slice(0, maxLength)
      const existing = next.findIndex((tag) => tag.toLowerCase() === trimmed.toLowerCase())
      if (existing >= 0) {
        lastDuplicate = existing
        continue
      }
      next.push(trimmed)
    }

    setDraft('')
    // Say something when nothing happened: a tag typed twice would otherwise
    // just vanish, which reads as the control being broken rather than as the
    // tag already being there.
    if (lastDuplicate !== null && next.length === value.length) flashDuplicate(lastDuplicate)
    if (next.length !== value.length) onChange(next)
  }

  function remove(index: number): void {
    onChange(value.filter((_, i) => i !== index))
    inputRef.current?.focus()
  }

  return (
    <div
      // The whole box is the click target, not just the text field: the input is
      // the last few pixels once several chips are in, and clicking the padding
      // beside a chip must not be a dead zone.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) inputRef.current?.focus()
      }}
      className="flex w-full flex-wrap items-center gap-1.5 rounded-lg border border-surface-3
        bg-surface-0 px-2 py-1.5 transition focus-within:border-accent"
    >
      {value.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          id={`${id}-chip-${index}`}
          className={`inline-flex max-w-full items-center gap-1 rounded-md py-0.5 pl-2 pr-1 text-xs
            transition ${
              duplicate === index
                ? 'bg-accent text-on-accent'
                : 'bg-surface-2 text-ink-1'
            }`}
        >
          <span className="truncate">{tag}</span>
          <button
            id={`${id}-chip-${index}-remove`}
            type="button"
            aria-label={`Xoá thẻ ${tag}`}
            title={`Xoá thẻ ${tag}`}
            onClick={() => remove(index)}
            className="rounded p-0.5 text-current opacity-60 transition hover:bg-surface-3
              hover:opacity-100"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}

      <input
        id={id}
        ref={inputRef}
        value={draft}
        maxLength={maxLength}
        placeholder={value.length === 0 ? placeholder : undefined}
        // Not a `<form>`, but browsers still autocomplete a bare text field.
        autoComplete="off"
        onChange={(event) => {
          const text = event.target.value
          // Typing the separator is the commit gesture. Handled here rather than
          // in `onKeyDown` so it also covers an IME, a paste ending in a comma,
          // and layouts where the comma arrives without a matching `key`.
          if (/[,\n]/.test(text)) commit(text)
          else setDraft(text)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Tab') {
            // Only swallow the key when there is something to commit, so Tab
            // still moves focus out of an empty field and Enter still reaches
            // any parent that submits on it.
            if (draft.trim().length === 0) return
            event.preventDefault()
            commit(draft)
            return
          }
          // Backspace at the start of an empty field deletes the previous chip,
          // the behaviour every other chip input has.
          if (event.key === 'Backspace' && draft.length === 0 && value.length > 0) {
            event.preventDefault()
            remove(value.length - 1)
          }
        }}
        // A tag still being typed when focus leaves is kept. Dropping it would
        // lose work at the exact moment the user reaches for Save.
        onBlur={() => commit(draft)}
        // `tag-field` suppresses the inner focus ring; see globals.css for why
        // it cannot be a utility class.
        className="tag-field min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm text-ink-1
          placeholder:text-ink-3"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      id="message-error"
      role="alert"
      className="mx-6 mt-4 flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-ink-1"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <p className="flex-1">{message}</p>
      <button
        id="btn-dismiss-error"
        onClick={onDismiss}
        aria-label="Bỏ qua"
        className="text-ink-3 transition hover:text-ink-1"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

export function EmptyState({
  id,
  icon: Icon = FileText,
  title,
  description,
  action,
}: {
  id: string
  icon?: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div id={id} className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 rounded-2xl bg-surface-2 p-4">
        <Icon className="size-7 text-ink-3" aria-hidden />
      </div>
      <h3 className="mb-1.5 text-base font-medium text-ink-1">{title}</h3>
      <p className="mb-5 max-w-sm text-sm text-ink-3">{description}</p>
      {action}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-ink-3">
      <span className="size-4 animate-spin rounded-full border-2 border-surface-3 border-t-accent" />
      {label ?? 'Đang tải…'}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/**
 * `−  120%  +  ⟲` — one stepper, used for both scales.
 *
 * The percentage is a button rather than a label: it is the reset, and putting
 * it on the number means the thing you want to undo is the thing you click. The
 * `⟲` icon only appears once there is something to reset, so the control is
 * three items wide at 100% and does not shift when it is not doing anything.
 *
 * It is a real control in the toolbar rather than a keyboard shortcut alone,
 * because a shortcut nobody is told about is not a feature.
 */
export function ZoomControl({
  id,
  scale,
  onStep,
  onReset,
  label,
  hint,
  atMin,
  atMax,
}: {
  /** Element ids are `<id>-out`, `<id>-value`, `<id>-in`. */
  id: string
  scale: number
  onStep: (delta: number) => void
  onReset: () => void
  /** Accessible name for the group, e.g. "Cỡ chữ nội dung". */
  label: string
  /** Native tooltip — the place to mention the keyboard shortcut. */
  hint?: string
  atMin?: boolean
  atMax?: boolean
}) {
  const dirty = Math.abs(scale - 1) > 0.001

  return (
    <span
      role="group"
      aria-label={label}
      title={hint}
      className="inline-flex items-center gap-0.5 rounded-lg border border-surface-3 bg-surface-1 p-0.5"
    >
      <ZoomStep
        id={`${id}-out`}
        label={`Giảm ${label.toLowerCase()}`}
        disabled={atMin}
        onClick={() => onStep(-1)}
      >
        <Minus className="size-3.5" />
      </ZoomStep>

      <button
        id={`${id}-value`}
        onClick={onReset}
        disabled={!dirty}
        title={dirty ? `Đặt lại về 100%` : undefined}
        aria-label={`${label}: ${formatScale(scale)}${dirty ? ' — bấm để đặt lại' : ''}`}
        className="inline-flex min-w-[3.75rem] items-center justify-center gap-1 rounded px-1 py-1
          text-[11px] tabular-nums text-ink-2 transition enabled:hover:text-ink-1
          disabled:cursor-default"
      >
        {formatScale(scale)}
        {dirty && <RotateCcw className="size-3 opacity-70" aria-hidden />}
      </button>

      <ZoomStep
        id={`${id}-in`}
        label={`Tăng ${label.toLowerCase()}`}
        disabled={atMax}
        onClick={() => onStep(1)}
      >
        <Plus className="size-3.5" />
      </ZoomStep>
    </span>
  )
}

function ZoomStep({
  id,
  label,
  disabled,
  onClick,
  children,
}: {
  id: string
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded p-1 text-ink-3 transition hover:bg-surface-2 hover:text-ink-1
        disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Settings primitives
// ---------------------------------------------------------------------------

/**
 * A labelled row for one setting: name and explanation on the left, the control
 * on the right. Used throughout the appearance screen so every option reads the
 * same way and the explanation is never optional.
 */
export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  /** Points the label at the control, when the control is a single input. */
  htmlFor?: string
  children: ReactNode
}) {
  const Tag = htmlFor ? 'label' : 'div'

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-surface-3 py-3.5 last:border-b-0">
      <Tag className="min-w-0 flex-1" {...(htmlFor ? { htmlFor } : {})}>
        <span className="block text-sm font-medium text-ink-1">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{hint}</span>}
      </Tag>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export const selectClass =
  'rounded-lg border border-surface-3 bg-surface-0 px-3 py-2 text-sm text-ink-1 ' +
  'transition focus:border-accent focus:outline-none'

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * A completion bar.
 *
 * The colour is passed in rather than derived here, because "what does 60%
 * mean" is a decision about checklists, not about bars — see `progressTone`.
 * `aria-valuenow` carries the number for anyone who cannot see the fill.
 */
export function ProgressBar({
  id,
  percent,
  tone,
  label,
  className = '',
}: {
  id?: string
  percent: number
  tone: string
  /** Announced to assistive technology; the bar itself has no text. */
  label: string
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))

  return (
    <div
      id={id}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-3 ${className}`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${clamped}%`, background: tone }}
      />
    </div>
  )
}

/**
 * The same number as a ring, for a card that has no width to spare.
 *
 * Drawn as one SVG circle with a dash offset rather than a conic gradient:
 * the gradient version cannot be given a rounded cap, and at small sizes the
 * hard edge reads as a rendering fault.
 */
export function ProgressRing({
  id,
  percent,
  tone,
  size = 44,
  label,
}: {
  id?: string
  percent: number
  tone: string
  size?: number
  label: string
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  const stroke = size >= 40 ? 4 : 3
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div
      id={id}
      role="img"
      aria-label={label}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-surface-3)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-ink-1"
        aria-hidden
      >
        {clamped}
      </span>
    </div>
  )
}
