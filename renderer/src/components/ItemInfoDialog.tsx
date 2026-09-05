'use client'

/**
 * Edit the item's own fields after it exists: title, category, summary, tags.
 *
 * Separate from `ItemDialog` rather than a mode inside it. Creation is mostly
 * about *where the bytes come from* — the source picker, the dropzone, the
 * format choice — and none of that has an answer once the item is real: the
 * files are already in the vault and each has its own controls in the detail
 * pane. Folding both into one component would mean a dialog where half the
 * fields are conditionally absent, which is how the create path gets broken by
 * a change meant for the edit path.
 *
 * What it does *not* touch is deliberate. Attachments are added with **Thêm
 * tệp** and **Soạn tài liệu**, their contents are edited in the viewer, and
 * they are removed one at a time from the file list. A metadata dialog that
 * also managed files would duplicate three affordances that already exist a few
 * pixels away.
 *
 * Changing the category moves the item between groups — `item:update` accepts
 * `categoryId`, and the sidebar counts follow on the refresh the store does.
 */

import { useState } from 'react'

import type { ItemDetail } from '@shared/types'
import { useVault } from '@/lib/store'
import { Button, Field, Modal, TagInput, inputClass } from './ui'

export function ItemInfoDialog({ detail, onClose }: { detail: ItemDetail; onClose: () => void }) {
  const { categories, updateItem, busy } = useVault()

  const [title, setTitle] = useState(detail.title)
  const [categoryId, setCategoryId] = useState(detail.category.id)
  const [summary, setSummary] = useState(detail.summary ?? '')
  const [tags, setTags] = useState<string[]>(detail.tags)
  const [touched, setTouched] = useState(false)

  const titleError = touched && title.trim().length === 0 ? 'Vui lòng nhập tiêu đề.' : undefined
  const canSubmit = title.trim().length > 0 && categoryId !== ''

  async function submit() {
    setTouched(true)
    if (!canSubmit) return

    // Every field is sent, not only the changed ones. `UpdateItemInput` treats
    // `undefined` as "leave alone", so a diff would be an optimisation that
    // buys nothing here and adds a way to drop an edit.
    const ok = await updateItem({
      id: detail.id,
      title,
      categoryId,
      summary,
      tags,
    })
    if (ok) onClose()
  }

  return (
    <Modal
      id="modal-item-info"
      title="Sửa thông tin tài liệu"
      onClose={onClose}
      footer={
        <>
          <Button id="btn-cancel-item-info" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            id="btn-submit-item-info"
            variant="primary"
            onClick={submit}
            disabled={busy || !canSubmit}
          >
            {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
          </Button>
        </>
      }
    >
      <Field
        id="item-info-title"
        label="Tiêu đề"
        hint="Đổi tiêu đề không đổi tên các tệp đã lưu trong kho."
        error={titleError}
      >
        <input
          id="item-info-title"
          className={inputClass}
          value={title}
          autoFocus
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
      </Field>

      <Field
        id="item-info-category"
        label="Nhóm"
        hint={
          categoryId === detail.category.id
            ? 'Chọn nhóm khác để chuyển tài liệu này sang đó.'
            : `Sẽ chuyển khỏi nhóm “${detail.category.name}”. Các tệp vẫn nằm nguyên chỗ cũ trong kho.`
        }
      >
        <select
          id="item-info-category"
          className={inputClass}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id="item-info-summary"
        label="Mô tả ngắn"
        hint="Không bắt buộc. Nội dung này cũng được tìm kiếm."
      >
        <textarea
          id="item-info-summary"
          className={`${inputClass} min-h-20 resize-y`}
          value={summary}
          placeholder="Bạn đã học được gì ở tài liệu này?"
          onChange={(event) => setSummary(event.target.value)}
        />
      </Field>

      <Field
        id="item-info-tags"
        label="Thẻ"
        hint="Gõ tên thẻ rồi nhấn dấu phẩy hoặc Enter để tạo thẻ. Bấm × trên thẻ để xoá."
      >
        <TagInput
          id="item-info-tags"
          value={tags}
          onChange={setTags}
          placeholder="spring, di, backend"
        />
      </Field>
    </Modal>
  )
}
