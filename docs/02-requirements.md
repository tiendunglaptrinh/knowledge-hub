# 02 · Requirements

Status values: **Built** — implemented and covered by `npm run smoke` or a screenshot.
**Planned** — see [11-roadmap.md](11-roadmap.md). Nothing here is marked Built unless it
actually is.

---

## Functional requirements

### FR-1 Categories

| # | Requirement | Status |
|---|---|---|
| FR-1.1 | The user can create a category with a name, an icon and a colour. | Built |
| FR-1.2 | Category names are unique, case-insensitively. `AI` and `ai` collide. | Built |
| FR-1.3 | A name is 1–60 characters after trimming and whitespace collapsing. | Built |
| FR-1.4 | Each category carries a URL-safe slug derived from its name, with Vietnamese diacritics transliterated (`Tiếng Anh` → `tieng-anh`). Collisions get a numeric suffix. | Built |
| FR-1.5 | Omitting a colour assigns one from a fixed palette, round-robin, so a new vault looks organised without asking. | Built |
| FR-1.6 | The category list shows each category's item count. | Built |
| FR-1.7 | Deleting a category that still holds items is refused with `CATEGORY_NOT_EMPTY`. | Built |
| FR-1.8 | A category can be renamed and recoloured. | Built (service); no UI yet |
| FR-1.9 | Categories can nest. | Planned — schema carries `parent_id`, always `NULL` |

### FR-2 Items

| # | Requirement | Status |
|---|---|---|
| FR-2.1 | The user can create an item with a title, an optional summary, tags and files. | Built |
| FR-2.2 | A title is 1–200 characters after trimming. | Built |
| FR-2.3 | Every item belongs to exactly one category. | Built |
| FR-2.4 | Tags are free text, global across categories, matched case-insensitively, deduplicated on save. | Built |
| FR-2.5 | Deleting an item deletes its files and its index entries. | Built |
| FR-2.6 | An item can be moved to another category, retitled, and its tags changed. | Built — **Sửa thông tin** on the item detail header |
| FR-2.7 | Items are listed newest-updated first. | Built |
| FR-2.8 | An item can be created with a document written in the app instead of an uploaded file. | Built |

### FR-3 Files

| # | Requirement | Status |
|---|---|---|
| FR-3.1 | Files are chosen through the native OS dialog, with multi-select. | Built |
| FR-3.2 | Files can be added by dragging them onto the upload dialog. | Built |
| FR-3.3 | An uploaded file is **copied**, never moved. The user's original survives. | Built |
| FR-3.4 | A single file may not exceed 200 MB. | Built |
| FR-3.5 | Files can be added to and removed from an existing item. | Built |
| FR-3.6 | Every stored file records size and a SHA-256 checksum. | Built |
| FR-3.7 | Any file can be handed to the OS default application, or revealed in the file manager. | Built |
| FR-3.8 | A Markdown or plain-text document can be written inside the application, with the source and a live rendered review side by side. | Built |
| FR-3.9 | A written document becomes an ordinary asset: same directory, same checksum, same search index, same viewer. Nothing records where its bytes came from. | Built — [ADR 0009](adr/0009-compose-documents-in-app.md) |
| FR-3.10 | Any stored Markdown or text file can be edited in place, including one that was uploaded. | Built |
| FR-3.11 | Editing refuses formats with no round trip (`pdf`, `docx`, images) at the service, not just in the UI. | Built — `ASSET_NOT_EDITABLE` |
| FR-3.12 | A save never leaves a partially written file where a reader could see one. | Built — temp file plus atomic `rename` |
| FR-3.13 | Text typed in the editor is capped at 5 MB. | Built |
| FR-3.14 | Files are stored under a readable name derived from the document, not under an opaque id. | Built |
| FR-3.15 | The name the user chose is preserved and is what the interface shows, whatever the file is called on disk. | Built — `assets.filename` |
| FR-3.16 | Two documents whose names reduce to the same stored name never overwrite each other. | Built — `-2`, `-3` suffixes |
| FR-3.17 | An existing vault can be brought to the readable scheme without losing data. | Built — `npm run tidy:filenames` |
| FR-3.18 | An edited document keeps a history of earlier versions. | Not planned for now — R-10 |

