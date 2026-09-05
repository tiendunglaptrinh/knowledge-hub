/**
 * The IPC contract — this application's public API.
 *
 * There is no HTTP server here, so `ipcMain.handle` channels play the role
 * REST endpoints play in a web app. Treating them as a versioned contract is
 * what keeps the renderer swappable and the main process testable.
 *
 * Three things live here and nowhere else:
 *   1. `IpcChannel`  — the channel name constants
 *   2. `ApiMap`      — request/response type for every channel
 *   3. `Result<T>`   — the envelope every call resolves to
 *
 * Both sides derive their types from `ApiMap`, so adding a channel without
 * implementing it is a compile error, and calling one with the wrong payload
 * is also a compile error. See docs/05-ipc-contract.md.
 */

import type { SerializedError } from './errors'
import type {
  AddAssetsInput,
  AddChecklistTaskInput,
  Asset,
  CategorySummary,
  ChecklistDetail,
  ChecklistListInput,
  ChecklistStats,
  ChecklistStatsInput,
  ChecklistSummary,
  ComposeAssetInput,
  CreateCategoryInput,
  CreateChecklistInput,
  CreateItemInput,
  CreateNoteInput,
  ItemDetail,
  ItemSummary,
  MoveChecklistTaskInput,
  Note,
  NoteListInput,
  NoteSummary,
  PickedFile,
  RenderedAsset,
  SearchInput,
  UpdateAssetTextInput,
  UpdateCategoryInput,
  UpdateChecklistInput,
  UpdateChecklistTaskInput,
  UpdateItemInput,
  UpdateNoteInput,
  UpdateState,
  VaultInfo,
} from './types'

/**
 * Uniform envelope. Handlers never reject: an expected failure comes back as
 * `{ ok: false }` so the renderer has one branch to write instead of a
 * try/catch around every call.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: SerializedError }

export const IpcChannel = {
  categoryList: 'category:list',
  categoryCreate: 'category:create',
  categoryUpdate: 'category:update',
  categoryDelete: 'category:delete',

  itemListByCategory: 'item:listByCategory',
  itemRecent: 'item:recent',
  itemGet: 'item:get',
  itemCreate: 'item:create',
  itemUpdate: 'item:update',
  itemDelete: 'item:delete',
  itemSearch: 'item:search',

  noteList: 'note:list',
  noteGet: 'note:get',
  noteCreate: 'note:create',
  noteUpdate: 'note:update',
  noteDelete: 'note:delete',

  checklistList: 'checklist:list',
  checklistGet: 'checklist:get',
  checklistGetByDay: 'checklist:getByDay',
  checklistCreate: 'checklist:create',
  checklistUpdate: 'checklist:update',
  checklistDelete: 'checklist:delete',
  checklistStats: 'checklist:stats',

  checklistTaskAdd: 'checklist:taskAdd',
  checklistTaskUpdate: 'checklist:taskUpdate',
  checklistTaskDelete: 'checklist:taskDelete',
  checklistTaskMove: 'checklist:taskMove',

  assetPick: 'asset:pick',
  assetAdd: 'asset:add',
  assetCompose: 'asset:compose',
  assetUpdateText: 'asset:updateText',
  assetDelete: 'asset:delete',
  assetRender: 'asset:render',
  assetOpenExternal: 'asset:openExternal',
  assetRevealInFolder: 'asset:revealInFolder',

  vaultInfo: 'vault:info',
  vaultOpenFolder: 'vault:openFolder',

  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
} as const

/**
 * The one channel that travels the other way: main → renderer.
 *
 * Everything else in this contract is request/response, because the renderer
 * always knows when it wants something. An update does not work that way — the
 * feed answers when it answers, and a download reports progress several times
 * a second — so this is a push, delivered with `webContents.send`.
 *
 * It is separate from `IpcChannel` on purpose: `ApiMap` describes calls that
 * return a `Result`, and this returns nothing to anyone.
 */
export const IpcEvent = {
  updateState: 'update:state',
} as const

export type IpcEvent = (typeof IpcEvent)[keyof typeof IpcEvent]

/** Payload of each `IpcEvent`. */
export interface EventMap {
  [IpcEvent.updateState]: UpdateState
}

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel]

/**
 * Request and response type per channel.
 * `req: void` means the channel takes no argument.
 */
export interface ApiMap {
  [IpcChannel.categoryList]: { req: void; res: CategorySummary[] }
  [IpcChannel.categoryCreate]: { req: CreateCategoryInput; res: CategorySummary }
  [IpcChannel.categoryUpdate]: { req: UpdateCategoryInput; res: CategorySummary }
  /** Refuses to delete a category that still holds items (CATEGORY_NOT_EMPTY). */
  [IpcChannel.categoryDelete]: { req: { id: string }; res: { id: string } }

