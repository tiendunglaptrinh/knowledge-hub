'use client'

import { FileUp, PenLine, Paperclip, Upload, X } from 'lucide-react'
import { useState } from 'react'

import type { PickedFile, TextFormat } from '@shared/types'
import { documentFilename } from '@shared/text-format'
import { bridge, codeOf, unwrap } from '@/lib/bridge'
import { formatBytes } from '@/lib/format'
import { messageFor } from '@/lib/messages'
import { useVault } from '@/lib/store'
import { Button, Field, Modal, TagInput, inputClass } from './ui'

/** Where the document's bytes come from. */
type Source = 'upload' | 'compose'

/**
 * Add a document, from a file or from nothing.
 *
 * **The source choice comes first.** Before this dialog offered *Soạn trực
 * tiếp*, the application could only hold files that already existed, and
 * someone who simply wanted to write something had to leave, open an editor,
 * save a `.md` somewhere, come back and upload it. The two paths are equal
 * citizens now, so the choice between them is the first thing on screen rather
 * than a link hidden under the dropzone.
 *
 * **The rest of the form is deliberately identical between them.** Title,
 * category, summary and tags mean the same thing either way, because what gets
 * created is the same item with the same kind of asset — only the origin of
 * the bytes differs. See docs/04-data-model.md#composed-documents.
 *
 * Uploads are staged as *paths*, not contents: `asset.pick` returns validated
 * paths and the copy happens on submit, so cancelling leaves nothing behind.
 * See docs/05-ipc-contract.md#why-paths-not-buffers.
 */
