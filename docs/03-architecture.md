# 03 · Architecture

## The shape

Two operating-system processes, one contract between them.

```
┌─────────────────────────────────────────────────────────────────────┐
│  RENDERER PROCESS            Chromium, sandboxed, no Node           │
│                                                                     │
│   renderer/src/app        one route, client-side views              │
│   renderer/src/components Sidebar · ItemGrid · ItemDetailPane ·     │
│                           NoteGrid · NoteEditorPane · AssetViewer · │
│                           ChecklistDashboard · ChecklistDetailPane ·│
│                           dialogs · SettingsPane                    │
│   renderer/src/lib        store.tsx (reducer) · bridge · messages   │
│                                                                     │
│                    window.knowledgeHub  ← the ONLY way out          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │  contextBridge, 40 fixed methods
┌───────────────────────────────┴─────────────────────────────────────┐
│  PRELOAD          isolated context, no require, no fs               │
│  src/preload/preload.ts      one ipcRenderer.invoke per method      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │  ipcMain.handle
┌───────────────────────────────┴─────────────────────────────────────┐
│  MAIN PROCESS                 full Node                             │
│                                                                     │
│   src/main/ipc/register.ts    ── thin handlers, Result envelope     │
│           ↓                                                          │
│   src/modules/*               ── SERVICES: all business rules       │
│      category · item · note · checklist · asset · document ·        │
│      vault · update                                                 │
│           ↓ depends on interfaces, not implementations              │
│   src/core/ports              ── repository + store interfaces      │
│   src/core/domain             ── pure: slug, asset kind, note,      │
│                                  checklist ranking, ids             │
│           ↑ implemented by                                          │
│   src/storage/sqlite/*        ── SQL only                           │
│   src/storage/fs/*            ── the vault on disk                  │
│                                                                     │
│   src/main/container.ts       ── composition root, the only `new`   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
        knowledge.db      assets/YYYY/MM/<itemId>/      notes/YYYY/MM/
```

`src/shared` sits outside this stack and is imported by both processes: DTO types, channel
names, the request/response map, and error codes.

---

## Why two processes, and why this hard a line

Electron gives you the split whether you want it or not. What is a choice is how much crosses
it. Here the answer is: only data, never capability.

The renderer cannot read a file, open a database, or spawn anything. It can call twenty-six named
operations. That means the interesting question — "what can a bug in the UI do?" — has a
bounded answer you can read in one file (`src/preload/preload.ts`), rather than an answer that
depends on what happens to be imported where.

The cost is that every capability must be designed as an operation. That is a feature: it is
what makes the IPC surface reviewable at all.

---

## Layer rules

These are the rules that keep the main process from turning into one large file of callbacks.
A change that breaks one should either be reverted or be argued for in an ADR.

### L-1 · Services own all business rules

Validation, authorisation, cross-entity coordination, ordering — all in `src/modules/*`. Never
in an IPC handler, never in a repository.

*Why:* a rule that lives in a handler is a rule that only applies when reached through that
handler. `ItemService.delete` must behave the same whether it is called by IPC, by a future CLI
command, or by the recovery tool.

### L-2 · IPC handlers are thin

Bind the payload, call one service method, return. No queries, no branching on business state.
The whole of `src/main/ipc/register.ts` should stay readable in one screen per resource.

### L-3 · Repositories only do data access

SQL in, rows out, mapped to DTOs. No decisions. `SqliteCategoryRepository` does not know that a
non-empty category cannot be deleted; `CategoryService` does.

### L-4 · `src/core` imports nothing concrete

No `electron`, no `better-sqlite3`, no `node:fs`. It holds the port interfaces and pure domain
functions. This is what makes the services testable without a database and what would make
swapping SQLite a contained change.

The rule is enforceable by eye: if a file under `src/core` grows an import from `src/storage`,
the dependency arrow has been reversed.

### L-5 · The composition root is the only place that constructs

`src/main/container.ts` is the only file containing `new SqliteItemRepository(...)` and
friends. Services receive collaborators as constructor arguments.

*Why:* a service that constructs its own repository has hard-coded its storage engine and
cannot be exercised in isolation. It also hides the startup order, which here genuinely matters
— the vault must be provably writable before SQLite opens a file inside it.

### L-6 · Mapping happens at the boundary

snake_case columns become camelCase DTO fields in `src/storage/sqlite/rows.ts`, and nowhere
else. A column rename must not be visible above the repository.

---

## Transactions

The rule: **the transaction is synchronous, and everything asynchronous happens outside it.**

better-sqlite3 is a synchronous binding. `db.transaction(fn)` runs `fn` to completion between
`BEGIN` and `COMMIT`. If `fn` were `async`, the transaction would commit at the first `await`
and the remaining writes would land outside it — silently.