  [IpcChannel.itemListByCategory]: { req: { categoryId: string }; res: ItemSummary[] }
  [IpcChannel.itemRecent]: { req: { limit?: number }; res: ItemSummary[] }
  [IpcChannel.itemGet]: { req: { id: string }; res: ItemDetail }
  [IpcChannel.itemCreate]: { req: CreateItemInput; res: ItemDetail }
  [IpcChannel.itemUpdate]: { req: UpdateItemInput; res: ItemDetail }
  /** Cascades: removes the item's assets from disk and its FTS rows. */
  [IpcChannel.itemDelete]: { req: { id: string }; res: { id: string } }
  [IpcChannel.itemSearch]: { req: SearchInput; res: ItemSummary[] }

  /** Bodies are omitted — a list of fifty notes should not ship fifty bodies. */
  [IpcChannel.noteList]: { req: NoteListInput; res: NoteSummary[] }
  [IpcChannel.noteGet]: { req: { id: string }; res: Note }
  [IpcChannel.noteCreate]: { req: CreateNoteInput; res: Note }
  [IpcChannel.noteUpdate]: { req: UpdateNoteInput; res: Note }
  /** Also removes the note's Markdown/text mirror from the vault. */
  [IpcChannel.noteDelete]: { req: { id: string }; res: { id: string } }

  /** Tasks are omitted — a month of plans should not ship a month of tasks. */
  [IpcChannel.checklistList]: { req: ChecklistListInput; res: ChecklistSummary[] }
  [IpcChannel.checklistGet]: { req: { id: string }; res: ChecklistDetail }
  /** `null` rather than an error: "today has no plan yet" is an ordinary state. */
  [IpcChannel.checklistGetByDay]: { req: { day: string }; res: ChecklistDetail | null }
  /** Creates the plan and its tasks atomically; refuses an empty one. */
  [IpcChannel.checklistCreate]: { req: CreateChecklistInput; res: ChecklistDetail }
  /** Metadata only. A daily plan's date is fixed once created. */
  [IpcChannel.checklistUpdate]: { req: UpdateChecklistInput; res: ChecklistDetail }
  /** Cascades: every task of the plan goes with it. */
  [IpcChannel.checklistDelete]: { req: { id: string }; res: { id: string } }
  [IpcChannel.checklistStats]: { req: ChecklistStatsInput; res: ChecklistStats }

  /*
   * Every task channel answers with the whole plan rather than the one task it
   * touched. Ticking a sub-task can change its parent, the plan's percentage
   * and the dashboard's tally at once, so a response of one task would leave
   * the renderer guessing at the other three.
   */
  [IpcChannel.checklistTaskAdd]: { req: AddChecklistTaskInput; res: ChecklistDetail }
  [IpcChannel.checklistTaskUpdate]: { req: UpdateChecklistTaskInput; res: ChecklistDetail }
  /** Refuses to remove the last top-level task (CHECKLIST_EMPTY). */
  [IpcChannel.checklistTaskDelete]: { req: { id: string }; res: ChecklistDetail }
  /** Reorders within one priority group; anything else is an error. */
  [IpcChannel.checklistTaskMove]: { req: MoveChecklistTaskInput; res: ChecklistDetail }

  /** Opens the native file dialog. Returns [] when the user cancels. */
  [IpcChannel.assetPick]: { req: void; res: PickedFile[] }
  [IpcChannel.assetAdd]: { req: AddAssetsInput; res: Asset[] }
  /** Writes a typed document into the vault as a new asset on an existing item. */
  [IpcChannel.assetCompose]: { req: ComposeAssetInput; res: Asset }
  /** Rewrites a `markdown` or `text` asset; `ASSET_NOT_EDITABLE` for anything else. */
  [IpcChannel.assetUpdateText]: { req: UpdateAssetTextInput; res: Asset }
  [IpcChannel.assetDelete]: { req: { id: string }; res: { id: string } }
  [IpcChannel.assetRender]: { req: { id: string }; res: RenderedAsset }
  /** Hands the file to the OS default application. */
  [IpcChannel.assetOpenExternal]: { req: { id: string }; res: null }
  /** Opens the containing folder and selects the file. */
  [IpcChannel.assetRevealInFolder]: { req: { id: string }; res: null }

  [IpcChannel.vaultInfo]: { req: void; res: VaultInfo }
  [IpcChannel.vaultOpenFolder]: { req: void; res: null }

  /** The current state, for a renderer that has just mounted. */
  [IpcChannel.updateGet]: { req: void; res: UpdateState }
  /** Asks the feed. Resolves as soon as the check *starts*; watch the event. */
  [IpcChannel.updateCheck]: { req: void; res: UpdateState }
  /** Starts the download. `autoDownload` is off — see `UpdateService`. */
  [IpcChannel.updateDownload]: { req: void; res: UpdateState }
  /** Quits and installs. Nothing after this call runs. */
  [IpcChannel.updateInstall]: { req: void; res: null }
}