### FR-4 Viewing

| # | Requirement | Status |
|---|---|---|
| FR-4.1 | PDFs render inline, with the built-in viewer's paging and zoom. | Built |
| FR-4.2 | `.docx` renders as formatted HTML, preserving headings, lists, tables and embedded images. | Built |
| FR-4.3 | Markdown renders with GitHub-flavoured syntax: tables, code blocks, blockquotes. | Built |
| FR-4.4 | Plain text and source files render verbatim in a monospace pane. | Built |
| FR-4.5 | Images render scaled to fit. | Built |
| FR-4.6 | A format with no viewer shows the file's details and an *open externally* action, never an error. | Built |
| FR-4.7 | Conversion warnings (e.g. a Word style mammoth could not map) are shown, collapsed, not hidden. | Built |
| FR-4.8 | Legacy `.doc` renders in-app. | Not planned — see [ADR 0006](adr/0006-document-rendering.md) |

### FR-5 Search

| # | Requirement | Status |
|---|---|---|
| FR-5.1 | One search box queries titles, summaries and extracted document text. | Built |
| FR-5.2 | Search is diacritic-insensitive: `ghi chu` finds `ghi chú`. | Built |
| FR-5.3 | The final term is prefix-matched, so results narrow as you type. | Built |
| FR-5.4 | Search can be scoped to a category. | Built (service); UI searches globally |
| FR-5.5 | Characters that are FTS5 operators are treated as literal text, never as syntax. A stray `"` must not produce an error. | Built |
| FR-5.6 | Text inside a PDF is searchable. | Planned — see [11-roadmap.md](11-roadmap.md) |

### FR-6 Storage and transparency

| # | Requirement | Status |
|---|---|---|
| FR-6.1 | The vault location is configurable through `KB_DATA_DIR`. | Built |
| FR-6.2 | A settings screen shows the resolved data directory, database path, assets directory and notes directory. | Built |
| FR-6.3 | That screen reports counts and total stored bytes. | Built |
| FR-6.4 | The vault directory can be opened in the OS file manager in one click. | Built |
| FR-6.5 | Every item writes an `item.json` sidecar next to its files. | Built |
| FR-6.6 | Every note writes a readable `.md`/`.txt` mirror with metadata in front matter. | Built |
| FR-6.7 | A command rebuilds the index from the sidecars. | Planned — the sidecars exist and carry enough data; the command does not |

### FR-7 Distribution and first run

Requirements that only exist because the application is meant to be installable by people other
than its author. Full detail in [13-distribution.md](13-distribution.md).

| # | Requirement | Status |
|---|---|---|
| FR-7.1 | An installed copy stores its vault where the running user can write, with no configuration. | Built — defaults to the OS per-user data directory |
| FR-7.2 | Two accounts on one machine get separate vaults. | Built — same mechanism |
| FR-7.3 | Uninstalling never deletes the user's documents. | Built — the vault is outside the install directory |
| FR-7.4 | Running the application requires no terminal, no `.env` and no Node installation. | Built — every value has a working default |
| FR-7.5 | Portable mode (vault beside the executable) is available, opt-in via a `portable.txt` marker. | Built |
| FR-7.6 | The first launch of an empty vault explains what to do. | Built — empty states are action-led |
| FR-7.7 | Installers are signed, so no unknown-publisher warning appears. | Not done — R-15 |
| FR-7.8 | The application can update itself. | Not done — R-16 |
| FR-7.9 | Logs are written to a file a user can find and send. | Not done — R-13 |
| FR-7.10 | Opening a vault written by a newer version fails with a clear message rather than a query error. | Not done — R-14 |

### FR-8 Notes

