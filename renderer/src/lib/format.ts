/** Small display helpers. Pure, no React, no bridge. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** exponent
  const decimals = exponent === 0 ? 0 : value < 10 ? 1 : 0

  return `${value.toFixed(decimals)} ${UNITS[exponent]}`
}

/**
 * Relative for anything within the last week, absolute after that — a list of
 * "3 ngày trước" is easier to scan than a column of identical-looking dates,
 * but "47 ngày trước" tells you less than the date itself.
 */
export function formatRelativeDate(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return '—'

  const seconds = Math.round((Date.now() - then.getTime()) / 1000)

  if (seconds < 60) return 'vừa xong'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} giờ trước`
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)} ngày trước`

  return then.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** How a due date relates to now, so a card can colour and word itself. */
export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

export interface DueStatus {
  tone: DueTone
  /** Short, human phrasing: `Quá hạn 2 ngày`, `Hôm nay 17:00`, `Còn 3 ngày`. */
  label: string
}

const DAY_MS = 86_400_000

/**
 * A deadline is only useful if the distance to it is readable at a glance.
 * Days are compared on the calendar rather than by elapsed hours: something
 * due at 08:00 tomorrow is "ngày mai" even when that is only nine hours away.
 */
export function describeDue(iso: string): DueStatus {
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return { tone: 'later', label: '—' }

  const time = due.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(due) - startOfDay(new Date())) / DAY_MS)

  if (due.getTime() < Date.now()) {
    if (days === 0) return { tone: 'overdue', label: `Quá hạn lúc ${time}` }
    return { tone: 'overdue', label: `Quá hạn ${Math.abs(days)} ngày` }
  }
  if (days === 0) return { tone: 'today', label: `Hôm nay ${time}` }
  if (days === 1) return { tone: 'today', label: `Ngày mai ${time}` }
  if (days <= 7) return { tone: 'soon', label: `Còn ${days} ngày` }
  return { tone: 'later', label: formatDate(iso) }
}

/**
 * ISO-8601 UTC -> the `YYYY-MM-DDTHH:mm` an `<input type="datetime-local">`
 * expects, in the user's own timezone. `toISOString()` cannot be used here:
 * it would show a deadline set for 17:00 in Hanoi as 10:00.
 */
export function toDateTimeLocal(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/**
 * The reverse. The value is timezone-naive, so `new Date()` reads it as local
 * time — which is what the user meant — and the service stores the UTC
 * instant that corresponds to it.
 */
export function fromDateTimeLocal(value: string): string | null {
  if (value.trim().length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Comma-separated or newline-separated tag input -> a clean list. */
export function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[,\n]/).map((t) => t.trim()).filter((t) => t.length > 0))]
}
