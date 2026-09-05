'use client'

import { Plus, Search } from 'lucide-react'
import type { ChecklistKind } from '@shared/types'
import { useEffect, useState } from 'react'

import { ChecklistDashboard } from '@/components/ChecklistDashboard'
import { ChecklistDetailPane } from '@/components/ChecklistDetailPane'
import { ChecklistDialog } from '@/components/ChecklistDialog'
import { ItemDetailPane } from '@/components/ItemDetailPane'
import { ItemDialog } from '@/components/ItemDialog'
import { ItemGrid } from '@/components/ItemGrid'
import { NoteDialog } from '@/components/NoteDialog'
import { NoteEditorPane } from '@/components/NoteEditorPane'
import { NoteGrid } from '@/components/NoteGrid'
import { SettingsPane } from '@/components/SettingsPane'
import { Sidebar } from '@/components/Sidebar'
import { UpdateBanner } from '@/components/UpdateBanner'
import { Button, ErrorBanner, Spinner } from '@/components/ui'
import { PrefsProvider } from '@/lib/prefs'
import { VaultProvider, useVault } from '@/lib/store'

export default function Page() {
  return (
    // Appearance sits outside the vault: it must apply to the booting spinner
    // and to the no-bridge notice too, neither of which has a vault to read.
    <PrefsProvider>
      <VaultProvider>
        <Shell />
      </VaultProvider>
    </PrefsProvider>
  )
}

function Shell() {
  const { status } = useVault()

  if (status === 'no-bridge') return <NoBridgeNotice />
  if (status === 'booting') {
    return (
      <main className="flex h-screen items-center justify-center">
        <Spinner label="Đang mở kho kiến thức…" />
      </main>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <MainPane />
    </div>
  )
}

function MainPane() {
  const { view, categories, detail, note, checklist, error, dismissError, search, searchNotes } =
    useVault()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [noteDialogOpen, setNoteDialogOpen] = useState(false)
  /** Which kind the wizard opens on; null when it is closed. */
  const [checklistDialog, setChecklistDialog] = useState<ChecklistKind | null>(null)
  const [queryText, setQueryText] = useState('')

  const notesView = view.kind === 'notes'
  const checklistsView = view.kind === 'checklists'

  // One box, two indexes. Crossing between them clears it, because a query
  // typed against notes is not a query against documents — and leaving the old
  // text visible over results it did not produce reads as a bug.
  useEffect(() => setQueryText(''), [notesView])

  // The detail view and the note editor take over the whole pane rather than
  // sitting beside the list: documents need the width, and a three-column
  // layout at 1360px leaves none of the three usable.
  if (detail || note || checklist) {
    return (
      <main className="flex min-w-0 flex-1 flex-col bg-surface-0">
        <UpdateBanner />
        {error && <ErrorBanner message={error} onDismiss={dismissError} />}
        <div className="min-h-0 flex-1">
          {detail ? (
            <ItemDetailPane detail={detail} />
          ) : note ? (
            <NoteEditorPane note={note} />
          ) : checklist ? (
            <ChecklistDetailPane checklist={checklist} />
          ) : null}
        </div>
      </main>
    )
  }

  const activeCategory =
    view.kind === 'category' ? categories.find((c) => c.id === view.categoryId) : undefined

  const heading =
    view.kind === 'settings'
      ? 'Cài đặt'
      : view.kind === 'notes'
        ? 'Ghi chú'
        : view.kind === 'checklists'
          ? 'Kế hoạch'
          : view.kind === 'search'
          ? `Kết quả cho “${view.query}”`
          : (activeCategory?.name ?? 'Gần đây')

  /** The search box means "filter this screen", and this screen may be notes. */
  const runSearch = (value: string) => (notesView ? searchNotes(value) : search(value))

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-surface-0">
      <UpdateBanner />

      <header className="flex items-center gap-4 border-b border-surface-3 px-6 py-4">
        <h2 id="pane-heading" className="shrink-0 text-base font-semibold">
          {heading}
        </h2>

        {view.kind !== 'settings' && !checklistsView && (
          <>
            <div className="relative ml-auto w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
                aria-hidden
              />
              <input
                id="input-search"
                value={queryText}
                placeholder={
                  notesView
                    ? 'Tìm trong ghi chú…'
                    : 'Tìm theo tiêu đề, mô tả, nội dung…'
                }
                onChange={(event) => setQueryText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') runSearch(queryText)
                  if (event.key === 'Escape') {
                    setQueryText('')
                    runSearch('')
                  }
                }}
                className="w-full rounded-lg border border-surface-3 bg-surface-1 py-2 pl-9 pr-3
                  text-sm text-ink-1 placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
            </div>

            {notesView ? (
              <Button id="btn-add-note" variant="primary" onClick={() => setNoteDialogOpen(true)}>
                <Plus className="size-4" />
                Ghi chú mới
              </Button>
            ) : (
              <Button
                id="btn-add-item"
                variant="primary"
                onClick={() => setDialogOpen(true)}
                disabled={categories.length === 0}
                title={categories.length === 0 ? 'Hãy tạo một nhóm trước' : undefined}
              >
                <Plus className="size-4" />
                Thêm tài liệu
              </Button>
            )}
          </>
        )}

        {checklistsView && (
          <Button
            id="btn-add-checklist"
            variant="primary"
            className="ml-auto"
            onClick={() => setChecklistDialog('daily')}
          >
            <Plus className="size-4" />
            Checklist mới
          </Button>
        )}
      </header>

      {error && <ErrorBanner message={error} onDismiss={dismissError} />}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view.kind === 'settings' ? (
          <SettingsPane />
        ) : checklistsView ? (
          <ChecklistDashboard onCreate={(kind) => setChecklistDialog(kind)} />
        ) : notesView ? (
          <NoteGrid onAddNote={() => setNoteDialogOpen(true)} />
        ) : (
          <ItemGrid onAddItem={() => setDialogOpen(true)} />
        )}
      </div>

      {dialogOpen && (
        <ItemDialog
          defaultCategoryId={view.kind === 'category' ? view.categoryId : null}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {noteDialogOpen && <NoteDialog onClose={() => setNoteDialogOpen(false)} />}

      {checklistDialog && (
        <ChecklistDialog
          defaultKind={checklistDialog}
          onClose={() => setChecklistDialog(null)}
        />
      )}
    </main>
  )
}

/**
 * Shown when the page is open in a plain browser. The renderer is only useful
 * inside Electron, but `npm run dev:renderer` serves it on localhost, so this
 * explains the situation rather than throwing.
 */
function NoBridgeNotice() {
  return (
    <main
      id="notice-no-bridge"
      className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <h1 className="text-lg font-semibold">Giao diện này cần chạy trong ứng dụng</h1>
      <p className="max-w-md text-sm leading-relaxed text-ink-3">
        Bạn đang mở trang bằng trình duyệt, nên không có cầu nối tới tiến trình chính — không đọc
        được cơ sở dữ liệu hay tệp trên máy. Hãy đóng tab này và chạy{' '}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">npm run dev</code> để mở cửa sổ
        Knowledge Hub.
      </p>
    </main>
  )
}