export type ApiRequest<C extends keyof ApiMap> = ApiMap[C]['req']
export type ApiResponse<C extends keyof ApiMap> = ApiMap[C]['res']

/** Name of the object the preload script exposes on `window`. */
export const BRIDGE_KEY = 'knowledgeHub'

/**
 * The shape of `window.knowledgeHub`. Grouped by resource purely for
 * ergonomics in components; each method is a thin wrapper over one channel.
 */
export interface KnowledgeHubBridge {
  category: {
    list(): Promise<Result<CategorySummary[]>>
    create(input: CreateCategoryInput): Promise<Result<CategorySummary>>
    update(input: UpdateCategoryInput): Promise<Result<CategorySummary>>
    remove(id: string): Promise<Result<{ id: string }>>
  }
  item: {
    listByCategory(categoryId: string): Promise<Result<ItemSummary[]>>
    recent(limit?: number): Promise<Result<ItemSummary[]>>
    get(id: string): Promise<Result<ItemDetail>>
    create(input: CreateItemInput): Promise<Result<ItemDetail>>
    update(input: UpdateItemInput): Promise<Result<ItemDetail>>
    remove(id: string): Promise<Result<{ id: string }>>
    search(input: SearchInput): Promise<Result<ItemSummary[]>>
  }
  note: {
    list(input: NoteListInput): Promise<Result<NoteSummary[]>>
    get(id: string): Promise<Result<Note>>
    create(input: CreateNoteInput): Promise<Result<Note>>
    update(input: UpdateNoteInput): Promise<Result<Note>>
    remove(id: string): Promise<Result<{ id: string }>>
  }
  checklist: {
    list(input: ChecklistListInput): Promise<Result<ChecklistSummary[]>>
    get(id: string): Promise<Result<ChecklistDetail>>
    getByDay(day: string): Promise<Result<ChecklistDetail | null>>
    create(input: CreateChecklistInput): Promise<Result<ChecklistDetail>>
    update(input: UpdateChecklistInput): Promise<Result<ChecklistDetail>>
    remove(id: string): Promise<Result<{ id: string }>>
    stats(input: ChecklistStatsInput): Promise<Result<ChecklistStats>>

    addTask(input: AddChecklistTaskInput): Promise<Result<ChecklistDetail>>
    updateTask(input: UpdateChecklistTaskInput): Promise<Result<ChecklistDetail>>
    removeTask(id: string): Promise<Result<ChecklistDetail>>
    moveTask(input: MoveChecklistTaskInput): Promise<Result<ChecklistDetail>>
  }
  asset: {
    pick(): Promise<Result<PickedFile[]>>
    add(input: AddAssetsInput): Promise<Result<Asset[]>>
    compose(input: ComposeAssetInput): Promise<Result<Asset>>
    updateText(input: UpdateAssetTextInput): Promise<Result<Asset>>
    remove(id: string): Promise<Result<{ id: string }>>
    render(id: string): Promise<Result<RenderedAsset>>
    openExternal(id: string): Promise<Result<null>>
    revealInFolder(id: string): Promise<Result<null>>
    /**
     * Resolves the absolute path of a file dropped onto the window.
     * Electron removed `File.path` in v32; this wraps `webUtils`.
     */
    pathForFile(file: File): string
  }
  vault: {
    info(): Promise<Result<VaultInfo>>
    openFolder(): Promise<Result<null>>
  }
  update: {
    get(): Promise<Result<UpdateState>>
    check(): Promise<Result<UpdateState>>
    download(): Promise<Result<UpdateState>>
    /** Quits the application. The promise never settles in practice. */
    install(): Promise<Result<null>>
    /**
     * Subscribes to state changes. Returns the unsubscribe function — the
     * renderer must call it on unmount, or a hot reload leaves two listeners
     * on one channel and the banner updates twice.
     */
    onStateChange(listener: (state: UpdateState) => void): () => void
  }
  /**
   * The window's own presentation. Not IPC: `webFrame` is available to a
   * sandboxed preload, so zoom is set in the renderer process directly and the
   * main process is not involved at all.
   *
   * This is the only mechanism that scales Chromium's built-in PDF viewer, an
   * image, or a size expressed in pixels — a stylesheet in the renderer cannot
   * reach inside an `<iframe>`. Everything the application draws itself is
   * themed with CSS variables instead; see renderer/src/lib/prefs.tsx.
   */
  view: {
    /** 1 is unzoomed. Clamped by Electron to a sane range. */
    setZoomFactor(factor: number): void
    getZoomFactor(): number
  }
}