A note is written in the application rather than uploaded to it. It has no category, no tags
and no attachments — see [04-data-model.md](04-data-model.md#entities) for why it is not an
item.

| # | Requirement | Status |
|---|---|---|
| FR-8.1 | The user can create a note with a title, a kind and a format. | Built |
| FR-8.2 | A title is 1–200 characters after trimming. | Built |
| FR-8.3 | The format is `markdown` or `text`, chosen by the user and stored. | Built |
| FR-8.4 | The kind is one of eight: học tập, nhật ký, hạn chót, việc cần làm, ý tưởng, cuộc họp, đoạn mã, khác. | Built |
| FR-8.5 | A note may carry a due date, and a `deadline` note must. | Built — `NOTE_DUE_REQUIRED` |
| FR-8.6 | Notes with a due date sort above those without, soonest first, so a deadline surfaces itself. | Built — in `ORDER BY`, not in the UI |
| FR-8.7 | A note can be ticked off, and finished notes sort to the bottom. | Built |
| FR-8.8 | A Markdown note is edited in two sections: the source and a live rendered review. | Built |
| FR-8.9 | The review renders through the same parser and sanitiser as a stored `.md` file. | Built — `lib/markdown.ts` |
| FR-8.10 | The list can be filtered by kind and searched by text over title and body. | Built |
| FR-8.11 | Note search is diacritic-insensitive and prefix-matches the final term, like item search. | Built — shared `toMatchExpression` |
| FR-8.12 | Every note is mirrored to a `.md` or `.txt` file in the vault, with metadata in front matter. | Built |
| FR-8.13 | Renaming a note, or changing its format, moves its file and leaves no stale copy. | Built |
| FR-8.14 | Deleting a note removes its file from the vault. | Built |
| FR-8.15 | A note can be filed under a category or tagged. | Planned — see [11-roadmap.md](11-roadmap.md) |
| FR-8.16 | A due note produces a desktop notification. | Planned |

---

### FR-9 Checklists

A checklist is a plan the user commits to before the work starts, and ticks off while it
happens. Two kinds share one table and one screen: a **daily** plan, identified by its date,
and a **module** plan, identified by its title and ranked by the Eisenhower matrix.

| # | Requirement | Status |
|---|---|---|
| FR-9.1 | The user creates a checklist through a three-step flow: kind and metadata, then the tasks, then a confirmation. | Built — `ChecklistDialog` |
| FR-9.2 | A checklist cannot be created empty; it needs at least one task. | Built — `CHECKLIST_EMPTY` |
| FR-9.3 | A day holds at most one checklist. Adding work to a day means opening that day's plan. | Built — `ux_checklists_day` + `CHECKLIST_DAY_TAKEN` |
| FR-9.4 | A daily checklist has no title — the date names it. A module checklist must have one. | Built — schema `CHECK` + `CHECKLIST_TITLE_NOT_ALLOWED` |
| FR-9.5 | A module checklist may carry a description and a deadline. | Built |
| FR-9.6 | A task has a title, and optionally a short description and a deadline. | Built |
| FR-9.7 | A task's state is one of three: *Cần hoàn thiện*, *Đang làm*, *Đã xong*. | Built |
| FR-9.8 | A task in a daily plan is ranked *Cao* or *Thường*. | Built |
| FR-9.9 | A task in a module plan is ranked by the Eisenhower matrix: *Làm ngay*, *Lên lịch*, *Uỷ thác*, *Loại bỏ*. | Built |
| FR-9.10 | Tasks are always presented in rank order; the user never has to sort them. | Built — `compareTasks`, applied in the service |
| FR-9.11 | A big task can be broken into sub-tasks, one level deep. | Built — `CHECKLIST_TASK_NESTING_TOO_DEEP` |
| FR-9.12 | Ticking a sub-task updates its parent: all done means done, any movement means *Đang làm*. | Built — `statusFromChildren` |
| FR-9.13 | Ticking a big task ticks its whole break-down, and un-ticking it un-ticks the whole break-down. | Built |
| FR-9.14 | Completion is a percentage over *leaf* tasks, so breaking one task into three does not inflate the total. | Built |
| FR-9.15 | Tasks of equal rank can be reordered by dragging. | Built — `checklist:taskMove` |
| FR-9.16 | A task cannot be dragged above a task that outranks it. | Built — `CHECKLIST_TASK_PRIORITY_MISMATCH`, and the drop target refuses the gesture |
| FR-9.17 | Re-ranking a task moves it to the end of the group it arrives in. | Built |
| FR-9.18 | Deleting the last task of a checklist is refused; delete the checklist instead. | Built — `CHECKLIST_EMPTY` |
| FR-9.19 | Deleting a checklist removes every task under it. | Built — `ON DELETE CASCADE` |
| FR-9.20 | A dashboard reports, for the current week or month: how many daily plans exist, how many reached 100%, and the average completion. | Built — `checklist:stats` |
| FR-9.21 | The dashboard draws one bar per day of the window, including days with no plan. | Built |
| FR-9.22 | Module plans are shown regardless of the window, because a two-month plan is relevant on every day of those two months. | Built |
| FR-9.23 | Every figure on the dashboard is computed in the main process, never re-tallied in the UI. | Built |
| FR-9.24 | A checklist can repeat (daily / weekly recurrence). | Planned — see [11-roadmap.md](11-roadmap.md) |
| FR-9.25 | A task can be moved from one checklist to another. | Planned |
| FR-9.26 | An unfinished task rolls over to the next day automatically. | Planned |

---

### FR-10 Updates

The application checks whether a newer version of itself has been published, and tells the user.
It never acts on that without being asked.

| # | Requirement | Status |
|---|---|---|
| FR-10.1 | The running copy checks a release feed once, shortly after launch. | Built — 8 s after the window opens |
| FR-10.2 | The user can check on demand from Settings. | Built |
| FR-10.3 | Nothing is downloaded until the user asks. | Built — `autoDownload = false` |
| FR-10.4 | Nothing is installed until the user asks, including at quit. | Built — `autoInstallOnAppQuit = false` |
| FR-10.5 | A newer version is announced by a strip across the top, showing both versions. | Built |
| FR-10.6 | Download progress is visible. | Built — percentage in the strip and in Settings |
| FR-10.7 | The strip can be dismissed for the session, and returns next launch. | Built |
| FR-10.8 | States that need no decision — up to date, checking, failed — appear only in Settings. | Built |
| FR-10.9 | A build that cannot update itself says so rather than failing. | Built — `unsupported`, tested by the presence of `app-update.yml` |
| FR-10.10 | A failed check leaves the running version untouched and reports a code, not a stack. | Built — `UPDATE_CHECK_FAILED` |
| FR-10.11 | The installer is signed, so the update does not warn on every release. | Not done — see [13-distribution.md](13-distribution.md#code-signing-d-6) |
| FR-10.12 | An older application refuses a vault written by a newer one. | Planned — [11-roadmap.md](11-roadmap.md) R-14, and it matters more now |

---

## Non-functional requirements

### NFR-1 Data safety

| # | Requirement | How it is met |
|---|---|---|
| NFR-1.1 | No user action may leave a database row pointing at a file that does not exist. | Files are copied before the row is written; a failed transaction removes the copies. [ADR 0005](adr/0005-copy-then-insert.md) |
| NFR-1.2 | An item, its tags, its assets and its search entry commit together or not at all. | One synchronous SQLite transaction, with every `await` outside it. |
| NFR-1.3 | The vault survives uninstalling or reinstalling the application. | The vault is outside the application directory by construction. |
| NFR-1.4 | A corrupted or deleted index must not mean lost documents. | Files are stored unmodified with an `item.json` sidecar. |
| NFR-1.5 | Deleting a category cannot silently destroy documents. | Refused while non-empty, at both the service and the schema level. |
| NFR-1.6 | No content exists only in the index. | Uploaded files are copies; notes are mirrored to a text file with front matter; a written document *is* a file. |
| NFR-1.7 | Modifying a stored file cannot corrupt it, even if the application dies mid-save. | Written to a temporary name and `rename`d over the target — atomic within one filesystem. |
| NFR-1.8 | A maintenance tool that moves files cannot leave a row pointing at nothing. | Disk first, database second; a re-run repairs an interrupted pass. |

### NFR-2 Security

| # | Requirement | How it is met |
|---|---|---|
| NFR-2.1 | The renderer has no filesystem or Node access. | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. |
| NFR-2.2 | The renderer's reachable surface is a fixed, enumerable list. | Twenty-six preload methods, no generic invoke. [07-security.md](07-security.md) |
| NFR-2.3 | No path from the renderer may read outside the vault. | Every path resolves through `FsAssetStore.resolve`, which rejects traversal. Covered by a smoke check. |
| NFR-2.4 | HTML converted from a user document is sanitised before it reaches the DOM. | DOMPurify, with scripts, styles, frames and event handlers removed. |
| NFR-2.5 | External links open in the system browser, never in an Electron window. | `setWindowOpenHandler` denies, `will-navigate` is restricted to our own origin. |

### NFR-3 Performance

| # | Requirement | How it is met |
|---|---|---|
| NFR-3.1 | List views must not issue a query per row. | One projection query joins the category and aggregates asset count and tags. |
| NFR-3.6 | A list must not ship content it does not display. | `note:list` returns a 280-character excerpt and a length, both computed in SQL. |
| NFR-3.2 | Fingerprinting a large file must not hold it in memory. | SHA-256 over a stream. |
| NFR-3.3 | Reporting total vault size must not walk the directory tree. | Summed from `assets.size_bytes`; a recursive stat on a `/mnt/*` mount is visibly slow. |
| NFR-3.4 | Files above 2 MB are not text-indexed. | `MAX_INDEXED_TEXT_BYTES`, so one large log does not bloat the index. |
| NFR-3.5 | Every column used in `WHERE`, `JOIN` or `ORDER BY` is indexed. | See [04-data-model.md](04-data-model.md). |

### NFR-4 Maintainability

| # | Requirement | How it is met |
|---|---|---|
| NFR-4.1 | Business rules live in exactly one layer. | Services. IPC handlers are thin, repositories are dumb. |
| NFR-4.2 | The two processes cannot drift on types. | Both import `src/shared`; the channel map makes a mismatch a compile error. |
| NFR-4.3 | Swapping the storage engine must not touch the services. | Services depend on the interfaces in `src/core/ports`. |
| NFR-4.4 | Adding a viewer must not require a migration. | `AssetKind` is derived from the extension, never persisted. |
| NFR-4.6 | Adding an *editor* must not require a migration either. | Editability is derived from `AssetKind` too; no `is_composed` or `is_editable` column exists. |
| NFR-4.5 | Schema changes are append-only and versioned. | Numbered migrations, tracked in `PRAGMA user_version`. |

### NFR-5 Usability

| # | Requirement | How it is met |
|---|---|---|
| NFR-5.1 | The interface is Vietnamese. | All UI strings; code and docs stay English. |
| NFR-5.2 | No error message shown to the user is an English developer string. | The main process returns a `code`; the renderer maps it through a Vietnamese catalogue. |
| NFR-5.3 | No destructive action completes on a single click, and none of them uses a system dialog. | One `ConfirmDialog`, naming the thing and what goes with it. [08-ui-guide.md](08-ui-guide.md#destructive-actions) |
| NFR-5.4 | Every interactive element carries a stable `id`. | [08-ui-guide.md](08-ui-guide.md); `scripts/screenshot.ts` fails if one drifts. |
| NFR-5.5 | Opening the page in a plain browser explains itself rather than throwing. | A dedicated notice when the bridge is absent. |
| NFR-5.6 | The navigation rail can be given back to the content, and stays that way across restarts. | Collapses to 56 px on `Ctrl`+`B`; the choice is in `localStorage`. |
| NFR-5.7 | Someone browsing the vault in a file manager can tell what each file is without opening it. | Files are named after their document, slugged. |

---

## Constraints

| # | Constraint | Consequence |
|---|---|---|
| C-1 | No budget for hosting. | Local-first is not a preference, it is the premise. |
| C-2 | Storage lives on the D: drive of the author's machine. | The vault path must be configurable, and the default must not bury data on C:. |
| C-3 | One user per installation. Many people may each install their own copy; nobody shares a vault. | No accounts, no permissions, no conflict resolution. See [ADR 0007](adr/0007-single-user-per-install.md). |
| C-4 | The author's familiarity is TypeScript, Next.js and Spring. | Electron + Next over Tauri + Rust. [ADR 0001](adr/0001-electron-nextjs.md) |
