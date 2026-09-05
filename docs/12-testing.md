# 12 · Testing

## Strategy

Two commands, both of which exercise the real system:

| Command | Proves | Runtime |
|---|---|---|
| `npm run smoke` | The services behave — real SQLite, real files, real `.docx` | ~3 s |
| `npm run shots` | The window renders and the element ids hold | ~30 s |

Plus `npm run typecheck`, which catches an entire class of contract drift for free because the
IPC map is typed against both sides.

### The rule: never mock the database or the filesystem

Every check in `scripts/smoke.ts` runs against a real SQLite file in a real temporary directory,
with real files copied into a real vault. No fakes, no in-memory substitute, no repository
stub.

This is not purism. The bugs worth catching here are precisely the ones a mock hides:

- Does the FTS5 tokenizer actually make `ghi chu` match `ghi chú`? A mock repository would say
  yes because you wrote it to.
- Does `ON DELETE CASCADE` actually fire? Only if `PRAGMA foreign_keys` is on, which is not the
  default, and which a mock cannot forget to set.
- Does a `.docx` survive the round trip through mammoth with Vietnamese intact? Only a real zip
  answers that.
- Does deleting an item actually remove its directory from disk?

A mocked test of any of those tests the mock.

### Why not a test framework

There is no Jest, no Vitest, no `describe`/`it`. `scripts/smoke.ts` is a plain script with a
`check(label, condition)` function, run through Electron's Node so `better-sqlite3` loads
against the right ABI.

The reasoning: a framework buys parallelism, watch mode, fixtures and reporters. This suite
runs in three seconds, has one fixture (a temp directory), and prints a list of lines. What a
framework would add here is a dependency, a config file, and a second way to run Electron's
Node — for no capability that is missing.

That trade tips the other way as soon as the suite needs isolation between cases or grows past
a few hundred checks. It has not yet.

---

## What the smoke test covers

188 checks, grouped as the script runs them.

### Migrations
- A fresh database migrates from v0 to v3

### Categories
- Vietnamese diacritics are transliterated in slugs (`Tiếng Anh` → `tieng-anh`)
- Colours are assigned round-robin
- Item counts appear in the list projection
- Duplicate names are rejected case-insensitively
- Empty names are rejected

### Items and uploads
- Multiple assets recorded in one operation
- Duplicate tags collapse
- `sort_order` assigned in sequence
- SHA-256 checksum computed
- `rel_path` is relative and POSIX-style on every platform
- The file exists in the vault afterwards
- **The user's original source file survives the import**
- The `item.json` sidecar is written

### Search
- Matches a title word
- Prefix-matches the final term (`depend` finds `Dependency`)
- Matches body text inside a Markdown file
- Matches body text inside a `.txt`
- Diacritic-insensitive (`ghi chu` finds `ghi chú`)
- An unrelated term finds nothing
- Category-scoped search excludes other categories
- **FTS5 operators in user input are treated as literals** — `NEAR( "unbalanced` returns
  nothing rather than throwing

### List projection
- The category name is joined in
- Asset count is correct
- Tags come back sorted
- Sidebar counts update

### Item metadata
Runs on its own item so the counts and search results the neighbouring sections assert on stay
undisturbed.
- Title, summary and tags update; tags are **replaced, not merged**
- `updated_at` moves forward
- **A metadata edit leaves the attachments alone** — same count, same `rel_path`, still on disk
- The index drops the old title and picks up the new title and summary
- **Body text stays indexed** through an edit that never touched a file
- An omitted field means "leave alone"; clearing tags needs an explicit empty list
- Changing the category moves the item between list projections, moves both sidebar counts, and
  scoped search follows it
- The `item.json` sidecar is rewritten with the new title
- `ITEM_NOT_FOUND` for an unknown item, `CATEGORY_NOT_FOUND` for a move to a category that is not
  there

### Rendering
- Markdown returns source, not HTML
- Text is classified as text
- A real `.docx` converts to HTML
- A Word heading becomes an `<h1>`
- Vietnamese survives the conversion
- `.docx` body text reaches the search index
- **A corrupt `.docx` fails with `ASSET_RENDER_FAILED`**, not an unhandled throw

### Composed documents
- A document typed in the editor becomes an ordinary asset, in the item's own directory
- The extension follows the chosen format, and an existing `.txt` is *replaced* rather than
  appended to (`ghi-chu.txt` + markdown → `ghi-chu.md`)
- Its text reaches the search index like an uploaded file's
- An empty name is rejected
- **Editing rewrites the file and the row together** — size and checksum both follow the new
  bytes, and `rel_path` does not move
- The index drops the old text and picks up the new
- **No `.tmp` file is left behind**, which is what proves the atomic-rename path ran
- **A PDF cannot be edited as text** — `ASSET_NOT_EDITABLE`, from the service rather than the UI

