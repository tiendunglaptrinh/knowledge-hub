'use client'

import {
  Clock,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import type { CategorySummary } from '@shared/types'
import { useVault } from '@/lib/store'
import { CategoryIcon, ConfirmDialog } from './ui'
import { CategoryDialog } from './CategoryDialog'

/**
 * Left rail: the list of categories, plus the views that are not a category
 * (recent, notes, settings).
 *
 * It collapses to a 56px icon rail. On a 1360px window the expanded rail is
 * nearly a fifth of the width, and a document being read wants all of it —
 * but the navigation still has to be one click away, so collapsing hides the
 * labels rather than the rail. The choice is remembered across restarts.
 *
 * Category ids appear in element ids (`nav-category-{id}`) so a test can
 * address a specific row without depending on its position.
 */
export function Sidebar() {
  const {
    categories,
    view,
    showCategory,
    showRecent,
    showNotes,
    showChecklists,
    showSettings,
    deleteCategory,
    sidebarCollapsed,
    toggleSidebar,
    busy,
  } = useVault()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<CategorySummary | null>(null)

  // Ctrl/Cmd+B, the shortcut every editor with a side panel uses.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        toggleSidebar()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  const activeCategoryId = view.kind === 'category' ? view.categoryId : null
  const collapsed = sidebarCollapsed

  return (
    <aside
      id="sidebar"
      data-collapsed={collapsed}
      className={`flex shrink-0 flex-col border-r border-surface-3 bg-surface-1 transition-[width] duration-150
        ${collapsed ? 'w-14' : 'w-64'}`}
    >
      <div className={`flex items-center gap-2 pt-5 pb-4 ${collapsed ? 'px-2' : 'px-5'}`}>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">Knowledge Hub</h1>
            <p className="mt-0.5 truncate text-xs text-ink-3">Kho kiến thức cá nhân</p>
          </div>
        )}
        <button
          id="btn-toggle-sidebar"
          onClick={toggleSidebar}
          aria-expanded={!collapsed}
          aria-controls="sidebar"
          aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
          title={`${collapsed ? 'Mở rộng' : 'Thu gọn'} thanh bên (Ctrl+B)`}
          className={`rounded-md p-1.5 text-ink-3 transition hover:bg-surface-2 hover:text-ink-1
            ${collapsed ? 'mx-auto' : ''}`}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <nav className={collapsed ? 'px-2' : 'px-3'}>
        <SidebarRow
          id="nav-recent"
          collapsed={collapsed}
          label="Gần đây"
          active={view.kind === 'recent' || view.kind === 'search'}
          onClick={showRecent}
        >
          <Clock className="size-4 shrink-0 text-ink-3" aria-hidden />
        </SidebarRow>

        <SidebarRow
          id="nav-notes"
          collapsed={collapsed}
          label="Ghi chú"
          active={view.kind === 'notes'}
          onClick={showNotes}
        >
          <StickyNote className="size-4 shrink-0 text-ink-3" aria-hidden />
        </SidebarRow>

        <SidebarRow
          id="nav-checklists"
          collapsed={collapsed}
          label="Kế hoạch"
          active={view.kind === 'checklists'}
          onClick={showChecklists}
        >
          <ListChecks className="size-4 shrink-0 text-ink-3" aria-hidden />
        </SidebarRow>
      </nav>

      <div
        className={`mt-5 flex items-center justify-between pb-2 ${collapsed ? 'px-2' : 'px-5'}`}
      >
        {!collapsed && (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Nhóm kiến thức
          </span>
        )}
        <button
          id="btn-add-category"
          onClick={() => setDialogOpen(true)}
          title="Thêm nhóm mới"
          aria-label="Thêm nhóm mới"
          className={`rounded-md p-1 text-ink-3 transition hover:bg-surface-2 hover:text-accent
            ${collapsed ? 'mx-auto' : ''}`}
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className={`flex-1 overflow-y-auto pb-3 ${collapsed ? 'px-2' : 'px-3'}`}>
        {categories.length === 0 ? (
          collapsed ? null : (
            <p className="px-2 py-3 text-xs leading-relaxed text-ink-3">
              Chưa có nhóm nào. Tạo nhóm đầu tiên, ví dụ <em>Software</em>, <em>AI</em> hoặc{' '}
              <em>English</em>.
            </p>
          )
        ) : (
          categories.map((category) => (
            <SidebarRow
              key={category.id}
              id={`nav-category-${category.id}`}
              collapsed={collapsed}
              label={category.name}
              badge={String(category.itemCount)}
              active={activeCategoryId === category.id}
              onClick={() => showCategory(category.id)}
              // Only offered for an empty category — the service refuses
              // otherwise, and an always-visible button that always errors is
              // worse than no button. Hidden on the icon rail, where there is
              // no room for it to be anything but a mis-click.
              action={
                !collapsed && category.itemCount === 0 ? (
                  <button
                    id={`btn-delete-category-${category.id}`}
                    aria-label={`Xoá nhóm ${category.name}`}
                    title="Xoá nhóm rỗng"
                    onClick={() => setPendingDelete(category)}
                    className="rounded p-1 text-ink-3 transition hover:bg-surface-3 hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : undefined
              }
            >
              <CategoryIcon
                name={category.icon}
                color={category.color}
                className="size-4 shrink-0"
              />
            </SidebarRow>
          ))
        )}
      </div>

      <div className={`border-t border-surface-3 ${collapsed ? 'p-2' : 'p-3'}`}>
        <SidebarRow
          id="nav-settings"
          collapsed={collapsed}
          label="Cài đặt"
          active={view.kind === 'settings'}
          onClick={showSettings}
        >
          <Settings className="size-4 shrink-0 text-ink-3" aria-hidden />
        </SidebarRow>
      </div>

      {dialogOpen && <CategoryDialog onClose={() => setDialogOpen(false)} />}

      {pendingDelete && (
        <ConfirmDialog
          id="modal-confirm-delete-category"
          title="Xoá nhóm kiến thức?"
          subject={pendingDelete.name}
          consequence="Nhóm này đang rỗng nên không có tài liệu nào bị mất. Chỉ riêng nhóm bị xoá."
          confirmLabel="Xoá nhóm"
          confirmId={`btn-confirm-delete-category`}
          cancelId="btn-cancel-delete-category"
          busy={busy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            const id = pendingDelete.id
            setPendingDelete(null)
            await deleteCategory(id)
          }}
        />
      )}
    </aside>
  )
}

