'use client'

import {
  ArrowLeft,
  ExternalLink,
  FolderOpen,
  Paperclip,
  PenLine,
  Plus,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import type { Asset, ItemDetail } from '@shared/types'
import { bridge } from '@/lib/bridge'
import { formatBytes, formatDateTime } from '@/lib/format'
import { useVault } from '@/lib/store'
import { AssetEditor } from './AssetEditor'
import { AssetViewer } from './AssetViewer'
import { DocumentDialog } from './DocumentDialog'
import { ItemInfoDialog } from './ItemInfoDialog'
import { Button, CategoryIcon, ConfirmDialog, EmptyState, Spinner } from './ui'

/**
 * Full-window reading view: file list on the left, the selected file rendered
 * on the right.
 *
 * The pane owns which asset is selected rather than the store, because that
 * choice does not survive leaving the item and nothing else needs to read it.
 */
export function ItemDetailPane({ detail }: { detail: ItemDetail }) {
  const {
    closeItem,
    deleteItem,
    addAssets,
    removeAsset,
    detailLoading,
    busy,
    editingAssetId,
    editAsset,
  } = useVault()

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [pendingAsset, setPendingAsset] = useState<Asset | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)

  // Default to the first attachment, and recover if the selected one is
  // deleted while it is open.
  useEffect(() => {
    const stillPresent = detail.assets.some((a) => a.id === selectedAssetId)
    if (!stillPresent) setSelectedAssetId(detail.assets[0]?.id ?? null)
  }, [detail.assets, selectedAssetId])

  // Creating a document opens the editor on it from the store, which also has
  // to bring the file list's selection along — otherwise the pane would be
  // editing one document while the list highlights another.
  useEffect(() => {
    if (editingAssetId) setSelectedAssetId(editingAssetId)
  }, [editingAssetId])

  const selected = detail.assets.find((a) => a.id === selectedAssetId) ?? null
  const editing = selected !== null && selected.id === editingAssetId

  if (detailLoading) return <Spinner />

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-surface-3 px-6 py-4">
        <div className="mb-3 flex items-center gap-3">
          <Button id="btn-back-to-list" variant="ghost" onClick={closeItem}>
            <ArrowLeft className="size-4" />
            Quay lại
          </Button>

          <span className="ml-auto flex items-center gap-2">
            <Button id="btn-edit-item-info" onClick={() => setInfoOpen(true)} disabled={busy}>
              <SquarePen className="size-4" />
              Sửa thông tin
            </Button>

            <Button id="btn-add-asset" onClick={() => void addAssets(detail.id)} disabled={busy}>
              <Plus className="size-4" />
              Thêm tệp
            </Button>

            <Button id="btn-compose-asset" onClick={() => setComposeOpen(true)} disabled={busy}>
              <PenLine className="size-4" />
              Soạn tài liệu
            </Button>

            <Button id="btn-delete-item" variant="danger" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="size-4" />
              Xoá
            </Button>
          </span>
        </div>

        <div className="flex items-start gap-3">
          <CategoryIcon
            name={detail.category.icon}
            color={detail.category.color}
            className="mt-1 size-5 shrink-0"
          />
          <div className="min-w-0">
            <h2 id="item-detail-title" className="text-lg font-semibold leading-snug">
              {detail.title}
            </h2>
            <p className="mt-0.5 text-xs text-ink-3">
              {detail.category.name} · cập nhật {formatDateTime(detail.updatedAt)}
            </p>
            {detail.summary && (
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">{detail.summary}</p>
            )}
            {detail.tags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {detail.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {detail.assets.length === 0 ? (
        <EmptyState
          id="empty-assets"
          icon={Paperclip}
          title="Tài liệu này chưa có nội dung"
          description="Tự viết một trang Markdown ngay trong ứng dụng, hoặc tải lên tệp PDF, Word, Markdown đã có sẵn."
          action={
            <div className="flex gap-2">
              <Button
                id="btn-compose-asset-empty"
                variant="primary"
                onClick={() => setComposeOpen(true)}
              >
                <PenLine className="size-4" />
                Soạn tài liệu
              </Button>
              <Button id="btn-add-asset-empty" onClick={() => void addAssets(detail.id)}>
                <Plus className="size-4" />
                Tải tệp lên
              </Button>
            </div>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Hidden while editing. Reading wants the file list; writing wants
              the width, and the editor's own header already says which
              document is open. `Đóng` brings the list straight back. */}
          <nav
            id="list-assets"
            className={`w-64 shrink-0 overflow-y-auto border-r border-surface-3 bg-surface-1 p-2
              ${editing ? 'hidden' : ''}`}
          >
            {detail.assets.map((asset) => (
              <div
                key={asset.id}
                className={`group mb-1 rounded-lg px-2.5 py-2 transition ${
                  asset.id === selectedAssetId
                    ? 'bg-accent-soft'
                    : 'hover:bg-surface-2'
                }`}
              >
                <button
                  id={`btn-select-asset-${asset.id}`}
                  onClick={() => setSelectedAssetId(asset.id)}
                  className="block w-full text-left"
                >
                  <p className="truncate text-sm text-ink-1" title={asset.filename}>
                    {asset.filename}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {asset.ext.toUpperCase() || '—'} · {formatBytes(asset.sizeBytes)}
                  </p>
                </button>

                <div className="mt-1.5 hidden gap-1 group-hover:flex">
                  <IconAction
                    id={`btn-asset-external-${asset.id}`}
                    label="Mở bằng ứng dụng ngoài"
                    onClick={() => void bridge().asset.openExternal(asset.id)}
                  >
                    <ExternalLink className="size-3.5" />
                  </IconAction>
                  <IconAction
                    id={`btn-asset-reveal-${asset.id}`}
                    label="Mở thư mục chứa"
                    onClick={() => void bridge().asset.revealInFolder(asset.id)}
                  >
                    <FolderOpen className="size-3.5" />
                  </IconAction>
                  <IconAction
                    id={`btn-asset-delete-${asset.id}`}
                    label="Xoá tệp"
                    danger
                    onClick={() => setPendingAsset(asset)}
                  >
                    <Trash2 className="size-3.5" />
                  </IconAction>
                </div>
              </div>
            ))}
          </nav>

          <section className="min-w-0 flex-1 bg-surface-0">
            {selected ? (
              editing ? (
                <AssetEditor asset={selected} />
              ) : (
                <AssetViewer asset={selected} onEdit={() => editAsset(selected.id)} />
              )
            ) : null}
          </section>
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          id="modal-confirm-delete-item"
          title="Xoá tài liệu?"
          subject={detail.title}
          consequence={
            detail.assets.length > 0
              ? `${detail.assets.length} tệp đính kèm cũng bị xoá khỏi kho lưu trữ. Bản gốc trong Downloads (nếu còn) không bị ảnh hưởng.`
              : 'Tài liệu này chưa có tệp đính kèm nào.'
          }
          confirmLabel="Xoá tài liệu"
          confirmId="btn-confirm-delete-item"
          cancelId="btn-cancel-delete-item"
          busy={busy}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            setConfirmingDelete(false)
            await deleteItem(detail.id)
          }}
        />
      )}

      {composeOpen && (
        <DocumentDialog itemId={detail.id} onClose={() => setComposeOpen(false)} />
      )}

      {infoOpen && <ItemInfoDialog detail={detail} onClose={() => setInfoOpen(false)} />}

      {pendingAsset && (
        <ConfirmDialog
          id="modal-confirm-delete-asset"
          title="Xoá tệp khỏi tài liệu?"
          subject={pendingAsset.filename}
          consequence={`Tệp ${formatBytes(pendingAsset.sizeBytes)} này bị xoá khỏi kho lưu trữ và khỏi chỉ mục tìm kiếm. Các tệp khác của tài liệu vẫn còn.`}
          confirmLabel="Xoá tệp"
          confirmId="btn-confirm-delete-asset"
          cancelId="btn-cancel-delete-asset"
          busy={busy}
          onCancel={() => setPendingAsset(null)}
          onConfirm={async () => {
            const id = pendingAsset.id
            setPendingAsset(null)
            await removeAsset(id)
          }}
        />
      )}
    </div>
  )
}

function IconAction({
  id,
  label,
  onClick,
  danger,
  children,
}: {
  id: string
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      id={id}
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`rounded p-1 text-ink-3 transition hover:bg-surface-3 ${
        danger ? 'hover:text-danger' : 'hover:text-ink-1'
      }`}
    >
      {children}
    </button>
  )
}
