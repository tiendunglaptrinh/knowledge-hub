/**
 * Storage ports.
 *
 * These interfaces are the seam between the application services and whatever
 * actually persists data. Services depend on the interface; `src/storage`
 * provides the SQLite + filesystem implementation. Nothing in `src/core` may
 * import `better-sqlite3`, `electron` or `node:fs` — if that rule ever needs
 * breaking, the abstraction is wrong.
 *
 * Everything here is synchronous. better-sqlite3 is a synchronous binding, and
 * pretending otherwise would add promises that never yield. Filesystem work is
 * the exception and lives on `AssetStore`, which is async.
 *
 * See docs/03-architecture.md#layer-rules.
 */

import type {
  Asset,
  Category,
  CategorySummary,
  Checklist,
  ChecklistKind,
  ChecklistTask,
  Item,
  ItemSummary,
  Note,
  NoteKind,
  NoteSummary,
  VaultInfo,
} from '../../shared/types'

// ---------------------------------------------------------------------------

/**
 * Runs several repository calls as one atomic unit.
 *
 * Synchronous on purpose: SQLite transactions are, and an `await` inside one
 * would hold the write lock across an arbitrary amount of unrelated work. Any
 * async step — a file copy, a Word conversion — happens either side of the
 * unit, never within it. See docs/03-architecture.md#transactions.
 */
export interface UnitOfWork {
  run<T>(work: () => T): T
}

// ---------------------------------------------------------------------------

export interface CategoryRepository {
  list(): CategorySummary[]
  findById(id: string): Category | null
  slugExists(slug: string): boolean
  /** Case-insensitive; used to reject duplicates before insert. */
  nameExists(name: string, exceptId?: string): boolean
  insert(category: Category): void
  update(category: Category): void
  delete(id: string): void
  countItems(categoryId: string): number
}

// ---------------------------------------------------------------------------

export interface ItemRepository {
  listByCategory(categoryId: string): ItemSummary[]
  listRecent(limit: number): ItemSummary[]
  findById(id: string): Item | null
  insert(item: Item): void
  update(item: Item): void
  /** Bumps `updatedAt` when something below the item changes, e.g. an asset. */
  touch(id: string, at: string): void
  delete(id: string): void
  /** FTS5 match over title, summary and extracted body text. */
  search(query: string, categoryId: string | undefined, limit: number): ItemSummary[]
  /** Replaces the item's row in the search index. */
  reindex(itemId: string, title: string, summary: string, body: string): void
  removeFromIndex(itemId: string): void
}

// ---------------------------------------------------------------------------

export interface NoteRepository {
  /**
   * Ordering is a storage concern here rather than a service one, because it
   * is expressed in `ORDER BY` and cannot be reproduced faithfully in
   * JavaScript without re-reading every row. Open dated notes come first by
   * `due_at` ascending, then open undated notes by recency, then done notes.
   */
  list(kind: NoteKind | undefined, query: string | undefined, limit: number): NoteSummary[]
  findById(id: string): Note | null
  insert(note: Note): void
  update(note: Note): void
  delete(id: string): void
  count(): number
  /** Records where the mirror file landed, once it has been written. */
  setRelPath(id: string, relPath: string): void
  /** Replaces the note's row in the search index. */
  reindex(noteId: string, title: string, content: string): void
  removeFromIndex(noteId: string): void
}

// ---------------------------------------------------------------------------

/**
 * Checklists and their tasks, in one port.
 *
 * They are not separable: a task has no meaning outside the plan it belongs
 * to, every write to one is made in the same transaction as a write to the
 * other, and splitting them would mean two ports that may only ever be used
 * together. Same reason `ItemRepository` owns the search index rather than
 * handing it to a repository of its own.
 *
 * Ordering is deliberately *not* done here. Unlike notes, whose order is one
 * `ORDER BY` no JavaScript could reproduce cheaply, a plan's order depends on
 * the priority *rank* — a mapping that lives in `src/core/domain/checklist.ts`
 * and would have to be re-spelled as a `CASE` expression to happen in SQL.
 * Rows come back grouped by parent and the service sorts them.
 */
export interface ChecklistRepository {
  /** `from`/`to` are inclusive `YYYY-MM-DD` bounds on `day`. */
  list(
    kind: ChecklistKind | undefined,
    from: string | undefined,
    to: string | undefined,
    limit: number,
  ): Checklist[]
  findById(id: string): Checklist | null
  findByDay(day: string): Checklist | null
  insert(checklist: Checklist): void
  update(checklist: Checklist): void
  delete(id: string): void
  count(): number

