'use client'

/**
 * Display metadata for note kinds and formats.
 *
 * The kinds themselves are a closed set in `src/shared/types.ts` and are
 * enforced by a `CHECK` constraint in the schema. What lives here is the part
 * the main process has no business knowing: the Vietnamese label, the icon and
 * the accent colour.
 *
 * Typed as `Record<NoteKind, …>`, so adding a kind to the union and forgetting
 * to describe it here is a compile error rather than a blank chip.
 */

import {
  AlarmClock,
  BookOpen,
  CalendarDays,
  Code2,
  FileText,
  Lightbulb,
  ListChecks,
  StickyNote,
  Users,
  type LucideIcon,
} from 'lucide-react'

import type { NoteFormat, NoteKind } from '@shared/types'
import { extensionForFormat } from '@shared/text-format'

export interface NoteKindMeta {
  label: string
  hint: string
  icon: LucideIcon
  /** Hex, matching the category palette in docs/08-ui-guide.md#category-palette. */
  color: string
}

export const NOTE_KIND_META: Record<NoteKind, NoteKindMeta> = {
  study: {
    label: 'Học tập',
    hint: 'Bài học, tóm tắt, kiến thức mới',
    icon: BookOpen,
    color: '#38bdf8',
  },
  daily: {
    label: 'Nhật ký',
    hint: 'Ghi chép hằng ngày, việc đã làm',
    icon: CalendarDays,
    color: '#4ade80',
  },
  deadline: {
    label: 'Hạn chót',
    hint: 'Có mốc thời gian bắt buộc — luôn nằm trên đầu danh sách',
    icon: AlarmClock,
    color: '#f87171',
  },
  task: {
    label: 'Việc cần làm',
    hint: 'Danh sách việc, có thể đặt thời hạn',
    icon: ListChecks,
    color: '#fbbf24',
  },
  idea: {
    label: 'Ý tưởng',
    hint: 'Nghĩ ra được gì thì ghi lại đây',
    icon: Lightbulb,
    color: '#a78bfa',
  },
  meeting: {
    label: 'Cuộc họp',
    hint: 'Nội dung trao đổi và việc cần theo dõi sau đó',
    icon: Users,
    color: '#60a5fa',
  },
  snippet: {
    label: 'Đoạn mã',
    hint: 'Câu lệnh, cấu hình, mẹo dùng lại nhiều lần',
    icon: Code2,
    color: '#34d399',
  },
  other: {
    label: 'Khác',
    hint: 'Không thuộc nhóm nào ở trên',
    icon: StickyNote,
    color: '#a3b0c9',
  },
}

/** The order the picker and the filter chips offer them in. */
export const NOTE_KIND_ORDER: NoteKind[] = [
  'study',
  'daily',
  'deadline',
  'task',
  'idea',
  'meeting',
  'snippet',
  'other',
]

export const NOTE_FORMAT_META: Record<NoteFormat, { label: string; hint: string; icon: LucideIcon }> =
  {
    markdown: {
      label: 'Markdown',
      hint: 'Có tiêu đề, danh sách, bảng, khối code — kèm khung xem trước',
      icon: FileText,
    },
    text: {
      label: 'Văn bản thuần',
      hint: 'Chữ thô, không định dạng. Gõ nhanh, không cần nhớ cú pháp',
      icon: FileText,
    },
  }

/** The extension the note is mirrored to in the vault; shown as a chip. */
export function noteExtension(format: NoteFormat): string {
  return extensionForFormat(format)
}

/**
 * Card preview text.
 *
 * The excerpt arrives as raw source, and three lines of `#`, `**` and backtick
 * noise tells the reader less about a note than the same three lines without
 * it. This strips the markers rather than rendering the Markdown: a card is
 * two hundred characters of a document, and formatting a fragment that may end
 * mid-list produces something that looks broken.
 *
 * Plain-text notes are returned untouched — there is no syntax to remove, and
 * a `#` in a text note is a `#`.
 */
export function plainExcerpt(excerpt: string, format: NoteFormat): string {
  if (format === 'text') return excerpt

  return excerpt
    .replace(/^```.*$/gm, '') // fence lines
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // heading markers
    .replace(/^\s{0,3}>\s?/gm, '') // blockquote markers
    .replace(/\*\*|__|~~/g, '') // bold, strikethrough
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their text
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
