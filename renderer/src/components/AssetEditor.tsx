'use client'

/**
 * Editing a stored Markdown or text document, in place.
 *
 * It replaces the viewer inside the detail pane rather than opening a screen
 * of its own: reading and writing the same document should not feel like two
 * different places, and the file list stays visible so switching away is one
 * click.
 *
 * The current contents come from `asset.render`, the same call the viewer
 * makes — there is no separate "load for editing" path that could return
 * something the viewer would have shown differently.
 */

import { Save, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { Asset, TextFormat } from '@shared/types'
import { bridge, codeOf, unwrap } from '@/lib/bridge'
import { formatBytes } from '@/lib/format'
import { messageFor } from '@/lib/messages'
import { useVault } from '@/lib/store'
import { TextComposer } from './TextComposer'
import { Button, ConfirmDialog, Spinner } from './ui'

export function AssetEditor({ asset }: { asset: Asset }) {
  const { saveAssetText, editAsset, busy } = useVault()

  const [loaded, setLoaded] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [format, setFormat] = useState<TextFormat>('text')
  const [error, setError] = useState<string | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  // Load the document. The editor is never opened on anything but markdown or
  // text — the service refuses the rest — so `text` is always present.
  useEffect(() => {
    let cancelled = false
    setLoaded(null)
    setError(null)

    void (async () => {
      try {
        const rendered = unwrap(await bridge().asset.render(asset.id))
        if (cancelled) return

        setFormat(rendered.kind === 'markdown' ? 'markdown' : 'text')
        setContent(rendered.text ?? '')
        setLoaded(rendered.text ?? '')
      } catch (caught) {
        if (!cancelled) setError(messageFor(codeOf(caught)))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [asset.id])

  const dirty = loaded !== null && content !== loaded

  async function save() {
    if (!dirty) return
    // `loaded` moves to what was saved, so the dirty flag clears without
    // waiting for the item to be refetched.
    const saved = content
    if (await saveAssetText(asset.id, saved)) setLoaded(saved)
  }

  function close() {
    if (dirty) {
      setConfirmingDiscard(true)
      return
    }
    editAsset(null)
  }

  // Ctrl/Cmd+S, and Escape to leave. No dependency array: the handler must
  // close over the current draft.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p id="message-editor-error" className="max-w-sm text-sm text-danger">
          {error}
        </p>
        <Button id="btn-cancel-edit-asset" onClick={() => editAsset(null)}>
          Quay lại
        </Button>
      </div>
    )
  }

  if (loaded === null) return <Spinner label="Đang mở tài liệu để sửa…" />

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-surface-3 px-6 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-1" title={asset.filename}>
            {asset.filename}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {dirty ? (
              <span id="asset-editor-dirty" className="text-ink-2">
                Có thay đổi chưa lưu
              </span>
            ) : (
              `Đã lưu · ${formatBytes(asset.sizeBytes)}`
            )}
          </p>
        </div>

        <span className="ml-auto flex items-center gap-2">
          <Button
            id="btn-save-asset"
            variant="primary"
            onClick={() => void save()}
            disabled={busy || !dirty}
            title="Ctrl+S"
          >
            <Save className="size-4" />
            {busy ? 'Đang lưu…' : 'Lưu'}
          </Button>
          <Button id="btn-cancel-edit-asset" variant="ghost" onClick={close}>
            <X className="size-4" />
            Đóng
          </Button>
        </span>
      </header>

      <TextComposer
        idPrefix="doc-editor"
        format={format}
        value={content}
        onChange={setContent}
        autoFocus
        placeholder={
          format === 'markdown'
            ? '# Tiêu đề\n\nGõ Markdown ở đây. Khung bên phải hiển thị kết quả.'
            : 'Gõ nội dung ở đây…'
        }
        meta={`${content.length.toLocaleString('vi-VN')} ký tự`}
      />

      {confirmingDiscard && (
        <ConfirmDialog
          id="modal-confirm-discard-edit"
          title="Đóng mà không lưu?"
          subject={asset.filename}
          consequence="Những gì bạn vừa gõ mà chưa lưu sẽ mất. Bấm Huỷ rồi Lưu nếu muốn giữ lại."
          confirmLabel="Bỏ thay đổi"
          confirmId="btn-confirm-discard-edit"
          cancelId="btn-cancel-discard-edit"
          onCancel={() => setConfirmingDiscard(false)}
          onConfirm={() => {
            setConfirmingDiscard(false)
            editAsset(null)
          }}
        />
      )}
    </div>
  )
}
