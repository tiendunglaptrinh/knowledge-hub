# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-09-05

Planned work is tracked in [docs/11-roadmap.md](docs/11-roadmap.md).

### Changed

**Tags are chips, not a comma-separated string.** Typing a tag and pressing `,` — or `Enter`, or
`Tab` — turns it into a visible token with an `×` that removes it. Backspace in the empty field
deletes the last one.

The old field worked but made the user do the parser's job in their head: with
`spring, di, backend` on one line there was no way to tell whether a trailing space mattered,
whether a typo three tags ago was still there, or which characters would survive. Nothing
confirmed a tag had been *accepted* until the item was saved.

- Duplicates are refused case-insensitively, matching the `ux_tags_name_ci` index the store
  enforces anyway — and the existing chip **flashes** rather than the new one silently vanishing,
  which would read as the control being broken.
- A tag still being typed when focus leaves is committed, not dropped. Losing it at the moment the
  user reaches for **Lưu** was the worst possible time to lose it.
- Pasting `spring, di, backend` still yields three chips, so the old format remains a valid thing
  to paste in.
- `value` is a `string[]`, so both dialogs now hold exactly what goes over IPC and `parseTags` is
  out of the submit path.
- New ids: `item-tags-chip-{n}` / `-remove`, and `item-info-tags-chip-{n}` / `-remove`.

### Added

**Auto-update — the application now tells you when a newer version exists.**

The feed is GitHub Releases on a public repository: no token in the application, `latest.yml`
and the installer fetched over anonymous HTTPS. A token is needed only on the build machine, to
upload.

**Nothing happens without a click.** `autoDownload` and `autoInstallOnAppQuit` are both off. A
user on a metered connection should not discover a 90 MB transfer after the fact, and this is a
tool people leave open — replacing it underneath them, even at quit, is a decision they should
make. The application checks once, eight seconds after launch, and then waits.

- **A strip across the top, in three states only**: *có bản mới*, *đang tải*, *đã tải xong*.
  `idle`, `checking`, `not-available`, `error` and `unsupported` report themselves in
  **Cài đặt → Nơi lưu trữ** instead. A strip across someone's window is an interruption, and
  "you are already up to date" does not earn one.
- The strip is **dismissible for the session** and keyed to the version — dismissing 0.2.1 does
  not silence 0.2.2. An update never installed is a bug you keep, so it returns next launch.
- **Settings gains a version block**: current version, a *Kiểm tra bản mới* button, and one
  sentence saying where the flow is.
- **`unsupported` is a state, not an error.** A development run, a `--dir` copy and a portable
  build have nothing an updater could write over; the test is whether electron-builder wrote
  `app-update.yml` into the resources directory. Reporting that plainly beats surfacing whatever
  `electron-updater` throws when it cannot find its own configuration.

Under it:

- `update:state` is the **first main → renderer push** in the contract, and it lives in a new
  `IpcEvent` map rather than in `IpcChannel`: `ApiMap` describes calls that return a `Result`,
  and this returns nothing to anyone. The preload wraps the listener so the renderer never
  receives Electron's `IpcRendererEvent` — that object carries `sender`.