/**
 * One navigation row. Collapsed it is an icon with a native tooltip; expanded
 * it is icon, label and an optional count. Same element id either way, so the
 * id contract does not depend on the rail's width.
 *
 * The row action sits *beside* the navigation button rather than inside it —
 * a button nested in a button is invalid HTML, and the click would have to be
 * stopped from propagating to a target that should never have been an
 * ancestor.
 */
function SidebarRow({
  id,
  collapsed,
  label,
  badge,
  active,
  onClick,
  action,
  children,
}: {
  id: string
  collapsed: boolean
  label: string
  badge?: string
  active: boolean
  onClick: () => void
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      className={`group relative mb-0.5 flex items-center rounded-lg text-sm transition
        ${active ? 'bg-accent-soft text-ink-1' : 'text-ink-2 hover:bg-surface-2 hover:text-ink-1'}`}
    >
      <button
        id={id}
        onClick={onClick}
        title={collapsed ? label : undefined}
        aria-label={collapsed ? label : undefined}
        aria-current={active ? 'page' : undefined}
        className={`flex min-w-0 flex-1 items-center py-2 text-inherit
          ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5'}`}
      >
        {children}
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left">{label}</span>
            {badge !== undefined && (
              <span className="text-xs tabular-nums text-ink-3">{badge}</span>
            )}
          </>
        )}
      </button>

      {action && (
        <span
          className="absolute right-1 hidden group-focus-within:block group-hover:block"
          // The row underneath is opaque, so the action can cover the count
          // rather than reflowing the label the moment the cursor arrives.
        >
          {action}
        </span>
      )}
    </div>
  )
}