export function ItemDialog({
  defaultCategoryId,
  onClose,
}: {
  defaultCategoryId: string | null
  onClose: () => void
}) {
  const { categories, createItem, busy } = useVault()

  const [source, setSource] = useState<Source>('upload')
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? categories[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [files, setFiles] = useState<PickedFile[]>([])
  const [format, setFormat] = useState<TextFormat>('markdown')
  const [dragging, setDragging] = useState(false)
  const [touched, setTouched] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  /** True once the user edits the title, so autofill stops overwriting them. */
  const [titleEdited, setTitleEdited] = useState(false)

  const composing = source === 'compose'
  const titleError = touched && title.trim().length === 0 ? 'Vui lòng nhập tiêu đề.' : undefined
  const canSubmit = title.trim().length > 0 && categoryId !== ''

  /** Merges new selections, de-duplicating on the absolute path. */
  function addFiles(incoming: PickedFile[]) {
    if (incoming.length === 0) return

    setFiles((current) => {
      const seen = new Set(current.map((f) => f.path))
      const merged = [...current, ...incoming.filter((f) => !seen.has(f.path))]

      // Typing the filename again is busywork, so the first attachment seeds
      // the title — until the user writes their own, which always wins.
      if (!titleEdited && merged.length > 0) {
        setTitle((currentTitle) =>
          currentTitle.trim().length === 0 ? stripExtension(merged[0]!.filename) : currentTitle,
        )
      }
      return merged
    })
  }

  async function pickFiles() {
    setLocalError(null)
    try {
      addFiles(unwrap(await bridge().asset.pick()))
    } catch (error) {
      setLocalError(messageFor(codeOf(error)))
    }
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragging(false)
    setLocalError(null)

    const dropped = Array.from(event.dataTransfer.files)
    if (dropped.length === 0) return

    try {
      const api = bridge().asset
      // Size and readability are re-checked in the main process on submit;
      // what is shown here is only a preview.
      addFiles(
        dropped
          .map((file) => ({ file, path: api.pathForFile(file) }))
          .filter(({ path }) => path.length > 0)
          .map(({ file, path }) => ({
            path,
            filename: file.name,
            ext: (file.name.split('.').pop() ?? '').toLowerCase(),
            sizeBytes: file.size,
          })),
      )
    } catch (error) {
      setLocalError(messageFor(codeOf(error)))
    }
  }

  async function submit() {
    setTouched(true)
    if (!canSubmit) return

    const ok = await createItem({
      categoryId,
      title,
      summary,
      tags,
      filePaths: composing ? [] : files.map((f) => f.path),
      // Created empty and opened in the editor. Asking someone to write the
      // document inside a modal that scrolls, before the item even exists,
      // would be the worst place in the application to put a text field.
      composed: composing ? [{ filename: title, format, content: '' }] : [],
    })
    if (ok) onClose()
  }

  return (
    <Modal
      id="modal-item"
      title="Thêm tài liệu"
      onClose={onClose}
      footer={
        <>
          <Button id="btn-cancel-item" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            id="btn-submit-item"
            variant="primary"
            onClick={submit}
            disabled={busy || !canSubmit}
          >
            {busy ? 'Đang lưu…' : composing ? 'Tạo và mở soạn thảo' : 'Lưu tài liệu'}
          </Button>
        </>
      }
    >
      {localError && (
        <p id="message-item-error" role="alert" className="mb-4 text-sm text-danger">
          {localError}
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* The source choice, before anything that depends on it            */}
      {/* ---------------------------------------------------------------- */}
      <Field id="item-source" label="Tài liệu này đến từ đâu?">
        <div id="item-source-picker" className="grid grid-cols-2 gap-2">
          <SourceCard
            id="btn-source-upload"
            active={source === 'upload'}
            icon={<FileUp className="size-5" aria-hidden />}
            title="Tải tệp từ máy"
            hint="PDF, Word, Markdown, ảnh — tệp đã có sẵn"
            onClick={() => setSource('upload')}
          />
          <SourceCard
            id="btn-source-compose"
            active={composing}
            icon={<PenLine className="size-5" aria-hidden />}
            title="Soạn trực tiếp"
            hint="Tự viết nội dung, vừa gõ vừa xem trước"
            onClick={() => setSource('compose')}
          />
        </div>
      </Field>

      {composing ? (
        <Field
          id="item-format"
          label="Định dạng"
          hint={
            title.trim().length > 0
              ? `Sẽ lưu thành tệp “${documentFilename(title, format)}” trong kho.`
              : format === 'markdown'
                ? 'Có khung xem trước bên cạnh khi soạn. Tên tệp lấy theo tiêu đề bên dưới.'
                : 'Chữ thô, gõ nhanh. Tên tệp lấy theo tiêu đề bên dưới.'
          }
        >
          <div id="item-format-picker" className="flex gap-1.5">
            {(
              [
                ['markdown', 'Markdown'],
                ['text', 'Văn bản thuần'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                id={`btn-item-format-${value}`}
                onClick={() => setFormat(value)}
                aria-pressed={format === value}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition
                  ${
                    format === value
                      ? 'border-accent bg-accent-soft text-ink-1'
                      : 'border-surface-3 text-ink-2 hover:border-ink-3'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
      ) : (
      <Field id="item-files-dropzone" label="Tệp đính kèm">
        <div
          id="item-files-dropzone"
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex items-center gap-4 rounded-lg border border-dashed px-4 py-4 transition ${
            dragging ? 'border-accent bg-accent-soft/40' : 'border-surface-3 bg-surface-0/40'
          }`}
        >
          <div className="shrink-0 rounded-xl bg-surface-2 p-2.5">
            <FileUp className="size-5 text-accent" aria-hidden />
          </div>

          <div className="min-w-0 flex-1">
            <Button id="btn-pick-files" variant="primary" onClick={pickFiles}>
              <Upload className="size-4" />
              Chọn tệp từ máy
            </Button>
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              hoặc kéo thả tệp vào khung này · PDF, Word (.docx), Markdown, ảnh, văn bản
            </p>
          </div>
        </div>

        {files.length > 0 && (
          <ul id="list-picked-files" className="mt-3 space-y-1.5">
            {files.map((file) => (
              <li
                key={file.path}
                className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"
              >
                <Paperclip className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                <span className="flex-1 truncate" title={file.path}>
                  {file.filename}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-3">
                  {formatBytes(file.sizeBytes)}
                </span>
                <button
                  id={`btn-remove-picked-${file.filename}`}
                  aria-label={`Bỏ ${file.filename}`}
                  onClick={() => setFiles((current) => current.filter((f) => f.path !== file.path))}
                  className="text-ink-3 transition hover:text-danger"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Field>
      )}

      {/* ---------------------------------------------------------------- */}

      <Field
        id="item-title"
        label="Tiêu đề"
        hint={
          composing
            ? 'Vừa là tiêu đề tài liệu, vừa là tên tệp được lưu ra.'
            : 'Tự điền theo tên tệp đầu tiên — sửa lại thoải mái.'
        }
        error={titleError}
      >
        <input
          id="item-title"
          className={inputClass}
          value={title}
          maxLength={200}
          autoFocus={composing}
          placeholder={
            composing
              ? 'Ví dụ: Ghi chép buổi học Spring Security'
              : 'Ví dụ: Spring Boot — Dependency Injection'
          }
          onChange={(event) => {
            setTitle(event.target.value)
            setTitleEdited(true)
          }}
          onBlur={() => setTouched(true)}
        />
      </Field>

      <Field id="item-category" label="Nhóm">
        <select
          id="item-category"
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

      <Field id="item-summary" label="Mô tả ngắn" hint="Không bắt buộc. Giúp tìm lại nhanh hơn.">
        <textarea
          id="item-summary"
          className={`${inputClass} min-h-20 resize-y`}
          value={summary}
          placeholder="Bạn đã học được gì ở tài liệu này?"
          onChange={(event) => setSummary(event.target.value)}
        />
      </Field>

      <Field
        id="item-tags"
        label="Thẻ"
        hint="Gõ tên thẻ rồi nhấn dấu phẩy hoặc Enter để tạo thẻ. Bấm × trên thẻ để xoá."
      >
        <TagInput
          id="item-tags"
          value={tags}
          onChange={setTags}
          placeholder="spring, di, backend"
        />
      </Field>
    </Modal>
  )
}

/** One of the two equal-weight choices at the top of the dialog. */
function SourceCard({
  id,
  active,
  icon,
  title,
  hint,
  onClick,
}: {
  id: string
  active: boolean
  icon: React.ReactNode
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-start gap-1.5 rounded-xl border px-4 py-3 text-left transition
        ${
          active
            ? 'border-accent bg-accent-soft'
            : 'border-surface-3 bg-surface-0/40 hover:border-ink-3'
        }`}
    >
      <span className={active ? 'text-accent' : 'text-ink-3'}>{icon}</span>
      <span className="text-sm font-medium text-ink-1">{title}</span>
      <span className="text-xs leading-relaxed text-ink-3">{hint}</span>
    </button>
  )
}

/** `OWASP Top 10.docx` -> `OWASP Top 10`. Leaves a dotless name untouched. */
function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : filename
}