So every mutating service method has three phases:

```ts
// 1. async, outside — validate, copy files, extract text for the index
const staged = await this.assetService.stage(item.id, item.createdAt, filePaths, 0)
const body   = await this.indexBody(staged.map((s) => s.asset))

// 2. sync, inside one transaction — every database write
try {
  this.uow.run(() => {
    this.items.insert(item)
    this.applyTags(item.id, tags)
    for (const { asset } of staged) this.assetRepo.insert(asset)
    this.items.reindex(item.id, title, summary ?? '', body)
  })
} catch (error) {
  await this.assetService.discard(staged)   // unwind the copies
  throw error
}

// 3. async, after commit — the sidecar, best-effort
await this.writeSidecar(detail)
```

`UnitOfWork.run` is deliberately typed as synchronous (`run<T>(work: () => T): T`) so that
putting an `await` inside it is a compile error rather than a subtle data bug.

Nested `uow.run` calls are safe: better-sqlite3 turns an inner transaction into a `SAVEPOINT`,
which is why `ItemService.create` can call `TagRepository.setForItem` — itself transactional —
without tracking depth.

---

## Composition root and startup order

`createContainer` enforces an order that matters:

1. **Resolve configuration.** Where is the vault? `KB_DATA_DIR`, else a documented default.
2. **Create and probe the vault.** `FsAssetStore.init()` creates the directory *and writes a
   probe file*. A vault on an unwritable path fails here, with `VAULT_UNWRITABLE`, rather than
   at the moment the user first tries to save something.
3. **Open SQLite and migrate.** Creating the database file inside a directory that has already
   been proven writable.
4. **Wire services.**

Reversing 2 and 3 would produce the worst failure mode available: a database created
successfully in a directory where assets cannot be written, so the application starts fine and
breaks on first upload.

---

## The renderer

Deliberately boring. One reducer in `renderer/src/lib/store.tsx`, one provider, no state
library.

The rule that earns its keep: **components never call the bridge for a mutation.** They call an
action on the store; the store calls the bridge and refreshes whatever the mutation invalidated.
Creating an item has to update the grid *and* the sidebar's item count — enforcing that in one
place is the difference between it always happening and it usually happening.

Reads that only the calling component cares about are the exception: `AssetViewer` calls
`asset.render` directly, because nothing else needs the result.

Three details worth knowing:

- **Stale-response guard.** Each list load takes a token; a response whose token is no longer
  current is dropped. Without it, clicking two categories quickly can leave the slower response
  painting over the faster one. Items, notes and checklists have separate tokens, since they
  load independently.
- **Changing view clears the detail pane, the note editor and the open checklist.** Otherwise
  clicking a category while reading a document leaves two panes describing different things.
- **The sidebar's collapsed state is the one piece of UI state that outlives the process.** It
  is written to `localStorage` by the store's `toggleSidebar`, and read back in an effect after
  the first paint rather than in the initial reducer state — reading storage during the first
  render would disagree with the HTML Next's static export ships.

---

## Why one package instead of a workspace monorepo

The directory layout suggests separate packages: `src/core`, `src/storage`, `src/modules`,
`renderer`. They are not npm workspaces, and that is deliberate.

`better-sqlite3` is a native module that `electron-builder install-app-deps` rebuilds against
Electron's ABI, and then `electron-builder` must unpack from the asar at exactly the right path.
Workspace hoisting moves that binary somewhere neither step expects. The failure is not a
compile error — it is a packaged application that starts and then cannot open its database.

The boundaries that matter here are enforced by the dependency rules above (L-1 to L-6), not by
`package.json` files. If the project outgrows one package, extracting workspaces is mechanical
precisely because the arrows already point the right way.

Recorded as [ADR 0003](adr/0003-single-package-layered.md).

---

## Where to add things

| Adding | Touch |
|---|---|
| A field on an entity | `src/shared/types.ts` → migration → `rows.ts` → repository → service → UI |
| A new viewer format | `core/domain/asset-kind.ts` → `DocumentService.render` → `AssetViewer` |
| A new operation | `shared/ipc.ts` (channel + `ApiMap` + bridge interface) → `preload.ts` → `ipc/register.ts` → service |
| A new error case | `shared/errors.ts` → throw in the service → `renderer/src/lib/messages.ts` |
| A new entity | `core/ports` → migration → `storage/sqlite` → `modules/<entity>` → `container.ts` → IPC → UI |

Adding an IPC channel without implementing it is a compile error, because `ApiMap` and the
handler registration are typed against each other. That is the point of the map.
