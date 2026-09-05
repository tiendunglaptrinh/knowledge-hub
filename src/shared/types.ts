/**
 * Data-transfer types crossing the IPC boundary.
 *
 * This file is the single source of truth for the shape of everything the UI
 * sees. It is imported by BOTH processes:
 *
 *   main process  -> services return these
 *   renderer      -> components consume these
 *
 * Constraints:
 *   - types only, no runtime code, no imports from `electron` or `node:*`
 *   - fields are camelCase; the SQLite columns they map to are snake_case and
 *     that translation happens in the repositories, nowhere else
 *   - dates are ISO-8601 UTC strings, never Date objects (IPC clones lose the
 *     prototype and Next's static export has no timezone context)
 *
 * See docs/05-ipc-contract.md.
 */

/** ISO-8601 timestamp in UTC, e.g. `2026-08-01T09:15:00.000Z`. */
export type IsoDateTime = string

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export interface Category {
  id: string
  name: string
  /** URL/filesystem-safe unique key derived from `name`. */
  slug: string
  /** Reserved for sub-categories. Always null in v0.1 — see docs/11-roadmap.md. */
  parentId: string | null
  /** Hex colour used for the accent dot, e.g. `#38bdf8`. */
  color: string
  /** Lucide icon name, e.g. `Code2`. Renderer falls back to `Folder`. */
  icon: string
  sortOrder: number
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export interface CategorySummary extends Category {
  /** Number of items directly in this category. */
  itemCount: number
}

// ---------------------------------------------------------------------------
// Item — one thing you learned; owns one or more files
// ---------------------------------------------------------------------------

export interface Item {
  id: string
  categoryId: string
  title: string
  summary: string | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export interface ItemSummary extends Item {
  categoryName: string
  categoryColor: string
  assetCount: number
  tags: string[]
  /** Extension of the first attachment, for the list icon. Empty when none. */
  primaryExt: string
}

export interface ItemDetail extends Item {
  category: Category
  assets: Asset[]
  tags: string[]
}

// ---------------------------------------------------------------------------
// Asset — one uploaded file belonging to an item
// ---------------------------------------------------------------------------

/**
 * How the viewer should render an asset. Derived from the extension by
 * `classifyAsset`, never stored — adding a new viewer must not require a
 * migration.
 */
export type AssetKind = 'markdown' | 'pdf' | 'word' | 'text' | 'image' | 'other'

export interface Asset {
  id: string
  itemId: string
  /** Original filename as chosen by the user, including extension. */
  filename: string
  /** Lowercase, without the dot, e.g. `pdf`. Empty string when absent. */
  ext: string
  mime: string
  sizeBytes: number
  /** POSIX-style path relative to the vault root. Never absolute. */
  relPath: string
  /** SHA-256 of the file contents, used for duplicate detection. */
  checksum: string
  sortOrder: number
  createdAt: IsoDateTime
}

/** An asset plus everything the viewer needs to display it. */
export interface RenderedAsset {
  asset: Asset
  kind: AssetKind
  /** Sanitised-upstream HTML for `markdown` and `word`. */
  html?: string
  /** Raw text for `text`. */
  text?: string
  /** `app://asset/<relPath>` URL for `pdf` and `image`. */
  url?: string
  /** Non-fatal conversion notes, e.g. unsupported Word styles. */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Note — something you write here, rather than a file you brought with you
// ---------------------------------------------------------------------------

/**
 * How text written inside the application is authored and displayed.
 *
 * `markdown` gets the two-section editor (source + review); `text` is a single
 * plain pane. Shared by notes and by composed documents, because it is the
 * same question in both places.
 */
export type TextFormat = 'markdown' | 'text'

/**
 * A note's format. Stored, not derived: unlike `AssetKind`, this is the user's
 * own choice about a body that has no filename to infer it from.
 */
export type NoteFormat = TextFormat

/**
 * What kind of note this is. Purely organisational — it drives the icon, the
 * colour and the filter chips, never a rule. The one exception is `deadline`,
 * which requires `dueAt`; see `NoteService.create`.
 */
export type NoteKind =
  | 'study'
  | 'daily'
  | 'deadline'
  | 'task'
  | 'idea'
  | 'meeting'
  | 'snippet'
  | 'other'

export interface Note {
  id: string
  title: string
  kind: NoteKind
  format: NoteFormat
  /** Markdown source or plain text, exactly as typed. */
  content: string
  /** When this note is due. Notes with one sort to the top. Null when undated. */
  dueAt: IsoDateTime | null
  /** When it was ticked off. Null while open; done notes sort to the bottom. */
  doneAt: IsoDateTime | null
  /**
   * POSIX-style path of the note's mirror file, relative to the vault root.
   * Empty when the mirror has not been written yet — the file is best-effort,
   * so a note can exist without one.
   */
  relPath: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

/** A note without its body, plus the first lines of it for the card. */
export interface NoteSummary extends Omit<Note, 'content'> {
  /** Leading characters of `content`, for the card preview. */
  excerpt: string
  /** Length of the full body in characters, so the card can say how long it is. */
  contentLength: number
}

// ---------------------------------------------------------------------------
// Checklist — a plan you commit to, and the tasks that make it up
// ---------------------------------------------------------------------------

/**
 * The two kinds of plan, which differ in what identifies them and in how a
 * task's priority is expressed.
 *
 * `daily`  — one plan per calendar day. It has no title (the day *is* the
 *            title) and its tasks are ranked *Cao* / *Thường*.
 * `module` — one plan per body of work, spanning weeks. It has a title, an
 *            optional description and deadline, and its tasks are ranked by
 *            the Eisenhower matrix instead.
 */
export type ChecklistKind = 'daily' | 'module'

/** Where a task is: `Cần hoàn thiện` → `Đang làm` → `Đã xong`. */
export type TaskStatus = 'todo' | 'doing' | 'done'

/**
 * Priority for a task inside a `daily` checklist.
 *
 * `high`   — do this before anything else today
 * `normal` — finish it some time today
 */
export type TaskPriority = 'high' | 'normal'

/**
 * Priority for a task inside a `module` checklist, as the four Eisenhower
 * quadrants. The names are the classic verbs rather than `urgent_important`,
 * because they say what to *do* with the task:
 *
 * `do`        urgent + important
 * `schedule`  important, not urgent
 * `delegate`  urgent, not important
 * `eliminate` neither
 */
export type EisenhowerQuadrant = 'do' | 'schedule' | 'delegate' | 'eliminate'

/**
 * How much of something is finished. Computed, never stored: a percentage in
 * a column would be one more thing that can disagree with the rows under it.
 *
 * `total` counts *leaf* tasks only — a big task that was broken down is
 * represented by its sub-tasks, so breaking one task into three does not make
 * the day look four tasks long.
 */
export interface Progress {
  total: number
  done: number
  /** 0–100, rounded. 100 only when `done === total` and `total > 0`. */
  percent: number
}

export interface Checklist {
  id: string
  kind: ChecklistKind
  /** `YYYY-MM-DD` in the user's own timezone for `daily`; null for `module`. */
  day: string | null
  /** Required for `module`, always null for `daily`. */
  title: string | null
  description: string | null
  /** Optional deadline for a `module` plan. Always null for `daily`. */
  dueAt: IsoDateTime | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export interface ChecklistTask {
  id: string
  checklistId: string
  /** Null for a top-level task; set for a sub-task (break-down). One level. */
  parentId: string | null
  title: string
  description: string | null
  dueAt: IsoDateTime | null
  status: TaskStatus
  /** Set on top-level tasks of a `daily` checklist, null everywhere else. */
  priority: TaskPriority | null
  /** Set on top-level tasks of a `module` checklist, null everywhere else. */
  quadrant: EisenhowerQuadrant | null
  /** Position among siblings *of the same priority*; see `checklist:taskMove`. */
  sortOrder: number
  doneAt: IsoDateTime | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

/** A task with its break-down attached, in the order the UI must render it. */
export interface ChecklistTaskNode extends ChecklistTask {
  children: ChecklistTaskNode[]
  /** Own progress: 1/1 for a leaf, the sub-tasks' tally for a parent. */
  progress: Progress
}

export interface ChecklistSummary extends Checklist {
  progress: Progress
  /** Top-level tasks, so a card can say "3 việc lớn" without the tree. */
  taskCount: number
}

export interface ChecklistDetail extends Checklist {
  tasks: ChecklistTaskNode[]
  progress: Progress
}

/** One day of the range in `ChecklistStats`. Only days with a plan appear. */
export interface DayProgress {
  /** `YYYY-MM-DD`. */
  day: string
  checklistId: string
  total: number
  done: number
  percent: number
}

/**
 * The dashboard's numbers, computed in the main process so the renderer never
 * has to load every task of every checklist just to count them.
 */
export interface ChecklistStats {
  /** Inclusive range of days the `daily` half covers, `YYYY-MM-DD`. */
  from: string
  to: string
  daily: {
    checklistCount: number
    /** Plans in the range that reached 100%. */
    completedCount: number
    taskTotal: number
    taskDone: number
    percent: number
    days: DayProgress[]
  }
  /**
   * The `module` half is *not* limited to the range: a two-month plan is
   * relevant on every day of those two months, so filtering it by the week on
   * screen would make it vanish for no reason the user can see.
   */
  module: {
    checklistCount: number
    completedCount: number
    taskTotal: number
    taskDone: number
    percent: number
  }
}

// ---------------------------------------------------------------------------
// Updates — the application checking whether a newer version of itself exists
// ---------------------------------------------------------------------------

/**
 * Where the update flow currently is.
 *
 * `unsupported` is a first-class state, not an error: a development run, a
 * `--dir` copy and a portable build all have nothing an updater could write
 * over. Reporting that plainly is better than surfacing whatever
 * `electron-updater` throws when it cannot find `app-update.yml`.
 */
export type UpdateStatus =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/**
 * The whole update flow as one value.
 *
 * Pushed to the renderer on every transition rather than polled: a download
 * emits progress several times a second, and a UI that had to ask would either
 * miss frames or hammer the channel.
 */
export interface UpdateState {
  status: UpdateStatus
  /** The version running right now, from `package.json`. */
  currentVersion: string
  /** The version on the feed, once one is known. Null otherwise. */
  availableVersion: string | null
  /** 0–100 while downloading; null in every other state. */
  percent: number | null
  /** Release notes as published, when the feed carries them. */
  releaseNotes: string | null
  /**
   * Why the last attempt failed, as an `ErrorCode` — never a sentence. The
   * renderer looks the text up, exactly as it does for a failed IPC call.
   */
  error: string | null
  /** When the last successful check finished. Null if none has. */
  checkedAt: IsoDateTime | null
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

export interface CreateCategoryInput {
  name: string
  color?: string
  icon?: string
}

export interface UpdateCategoryInput {
  id: string
  name?: string
  color?: string
  icon?: string
}

/**
 * A document the user typed rather than uploaded.
 *
 * It becomes an ordinary `assets` row: once written there is nothing to
 * distinguish it from an uploaded `.md`, which is why it can be searched,
 * viewed, opened externally and edited by exactly the same code.
 */
export interface ComposedDocument {
  /** Display name. The extension is derived from `format`, not from this. */
  filename: string
  format: TextFormat
  content: string
}

export interface CreateItemInput {
  categoryId: string
  title: string
  summary?: string
  tags?: string[]
  /**
   * Absolute paths on the local filesystem, obtained from `asset.pick`.
   * The main process copies them into the vault; file bytes never travel
   * over IPC. See docs/05-ipc-contract.md#why-paths-not-buffers.
   */
  filePaths?: string[]
  /**
   * Documents written in the editor. Text *does* travel over IPC — unlike an
   * uploaded file it has no path, and it is bounded at 5 MB.
   */
  composed?: ComposedDocument[]
}

export interface ComposeAssetInput {
  itemId: string
  filename: string
  format: TextFormat
  content: string
}

/** Rewrites the body of a `markdown` or `text` asset, in place. */
export interface UpdateAssetTextInput {
  id: string
  content: string
}

export interface UpdateItemInput {
  id: string
  title?: string
  summary?: string
  categoryId?: string
  tags?: string[]
}

export interface AddAssetsInput {
  itemId: string
  filePaths: string[]
}

export interface SearchInput {
  query: string
  categoryId?: string
  limit?: number
}

export interface CreateNoteInput {
  title: string
  kind?: NoteKind
  format?: NoteFormat
  content?: string
  /** ISO-8601. Required when `kind` is `deadline`. */
  dueAt?: string | null
}

/**
 * Every field is optional and an omitted one is left alone. `dueAt: null`
 * clears the date — which is why it is `string | null | undefined` rather than
 * `string | undefined`: the three states are genuinely different.
 */
export interface UpdateNoteInput {
  id: string
  title?: string
  kind?: NoteKind
  format?: NoteFormat
  content?: string
  dueAt?: string | null
  /** `true` stamps `doneAt` with the current instant, `false` clears it. */
  done?: boolean
}

export interface NoteListInput {
  /** Restrict to one kind. Omitted means every kind. */
  kind?: NoteKind
  /** Free text over title and body, same FTS treatment as item search. */
  query?: string
  limit?: number
}

/** A file the user selected but has not committed yet. */
export interface PickedFile {
  path: string
  filename: string
  ext: string
  sizeBytes: number
}

/**
 * A task as it is described *before* it exists — by the create wizard, or by
 * "add a task to this plan". `children` is one level deep: the break-down of
 * a big task, not a general tree, because a plan for one day that needs three
 * levels of nesting is not a plan for one day.
 */
export interface NewChecklistTask {
  title: string
  description?: string
  /** ISO-8601. Optional everywhere — most tasks are due when the plan is. */
  dueAt?: string | null
  /** Defaults to `todo`. */
  status?: TaskStatus
  /** `daily` only; defaults to `normal`. Ignored by a `module` checklist. */
  priority?: TaskPriority
  /** `module` only; defaults to `schedule`. Ignored by a `daily` checklist. */
  quadrant?: EisenhowerQuadrant
  children?: NewChecklistTask[]
}

/**
 * Creating a plan and filling it are one operation, deliberately.
 *
 * `tasks` must hold at least one entry: an empty checklist is a promise with
 * nothing in it, and the UI's wizard is built around confirming a list the
 * user has already typed. See `CHECKLIST_EMPTY`.
 */
export interface CreateChecklistInput {
  kind: ChecklistKind
  /** `YYYY-MM-DD`. Required for `daily`, rejected for `module`. */
  day?: string
  /** Required for `module`, rejected for `daily`. */
  title?: string
  description?: string
  /** `module` only. */
  dueAt?: string | null
  tasks: NewChecklistTask[]
}

/** Metadata only — tasks are edited through the `checklist:task*` channels. */
export interface UpdateChecklistInput {
  id: string
  title?: string
  description?: string | null
  dueAt?: string | null
}

export interface ChecklistListInput {
  kind?: ChecklistKind
  /** Inclusive `YYYY-MM-DD` bounds, applied to `day`. `daily` plans only. */
  from?: string
  to?: string
  limit?: number
}

export interface AddChecklistTaskInput extends NewChecklistTask {
  checklistId: string
  /** Null or omitted adds a top-level task; an id adds a sub-task under it. */
  parentId?: string | null
}

/**
 * Every field is optional and an omitted one is left alone; `null` clears a
 * nullable one. Same three-state reasoning as `UpdateNoteInput.dueAt`.
 */
export interface UpdateChecklistTaskInput {
  id: string
  title?: string
  description?: string | null
  dueAt?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  quadrant?: EisenhowerQuadrant
}

/**
 * Drag-and-drop reordering.
 *
 * The task lands immediately before or after `targetId`. Both must be
 * siblings *and* carry the same priority — the matrix decides the order of the
 * groups, and the user decides the order inside one. Anything else is
 * `CHECKLIST_TASK_PRIORITY_MISMATCH`, not a silent no-op.
 */
export interface MoveChecklistTaskInput {
  id: string
  targetId: string
  position: 'before' | 'after'
}

/** Inclusive `YYYY-MM-DD` bounds for the dashboard's daily half. */
export interface ChecklistStatsInput {
  from: string
  to: string
}

// ---------------------------------------------------------------------------
// Vault info — shown in Settings so the user always knows where data lives
// ---------------------------------------------------------------------------

export interface VaultInfo {
  dataDir: string
  databasePath: string
  assetsDir: string
  /** Where the Markdown/text mirror of every note is written. */
  notesDir: string
  /** Total bytes of all stored assets. */
  totalAssetBytes: number
  categoryCount: number
  itemCount: number
  assetCount: number
  noteCount: number
  checklistCount: number
  schemaVersion: number
}
