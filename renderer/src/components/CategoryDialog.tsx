'use client'

import { useState } from 'react'

import { useVault } from '@/lib/store'
import { CATEGORY_ICONS, Button, CategoryIcon, Field, Modal, inputClass } from './ui'

/** Same palette the service falls back to, so the preview matches the result. */
const COLORS = [
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#f87171',
  '#60a5fa',
  '#4ade80',
]

const ICON_NAMES = Object.keys(CATEGORY_ICONS)

/**
 * Create a category.
 *
 * Validation is intentionally shallow here — empty name only. Everything else
 * (length, duplicates) is decided by the service, and the dialog renders the
 * code it returns. Duplicating those rules in the UI is how the two drift.
 */
export function CategoryDialog({ onClose }: { onClose: () => void }) {
  const { createCategory, busy } = useVault()

  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(COLORS[0]!)
  const [icon, setIcon] = useState<string>('Folder')
  const [touched, setTouched] = useState(false)

  const nameError = touched && name.trim().length === 0 ? 'Vui lòng nhập tên nhóm.' : undefined

  async function submit() {
    setTouched(true)
    if (name.trim().length === 0) return
    if (await createCategory({ name, color, icon })) onClose()
  }

  return (
    <Modal
      id="modal-category"
      title="Tạo nhóm kiến thức"
      onClose={onClose}
      footer={
        <>
          <Button id="btn-cancel-category" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button id="btn-submit-category" variant="primary" onClick={submit} disabled={busy}>
            {busy ? 'Đang lưu…' : 'Tạo nhóm'}
          </Button>
        </>
      }
    >
      <Field
        id="category-name"
        label="Tên nhóm"
        hint="Ví dụ: Software, AI, English, Interview"
        error={nameError}
      >
        <input
          id="category-name"
          className={inputClass}
          value={name}
          autoFocus
          maxLength={60}
          placeholder="Nhập tên nhóm…"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
      </Field>

      <Field id="category-icon-picker" label="Biểu tượng">
        <div id="category-icon-picker" className="flex flex-wrap gap-1.5">
          {ICON_NAMES.map((iconName) => (
            <button
              key={iconName}
              id={`btn-icon-${iconName}`}
              onClick={() => setIcon(iconName)}
              aria-label={iconName}
              aria-pressed={icon === iconName}
              className={`rounded-lg border p-2 transition ${
                icon === iconName
                  ? 'border-accent bg-accent-soft'
                  : 'border-surface-3 hover:border-ink-3'
              }`}
            >
              <CategoryIcon name={iconName} color={color} className="size-4" />
            </button>
          ))}
        </div>
      </Field>

      <Field id="category-color-picker" label="Màu">
        <div id="category-color-picker" className="flex flex-wrap gap-2">
          {COLORS.map((value) => (
            <button
              key={value}
              id={`btn-color-${value.slice(1)}`}
              onClick={() => setColor(value)}
              aria-label={`Màu ${value}`}
              aria-pressed={color === value}
              style={{ backgroundColor: value }}
              className={`size-7 rounded-full transition ${
                color === value ? 'ring-2 ring-ink-1 ring-offset-2 ring-offset-surface-1' : ''
              }`}
            />
          ))}
        </div>
      </Field>
    </Modal>
  )
}
