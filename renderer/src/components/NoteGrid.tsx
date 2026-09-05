'use client'

import { Check, Plus, RotateCcw, StickyNote, Trash2 } from 'lucide-react'
import { useState } from 'react'

import type { NoteSummary } from '@shared/types'
import { describeDue, formatRelativeDate } from '@/lib/format'
import { NOTE_KIND_META, NOTE_KIND_ORDER, noteExtension, plainExcerpt } from '@/lib/notes'
import { useVault } from '@/lib/store'
import { Button, ConfirmDialog, EmptyState, Spinner } from './ui'

/** Due-date chip colours. Overdue has to be unmissable; later has to not be. */
const DUE_TONE: Record<string, string> = {
  overdue: 'bg-danger/15 text-danger',
  today: 'bg-amber-400/15 text-amber-300',
  soon: 'bg-accent-soft text-accent',
  later: 'bg-surface-2 text-ink-3',
}

/**
 * The notes list.
 *
 * Ordering is the repository's, not this component's: open notes with a
 * deadline first and soonest-first, then everything else by recency, then the
 * ones already ticked off. The point of a deadline note is that it puts itself
 * where you will see it, which cannot be a client-side sort of one page of
 * results.
 */
export function NoteGrid({ onAddNote }: { onAddNote: () => void }) {
  const {
    notes,
    notesLoading,
    noteFilter,
    noteQuery,
    filterNotes,
    openNote,
    updateNote,
    deleteNote,
    busy,
  } = useVault()

  const [pendingDelete, setPendingDelete] = useState<NoteSummary | null>(null)

  return (
    <div className="px-6 py-4">
      <div id="note-filters" className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip active={noteFilter === null} id="btn-note-filter-all" onClick={() => filterNotes(null)}>
          Tất cả
        </FilterChip>
        {NOTE_KIND_ORDER.map((kind) => {
          const meta = NOTE_KIND_META[kind]
          const Icon = meta.icon
          return (
            <FilterChip
              key={kind}
              id={`btn-note-filter-${kind}`}
              active={noteFilter === kind}
              onClick={() => filterNotes(noteFilter === kind ? null : kind)}
            >
              <Icon className="size-3.5" style={{ color: meta.color }} aria-hidden />
              {meta.label}
            </FilterChip>
          )
        })}
      </div>

      {notesLoading ? (
        <Spinner />
      ) : notes.length === 0 ? (
        <EmptyState
          id="empty-notes"
          icon={StickyNote}
          title={
            noteQuery.length > 0 || noteFilter !== null
              ? 'Không có ghi chú nào khớp'
              : 'Chưa có ghi chú nào'
          }
          description={
            noteQuery.length > 0 || noteFilter !== null
              ? 'Thử bỏ bớt bộ lọc, hoặc dùng từ khoá ngắn hơn.'
              : 'Ghi chú là thứ bạn tự viết ở đây: bài học, nhật ký, việc cần làm, hạn chót. Không cần tệp đính kèm.'
          }
          action={
            noteQuery.length === 0 && noteFilter === null ? (
              <Button id="btn-add-note-empty" variant="primary" onClick={onAddNote}>
                <Plus className="size-4" />
                Ghi chú mới
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          id="grid-notes"
          className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]"
        >
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              busy={busy}
              onOpen={() => void openNote(note.id)}
              onToggleDone={() => void updateNote({ id: note.id, done: note.doneAt === null })}
              onDelete={() => setPendingDelete(note)}
            />
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          id="modal-confirm-delete-note"
          title="Xoá ghi chú?"
          subject={pendingDelete.title}
          consequence={`Ghi chú và bản sao .${noteExtension(pendingDelete.format)} của nó trong kho lưu trữ đều bị xoá.`}
          confirmLabel="Xoá ghi chú"
          confirmId="btn-confirm-delete-note"
          cancelId="btn-cancel-delete-note"
          busy={busy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            const id = pendingDelete.id
            setPendingDelete(null)
            await deleteNote(id)
          }}
        />
      )}
    </div>
  )
}

function NoteCard({
  note,
  busy,
  onOpen,
  onToggleDone,
  onDelete,
}: {
  note: NoteSummary
  busy: boolean
  onOpen: () => void
  onToggleDone: () => void
  onDelete: () => void
}) {
  const meta = NOTE_KIND_META[note.kind]
  const Icon = meta.icon
  const done = note.doneAt !== null
  const due = note.dueAt ? describeDue(note.dueAt) : null
  const preview = plainExcerpt(note.excerpt, note.format)

  return (
    <div
      id={`card-note-${note.id}`}
      className={`group flex h-full flex-col rounded-[14px] border bg-surface-1 p-4 transition
        ${done ? 'border-surface-3/60 opacity-60' : 'border-surface-3 hover:border-accent/50'}`}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="size-3.5 shrink-0" style={{ color: meta.color }} aria-hidden />
        <span className="truncate text-xs text-ink-3">{meta.label}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-3">
          {noteExtension(note.format)}
        </span>

        {due && (
          <span
            className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              done ? 'bg-surface-2 text-ink-3' : DUE_TONE[due.tone]
            }`}
          >
            {due.label}
          </span>
        )}
      </div>

      <button
        id={`btn-open-note-${note.id}`}
        onClick={onOpen}
        className="flex-1 text-left"
        title="Mở ghi chú"
      >
        <h3
          className={`mb-1.5 line-clamp-2 text-sm font-medium leading-snug text-ink-1 ${
            done ? 'line-through' : ''
          }`}
        >
          {note.title}
        </h3>
        {preview.length > 0 ? (
          <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-ink-3">
            {preview}
          </p>
        ) : (
          <p className="text-xs italic text-ink-3">Chưa có nội dung</p>
        )}
      </button>

      <div className="mt-3 flex items-center gap-1 border-t border-surface-3 pt-2.5 text-[11px] text-ink-3">
        <span>{note.contentLength.toLocaleString('vi-VN')} ký tự</span>
        <span className="ml-auto">{formatRelativeDate(note.updatedAt)}</span>

        <button
          id={`btn-note-done-${note.id}`}
          onClick={onToggleDone}
          disabled={busy}
          title={done ? 'Đánh dấu chưa xong' : 'Đánh dấu đã xong'}
          aria-label={done ? 'Đánh dấu chưa xong' : 'Đánh dấu đã xong'}
          aria-pressed={done}
          className="rounded p-1 transition hover:bg-surface-2 hover:text-success disabled:opacity-40"
        >
          {done ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
        </button>
        <button
          id={`btn-note-delete-${note.id}`}
          onClick={onDelete}
          title="Xoá ghi chú"
          aria-label={`Xoá ghi chú ${note.title}`}
          className="rounded p-1 transition hover:bg-surface-2 hover:text-danger"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function FilterChip({
  id,
  active,
  onClick,
  children,
}: {
  id: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition
        ${
          active
            ? 'border-accent bg-accent-soft text-ink-1'
            : 'border-surface-3 text-ink-2 hover:border-ink-3'
        }`}
    >
      {children}
    </button>
  )
}
