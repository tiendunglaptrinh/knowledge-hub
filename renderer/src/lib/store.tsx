'use client'

/**
 * Application state.
 *
 * One reducer and one provider for the whole UI. A single-window desktop app
 * with four screens does not need a state library, and keeping every mutation
 * in one file makes the data flow readable end to end:
 *
 *   component -> action -> bridge (IPC) -> reducer -> component
 *
 * Components never call the bridge directly. That rule is what makes "after
 * any mutation the affected lists are refetched" enforceable in one place
 * rather than remembered at fifteen call sites.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'

import type {
  AddChecklistTaskInput,
  CategorySummary,
  ChecklistDetail,
  ChecklistStats,
  ChecklistSummary,
  ComposeAssetInput,
  CreateChecklistInput,
  CreateCategoryInput,
  CreateItemInput,
  CreateNoteInput,
  ItemDetail,
  ItemSummary,
  MoveChecklistTaskInput,
  Note,
  NoteKind,
  NoteSummary,
  UpdateChecklistInput,
  UpdateChecklistTaskInput,
  UpdateItemInput,
  UpdateNoteInput,
  UpdateState,
  VaultInfo,
} from '@shared/types'
import { documentFilename } from '@shared/text-format'
import { bridge, codeOf, getBridge, unwrap } from './bridge'
import { rangeFor, type StatsRange } from './checklists'
import { messageFor } from './messages'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Which list the main pane is showing. */
export type View =
  | { kind: 'recent' }
  | { kind: 'category'; categoryId: string }
  | { kind: 'search'; query: string }
  | { kind: 'notes' }
  | { kind: 'checklists' }
  | { kind: 'settings' }

export type Status = 'booting' | 'ready' | 'no-bridge'

/** Where the collapsed/expanded choice survives a restart. */
const SIDEBAR_KEY = 'kb.sidebar.collapsed'

interface State {
  status: Status
  categories: CategorySummary[]
  view: View
  items: ItemSummary[]
  itemsLoading: boolean
  /** Detail pane; null when the list is showing. */
  detail: ItemDetail | null
  detailLoading: boolean
  /**
   * The asset the document editor is open on, if any. In the store rather
   * than in the pane because creating a document has to be able to say
   * "…and open the editor on it" across a view change.
   */
  editingAssetId: string | null
  /** Note list for the notes view. */
  notes: NoteSummary[]
  notesLoading: boolean
  /** Kind filter on the notes list; null means every kind. */
  noteFilter: NoteKind | null
  /** Free-text filter on the notes list. */
  noteQuery: string
  /** The note open in the editor; null when the list is showing. */
  note: Note | null
  noteLoading: boolean
  /** Which window the checklist dashboard is reporting on. */
  checklistRange: StatsRange
  /** Dashboard tallies for that window; null until the first load. */
  checklistStats: ChecklistStats | null
  /** Daily plans inside the window, newest day first. */
  dailyChecklists: ChecklistSummary[]
  /** Every module plan, regardless of the window; see `ChecklistStats.module`. */
  moduleChecklists: ChecklistSummary[]
  checklistsLoading: boolean
  /** The plan open in the full pane; null while the dashboard is showing. */
  checklist: ChecklistDetail | null
  checklistLoading: boolean
  vaultInfo: VaultInfo | null
  /**
   * Where the update flow is. Null until the first state arrives from the main
   * process — which is immediately, so the banner never flashes.
   */
  update: UpdateState | null
  /** Transient banner text, cleared on the next successful action. */
  error: string | null
  busy: boolean
  sidebarCollapsed: boolean
}

const initialState: State = {
  status: 'booting',
  categories: [],
  view: { kind: 'recent' },
  items: [],
  itemsLoading: false,
  detail: null,
  detailLoading: false,
  editingAssetId: null,
  notes: [],
  notesLoading: false,
  noteFilter: null,
  noteQuery: '',
  note: null,
  noteLoading: false,
  checklistRange: 'week',
  checklistStats: null,
  dailyChecklists: [],
  moduleChecklists: [],
  checklistsLoading: false,
  checklist: null,
  checklistLoading: false,
  vaultInfo: null,
  update: null,
  error: null,
  busy: false,
  // Starts expanded and is corrected from localStorage on mount. Reading
  // storage during the initial render would disagree with the prerendered
  // HTML Next's static export ships.
  sidebarCollapsed: false,
}

