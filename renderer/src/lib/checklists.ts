'use client'

/**
 * Display metadata for checklists, plus the calendar arithmetic the dashboard
 * needs.
 *
 * The values themselves are a closed set in `src/shared/types.ts`, enforced by
 * `CHECK` constraints in the schema and by `src/core/domain/checklist.ts`.
 * What lives here is the part the main process has no business knowing: the
 * Vietnamese label, the icon, the accent colour — and the fact that a week
 * starts on Monday, which is a presentation decision, not a storage one.
 *
 * Every map is typed as `Record<Union, …>`, so adding a value to the union and
 * forgetting to describe it here is a compile error rather than a blank chip.
 */

import {
  ArrowDownRight,
  CalendarClock,
  CalendarDays,
  Circle,
  CircleCheckBig,
  CircleDashed,
  CircleDot,
  Flame,
  LayoutGrid,
  Timer,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

import type {
  ChecklistKind,
  EisenhowerQuadrant,
  Progress,
  TaskPriority,
  TaskStatus,
} from '@shared/types'

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export interface Meta {
  label: string
  hint: string
  icon: LucideIcon
  /** Hex, matching the palette in docs/08-ui-guide.md#category-palette. */
  color: string
}

export const CHECKLIST_KIND_META: Record<ChecklistKind, Meta> = {
  daily: {
    label: 'Checklist ngày',
    hint: 'Kế hoạch cho một ngày cụ thể. Mỗi ngày chỉ có một checklist.',
    icon: CalendarDays,
    color: '#38bdf8',
  },
  module: {
    label: 'Checklist module',
    hint: 'Một khối công việc kéo dài nhiều ngày, sắp xếp theo ma trận Eisenhower.',
    icon: LayoutGrid,
    color: '#a78bfa',
  },
}

export const TASK_STATUS_META: Record<TaskStatus, Meta> = {
  todo: {
    label: 'Cần hoàn thiện',
    hint: 'Chưa bắt đầu',
    icon: CircleDashed,
    color: '#a3b0c9',
  },
  doing: {
    label: 'Đang làm',
    hint: 'Đã bắt tay vào nhưng chưa xong',
    icon: CircleDot,
    color: '#fbbf24',
  },
  done: {
    label: 'Đã xong',
    hint: 'Hoàn thành',
    icon: CircleCheckBig,
    color: '#34d399',
  },
}

export const TASK_STATUS_ORDER: TaskStatus[] = ['todo', 'doing', 'done']

export const PRIORITY_META: Record<TaskPriority, Meta> = {
  high: {
    label: 'Cao',
    hint: 'Cần hoàn thiện trước nhất trong ngày',
    icon: Flame,
    color: '#f87171',
  },
  normal: {
    label: 'Thường',
    hint: 'Xong trong ngày của checklist là được',
    icon: Circle,
    color: '#38bdf8',
  },
}

export const PRIORITY_ORDER: TaskPriority[] = ['high', 'normal']

/**
 * The four quadrants, labelled by what you do with a task rather than by the
 * two axes — *Làm ngay* is advice, *khẩn cấp + quan trọng* is a coordinate.
 * The axes are in the hint, where they explain the label.
 */
export const QUADRANT_META: Record<EisenhowerQuadrant, Meta> = {
  do: {
    label: 'Làm ngay',
    hint: 'Khẩn cấp + Quan trọng',
    icon: Flame,
    color: '#f87171',
  },
  schedule: {
    label: 'Lên lịch',
    hint: 'Quan trọng, chưa khẩn cấp',
    icon: CalendarClock,
    color: '#34d399',
  },
  delegate: {
    label: 'Uỷ thác',
    hint: 'Khẩn cấp, ít quan trọng',
    icon: ArrowDownRight,
    color: '#fbbf24',
  },
  eliminate: {
    label: 'Loại bỏ',
    hint: 'Không khẩn cấp, không quan trọng',
    icon: Trash2,
    color: '#94a3b8',
  },
}

/** Rendering order — the same ranking `QUADRANT_RANK` applies in the service. */
export const QUADRANT_ORDER: EisenhowerQuadrant[] = ['do', 'schedule', 'delegate', 'eliminate']

export const DEADLINE_ICON: LucideIcon = Timer

/**
 * The next state a click on the status chip moves to.
 * `Cần hoàn thiện → Đang làm → Đã xong → Cần hoàn thiện`.
 */
export function nextStatus(current: TaskStatus): TaskStatus {
  return current === 'todo' ? 'doing' : current === 'doing' ? 'done' : 'todo'
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
const WEEKDAYS_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

/**
 * `Date` -> `YYYY-MM-DD` in the *local* calendar.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that converts to UTC first,
 * so anywhere east of Greenwich the plan created at 08:00 on the 5th would be
 * filed under the 4th. The day is a calendar day; see `isDayString`.
 */
export function dayOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function todayDay(): string {
  return dayOf(new Date())
}

/** `YYYY-MM-DD` -> a local `Date` at midnight. */
export function dateOfDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1)
}

export function isToday(day: string): boolean {
  return day === todayDay()
}

export type StatsRange = 'week' | 'month'

export const RANGE_LABEL: Record<StatsRange, string> = {
  week: 'Tuần này',
  month: 'Tháng này',
}

/**
 * The window the dashboard reports on.
 *
 * The week runs Monday to Sunday, which is how a working week is read here —
 * `getDay()` returns 0 for Sunday, so it is shifted to the end rather than
 * treated as the start.
 */
export function rangeFor(range: StatsRange, from: Date = new Date()): { from: string; to: string } {
  if (range === 'month') {
    const first = new Date(from.getFullYear(), from.getMonth(), 1)
    const last = new Date(from.getFullYear(), from.getMonth() + 1, 0)
    return { from: dayOf(first), to: dayOf(last) }
  }

  const weekday = (from.getDay() + 6) % 7 // Monday = 0
  const monday = new Date(from.getFullYear(), from.getMonth(), from.getDate() - weekday)
  const sunday = new Date(monday.getTime() + 6 * DAY_MS)
  return { from: dayOf(monday), to: dayOf(sunday) }
}

/** Every day in an inclusive range, so the chart can draw the empty ones too. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = []
  const end = dateOfDay(to).getTime()

  for (let cursor = dateOfDay(from); cursor.getTime() <= end; ) {
    days.push(dayOf(cursor))
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
  }
  return days
}

/** `Thứ Sáu, 05/09/2026`. */
export function formatDayLong(day: string): string {
  const date = dateOfDay(day)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${WEEKDAYS[date.getDay()]}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

/** `T6 05/09` — for a card header, where the year is noise. */
export function formatDayShort(day: string): string {
  const date = dateOfDay(day)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${WEEKDAYS_SHORT[date.getDay()]} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
}

/** `T6` and `05` — the two lines of one bar in the range chart. */
export function weekdayShort(day: string): string {
  return WEEKDAYS_SHORT[dateOfDay(day).getDay()] ?? ''
}

export function dayNumber(day: string): string {
  return String(dateOfDay(day).getDate()).padStart(2, '0')
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * The colour a progress bar takes at a given completion.
 *
 * Three steps rather than a gradient: the point of the colour is to say
 * "finished / on the way / barely started" at a glance, and a continuous ramp
 * says none of the three.
 */
export function progressTone(percent: number): string {
  if (percent >= 100) return 'var(--color-success)'
  if (percent >= 40) return 'var(--color-accent)'
  return 'var(--color-ink-3)'
}

export function progressLabel(progress: Progress): string {
  if (progress.total === 0) return 'Chưa có việc nào'
  return `${progress.done}/${progress.total} việc · ${progress.percent}%`
}
