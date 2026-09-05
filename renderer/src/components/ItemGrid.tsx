'use client'

import { FileText, Paperclip, Plus } from 'lucide-react'

import type { ItemSummary } from '@shared/types'
import { formatRelativeDate } from '@/lib/format'
import { useVault } from '@/lib/store'
import { Button, EmptyState, Spinner } from './ui'

/** Small extension chip; the colour is stable per family, not per extension. */
const EXT_TINT: Record<string, string> = {
  pdf: 'bg-red-500/15 text-red-300',
  docx: 'bg-blue-500/15 text-blue-300',
  md: 'bg-emerald-500/15 text-emerald-300',
  markdown: 'bg-emerald-500/15 text-emerald-300',
  txt: 'bg-slate-500/20 text-slate-300',
  png: 'bg-violet-500/15 text-violet-300',
  jpg: 'bg-violet-500/15 text-violet-300',
  jpeg: 'bg-violet-500/15 text-violet-300',
}

export function ItemGrid({ onAddItem }: { onAddItem: () => void }) {
  const { items, itemsLoading, view, categories, openItem } = useVault()

  if (itemsLoading) return <Spinner />

  if (items.length === 0) {
    if (view.kind === 'search') {
      return (
        <EmptyState
          id="empty-search"
          title="Không tìm thấy kết quả"
          description={`Không có tài liệu nào khớp với “${view.query}”. Thử từ khoá ngắn hơn, hoặc tìm theo thẻ.`}
        />
      )
    }

    const canAdd = categories.length > 0
    return (
      <EmptyState
        id="empty-items"
        title={canAdd ? 'Nhóm này chưa có tài liệu' : 'Hãy bắt đầu bằng một nhóm'}
        description={
          canAdd
            ? 'Tải lên tệp có sẵn — PDF, Word, Markdown, ảnh — hoặc tự soạn một tài liệu ngay trong ứng dụng.'
            : 'Tạo một nhóm ở thanh bên trái trước, sau đó thêm tài liệu vào nhóm đó.'
        }
        action={
          canAdd ? (
            <Button id="btn-add-item-empty" variant="primary" onClick={onAddItem}>
              <Plus className="size-4" />
              Thêm tài liệu
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div
      id="grid-items"
      className="grid gap-3 px-6 py-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]"
    >
      {items.map((item) => (
        <ItemCard key={item.id} item={item} onOpen={() => void openItem(item.id)} />
      ))}
    </div>
  )
}

function ItemCard({ item, onOpen }: { item: ItemSummary; onOpen: () => void }) {
  const tint = EXT_TINT[item.primaryExt] ?? 'bg-surface-3 text-ink-2'

  return (
    <button
      id={`card-item-${item.id}`}
      onClick={onOpen}
      className="group flex h-full flex-col rounded-[14px] border border-surface-3 bg-surface-1
        p-4 text-left transition hover:border-accent/50 hover:bg-surface-2"
    >
      <div className="mb-2.5 flex items-center gap-2">
        {item.primaryExt ? (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tint}`}>
            {item.primaryExt}
          </span>
        ) : (
          <FileText className="size-3.5 text-ink-3" aria-hidden />
        )}
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: item.categoryColor }}
          aria-hidden
        />
        <span className="truncate text-xs text-ink-3">{item.categoryName}</span>
      </div>

      <h3 className="mb-1.5 line-clamp-2 text-sm font-medium leading-snug text-ink-1">
        {item.title}
      </h3>

      {item.summary && (
        <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-ink-3">{item.summary}</p>
      )}

      {item.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {item.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">
              {tag}
            </span>
          ))}
          {item.tags.length > 3 && (
            <span className="px-1 py-0.5 text-[10px] text-ink-3">+{item.tags.length - 3}</span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-surface-3 pt-2.5 text-[11px] text-ink-3">
        <span className="flex items-center gap-1">
          <Paperclip className="size-3" aria-hidden />
          {item.assetCount}
        </span>
        <span className="ml-auto">{formatRelativeDate(item.updatedAt)}</span>
      </div>
    </button>
  )
}