### Notes
- A title is trimmed and its whitespace collapsed
- An empty title is rejected
- **A `deadline` with no date is rejected**, and an unparseable date is rejected separately
- A due date given in `+07:00` is stored as the corresponding UTC instant
- **A dated note sorts above an undated one, and a finished note sinks below both** — the one
  thing the ordering exists to do
- The list returns an excerpt and a length, not the body
- Filtering by kind excludes the other kinds
- Search matches a title, matches body text, and is diacritic-insensitive (`on tap` finds
  `Ôn tập`)
- An unrelated term finds nothing
- The note is mirrored to a file in the vault, with YAML front matter and the body after it
- **Renaming moves the file and leaves no stale copy**; changing the format changes the
  extension
- Reindexed under the new title
- An omitted field is left alone; `dueAt: null` clears the date
- Deleting removes the row, the index entry **and** the file

### Checklists
- A daily plan is created with no title and its tasks in one call; a title on one is rejected
- A module plan without a title is rejected
- **A second plan for the same day is refused** (`CHECKLIST_DAY_TAKEN`)
- **An empty checklist is refused**, and so is deleting the last remaining task
- `2026-02-31` is refused — the day is round-tripped through `Date`, not just regex-matched
- Task titles are trimmed and whitespace-collapsed
- **`Cao` sorts above `Thường`, and the four Eisenhower quadrants sort `do → schedule →
  delegate → eliminate`** — the ordering the whole feature is built on
- A sub-task carries neither priority nor quadrant
- **Progress counts leaves**: three sub-tasks under one big task make a total of four, not five
- Ticking one sub-task moves its parent to `doing`; ticking the last one moves it to `done` and
  stamps `doneAt`
- **Ticking a big task ticks its whole break-down, and un-ticking it un-ticks the whole
  break-down**
- A task can be reordered within its group, and the group itself does not move
- **A task cannot be dragged past a higher rank** (`CHECKLIST_TASK_PRIORITY_MISMATCH`), in both
  the daily and the module ranking
- Re-ranking a task moves it to the end of the group it arrives in
- A sub-task cannot own sub-tasks (`CHECKLIST_TASK_NESTING_TOO_DEEP`)
- A deadline given in `+07:00` is stored as the corresponding UTC instant
- `stats` counts every daily plan in the range and every leaf under it; a narrower range
  excludes the other day **but keeps the module plans**
- A backwards range is refused
- `findByDay` returns the plan for a day, and `null` for a day with none
- Deleting a plan cascades to its tasks

### Deletion rules
- A non-empty category cannot be deleted
- An empty category can
- Removing an asset deletes the row **and** the file
- Removing an asset removes its text from the index while leaving the rest
- Deleting an item cascades to its assets
- Deleting an item removes its directory from the vault
- Orphaned tags are pruned

### Error paths
- Missing item, category and asset each raise their own code
- **Path traversal is refused** — `../../../etc/passwd` raises `VAULT_PATH_ESCAPE`

### Schema guard
- A fresh vault opens at the current version
- **A vault whose `user_version` is ahead of this build is refused** (`VAULT_TOO_NEW`) — the one
  invariant that can only be tested by faking the future, since no migration produces it

### Vault info
- Counts (including checklists), the notes directory and the schema version reported correctly

---

## The `.docx` fixture

`scripts/make-docx.ts` builds a valid OOXML package at runtime — a store-mode ZIP with
`[Content_Types].xml`, `_rels/.rels` and `word/document.xml`, written with a hand-rolled CRC32
and no dependencies.

Two reasons it is generated rather than checked in:

1. A binary fixture in the repository is a thing nobody reviews and nobody updates.
2. The obvious alternative was to borrow one of the author's own Word documents from the D:
   drive. Using a person's real files as test data is not something a test suite should do
   quietly.

The generated document deliberately contains Vietnamese text, so the conversion check is a real
encoding check.

---

## What `npm run shots` proves

It boots the actual application against a throwaway vault, seeds four categories, five items
(one of them written in the app), five notes and four checklists, then drives the UI **by
element id**:

```ts
await click(window, '#btn-back-to-list')
await click(window, '#btn-add-item')
```

It also *completes* the compose flow rather than cancelling out of it — types a title, submits,
and checks it lands in the editor.