- New: `UpdateService` (the only place `electron-updater`'s global event emitter is touched),
  four channels, four error codes, `UpdateBanner`.
- `npm run shots` grows to **22 screenshots** and sends `update:state` by hand, which is the
  only way to cover a channel whose real trigger is a published release.

**Checklists — plan a day, or a body of work, and watch the percentage move.**

A fourth screen, **Kế hoạch**, holding two kinds of plan that differ in exactly two ways: what
identifies them, and how a task's priority is expressed.

- **Checklist ngày** — one plan per calendar day, and *only* one. It has no title, because the
  date names it. Tasks are ranked **Cao** (do this first) or **Thường** (some time today).
- **Checklist module** — a plan for a body of work that will not fit in a day: forty tasks over
  two months, where planning day by day is the wrong shape. It has a title, an optional
  description and deadline, and its tasks are ranked by the **Eisenhower matrix** — *Làm ngay*,
  *Lên lịch*, *Uỷ thác*, *Loại bỏ* — and kept in that order automatically.

**Creating one is a three-step flow, and nothing is written until the last step.** Kind and
metadata, then the tasks, then a confirmation naming what is about to be created. The middle
step is not a field — it is a list being assembled — and a plan and its tasks are created by a
single IPC call, so an abandoned wizard leaves nothing behind and the "at least one task" rule
is checked against the whole thing rather than against a row that already exists.

- A task carries a title, an optional short description, an optional deadline, a state (*Cần
  hoàn thiện* → *Đang làm* → *Đã xong*) and a rank.
- **A big task breaks into sub-tasks, one level deep.** Ticking the big task ticks the whole
  break-down; finishing the break-down finishes the big task. Anything else would let the
  checkbox disagree with the progress bar beside it.
- **Progress counts leaf tasks.** Splitting one task into three makes the total three, not four
   — breaking work down must not inflate what there is to do.
- **Tasks of equal rank can be dragged past each other; a task can never be dragged above one
  that outranks it.** The gesture is refused at the *drop target* rather than at the source, so
  a task dragged towards a higher group simply finds nowhere to land: no error, no dialog. To
  actually promote a task, change its rank — it lands at the end of the group it arrives in.
- Re-ranking, ticking, editing and reordering all answer with the whole plan, because ticking
  one sub-task can move its parent, the plan's percentage and the dashboard's tally at once.

**A dashboard, because a checklist you cannot look back at is a to-do list.** Four tiles —
plans in the window, average completion, work remaining, module plans still running — then one
bar per day of the week or month, then the plans themselves. Every figure is computed in the
main process (`checklist:stats`); nothing on the screen re-tallies anything, because a
percentage the UI worked out for itself is one that can disagree with the card beside it.

- **Every day of the window gets a bar, including the empty ones** — a gap in the row is the
  most useful thing the chart says. A day with a plan and nothing done still gets a sliver, so
  "planned nothing" and "planned and did nothing" look different.
- The week/month switch moves the daily half only. A two-month plan is relevant on every day of
  those two months, so hiding it when the window narrows would read as data loss.

Under it:

- **Migration 4** adds `checklists` and `checklist_tasks`. The kind rule is a `CHECK`, not a
  service rule: "a daily plan with a title" and "a module plan pinned to a date" are
  unrepresentable rather than merely rejected. One plan per day is a *partial* unique index, so
  every module row is exempt instead of colliding.
- **`day` is a calendar day (`YYYY-MM-DD`), never a timestamp.** The plan for the 5th belongs to
  the 5th wherever the user is; stored as an instant it would be the 4th for anyone east of
  Greenwich after 17:00, and the unique index would stop meaning what it says.
- The ranking lives in `src/core/domain/checklist.ts` and is applied by the service, not in
  `ORDER BY` and not in the renderer — one copy, one place to change it.
- New: `ChecklistService`, `SqliteChecklistRepository`, eleven IPC channels, sixteen error
  codes, `ChecklistDashboard`, `ChecklistDialog`, `ChecklistDetailPane`, and `ProgressBar` /
  `ProgressRing` in the shared UI kit.
- `npm run smoke` grows to **186 checks**, 45 of them on checklists — the day rule, the empty
  rule, both rankings, the parent/child status contract, leaf-counted progress, the drag
  restriction and the dashboard tallies. `npm run shots` grows to **19 screenshots** and asserts
  that ticking a sub-task actually raises the plan's `aria-valuenow`.
- Settings gains a **Checklist** count; `VaultInfo.checklistCount` reports it.

**Appearance settings** — the window is no longer fixed at one theme, one font and one type size.

- **Cài đặt** (formerly **Nơi lưu trữ**) is now two tabs. **Giao diện** is the new screen of
  choices; **Nơi lưu trữ** is the storage screen unchanged, moved under a tab because reading
  facts about the disk and choosing how the app looks are two different tasks.
- **Four themes**: Tối (the previous dark, still the default), Sáng, Ngả vàng (a paper-coloured
  reading surface) and Tương phản cao. Every colour in the UI was already a token, so a theme is
  a block of CSS variable overrides and no component knows themes exist. Two values that were
  hardcoded had to become tokens first: rendered-document headings (`#fff`, invisible on a light
  background) and the label on filled accent/danger buttons, now `--color-on-accent`.
- **Three font settings**, each covering one role: `Phông giao diện` for the chrome,
  `Phông tài liệu` for rendered documents and plain-text notes, `Phông mã nguồn` for Markdown
  source, code blocks and verbatim text. Only families already installed on the machine are
  offered — the renderer's CSP allows no remote origin — and every option falls back to a generic
  family. The stacks are defined once, in `globals.css`.
- **Two independent zoom scales**, because they solve different problems:
  - **Thu phóng ứng dụng** scales the whole window through Electron's own zoom factor, which is
    the only mechanism that also reaches Chromium's built-in PDF viewer, an image, and any size
    written in pixels. Bound to `Ctrl` `+` / `Ctrl` `−` / `Ctrl` `0` globally, as in any other
    desktop application.
  - **Cỡ chữ nội dung** scales documents and editing panes only, leaving the chrome alone. It has
    a `−  %  +` control in the document viewer and in the editor toolbar, responds to
    `Ctrl`+scroll over the content, and the percentage itself is the reset button.
- Preferences are applied the instant they change — there is no Save button, because every option
  is reversible and visible immediately. `Đặt lại mặc định` is the undo.
- They live in `localStorage`, not in the vault: they describe this machine, not the knowledge, so
  they need no IPC channel and no schema migration, and copying the vault does not carry them.
  A small script in `<head>` applies the stored theme and fonts **before the first paint**, so a
  chosen light theme no longer flashes dark on every launch.
- The preload bridge gains a `view` group (`setZoomFactor`, `getZoomFactor`). It is not IPC:
  `webFrame` is available to a sandboxed preload, so the main process is not involved. The IPC
  channel count is unchanged at twenty-six.

**Notes** — the application now holds things you write, not only files you brought.

- A note has a title, a **kind** (học tập, nhật ký, hạn chót, việc cần làm, ý tưởng, cuộc họp,
  đoạn mã, khác), a **format** (Markdown or plain text) and an optional **due date**.
- **A Markdown note is edited in two sections**: the source on the left and a live rendered
  review on the right, switchable to either alone. The review goes through the same parser and
  sanitiser as the viewer for a stored `.md` file, so a note cannot look one way while it is
  being written and another afterwards.
- **A dated note sorts itself to the top of the list**, soonest first, with the chip red when
  overdue and amber when due today or tomorrow. A `deadline` note is refused without a date
  (`NOTE_DUE_REQUIRED`) — the label promises an ordering it cannot deliver otherwise.
- Notes can be ticked off; finished ones sink to the bottom.
- Filter chips by kind, and a search box over titles and bodies with the same
  diacritic-insensitive, prefix-matching behaviour as document search.
- **Every note is mirrored to an ordinary `.md` or `.txt` file** under `notes/YYYY/MM/`, with
  its metadata in YAML front matter. Notes are the only content with no uploaded file behind
  them, so without this they would live in `knowledge.db` and nowhere else — the one shape of
  data loss the vault design exists to prevent. Renaming a note or changing its format moves
  the file; deleting the note removes it.
- Schema v2: `notes` and `notes_fts`. Additive only, so an existing vault upgrades on next
  launch with nothing rewritten.
- Five IPC channels (`note:list` · `get` · `create` · `update` · `delete`), taking the bridge
  from nineteen methods to twenty-four. `note:list` returns a 280-character excerpt and a
  length rather than the body.
- The Settings screen reports the notes directory and the note count.
- [ADR 0008](docs/adr/0008-notes-as-a-separate-entity.md) — why a note is its own entity
  rather than an item with no attachments.

**Writing documents in the app** — a category no longer needs you to have a file first.

- *Thêm tài liệu* now opens with a choice of two equal-weight cards: **Tải tệp từ máy** or
  **Soạn trực tiếp**. Choosing to write asks for a title and a format, creates the document
  empty, and opens the editor on it.
- **The editor is the same two-section surface as the note editor** — Markdown source on the
  left, live rendered review on the right, with a scroll that follows. `TextComposer` is shared
  by both, and the review goes through the same `renderMarkdown` as the viewer for a stored
  `.md`, so a document cannot look one way while it is written and another afterwards.
- **Any stored Markdown or text file can now be edited in place**, including one that was
  uploaded — a *Sửa* button floats over the viewer. `.docx`, PDF and images are excluded and
  the service refuses them (`ASSET_NOT_EDITABLE`) rather than relying on the button being
  hidden.
- *Soạn tài liệu* adds a written document to an item that already exists.
- Saving is explicit (`Ctrl`/`Cmd`+`S`); closing with unsaved work asks first. While editing,
  the file list hides so the editor gets the full width.
- **A written document is an ordinary asset.** Same directory, same naming rule, same checksum,
  same search index — no column records that it was typed rather than uploaded, and nothing
  downstream can tell. Editability is derived from `AssetKind`, so it
  needed no migration. [ADR 0009](docs/adr/0009-compose-documents-in-app.md).
- Two IPC channels (`asset:compose`, `asset:updateText`), taking the bridge to twenty-six
  methods. Typed text crosses IPC — the deliberate exception to *paths, not buffers* — and is
  capped at 5 MB against 200 MB for an upload.

**An item's own details are editable after creation** — the last field in the application that
was write-once.

- **Sửa thông tin** on the item detail header opens `ItemInfoDialog`: title, category, summary
  and tags. `item:update` had carried all four since v0.1 and `store.updateItem` had been
  written to call it, but nothing in the interface ever did — the backend was complete and the
  button was missing. This adds the button, not the capability.
- **Changing the category moves the item**, out of one group's list and into another's, with
  both sidebar counts and category-scoped search following on the refresh.
- Editing metadata does not touch the files. The attachments, their names and their paths in the
  vault are exactly as they were; only the item's own row, its FTS entry and its `item.json`
  sidecar are rewritten.
- A separate dialog from *Thêm tài liệu* rather than a mode inside it. Creation is mostly about
  where the bytes come from — the source cards, the dropzone, the format picker — and none of
  that has an answer once the files are in the vault. One component serving both would be half
  conditionally-absent fields.
- `npm run smoke` gained a section for it: tags replace rather than merge, an omitted field is
  left alone, clearing tags takes an explicit empty list, the body text of an untouched file
  stays indexed through a title change, and a move to a category that does not exist is refused
  with `CATEGORY_NOT_FOUND`. `item:update` previously had no smoke coverage at all.

**Readable filenames in the vault.**

- A stored file is now named after its document, slugged: `Spring Boot` is saved as
  `spring-boot.md`, `OWASP Tổng Hợp.PDF` as `owasp-tong-hop.pdf`. Every file used to be prefixed
  with the id of the row that owned it — `7b1e2c3d-…-OWASP Top 10.docx` — which made collisions
  impossible for free and the vault unreadable, working directly against the reason files are
  stored as plain files at all.
- **The name the user chose is untouched.** It stays in `assets.filename` and is what every
  screen shows; only the name on disk changes. The two are different jobs — a display name
  should read well, a stored name should be boring on every filesystem.
- Names that reduce to the same slug get `-2`, `-3` … The uniqueness test is the write itself,
  an exclusive create that fails with `EEXIST`, so there is no window between checking and
  writing.
- Notes are named the same way. Since their filename no longer carries the note id, **schema v3
  adds `notes.rel_path`** to record where each note's file is — without it a rename would have
  nothing to search the directory for. Legacy `<noteId>-title.md` files are swept away as each
  note is saved.
- **`npm run tidy:filenames`** renames an existing vault in one pass: file, then `rel_path`, then
  the affected `item.json` sidecars. `--dry-run` prints what would change. Disk first and
  database second, so an interrupted run is repaired by the next one.

**A collapsible sidebar.**

- `Ctrl`/`Cmd`+`B`, or the button in the rail's header, collapses it to a **56 px icon rail**.
  At 1360 px the expanded rail is nearly a fifth of the window, and a document or a two-section
  editor wants all of it.
- The choice is remembered across restarts (`localStorage`). Element ids are identical either
  way, so nothing that drives the UI depends on the rail's width.

**Documentation and packaging** (earlier on this same unreleased line).

- [docs/13-distribution.md](docs/13-distribution.md) — packaging per platform, code signing,
  auto-update, versioning, the release checklist, and what a new user actually experiences.
- [ADR 0007](docs/adr/0007-single-user-per-install.md) — one user per installation; many
  installations are fine, a shared vault is a different product.
- `scripts/make-icon.mjs` — generates `build/icon.png` and `build/icon.ico` with no image
  dependency.
- Windows build procedure, including the `better-sqlite3` ABI workaround and the winCodeSign
  symlink failure, in [docs/09-development.md](docs/09-development.md).

### Changed

- **Every destructive action now asks first, and none of them completes on a single click.**
  Deleting a file from a document, or an empty category, previously happened the instant the
  trash icon was clicked. Deleting a document used an inline two-step whose confirm button
  appeared exactly where the cursor already was, so a second click could land on it before
  anything had been read. All four — document, file, category, note — now go through one
  `ConfirmDialog` that names the thing, says what else goes with it, states that there is no
  undo, and puts the confirm button somewhere the previous click cannot carry through to.
- The sidebar's per-category delete is no longer a `<span role="button">` nested inside the
  navigation `<button>` — invalid HTML that needed its click stopped from propagating to an
  ancestor that should never have been one.
- Markdown parsing and sanitisation moved into `renderer/src/lib/markdown.ts`, shared by the
  asset viewer and the note editor's review pane. It deliberately exports no
  parse-without-sanitising function.
- The vault path-traversal check moved into `src/storage/fs/vault-path.ts`, shared by the asset
  store and the new note store, so the one security-critical line in the storage layer exists
  once.
- **Stored assets are no longer write-once.** Editing one rewrites its file and updates its
  `size_bytes` and `checksum` in the same operation. The write goes to a temporary name and is
  `rename`d over the target, so the property the backup advice actually relied on still holds:
  a reader of `assets/` sees the whole old version or the whole new one, never a partial write.
  `rel_path` still cannot change — the repository exposes a narrow `updateContent`, not a
  general `update`.
- The note editor's Markdown panes moved into the shared `TextComposer`; its pane buttons are
  now `btn-note-editor-pane-*` rather than `btn-note-pane-*`.
- Filename derivation (`documentFilename`) moved to `src/shared/text-format.ts` so the editor
  can show the user, live, exactly what the main process will name their file.
- `npm run smoke` grew from 53 checks to 138; `npm run shots` from five screenshots to twelve.
  The compose-dialog shot asserts `aria-pressed` before capturing — the first version of it
  photographed a frame where the highlight was still on the other card.
- [docs/09-development.md](docs/09-development.md) now documents how to update an installed
  Windows copy by replacing `app.asar`, which is sufficient whenever no native module or
  Electron version changed — and the three ways of getting it wrong.
- **The upload dialog now leads with the file picker.** *Chọn tệp từ máy* was previously the
  last control in the form, which pushed it past the bottom of the modal's scroll area — the
  dialog looked as though it only accepted drag-and-drop. Files are now the first section and
  the button cannot be clipped.
- The title field autofills from the first attached file's name, until the user edits it.
- **An installed application now stores its vault in the running user's own application-data
  directory** instead of beside the executable. The previous default failed under
  `C:\Program Files` (not writable by a standard user) and gave every account on a shared
  machine one vault. Portable behaviour is still available, opt-in with a `portable.txt` file
  beside the executable. See [ADR 0007](docs/adr/0007-single-user-per-install.md).
- A packaged application reads `.env` from beside the executable rather than from inside the
  asar archive, which is what makes `KB_DATA_DIR` reachable for an installed copy at all.

## [0.1.0] — 2026-08-01

First working version.

### Added

**Categories**
- Create with a name, an icon from a fixed set of sixteen, and a colour
- Case-insensitive unique names; Vietnamese diacritics transliterated into ASCII slugs
- Colours assigned round-robin from an eight-colour palette when not chosen
- Item counts in the sidebar
- Deletion refused while the category holds items, at both the service and schema level

**Items**
- Title, optional summary, tags, and any number of attached files
- Tags are global across categories, matched case-insensitively, deduplicated on save
- Deleting an item removes its files and index entries

**Files**
- Native multi-select file dialog, and drag-and-drop onto the upload dialog
- Files are copied into the vault, never moved
- 200 MB per-file limit; SHA-256 checksum recorded
- Add to and remove from an existing item
- Open with the OS default application, or reveal in the file manager

**Viewing**
- PDF inline via Chromium's built-in viewer
- `.docx` converted to HTML by mammoth, with collapsed conversion warnings
- Markdown rendered with GitHub-flavoured syntax
- Plain text and source files verbatim
- Images scaled to fit
- Unsupported formats show file details and an *open externally* action

**Search**
- Full text across titles, summaries and extracted document contents
- Diacritic-insensitive — `ghi chu` matches `ghi chú`
- Prefix matching on the final term
- FTS5 operators in user input treated as literal text

**Storage**
- Vault location configurable through `KB_DATA_DIR`
- Settings screen showing resolved paths, counts and total size
- `item.json` sidecar beside every item's files, for index rebuilding

**Infrastructure**
- SQLite schema v1 with FTS5, migrated through `PRAGMA user_version`
- Typed IPC contract across nineteen channels
- `npm run smoke` — 53 checks against a real database and real files
- `npm run shots` — boots the app, seeds it, captures screenshots and validates element ids
- Full documentation set in `docs/`, including six architecture decision records

### Security

- `contextIsolation`, `sandbox` and `nodeIntegration: false` on the renderer
- A fixed nineteen-method preload bridge; no generic invoke
- Path traversal refused in `FsAssetStore.resolve`, covered by a smoke check
- HTML from documents sanitised with DOMPurify before entering the DOM
- External links opened in the system browser, never in an Electron window
- Content Security Policy without `'unsafe-eval'` in production builds

### Known limitations

- PDF contents are not indexed for search
- Categories are flat; `parent_id` exists in the schema but is always `NULL`
- Editing an item's title, summary or tags is implemented in the service but has no UI
- No undo
- `'unsafe-inline'` is required in the CSP by Next's static export
