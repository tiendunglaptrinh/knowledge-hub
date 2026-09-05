# 05 · IPC contract

There is no HTTP server here, so `ipcMain.handle` channels play the role REST endpoints play in
a web application. Treating them as a versioned contract — rather than as ad-hoc callbacks — is
what keeps the renderer swappable and the main process reviewable.

Authoritative definition: `src/shared/ipc.ts`.

---

## Three things, one file

```ts
export const IpcChannel = { categoryList: 'category:list', ... } as const

export interface ApiMap {
  [IpcChannel.categoryList]: { req: void; res: CategorySummary[] }
  ...
}

export interface KnowledgeHubBridge { category: { list(): ... }, ... }
```

Both sides derive from `ApiMap`. Registering a handler that returns the wrong shape is a
compile error; calling a channel with the wrong payload is a compile error; adding a channel to
the map and forgetting to implement it is a compile error. That last one is the reason the map
exists at all.

---

## The envelope

```ts
type Result<T> = { ok: true; data: T } | { ok: false; error: SerializedError }
```

**Handlers never reject.** An expected failure comes back as `{ ok: false }`, so the renderer
has one branch to write rather than a `try`/`catch` around every call. `unwrap()` in
`renderer/src/lib/bridge.ts` converts the failure branch into a `BridgeError` at the point the
caller wants an exception.

An `AppError` thrown in a service crosses intact — code, message and details. Anything else is
a bug: its message could contain a filesystem path or a stack trace, so the renderer receives
`UNKNOWN` and the detail goes only to the log.

```ts
function serialize(channel: string, error: unknown): SerializedError {
  if (error instanceof AppError) { logger.warn(...); return { code, message, details } }
  logger.error(`${channel} -> unhandled: ${stack}`)
  return { code: ErrorCode.UNKNOWN, message: 'unexpected error; see the application log' }
}
```

---

## Channels

### Categories

| Channel | Request | Response | Notes |
|---|---|---|---|
| `category:list` | — | `CategorySummary[]` | Includes `itemCount`; ordered by `sortOrder`, then name |
| `category:create` | `CreateCategoryInput` | `CategorySummary` | Colour and icon optional |
| `category:update` | `UpdateCategoryInput` | `CategorySummary` | Partial; omitted fields are unchanged |
| `category:delete` | `{ id }` | `{ id }` | `CATEGORY_NOT_EMPTY` if it still holds items |

### Items

| Channel | Request | Response | Notes |
|---|---|---|---|
| `item:listByCategory` | `{ categoryId }` | `ItemSummary[]` | Newest-updated first |
| `item:recent` | `{ limit? }` | `ItemSummary[]` | Default 30, capped at 200 |
| `item:get` | `{ id }` | `ItemDetail` | Includes category, assets and tags |
| `item:create` | `CreateItemInput` | `ItemDetail` | Copies `filePaths` into the vault |
| `item:update` | `UpdateItemInput` | `ItemDetail` | Partial; `tags` omitted means unchanged, `[]` means clear |
| `item:delete` | `{ id }` | `{ id }` | Removes the item's files and index rows |
| `item:search` | `SearchInput` | `ItemSummary[]` | Default 50, capped at 200 |

### Notes

| Channel | Request | Response | Notes |
|---|---|---|---|
| `note:list` | `NoteListInput` | `NoteSummary[]` | Optional `kind` and `query` filters. Default 100, capped at 500 |
| `note:get` | `{ id }` | `Note` | The only channel that returns a note's body |
| `note:create` | `CreateNoteInput` | `Note` | `NOTE_DUE_REQUIRED` when `kind` is `deadline` and `dueAt` is absent |
| `note:update` | `UpdateNoteInput` | `Note` | Partial; see the three-state `dueAt` below |
| `note:delete` | `{ id }` | `{ id }` | Removes the row, the index entry and the file in the vault |

**`note:list` omits the body.** It returns the first 280 characters as `excerpt` and the full
length as `contentLength`, both computed in SQL. A hundred notes of a few kilobytes each is a
megabyte of structured-clone traffic to render cards that show three lines.

