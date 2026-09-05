'use client'

import { useState } from 'react'

import type { NoteFormat, NoteKind } from '@shared/types'
import { fromDateTimeLocal } from '@/lib/format'
import { NOTE_FORMAT_META, NOTE_KIND_META, NOTE_KIND_ORDER, noteExtension } from '@/lib/notes'
import { useVault } from '@/lib/store'
import { Button, Field, Modal, inputClass } from './ui'

/**
 * Create a note: the metadata only.
 *
 * The body is written in the editor this dialog opens, not here. A textarea in
 * a modal is a worse place to write than a full pane, and putting one here
 * would mean the Markdown preview either lives in a cramped box or does not
 * exist until after the note is saved.
 *
 * Validation is shallow — an empty title, and a deadline with no date. Both
 * are also enforced by `NoteService`; what is checked here is only what would
 * otherwise let the user press *Tạo ghi chú* and be told no.
 */
export function NoteDialog({ onClose }: { onClose: () => void }) {
  const { createNote, busy } = useVault()

  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<NoteKind>('study')
  const [format, setFormat] = useState<NoteFormat>('markdown')
  const [dueLocal, setDueLocal] = useState('')
  const [touched, setTouched] = useState(false)

  const needsDue = kind === 'deadline'
  const titleError = touched && title.trim().length === 0 ? 'Vui lòng nhập tiêu đề.' : undefined
  const dueError =
    touched && needsDue && dueLocal.trim().length === 0
      ? 'Ghi chú “Hạn chót” cần có thời hạn.'
      : undefined

  const canSubmit = title.trim().length > 0 && (!needsDue || dueLocal.trim().length > 0)

  async function submit() {
    setTouched(true)
    if (!canSubmit) return

    const ok = await createNote({
      title,
      kind,
      format,
      dueAt: fromDateTimeLocal(dueLocal),
      content: '',
    })
    if (ok) onClose()
  }

  return (
    <Modal
      id="modal-note"
      title="Ghi chú mới"
      onClose={onClose}
      footer={
        <>
          <Button id="btn-cancel-note" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            id="btn-submit-note"
            variant="primary"
            onClick={submit}
            disabled={busy || !canSubmit}
          >
            {busy ? 'Đang tạo…' : 'Tạo và mở soạn thảo'}
          </Button>
        </>
      }
    >
      <Field id="note-title" label="Tiêu đề" error={titleError}>
        <input
          id="note-title"
          className={inputClass}
          value={title}
          autoFocus
          maxLength={200}
          placeholder="Ví dụ: Ôn tập Spring Security — buổi 3"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
      </Field>

      <Field id="note-kind-picker" label="Loại ghi chú" hint={NOTE_KIND_META[kind].hint}>
        <div id="note-kind-picker" className="grid grid-cols-4 gap-1.5">
          {NOTE_KIND_ORDER.map((value) => {
            const meta = NOTE_KIND_META[value]
            const Icon = meta.icon
            const selected = kind === value

            return (
              <button
                key={value}
                id={`btn-note-kind-${value}`}
                onClick={() => setKind(value)}
                aria-pressed={selected}
                title={meta.hint}
                className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-[11px] transition
                  ${
                    selected
                      ? 'border-accent bg-accent-soft text-ink-1'
                      : 'border-surface-3 text-ink-2 hover:border-ink-3'
                  }`}
              >
                <Icon className="size-4" style={{ color: meta.color }} aria-hidden />
                <span className="truncate">{meta.label}</span>
              </button>
            )
          })}
        </div>
      </Field>

      <Field
        id="note-format-picker"
        label="Định dạng"
        hint={`${NOTE_FORMAT_META[format].hint} · lưu ra tệp .${noteExtension(format)}`}
      >
        <div id="note-format-picker" className="flex gap-1.5">
          {(['markdown', 'text'] as const).map((value) => (
            <button
              key={value}
              id={`btn-note-format-${value}`}
              onClick={() => setFormat(value)}
              aria-pressed={format === value}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm transition
                ${
                  format === value
                    ? 'border-accent bg-accent-soft text-ink-1'
                    : 'border-surface-3 text-ink-2 hover:border-ink-3'
                }`}
            >
              {NOTE_FORMAT_META[value].label}
            </button>
          ))}
        </div>
      </Field>

      <Field
        id="note-due"
        label={needsDue ? 'Thời hạn (bắt buộc)' : 'Thời hạn (không bắt buộc)'}
        hint="Ghi chú có thời hạn luôn được xếp lên đầu danh sách, quá hạn thì đánh dấu đỏ."
        error={dueError}
      >
        <div className="flex items-center gap-2">
          <input
            id="note-due"
            type="datetime-local"
            className={inputClass}
            value={dueLocal}
            onChange={(event) => setDueLocal(event.target.value)}
          />
          {dueLocal.length > 0 && (
            <Button id="btn-clear-note-due" variant="ghost" onClick={() => setDueLocal('')}>
              Xoá
            </Button>
          )}
        </div>
      </Field>
    </Modal>
  )
}