type Action =
  | { type: 'status'; status: Status }
  | { type: 'categories'; categories: CategorySummary[] }
  | { type: 'view'; view: View }
  | { type: 'itemsLoading' }
  | { type: 'items'; items: ItemSummary[] }
  | { type: 'detailLoading' }
  | { type: 'detail'; detail: ItemDetail | null }
  | { type: 'editingAsset'; assetId: string | null }
  | { type: 'notesLoading' }
  | { type: 'notes'; notes: NoteSummary[] }
  | { type: 'noteFilter'; kind: NoteKind | null }
  | { type: 'noteQuery'; query: string }
  | { type: 'noteLoading' }
  | { type: 'note'; note: Note | null }
  | { type: 'checklistRange'; range: StatsRange }
  | { type: 'checklistsLoading' }
  | {
      type: 'checklists'
      stats: ChecklistStats
      daily: ChecklistSummary[]
      module: ChecklistSummary[]
    }
  | { type: 'checklistLoading' }
  | { type: 'checklist'; checklist: ChecklistDetail | null }
  | { type: 'vaultInfo'; info: VaultInfo }
  | { type: 'update'; update: UpdateState }
  | { type: 'error'; message: string | null }
  | { type: 'busy'; busy: boolean }
  | { type: 'sidebar'; collapsed: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'status':
      return { ...state, status: action.status }
    case 'categories':
      return { ...state, categories: action.categories }
    case 'view':
      // Changing view always leaves the detail pane and the note editor;
      // otherwise clicking a category while reading a document leaves the two
      // panes disagreeing.
      return {
        ...state,
        view: action.view,
        detail: null,
        note: null,
        checklist: null,
        editingAssetId: null,
      }
    case 'itemsLoading':
      return { ...state, itemsLoading: true }
    case 'items':
      return { ...state, items: action.items, itemsLoading: false }
    case 'detailLoading':
      return { ...state, detailLoading: true }
    case 'detail':
      // Opening one full-pane view closes the other. No current path can set
      // both — each is only reachable from a screen where the other is already
      // null — but the pane renders whichever it finds first, so making them
      // exclusive here is cheaper than relying on that staying true.
      return { ...state, detail: action.detail, detailLoading: false, note: null, checklist: null }
    case 'editingAsset':
      return { ...state, editingAssetId: action.assetId }
    case 'notesLoading':
      return { ...state, notesLoading: true }
    case 'notes':
      return { ...state, notes: action.notes, notesLoading: false }
    case 'noteFilter':
      return { ...state, noteFilter: action.kind }
    case 'noteQuery':
      return { ...state, noteQuery: action.query }
    case 'noteLoading':
      return { ...state, noteLoading: true }
    case 'note':
      return { ...state, note: action.note, noteLoading: false, detail: null, checklist: null }
    case 'checklistRange':
      return { ...state, checklistRange: action.range }
    case 'checklistsLoading':
      return { ...state, checklistsLoading: true }
    case 'checklists':
      return {
        ...state,
        checklistStats: action.stats,
        dailyChecklists: action.daily,
        moduleChecklists: action.module,
        checklistsLoading: false,
      }
    case 'checklistLoading':
      return { ...state, checklistLoading: true }
    case 'checklist':
      return { ...state, checklist: action.checklist, checklistLoading: false }
    case 'vaultInfo':
      return { ...state, vaultInfo: action.info }
    case 'update':
      return { ...state, update: action.update }
    case 'error':
      return { ...state, error: action.message }
    case 'busy':
      return { ...state, busy: action.busy }
    case 'sidebar':
      return { ...state, sidebarCollapsed: action.collapsed }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface VaultStore extends State {
  showRecent(): void
  showCategory(categoryId: string): void
  showNotes(): void
  showChecklists(): void
  showSettings(): void
  search(query: string): void

  openItem(id: string): Promise<void>
  closeItem(): void

  createCategory(input: CreateCategoryInput): Promise<boolean>
  deleteCategory(id: string): Promise<boolean>

  createItem(input: CreateItemInput): Promise<boolean>
  updateItem(input: UpdateItemInput): Promise<boolean>
  deleteItem(id: string): Promise<boolean>

  addAssets(itemId: string): Promise<boolean>
  removeAsset(assetId: string): Promise<boolean>
  composeAsset(input: ComposeAssetInput): Promise<boolean>
  saveAssetText(assetId: string, content: string): Promise<boolean>
  editAsset(assetId: string | null): void

  filterNotes(kind: NoteKind | null): void
  searchNotes(query: string): void
  openNote(id: string): Promise<void>
  closeNote(): void
  createNote(input: CreateNoteInput): Promise<boolean>
  updateNote(input: UpdateNoteInput): Promise<boolean>
  deleteNote(id: string): Promise<boolean>

  setChecklistRange(range: StatsRange): void
  openChecklist(id: string): Promise<void>
  closeChecklist(): void
  createChecklist(input: CreateChecklistInput): Promise<boolean>
  updateChecklist(input: UpdateChecklistInput): Promise<boolean>
  deleteChecklist(id: string): Promise<boolean>
  addChecklistTask(input: AddChecklistTaskInput): Promise<boolean>
  updateChecklistTask(input: UpdateChecklistTaskInput): Promise<boolean>
  deleteChecklistTask(id: string): Promise<boolean>
  moveChecklistTask(input: MoveChecklistTaskInput): Promise<boolean>

  checkForUpdate(): Promise<boolean>
  downloadUpdate(): Promise<boolean>
  installUpdate(): Promise<boolean>

  toggleSidebar(): void
  openVaultFolder(): Promise<void>
  dismissError(): void
}

const StoreContext = createContext<VaultStore | null>(null)

export function VaultProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  /**
   * Guards against a slow response for a view the user has already left. Each
   * list load stamps a token; a response whose token is stale is dropped.
   */
  const loadToken = useRef(0)

  /** Runs an action, turning a BridgeError into the banner. */
  const guard = useCallback(async (work: () => Promise<void>): Promise<boolean> => {
    dispatch({ type: 'busy', busy: true })
    try {
      await work()
      dispatch({ type: 'error', message: null })
      return true
    } catch (error) {
      dispatch({ type: 'error', message: messageFor(codeOf(error)) })
      return false
    } finally {
      dispatch({ type: 'busy', busy: false })
    }
  }, [])

  const refreshCategories = useCallback(async () => {
    dispatch({ type: 'categories', categories: unwrap(await bridge().category.list()) })
  }, [])

  /** The same guard for the notes list, which loads independently of items. */
  const noteToken = useRef(0)

  const loadItems = useCallback(async (view: View) => {
    if (view.kind === 'settings' || view.kind === 'notes') return

    const token = ++loadToken.current
    dispatch({ type: 'itemsLoading' })

    const api = bridge().item
    const result =
      view.kind === 'category'
        ? await api.listByCategory(view.categoryId)
        : view.kind === 'search'
          ? await api.search({ query: view.query })
          : await api.recent()

    if (token !== loadToken.current) return // superseded
    dispatch({ type: 'items', items: unwrap(result) })
  }, [])

  const loadNotes = useCallback(async (kind: NoteKind | null, query: string) => {
    const token = ++noteToken.current
    dispatch({ type: 'notesLoading' })

    const result = await bridge().note.list({
      kind: kind ?? undefined,
      query: query.trim().length > 0 ? query : undefined,
    })

    if (token !== noteToken.current) return // superseded
    dispatch({ type: 'notes', notes: unwrap(result) })
  }, [])

  /** Same stale-response guard again, for the dashboard's three calls. */
  const checklistToken = useRef(0)

  /**
   * The dashboard in one load: the tallies, the daily plans of the window, and
   * every module plan.
   *
   * Three calls rather than one channel returning all three, because each is
   * independently useful — and because a task mutation only needs to refresh
   * this, never the item or note lists.
   */
  const loadChecklists = useCallback(async (range: StatsRange) => {
    const token = ++checklistToken.current
    dispatch({ type: 'checklistsLoading' })

    const { from, to } = rangeFor(range)
    const api = bridge().checklist

    const [stats, daily, module] = await Promise.all([
      api.stats({ from, to }),
      api.list({ kind: 'daily', from, to }),
      api.list({ kind: 'module' }),
    ])

    if (token !== checklistToken.current) return // superseded
    dispatch({
      type: 'checklists',
      stats: unwrap(stats),
      daily: unwrap(daily),
      module: unwrap(module),
    })
  }, [])

  // Boot: detect the bridge, then load the first screen.
  useEffect(() => {
    if (!getBridge()) {
      dispatch({ type: 'status', status: 'no-bridge' })
      return
    }
    void guard(async () => {
      await refreshCategories()
      await loadItems({ kind: 'recent' })
      dispatch({ type: 'status', status: 'ready' })
    })
  }, [guard, loadItems, refreshCategories])

  /**
   * Update state is pushed, not polled.
   *
   * The initial `get()` is what fills the state for a renderer that mounted
   * after the main process had already checked — a reload, or a slow first
   * paint. Everything after that arrives on the event.
   */
  useEffect(() => {
    const api = getBridge()?.update
    if (!api) return

    const unsubscribe = api.onStateChange((update) => dispatch({ type: 'update', update }))

    void api.get().then((result) => {
      if (result.ok) dispatch({ type: 'update', update: result.data })
    })

    return unsubscribe
  }, [])

  // Restore the sidebar's collapsed state after the first paint, for the
  // reason given on `initialState.sidebarCollapsed`.
  useEffect(() => {
    if (window.localStorage.getItem(SIDEBAR_KEY) === '1') {
      dispatch({ type: 'sidebar', collapsed: true })
    }
  }, [])

  const goTo = useCallback(
    (view: View) => {
      dispatch({ type: 'view', view })
      void guard(() => loadItems(view))
    },
    [guard, loadItems],
  )

  const store = useMemo<VaultStore>(() => {
    /** Reloads the current list plus the sidebar counts. */
    const refreshAll = async (view: View) => {
      await refreshCategories()
      await loadItems(view)
    }

    return {
      ...state,

      showRecent: () => goTo({ kind: 'recent' }),
      showCategory: (categoryId) => goTo({ kind: 'category', categoryId }),
      showNotes: () => {
        dispatch({ type: 'view', view: { kind: 'notes' } })
        void guard(() => loadNotes(state.noteFilter, state.noteQuery))
      },
      showChecklists: () => {
        dispatch({ type: 'view', view: { kind: 'checklists' } })
        void guard(() => loadChecklists(state.checklistRange))
      },
      showSettings: () => {
        dispatch({ type: 'view', view: { kind: 'settings' } })
        void guard(async () => {
          dispatch({ type: 'vaultInfo', info: unwrap(await bridge().vault.info()) })
        })
      },
      search: (query) => {
        const trimmed = query.trim()
        goTo(trimmed.length === 0 ? { kind: 'recent' } : { kind: 'search', query: trimmed })
      },

      openItem: async (id) => {
        dispatch({ type: 'detailLoading' })
        await guard(async () => {
          dispatch({ type: 'detail', detail: unwrap(await bridge().item.get(id)) })
        })
      },
      closeItem: () => dispatch({ type: 'detail', detail: null }),

      createCategory: (input) =>
        guard(async () => {
          const created = unwrap(await bridge().category.create(input))
          await refreshCategories()
          goTo({ kind: 'category', categoryId: created.id })
        }),

      deleteCategory: (id) =>
        guard(async () => {
          unwrap(await bridge().category.remove(id))
          await refreshCategories()
          goTo({ kind: 'recent' })
        }),

      createItem: (input) =>
        guard(async () => {
          const created = unwrap(await bridge().item.create(input))
          await refreshAll({ kind: 'category', categoryId: input.categoryId })
          dispatch({ type: 'view', view: { kind: 'category', categoryId: input.categoryId } })
          dispatch({ type: 'detail', detail: created })

          // A document that was typed rather than uploaded is not finished at
          // the moment it is created — it is empty. Land the user in the
          // editor rather than on a blank viewer they have to work out how to
          // leave. Uploads skip this: their content already exists.
          const wanted = input.composed?.[0]
          if (wanted) {
            // Match on the *derived* filename. The service normalises the name
            // it was given — 'Tên' becomes 'Tên.md' — so comparing against the
            // raw input never matches, and the editor silently fails to open.
            // Both sides call the same `documentFilename`, so this is exact.
            const filename = documentFilename(wanted.filename, wanted.format)
            const first = created.assets.find((asset) => asset.filename === filename)
            if (first) dispatch({ type: 'editingAsset', assetId: first.id })
          }
        }),

      updateItem: (input) =>
        guard(async () => {
          const updated = unwrap(await bridge().item.update(input))
          dispatch({ type: 'detail', detail: updated })
          await refreshAll(state.view)
        }),

      deleteItem: (id) =>
        guard(async () => {
          unwrap(await bridge().item.remove(id))
          dispatch({ type: 'detail', detail: null })
          await refreshAll(state.view)
        }),

      addAssets: (itemId) =>
        guard(async () => {
          const picked = unwrap(await bridge().asset.pick())
          if (picked.length === 0) return

          unwrap(await bridge().asset.add({ itemId, filePaths: picked.map((f) => f.path) }))
          dispatch({ type: 'detail', detail: unwrap(await bridge().item.get(itemId)) })
          await loadItems(state.view)
        }),

      removeAsset: (assetId) =>
        guard(async () => {
          const itemId = state.detail?.id
          unwrap(await bridge().asset.remove(assetId))
          // Deleting the file the editor is open on has to close the editor,
          // not leave it editing something that no longer exists.
          if (state.editingAssetId === assetId) {
            dispatch({ type: 'editingAsset', assetId: null })
          }
          if (itemId) {
            dispatch({ type: 'detail', detail: unwrap(await bridge().item.get(itemId)) })
          }
          await loadItems(state.view)
        }),

      composeAsset: (input) =>
        guard(async () => {
          const created = unwrap(await bridge().asset.compose(input))
          dispatch({ type: 'detail', detail: unwrap(await bridge().item.get(input.itemId)) })
          dispatch({ type: 'editingAsset', assetId: created.id })
          await loadItems(state.view)
        }),

      saveAssetText: (assetId, content) =>
        guard(async () => {
          unwrap(await bridge().asset.updateText({ id: assetId, content }))

          // Refetch the item: the save bumped its `updatedAt` and changed the
          // asset's size, both of which are on screen. The list is refreshed
          // too because editing a document reorders "newest updated first".
          const itemId = state.detail?.id
          if (itemId) {
            dispatch({ type: 'detail', detail: unwrap(await bridge().item.get(itemId)) })
          }
          await loadItems(state.view)
        }),

      editAsset: (assetId) => dispatch({ type: 'editingAsset', assetId }),

      // ------------------------------------------------------------- notes

      filterNotes: (kind) => {
        dispatch({ type: 'noteFilter', kind })
        void guard(() => loadNotes(kind, state.noteQuery))
      },

      searchNotes: (query) => {
        dispatch({ type: 'noteQuery', query })
        void guard(() => loadNotes(state.noteFilter, query))
      },

      openNote: async (id) => {
        dispatch({ type: 'noteLoading' })
        await guard(async () => {
          dispatch({ type: 'note', note: unwrap(await bridge().note.get(id)) })
        })
      },

      closeNote: () => dispatch({ type: 'note', note: null }),

      createNote: (input) =>
        guard(async () => {
          const created = unwrap(await bridge().note.create(input))
          // Straight into the editor: a note with a title and no body is not
          // yet the thing the user came here to make.
          dispatch({ type: 'view', view: { kind: 'notes' } })
          dispatch({ type: 'note', note: created })
          await loadNotes(state.noteFilter, state.noteQuery)
        }),

      updateNote: (input) =>
        guard(async () => {
          const updated = unwrap(await bridge().note.update(input))
          // Only refresh the open editor when it is the note being edited —
          // ticking a checkbox in the list must not drag the user into it.
          if (state.note?.id === updated.id) dispatch({ type: 'note', note: updated })
          await loadNotes(state.noteFilter, state.noteQuery)
        }),

      deleteNote: (id) =>
        guard(async () => {
          unwrap(await bridge().note.remove(id))
          if (state.note?.id === id) dispatch({ type: 'note', note: null })
          await loadNotes(state.noteFilter, state.noteQuery)
        }),

      // -------------------------------------------------------- checklists

      setChecklistRange: (range) => {
        dispatch({ type: 'checklistRange', range })
        void guard(() => loadChecklists(range))
      },

      openChecklist: async (id) => {
        dispatch({ type: 'checklistLoading' })
        await guard(async () => {
          dispatch({ type: 'checklist', checklist: unwrap(await bridge().checklist.get(id)) })
        })
      },

      closeChecklist: () => dispatch({ type: 'checklist', checklist: null }),

      createChecklist: (input) =>
        guard(async () => {
          const created = unwrap(await bridge().checklist.create(input))
          // Straight into the plan: the wizard confirmed a list of tasks, and
          // the next thing anyone does with a plan is work through it.
          dispatch({ type: 'view', view: { kind: 'checklists' } })
          dispatch({ type: 'checklist', checklist: created })
          await loadChecklists(state.checklistRange)
        }),

      updateChecklist: (input) =>
        guard(async () => {
          const updated = unwrap(await bridge().checklist.update(input))
          dispatch({ type: 'checklist', checklist: updated })
          await loadChecklists(state.checklistRange)
        }),

      deleteChecklist: (id) =>
        guard(async () => {
          unwrap(await bridge().checklist.remove(id))
          if (state.checklist?.id === id) dispatch({ type: 'checklist', checklist: null })
          await loadChecklists(state.checklistRange)
        }),

      /*
       * Every task mutation answers with the whole plan, so the open pane is
       * replaced wholesale rather than patched: ticking one sub-task can move
       * its parent, the plan's percentage and the dashboard's tally at once.
       * The dashboard is reloaded behind it for the same reason.
       */
      addChecklistTask: (input) =>
        guard(async () => {
          dispatch({ type: 'checklist', checklist: unwrap(await bridge().checklist.addTask(input)) })
          await loadChecklists(state.checklistRange)
        }),

      updateChecklistTask: (input) =>
        guard(async () => {
          dispatch({
            type: 'checklist',
            checklist: unwrap(await bridge().checklist.updateTask(input)),
          })
          await loadChecklists(state.checklistRange)
        }),

      deleteChecklistTask: (id) =>
        guard(async () => {
          dispatch({
            type: 'checklist',
            checklist: unwrap(await bridge().checklist.removeTask(id)),
          })
          await loadChecklists(state.checklistRange)
        }),

      moveChecklistTask: (input) =>
        guard(async () => {
          dispatch({
            type: 'checklist',
            checklist: unwrap(await bridge().checklist.moveTask(input)),
          })
          await loadChecklists(state.checklistRange)
        }),

      // ----------------------------------------------------------- updates

      /*
       * Each of these answers with the new state as well as pushing it, so the
       * button that was clicked changes immediately rather than after the
       * round trip through the event.
       */
      checkForUpdate: () =>
        guard(async () => {
          dispatch({ type: 'update', update: unwrap(await bridge().update.check()) })
        }),

      downloadUpdate: () =>
        guard(async () => {
          dispatch({ type: 'update', update: unwrap(await bridge().update.download()) })
        }),

      installUpdate: () =>
        guard(async () => {
          // The application quits inside this call, so nothing below it runs.
          unwrap(await bridge().update.install())
        }),

      // ------------------------------------------------------------- chrome

      toggleSidebar: () => {
        const collapsed = !state.sidebarCollapsed
        window.localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0')
        dispatch({ type: 'sidebar', collapsed })
      },

      openVaultFolder: async () => {
        await guard(async () => {
          unwrap(await bridge().vault.openFolder())
        })
      },

      dismissError: () => dispatch({ type: 'error', message: null }),
    }
  }, [state, goTo, guard, loadItems, loadNotes, loadChecklists, refreshCategories])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useVault(): VaultStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useVault must be used inside <VaultProvider>')
  return store
}