`click()` throws when the selector matches nothing. That makes the screenshot run a live check
on the id contract in [08-ui-guide.md](08-ui-guide.md#element-ids): rename `btn-add-item` and
the run fails instead of quietly producing a picture of the wrong screen.

This caught a real mistake during development — an early version clicked `#btn-add-item` after
navigating to Settings, where that button does not exist, and silently captured a screenshot of
Settings labelled as the upload dialog.

Twenty-two screenshots, in the order the run produces them:

| File | Screen |
|---|---|
| `01-recent.png` | Recent items |
| `02-item-detail-word.png` · `03-item-detail-markdown.png` | The two document viewers |
| `04-add-item-dialog.png` | Upload dialog |
| `05-settings.png` | Vault paths and counts |
| `06-notes.png` | Note list, deadlines first |
| `07-note-editor.png` | Markdown source beside its live review |
| `08-sidebar-collapsed.png` | The 56 px icon rail |
| `09-confirm-delete.png` | The confirmation, naming a real document |
| `10-compose-dialog.png` | *Soạn trực tiếp* selected in the add-document dialog |
| `11-document-editor.png` | Editing a stored `.md`, source beside review |
| `12-item-info-dialog.png` | The item's own fields, opened prefilled |
| `13-checklist-dashboard.png` | Week tallies, the per-day chart, both kinds of plan |
| `14-…step1.png` · `15-…step2.png` · `16-…step3.png` | The three steps of the create wizard |
| `17-checklist-module-detail.png` | A module plan, grouped by Eisenhower quadrant |
| `18-checklist-daily-detail.png` | A daily plan with a break-down under a big task |
| `19-checklist-daily-ticked.png` | The same plan after ticking one sub-task |
| `20-update-available.png` · `21-update-downloaded.png` | The update strip in its two actionable states |
| `22-update-settings.png` | The version block, reporting "up to date" |

The last seven of the first twelve are the only automated coverage of the collapse toggle, the
confirmation dialog, the editor and the info dialog: all four are pure UI, and all four would
pass a service-level test that proved nothing. The checklist run is there for the same reason —
drag ordering, the group headings and the wizard's step machine exist only in the renderer.

**The update steps test a channel nothing else can reach.** No test can arrange for a real feed
to publish a newer version — but the *push* can be arranged: the run sends `update:state`
exactly as `UpdateService` sends it, then asserts the banner is on screen carrying the new
version number. That exercises the whole renderer path — preload subscription, store reducer,
banner — and is the only coverage of the one main-to-renderer channel in the contract. A
`webContents.send` that silently went nowhere would otherwise look identical to "no update
available".

The checklist steps assert twice, in the same spirit as the compose flow. After **Xác nhận tạo
checklist** the dialog must be gone and the new plan must be on screen — creation has to hand
off into the plan it just made. And after ticking a sub-task, `aria-valuenow` on
`progress-checklist-{id}` must be **higher than before**: that one number is the whole promise
of the feature, and it is computed three layers away from the checkbox that was clicked.

The info-dialog step asserts before and after the picture rather than trusting the pixels: the
title input must already equal the heading when the dialog opens (an empty form would clear the
summary and tags on submit), and after **Lưu thay đổi** the dialog must be gone and the heading
must carry the new title.

### Two assertions that are not about pixels

The compose flow is the one place the run checks *state* rather than trusting a picture, and
both checks earned their place by failing.

**`aria-pressed` on `#btn-source-compose`**, read after clicking it and before the shot. The
first version of `10-compose-dialog.png` captured a frame in which the highlight was still on
the other card — exactly the compositor lag described below. The DOM was right and the pixels
were a frame behind; without the assertion the screenshot would have been filed as evidence
that the toggle was broken.

**`#doc-editor-source` exists after submitting the dialog.** Creating a written document has to
hand off into the editor, and nothing else covers that hand-off. It caught a real bug: the
store matched the created asset by the *raw* name the user typed (`Tên`) against the
*normalised* filename the service wrote (`Tên.md`), so the editor silently never opened. The
screenshot before it looked perfect, because it was taken from a document created by the
seeder rather than through the dialog.

The lesson both times: **a screen that renders correctly is not a flow that works.** Drive the
flow, then assert on the DOM.

### A caveat about screenshots

The capture window is hidden (`show: false`), and a hidden window's compositor can lag the DOM.
An early run produced a frame where the document pane had updated but the sidebar highlight had
not. The DOM was correct — verified by querying it directly — but the captured pixels were a
frame behind.

It happens again whenever a new step is added with too short a wait: the first version of the
checklist wizard shots used a 400 ms settle and captured *step 1* under the filename for step
2, three times over. The fix is a longer settle before each capture, not a retry — the DOM was
never wrong.

The lesson generalises: **a screenshot is evidence about pixels, not about state.** When the
two disagree, query the DOM.

---

## Adding a check

Open `scripts/smoke.ts` and add to the relevant section:

```ts
check('a description that reads as a claim', someCondition)

await expectCode('what should be refused', ErrorCode.SOMETHING, () => service.doIt())
```

Label them as claims — `'asset file gone from the vault'`, not `'test delete'`. The output is
read by a person deciding whether to trust a change.

---

## Before committing

```bash
npm run typecheck   # both projects
npm run smoke       # 188 checks
npm run shots       # only if the UI changed
```

If `smoke` fails, the change is wrong until proven otherwise. It has no flaky checks: there is
no network, no clock dependence, and no shared state between runs.