  tasksFor(checklistId: string): ChecklistTask[]
  /** Every task of several plans at once, for the dashboard's tallies. */
  tasksForMany(checklistIds: readonly string[]): ChecklistTask[]
  findTaskById(id: string): ChecklistTask | null
  insertTask(task: ChecklistTask): void
  updateTask(task: ChecklistTask): void
  deleteTask(id: string): void
  countTasks(checklistId: string): number
  /** One past the highest `sort_order` among a task's siblings. */
  nextSortOrder(checklistId: string, parentId: string | null): number
}

// ---------------------------------------------------------------------------

export interface TagRepository {
  /** Creates any tag that does not exist yet, then returns all their ids. */
  ensureAll(names: string[]): string[]
  listForItem(itemId: string): string[]
  setForItem(itemId: string, tagIds: string[]): void
  /** Deletes tags no item references any more. */
  pruneOrphans(): void
}

// ---------------------------------------------------------------------------

export interface AssetRepository {
  listForItem(itemId: string): Asset[]
  findById(id: string): Asset | null
  findByChecksum(itemId: string, checksum: string): Asset | null
  insert(asset: Asset): void
  /**
   * Narrow on purpose: editing a document changes its bytes, never its
   * identity or its location. A general `update` would make `rel_path`
   * writable, and a moved path with a live file behind it is DI-6 gone.
   */
  updateContent(id: string, sizeBytes: number, checksum: string): void
  delete(id: string): void
  nextSortOrder(itemId: string): number
}

// ---------------------------------------------------------------------------

/**
 * Everything that touches the vault directory. Kept separate from the
 * repositories because a file write is not transactional with SQLite, and the
 * services need to reason about that explicitly.
 */
export interface AssetStore {
  /** Absolute path to the vault root. */
  readonly rootDir: string
  readonly assetsDir: string

  /**
   * Copies `sourcePath` into the vault and returns the POSIX-style path
   * relative to the vault root, together with size and checksum.
   *
   * `itemCreatedAt` — not the asset's own timestamp — decides the directory,
   * so every file belonging to one item stays in one folder.
   */
  put(input: {
    sourcePath: string
    assetId: string
    itemId: string
    itemCreatedAt: string
    filename: string
  }): Promise<{ relPath: string; sizeBytes: number; checksum: string }>

  /**
   * Writes a document typed in the editor, as a new file. Same naming and
   * layout as `put` — once written there is nothing to distinguish it from an
   * uploaded file, which is the whole design.
   */
  putText(input: {
    assetId: string
    itemId: string
    itemCreatedAt: string
    filename: string
    contents: string
  }): Promise<{ relPath: string; sizeBytes: number; checksum: string }>

  /**
   * Rewrites an existing text file in place, and the only operation in the
   * application that modifies a stored asset.
   *
   * Written to a temporary name and renamed over the target, so a reader — a
   * backup running against a live vault, most importantly — sees either the
   * old file or the new one and never a half-written one.
   */
  replaceText(relPath: string, contents: string): Promise<{ sizeBytes: number; checksum: string }>

  /** Resolves a vault-relative path to an absolute one, refusing escapes. */
  resolve(relPath: string): string

  read(relPath: string): Promise<Buffer>
  readText(relPath: string): Promise<string>
  exists(relPath: string): Promise<boolean>
  remove(relPath: string): Promise<void>
  /** Removes an item's whole directory, if it still exists. */
  removeItemDir(itemId: string, itemCreatedAt: string): Promise<void>

  /** Writes the human-readable sidecar used to rebuild the index. */
  writeSidecar(itemId: string, itemCreatedAt: string, payload: unknown): Promise<void>
}

// ---------------------------------------------------------------------------

/**
 * The note half of the vault: one Markdown or text file per note, with the
 * metadata in YAML front matter.
 *
 * Notes are the only content in the application that has no uploaded file
 * behind it, so without this they would exist in `knowledge.db` and nowhere
 * else — the one kind of data a lost index would actually lose. The mirror is
 * best-effort and written after the transaction commits, exactly like
 * `item.json`. See docs/06-storage-layout.md#notes.
 */
export interface NoteStore {
  readonly notesDir: string

  /**
   * Writes the note's file and removes the one it replaces — the name carries
   * the title and the extension carries the format, so both move when the user
   * edits them. Returns the vault-relative path actually used, which may carry
   * a `-2` suffix if the slugged name was taken.
   */
  write(input: {
    noteId: string
    noteCreatedAt: string
    filename: string
    contents: string
    previousRelPath?: string
  }): Promise<string>

  /** Removes the note's file. Safe when there is none. */
  remove(noteId: string, noteCreatedAt: string, relPath?: string): Promise<void>
}

// ---------------------------------------------------------------------------

/** Read-only facts about the vault, for the Settings screen. */
export interface VaultRepository {
  info(): Omit<VaultInfo, 'dataDir' | 'databasePath' | 'assetsDir' | 'totalAssetBytes'>
}