**`dueAt` on `UpdateNoteInput` has three states, and they all mean different things.** Absent
leaves the date alone, `null` clears it, a string sets it. `done` behaves the same way: absent
changes nothing, `true` stamps `doneAt` if it is not already set, `false` clears it. Collapsing
absent and `null` would make every metadata edit silently drop the deadline.

**Dates are normalised on the way in.** Whatever the caller sends is parsed and re-emitted as an
ISO-8601 UTC string, because the list is ordered by string comparison on that column.

### Checklists

| Channel | Request | Response | Notes |
|---|---|---|---|
| `checklist:list` | `ChecklistListInput` | `ChecklistSummary[]` | Optional `kind` and inclusive `from`/`to` day bounds. Default 100, capped at 500 |
| `checklist:get` | `{ id }` | `ChecklistDetail` | The plan with its task tree and its percentage |
| `checklist:getByDay` | `{ day }` | `ChecklistDetail \| null` | `null`, not an error — "today has no plan yet" is an ordinary state |
| `checklist:create` | `CreateChecklistInput` | `ChecklistDetail` | The plan *and* its tasks, in one transaction |
| `checklist:update` | `UpdateChecklistInput` | `ChecklistDetail` | Metadata only; a daily plan's date is fixed once created |
| `checklist:delete` | `{ id }` | `{ id }` | Cascades to every task |
| `checklist:stats` | `ChecklistStatsInput` | `ChecklistStats` | Daily half bounded by the range; module half is not |
| `checklist:taskAdd` | `AddChecklistTaskInput` | `ChecklistDetail` | `parentId` set adds a sub-task |
| `checklist:taskUpdate` | `UpdateChecklistTaskInput` | `ChecklistDetail` | Partial; three-state fields as below |
| `checklist:taskDelete` | `{ id }` | `ChecklistDetail` | `CHECKLIST_EMPTY` when it is the last top-level task |
| `checklist:taskMove` | `MoveChecklistTaskInput` | `ChecklistDetail` | Reorders within one priority group |

**Creating a plan and filling it is one call.** A checklist may not exist without at least one
task, so a two-call flow — create, then add — would have to pass through the state the rule
forbids. It also means an abandoned wizard leaves nothing behind.

**Every task channel answers with the whole plan, not the task it touched.** Ticking one
sub-task can change its parent's status, the plan's percentage and the dashboard's tally at
once; a response carrying one task would leave the renderer to guess at the other three, which
is how two numbers on one screen start disagreeing.

**`checklist:stats` does not filter module plans by the range.** A two-month plan is relevant on
every day of those two months, so hiding it when the user switches from *Tháng này* to *Tuần
này* would look like data loss. Only the daily half moves with the window.

**Days are `YYYY-MM-DD`, not timestamps.** `from`, `to` and `day` are calendar days in the
user's own timezone; see [04-data-model.md](04-data-model.md#checklists).

### Assets

| Channel | Request | Response | Notes |
|---|---|---|---|
| `asset:pick` | — | `PickedFile[]` | Native dialog; `[]` on cancel. Validates size and readability |
| `asset:add` | `AddAssetsInput` | `Asset[]` | Appends uploaded files to an existing item |
| `asset:compose` | `ComposeAssetInput` | `Asset` | Writes a typed document into the vault as a new asset |
| `asset:updateText` | `UpdateAssetTextInput` | `Asset` | Rewrites a `markdown` or `text` asset in place |
| `asset:delete` | `{ id }` | `{ id }` | Removes the row, then the file |
| `asset:render` | `{ id }` | `RenderedAsset` | See the rendering table below |
| `asset:openExternal` | `{ id }` | `null` | Hands the file to the OS default application |
| `asset:revealInFolder` | `{ id }` | `null` | Opens the containing folder, file selected |

**`item:create` takes both `filePaths` and `composed`**, and may take both at once. Uploads are
staged first, typed documents second, and they end up in one list of rows that nothing
downstream distinguishes. See [ADR 0009](adr/0009-compose-documents-in-app.md).

