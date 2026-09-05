/**
 * Row shapes and row -> DTO mapping.
 *
 * SQLite columns are snake_case, DTO fields are camelCase. That translation
 * happens here and only here, so a column rename never leaks past the storage
 * layer. See docs/03-architecture.md#layer-rules.
 */

import type {
  Asset,
  Category,
  CategorySummary,
  Checklist,
  ChecklistTask,
  Item,
  ItemSummary,
  Note,
  NoteFormat,
  NoteKind,
  NoteSummary,
} from '../../shared/types'
import {
  isEisenhowerQuadrant,
  isTaskPriority,
  isTaskStatus,
} from '../../core/domain/checklist'

/**
 * Separator used inside `group_concat` for tag names. ASCII 31 (unit
 * separator) cannot occur in a tag, so it cannot be confused with content the
 * way a comma can.
 */
export const CONCAT_SEP = String.fromCharCode(31)

export interface CategoryRow {
  id: string
  name: string
  slug: string
  parent_id: string | null
  color: string
  icon: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CategorySummaryRow extends CategoryRow {
  item_count: number
}

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    parentId: row.parent_id,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toCategorySummary(row: CategorySummaryRow): CategorySummary {
  return { ...toCategory(row), itemCount: row.item_count }
}

export interface ItemRow {
  id: string
  category_id: string
  title: string
  summary: string | null
  created_at: string
  updated_at: string
}

export interface ItemSummaryRow extends ItemRow {
  category_name: string
  category_color: string
  asset_count: number
  primary_ext: string | null
  tag_names: string | null
}

export function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toItemSummary(row: ItemSummaryRow): ItemSummary {
  return {
    ...toItem(row),
    categoryName: row.category_name,
    categoryColor: row.category_color,
    assetCount: row.asset_count,
    primaryExt: row.primary_ext ?? '',
    tags: row.tag_names ? row.tag_names.split(CONCAT_SEP).filter(Boolean).sort() : [],
  }
}

export interface NoteRow {
  id: string
  title: string
  kind: string
  format: string
  content: string
  due_at: string | null
  done_at: string | null
  rel_path: string
  created_at: string
  updated_at: string
}

/** `content` is replaced by a truncation and a length; see `NOTE_SUMMARY_SELECT`. */
export interface NoteSummaryRow extends Omit<NoteRow, 'content'> {
  excerpt: string
  content_length: number
}

/**
 * The CHECK constraints in migration 2 already guarantee these, but the column
 * is TEXT and a row written by a future version — or by `sqlite3` on the
 * command line — would otherwise be typed as valid by assertion alone.
 */
function toNoteKind(raw: string): NoteKind {
  switch (raw) {
    case 'study':
    case 'daily':
    case 'deadline':
    case 'task':
    case 'idea':
    case 'meeting':
    case 'snippet':
    case 'other':
      return raw
    default:
      return 'other'
  }
}

function toNoteFormat(raw: string): NoteFormat {
  return raw === 'text' ? 'text' : 'markdown'
}

export function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    kind: toNoteKind(row.kind),
    format: toNoteFormat(row.format),
    content: row.content,
    dueAt: row.due_at,
    doneAt: row.done_at,
    relPath: row.rel_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toNoteSummary(row: NoteSummaryRow): NoteSummary {
  const { content: _content, ...note } = toNote({ ...row, content: '' })
  return { ...note, excerpt: row.excerpt, contentLength: row.content_length }
}

export interface AssetRow {
  id: string
  item_id: string
  filename: string
  ext: string
  mime: string
  size_bytes: number
  rel_path: string
  checksum: string
  sort_order: number
  created_at: string
}

export function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    itemId: row.item_id,
    filename: row.filename,
    ext: row.ext,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    relPath: row.rel_path,
    checksum: row.checksum,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export interface ChecklistRow {
  id: string
  kind: string
  day: string | null
  title: string | null
  description: string | null
  due_at: string | null
  created_at: string
  updated_at: string
}

export interface ChecklistTaskRow {
  id: string
  checklist_id: string
  parent_id: string | null
  title: string
  description: string | null
  due_at: string | null
  status: string
  priority: string | null
  quadrant: string | null
  sort_order: number
  done_at: string | null
  created_at: string
  updated_at: string
}

/**
 * The CHECK constraints in migration 4 already guarantee these, but the
 * columns are TEXT: a row written by a future version — or by `sqlite3` on the
 * command line — would otherwise be typed as valid by assertion alone. Same
 * reasoning as `toNoteKind`.
 */
export function toChecklist(row: ChecklistRow): Checklist {
  return {
    id: row.id,
    kind: row.kind === 'module' ? 'module' : 'daily',
    day: row.day,
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toChecklistTask(row: ChecklistTaskRow): ChecklistTask {
  return {
    id: row.id,
    checklistId: row.checklist_id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
    status: isTaskStatus(row.status) ? row.status : 'todo',
    priority: isTaskPriority(row.priority) ? row.priority : null,
    quadrant: isEisenhowerQuadrant(row.quadrant) ? row.quadrant : null,
    sortOrder: row.sort_order,
    doneAt: row.done_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
