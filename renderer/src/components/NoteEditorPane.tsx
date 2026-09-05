'use client'

import { ArrowLeft, Check, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { Note, NoteFormat, NoteKind } from '@shared/types'
import { describeDue, formatDateTime, fromDateTimeLocal, toDateTimeLocal } from '@/lib/format'
import { NOTE_KIND_META, NOTE_KIND_ORDER, noteExtension } from '@/lib/notes'
import { useVault } from '@/lib/store'
import { TextComposer } from './TextComposer'
import { Button, ConfirmDialog, Spinner } from './ui'

/**
 * Full-window note editor.
 *
 * A Markdown note has **two sections**: the source on the left and the
 * rendered review on the right, live. The review uses exactly the same
 * parse-and-sanitise path as the viewer for a stored `.md` file
 * (`lib/markdown.ts`), so what the note looks like while it is being written
 * is what it looks like afterwards — there is no second renderer to drift.
 *
 * A plain-text note gets one pane, because a preview of unformatted text is
 * the same text in a different font.
 *
 * Saving is explicit. Autosave on a body the user is still thinking about
 * would mean every half-written sentence becomes a version in the vault, and
 * `Ctrl+S` is the gesture anyone writing in a text pane already has in their
 * fingers.
 */
export function NoteEditorPane({ note }: { note: Note }) {
  const { closeNote, updateNote, deleteNote, noteLoading, busy } = useVault()

  const [title, setTitle] = useState(note.title)
  const [kind, setKind] = useState<NoteKind>(note.kind)
  const [format, setFormat] = useState<NoteFormat>(note.format)
  const [dueLocal, setDueLocal] = useState(toDateTimeLocal(note.dueAt))
  const [content, setContent] = useState(note.content)
  const [confirming, setConfirming] = useState(false)

  // Re-seed when the store hands over a different note, or the same one after
  // a save. Keyed on `updatedAt` too, so the fields follow a successful write
  // instead of holding the values the user typed before it.
  const seeded = useRef(`${note.id}:${note.updatedAt}`)
  useEffect(() => {
    const key = `${note.id}:${note.updatedAt}`
    if (seeded.current === key) return
    seeded.current = key

    setTitle(note.title)
    setKind(note.kind)
    setFormat(note.format)
    setDueLocal(toDateTimeLocal(note.dueAt))
    setContent(note.content)
  }, [note])

  const dirty =
    title !== note.title ||
    kind !== note.kind ||
    format !== note.format ||
    content !== note.content ||
    dueLocal !== toDateTimeLocal(note.dueAt)

  const needsDue = kind === 'deadline'
  const canSave = title.trim().length > 0 && (!needsDue || dueLocal.trim().length > 0) && dirty

  async function save() {
    if (!canSave) return
    await updateNote({
      id: note.id,
      title,
      kind,
      format,
      content,
      dueAt: fromDateTimeLocal(dueLocal),
    })
  }

  // Ctrl/Cmd+S. Registered on the document because focus is usually inside the
  // textarea, where the browser's own save dialog would otherwise open. No
  // dependency array on purpose: the handler has to close over the current
  // draft, and re-binding one listener per render is cheaper than the ref
  // dance that would avoid it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (noteLoading) return <Spinner label="Đang mở ghi chú…" />

  const meta = NOTE_KIND_META[kind]
  const done = note.doneAt !== null
  const due = note.dueAt ? describeDue(note.dueAt) : null

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-surface-3 px-6 py-4">
        <div className="mb-3 flex items-center gap-2">
          <Button id="btn-back-to-notes" variant="ghost" onClick={closeNote}>
            <ArrowLeft className="size-4" />
            Quay lại
          </Button>

          {dirty && (
            <span id="note-dirty" className="text-xs text-ink-3">
              Có thay đổi chưa lưu
            </span>
          )}

          <span className="ml-auto flex items-center gap-2">
            <Button
              id="btn-note-toggle-done"
              onClick={() => void updateNote({ id: note.id, done: !done })}
              disabled={busy}
              title={done ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu đã hoàn thành'}
            >
              {done ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
              {done ? 'Mở lại' : 'Đã xong'}
            </Button>

            <Button
              id="btn-save-note"
              variant="primary"
              onClick={() => void save()}
              disabled={busy || !canSave}
              title="Ctrl+S"
            >
              <Save className="size-4" />
              {busy ? 'Đang lưu…' : 'Lưu'}
            </Button>

            <Button id="btn-delete-note" variant="danger" onClick={() => setConfirming(true)}>
              <Trash2 className="size-4" />
              Xoá
            </Button>
          </span>
        </div>

        <input
          id="note-editor-title"
          value={title}
          maxLength={200}
          aria-label="Tiêu đề ghi chú"
          onChange={(event) => setTitle(event.target.value)}
          className="w-full bg-transparent text-lg font-semibold leading-snug text-ink-1
            outline-none placeholder:text-ink-3"
          placeholder="Tiêu đề ghi chú…"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <select
            id="note-editor-kind"
            aria-label="Loại ghi chú"
            value={kind}
            onChange={(event) => setKind(event.target.value as NoteKind)}
            className="rounded-lg border border-surface-3 bg-surface-1 px-2.5 py-1.5 text-xs text-ink-1
              focus:border-accent focus:outline-none"
            style={{ color: meta.color }}
          >
            {NOTE_KIND_ORDER.map((value) => (
              <option key={value} value={value} className="text-ink-1">
                {NOTE_KIND_META[value].label}
              </option>
            ))}
          </select>

          <select
            id="note-editor-format"
            aria-label="Định dạng"
            value={format}
            onChange={(event) => setFormat(event.target.value as NoteFormat)}
            className="rounded-lg border border-surface-3 bg-surface-1 px-2.5 py-1.5 text-xs text-ink-1
              focus:border-accent focus:outline-none"
          >
            <option value="markdown">Markdown (.md)</option>
            <option value="text">Văn bản thuần (.txt)</option>
          </select>

          <label className="flex items-center gap-1.5 text-ink-3" htmlFor="note-editor-due">
            Thời hạn{needsDue ? ' *' : ''}
          </label>
          <input
            id="note-editor-due"
            type="datetime-local"
            value={dueLocal}
            onChange={(event) => setDueLocal(event.target.value)}
            className="rounded-lg border border-surface-3 bg-surface-1 px-2.5 py-1.5 text-xs text-ink-1
              focus:border-accent focus:outline-none"
          />
          {dueLocal.length > 0 && !needsDue && (
            <button
              id="btn-note-editor-clear-due"
              onClick={() => setDueLocal('')}
              className="rounded px-1.5 py-1 text-ink-3 transition hover:text-danger"
            >
              Bỏ thời hạn
            </button>
          )}

          {/* The Save button is disabled without this, so say why rather than
              leaving the user to work out which field is holding it. */}
          {needsDue && dueLocal.trim().length === 0 && (
            <span id="note-editor-due-error" className="text-danger">
              Ghi chú “Hạn chót” cần có thời hạn.
            </span>
          )}

          <span className="ml-auto text-ink-3">
            {due && <span className="mr-3">Hạn: {due.label}</span>}
            Cập nhật {formatDateTime(note.updatedAt)}
          </span>
        </div>
      </header>

      <TextComposer
        idPrefix="note-editor"
        format={format}
        value={content}
        onChange={setContent}
        placeholder={
          format === 'markdown'
            ? '# Tiêu đề\n\nGõ Markdown ở đây. Khung bên phải hiển thị kết quả.'
            : 'Gõ nội dung ghi chú ở đây…'
        }
        meta={`${content.length.toLocaleString('vi-VN')} ký tự · lưu ra .${noteExtension(format)}`}
      />

      {confirming && (
        <ConfirmDialog
          id="modal-confirm-delete-note"
          title="Xoá ghi chú?"
          subject={note.title}
          consequence={`Ghi chú và bản sao .${noteExtension(note.format)} của nó trong kho lưu trữ đều bị xoá.`}
          confirmLabel="Xoá ghi chú"
          confirmId="btn-confirm-delete-note"
          cancelId="btn-cancel-delete-note"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false)
            await deleteNote(note.id)
          }}
        />
      )}
    </div>
  )
}