**Typed text *does* cross IPC**, which is the one exception to
[why paths, not buffers](#why-paths-not-buffers) below. It has no path to send — it exists only
in the renderer until it is saved — and it is bounded at 5 MB, against 200 MB for an upload.

**`asset:updateText` refuses anything but `markdown` and `text`** with `ASSET_NOT_EDITABLE`.
The rule is in `AssetService.requireEditable`, not in the UI: hiding the button is a courtesy,
the service is the mechanism.

### Vault

| Channel | Request | Response |
|---|---|---|
| `vault:info` | — | `VaultInfo` — paths (including `notesDir`), counts (including `noteCount`), total bytes, schema version |
| `vault:openFolder` | — | `null` |

---

### Updates

| Channel | Request | Response | Notes |
|---|---|---|---|
| `update:get` | — | `UpdateState` | For a renderer that has just mounted |
| `update:check` | — | `UpdateState` | Resolves when the check *starts*, not when it finishes |
| `update:download` | — | `UpdateState` | `UPDATE_NOT_READY` unless an update is waiting |
| `update:install` | — | `null` | Quits the application; the promise never settles |

**`update:state` is the one channel that travels the other way.** Everything else here is
request/response, because the renderer always knows when it wants something. An update does not
work that way — the feed answers when it answers, and a download reports progress several times
a second. So it is a push, sent with `webContents.send`, and it lives in `IpcEvent` rather than
`IpcChannel`: `ApiMap` describes calls that return a `Result`, and this returns nothing to
anyone.

```ts
// renderer
const unsubscribe = bridge().update.onStateChange((state) => …)
```

The preload wraps the listener rather than handing it to `ipcRenderer.on` directly, so the
renderer never receives Electron's `IpcRendererEvent` — that object carries `sender`, and giving
a renderer a route back to the main process would undo the point of
[07-security.md](07-security.md). The wrapper is also why `onStateChange` returns its own
unsubscribe: `removeListener` needs the wrapper, which the caller has no way to name.

**`update:check` deliberately does not wait for the answer.** A renderer awaiting the round trip
would sit on a spinner for the length of a network timeout. It gets the `checking` state
immediately and the outcome on the event.

## Why paths, not buffers

`asset:pick` returns absolute filesystem **paths**. `item:create` and `asset:add` take those
paths, and the main process performs the copy.

This is about *files*. Text typed in the editor is the deliberate exception, described under
[Assets](#assets) above.

The alternative — reading the file in the renderer and sending an `ArrayBuffer` — would mean
serialising up to 200 MB through the structured-clone algorithm, holding it in memory twice, and
giving the renderer a reason to read files, which is precisely the capability the sandbox
exists to withhold.

Passing a path means the renderer names a file it cannot itself open. The main process still
validates everything: that the path is a regular file, that it is readable, that it is within
the size limit. A path is a request, not an authorisation.

Drag-and-drop uses the same route. Electron 32 removed `File.path`; `webUtils.getPathForFile`
in the preload is the supported replacement and the only reason `webUtils` is imported there.

---

## Rendering

`asset:render` returns a discriminated result. What comes back depends on the kind:

| Kind | Field | Who does the work |
|---|---|---|
| `pdf`, `image` | `url` — `app://asset/<relPath>` | Chromium, streaming from the protocol handler |
| `word` | `html` | mammoth, in the main process; sanitised in the renderer |
| `markdown` | `text` — the source | Parsed **and** sanitised in the renderer |
| `text` | `text` | Shown verbatim |
| `other` | — | No viewer; the UI offers *open externally* |

**Markdown is deliberately not parsed in the main process.** Sending source rather than HTML
keeps the parser and the sanitiser on the same side of the boundary, so there is never a moment
where unsanitised HTML exists as a string that some future code path might render directly.

**PDFs are not sent through IPC at all.** A 50 MB file base64'd into a message would be absurd;
the protocol handler streams it, and range requests work, which is what the PDF viewer needs to
page through a large document.

---

## Error codes

`UPPER_SNAKE_CASE`, prefixed with the resource. Defined in `src/shared/errors.ts`.

| Code | Meaning |
|---|---|
| `UNKNOWN` | Unexpected; detail is in the log only |
| `VALIDATION_FAILED` | Generic input rejection |
| `CATEGORY_NOT_FOUND` · `CATEGORY_NAME_REQUIRED` · `CATEGORY_NAME_TOO_LONG` · `CATEGORY_NAME_DUPLICATE` · `CATEGORY_NOT_EMPTY` | |
| `ITEM_NOT_FOUND` · `ITEM_TITLE_REQUIRED` · `ITEM_TITLE_TOO_LONG` | |
| `NOTE_NOT_FOUND` · `NOTE_TITLE_REQUIRED` · `NOTE_TITLE_TOO_LONG` | |
| `NOTE_DUE_INVALID` | The string sent as `dueAt` is not a date `Date` can parse |
| `NOTE_DUE_REQUIRED` | A `deadline` note was created or left without a `dueAt` |
| `CHECKLIST_NOT_FOUND` · `CHECKLIST_TITLE_REQUIRED` · `CHECKLIST_TITLE_TOO_LONG` | |
| `CHECKLIST_TITLE_NOT_ALLOWED` | A daily plan was given a title; the date names it |
| `CHECKLIST_DAY_REQUIRED` · `CHECKLIST_DAY_INVALID` | Missing, malformed, or a date that does not exist (`2026-02-31`) |
| `CHECKLIST_DAY_TAKEN` | That day already has a plan; add to it instead |
| `CHECKLIST_EMPTY` | A checklist was created with no tasks, or its last task was deleted |
| `CHECKLIST_TOO_MANY_TASKS` | Over 500 tasks in one plan |
| `CHECKLIST_DUE_INVALID` | The string sent as `dueAt` is not a date `Date` can parse |
| `CHECKLIST_TASK_NOT_FOUND` · `CHECKLIST_TASK_TITLE_REQUIRED` · `CHECKLIST_TASK_TITLE_TOO_LONG` | |
| `CHECKLIST_TASK_NESTING_TOO_DEEP` | A sub-task cannot own sub-tasks |
| `CHECKLIST_TASK_MOVE_INVALID` | Dropped onto a task in another plan or under another parent |
| `CHECKLIST_TASK_PRIORITY_MISMATCH` | Dropped onto a task of a different rank |
| `ASSET_NOT_FOUND` · `ASSET_FILE_MISSING` · `ASSET_TOO_LARGE` · `ASSET_UNREADABLE` · `ASSET_RENDER_FAILED` | |
| `ASSET_NAME_REQUIRED` | A composed document was given a name that is empty after trimming |
| `ASSET_NOT_EDITABLE` | The editor was pointed at something that is not Markdown or plain text |
| `UPDATE_CHECK_FAILED` · `UPDATE_DOWNLOAD_FAILED` | The feed or the download could not be reached |
| `UPDATE_NOT_READY` | Asked to download or install when nothing is waiting |
| `UPDATE_UNSUPPORTED` | This build cannot update itself — development, `--dir`, or portable |
| `VAULT_UNWRITABLE` · `VAULT_PATH_ESCAPE` | |

### The message rule

**The `message` field is for the developer and the log. No screen ever renders it.**

The interface is Vietnamese and the codebase is English. A message that crossed the wire would
either be the wrong language on screen or would freeze Vietnamese display text into the API
contract. So the main process returns a `code`, and `renderer/src/lib/messages.ts` maps it to
Vietnamese.

**Adding a code to `errors.ts` and adding its entry to `messages.ts` happen in the same
commit.** A code with no entry falls back to the generic `UNKNOWN` text, which is a silent
degradation rather than a visible failure — so the discipline has to come from the commit, not
from the compiler.

---

## Adding a channel

1. `src/shared/ipc.ts` — add to `IpcChannel`, to `ApiMap`, and to `KnowledgeHubBridge`
2. `src/preload/preload.ts` — one line: `invoke(IpcChannel.thing, payload)`
3. `src/main/ipc/register.ts` — one `handle(...)` calling one service method
4. The service — where the actual rule goes
5. Any new error code → `errors.ts` **and** `messages.ts`
6. This document

Steps 1 and 3 are checked by the compiler. Steps 5 and 6 are not, which is why they are written
down.

---

## What is deliberately absent

**No generic `invoke(channel, payload)` escape hatch.** It would make the preload one line
long, and it would make the answer to "what can the renderer do?" unbounded. Twenty-six named
methods are the whole surface, and that is the point.

**No events from main to renderer.** Nothing outside the application changes the data, so there
is nothing to push. If file-watching ever arrives, that changes — and it should be an ADR, not
a quiet addition.
