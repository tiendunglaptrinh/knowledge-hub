'use client'

/**
 * Add a written document to an item that already exists.
 *
 * Metadata only — a name and a format — then the editor opens on it, for the
 * same reason `ItemDialog` does not embed a textarea: a modal that scrolls is
 * the wrong shape for writing, and a Markdown preview inside one is either
 * cramped or missing.
 */

import { useState } from 'react'

import type { TextFormat } from '@shared/types'
import { documentFilename } from '@shared/text-format'
import { useVault } from '@/lib/store'
import { Button, Field, Modal, inputClass } from './ui'

export function DocumentDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { composeAsset, busy } = useVault()

  const [name, setName] = useState('')
  const [format, setFormat] = useState<TextFormat>('markdown')
  const [touched, setTouched] = useState(false)

  const nameError = touched && name.trim().length === 0 ? 'Vui lòng nhập tên tài liệu.' : undefined

  async function submit() {
    setTouched(true)
    if (name.trim().length === 0) return

    const ok = await composeAsset({ itemId, filename: name, format, content: '' })
    if (ok) onClose()
  }

  return (
    <Modal
      id="modal-document"
      title="Soạn tài liệu mới"
      onClose={onClose}
      footer={
        <>
          <Button id="btn-cancel-document" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            id="btn-submit-document"
            variant="primary"
            onClick={submit}
            disabled={busy || name.trim().length === 0}
          >
            {busy ? 'Đang tạo…' : 'Tạo và mở soạn thảo'}
          </Button>
        </>
      }
    >
      <Field
        id="document-name"
        label="Tên tài liệu"
        hint={
          name.trim().length > 0
            ? `Sẽ lưu thành tệp “${documentFilename(name, format)}” cạnh các tệp khác của tài liệu này.`
            : 'Đây cũng là tên tệp được lưu ra kho.'
        }
        error={nameError}
      >
        <input
          id="document-name"
          className={inputClass}
          value={name}
          autoFocus
          maxLength={120}
          placeholder="Ví dụ: Tóm tắt chương 4"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
      </Field>

      <Field id="document-format" label="Định dạng">
        <div id="document-format-picker" className="grid grid-cols-2 gap-2">
          {(
            [
              ['markdown', 'Markdown', 'Có khung xem trước bên cạnh'],
              ['text', 'Văn bản thuần', 'Chữ thô, gõ nhanh'],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              id={`btn-document-format-${value}`}
              onClick={() => setFormat(value)}
              aria-pressed={format === value}
              className={`rounded-lg border px-3 py-2.5 text-left transition
                ${
                  format === value
                    ? 'border-accent bg-accent-soft'
                    : 'border-surface-3 hover:border-ink-3'
                }`}
            >
              <span className="block text-sm text-ink-1">{label}</span>
              <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>
            </button>
          ))}
        </div>
      </Field>
    </Modal>
  )
}
