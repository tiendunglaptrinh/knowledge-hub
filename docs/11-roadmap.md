# 11 · Roadmap

Nothing in this document is built. Everything here names the files it would touch, so the cost
of an idea is visible before it is started.

Ordered by value per unit of work, not by appeal.

---

## Near term

### R-1 · Edit an item from the UI

`ItemService.update` exists, is covered by the contract, and has no UI. Retitling, editing the
summary, changing tags and moving an item between categories are all one dialog away.

**Touches:** a new `EditItemDialog`, an `updateItem` action already present in the store.
**Cost:** small. **Value:** high — this is the most obvious gap a user hits on day two.

### R-2 · PDF text extraction for search

PDFs are the most common format here and the only major one whose contents are invisible to
search. `DocumentService.extractText` already has the shape; it returns `''` for `pdf`.

**Touches:** `DocumentService.extractText`, one new dependency, a re-index migration for
existing rows.

**Why it was deferred:** every option costs something real. `pdf-parse` is unmaintained;
`pdfjs-dist` is large and awkward outside a browser; a native binding reintroduces the ABI
rebuild problem that `better-sqlite3` already imposes. Choosing deserves an ADR rather than a
default.

**Cost:** medium. **Value:** high.

### R-3 · `rebuild-index` command

The sidecars already carry everything needed. What is missing is the command that walks
`assets/**/item.json` and reconstructs the database.

**Touches:** a new script, reusing the existing services.
**Cost:** small. **Value:** high — it turns "the index is a single point of failure" into "the
index is a cache", which is what the sidecar was written for.

### R-4 · Rename and recolour a category from the UI

Same situation as R-1: `CategoryService.update` exists and is unreachable.

**Cost:** small.

---

## Medium term

### R-5 · Sub-categories

`categories.parent_id` exists and is always `NULL`.

**Touches:** the sidebar becomes a tree; `CategoryRepository.list` needs a recursive CTE for
descendant counts; `listByCategory` needs to decide whether it includes descendants (it should,
with a toggle).

**Cost:** medium — mostly UI. The schema is ready.

### R-6 · Tag browsing

Tags are stored, displayed and searchable, but there is no way to click one and see everything
carrying it.

**Touches:** a `tag` variant on the `View` union, one new IPC channel, a tag list in the
sidebar.
**Cost:** small–medium.

### R-17 · Notes in categories, and note tags

A note currently belongs to nothing. That is the right starting point — see
[04-data-model.md](04-data-model.md#entities) for why a note is not an item — but "which of my
Spring notes was that" is a question the application cannot answer today.

**Touches:** a nullable `category_id` on `notes` (nullable, so an uncategorised note stays
valid), the sidebar counts, and a `note_tags` table reusing the existing global `tags`.

**Cost:** small–medium. **Value:** high once there are more than a screenful of notes.

### R-18 · Due-date notifications

A deadline note sorts itself to the top of a screen the user has to be looking at. A desktop
notification would reach them when they are not.

**Touches:** a scheduler in the main process, `Notification` from Electron, a "remind me" field
distinct from the due date, and a decision about what happens while the app is closed — which
is the part that makes this larger than it sounds.

**Cost:** medium. Deserves an ADR for the closed-app case.

### R-19 · Turn a note into an item, and an item's `.md` into a note

Both conversions are one insert and one delete, and both are things a person will want the
first time they write a note that turns out to belong beside a PDF.

**Cost:** small.

### R-20 · Recurring checklists

A daily plan that repeats — every weekday, every Monday — instead of being typed out again.
The obvious shape is a template a plan is *generated from*, not a `repeat` column on the plan
itself: the moment a generated day is edited it stops being the template, and a column cannot
express that.

**Touches:** a `checklist_templates` table, a generator that runs at first launch of a day, and
a decision about what happens to a day that was skipped — generate it retroactively, or leave
the gap the dashboard is designed to show.

**Cost:** medium. Deserves an ADR for the skipped-day question.

### R-21 · Roll an unfinished task over to tomorrow

Today's plan ends with two tasks open. Rolling them into tomorrow's plan by hand is exactly the
kind of retyping the feature exists to remove.

**Touches:** a `checklist:taskMove` variant that changes `checklist_id` rather than
`sort_order`, and a rule for what happens when tomorrow has no plan yet — most likely creating
one from the tasks being rolled, which is the only way that stays inside "a plan is never
empty".

**Cost:** small once R-20's generator exists; awkward before it.

### R-22 · A task that points at an item or a note

*"Read the OWASP document"* is a task whose subject already lives in the vault. A nullable
`item_id` / `note_id` on a task would make the row openable rather than merely descriptive.

**Cost:** small. The risk is scope creep towards a general linking system, which is
[explicitly not planned](#explicitly-not-planned).

### R-7 · Reorder assets within an item

`assets.sort_order` is stored and honoured; nothing writes it except insertion order.

**Cost:** small, plus whatever drag-and-drop reordering costs.

### R-8 · Export

Two useful shapes: a zip of the vault with sidecars, and a Markdown tree with front matter for
importing into Obsidian.

**Cost:** medium. **Value:** it is the strongest possible statement that the application does
not hold the data hostage.

---

## Longer term

### R-9 · Full-text highlighting

FTS5's `snippet()` and `highlight()` can return matched text with context. Search results
currently show the summary, not the matching passage.

**Cost:** medium — the query is easy, the UI for it is not.

### R-10 · Version history for documents

Re-uploading a file replaces nothing today; it becomes a second asset. **Editing one, however,
now does overwrite** — so this went from a nicety to the missing half of a feature that ships.
Real versioning means an `asset_versions` table and a UI to browse it.

**Cost:** large. **Value:** real, but narrower than it first appears for a personal vault.

### R-11 · Light theme

Would need `.doc-prose` restyled as well as the chrome. Deliberately not done — see
[08-ui-guide.md](08-ui-guide.md#dark-only).

### R-12 · Automated UI tests

`scripts/screenshot.ts` already drives the UI by element id and fails when one drifts, which is
most of the value. A real Playwright suite against the Electron binary would add assertions on
behaviour rather than just on rendering.

**Cost:** medium.

---

## Getting it into other people's hands

Scoped in full in [13-distribution.md](13-distribution.md). The blocking items, in order:

### R-13 · Log to a file

Today logs go to stdout, which an installed user never sees. Without this, "it crashed on my
machine" is unactionable.

**Touches:** `src/main/logger.ts` (add a rotating file sink under `app.getPath('logs')`), plus a
button on the Settings screen to open it.
**Cost:** small. **Value:** high the moment anyone but you runs it.

### R-14 · Refuse a vault from a newer version

An older application opening a vault whose `user_version` is ahead of `LATEST_SCHEMA_VERSION`
currently fails somewhere inside a query rather than saying so. Now that auto-update ships
(R-16), several versions *are* in circulation, which makes this a data-loss-shaped bug rather
than a future one.

**Touches:** `openDatabase` — one comparison and one clear error.
**Cost:** tiny. **Value:** high. Do this before the second person installs it.

### R-15 · Code signing

Unsigned builds trigger SmartScreen on Windows and are refused outright by Gatekeeper on macOS.
Costs real money annually (~200–400 USD for Windows, 99 USD for Apple) and needs the key
available to the build machine.

**Cost:** money and setup, not code. **Value:** the difference between "send it to a few
friends" and "publish it".

### R-16 · Auto-update — **done in 0.2.0**

Shipped: GitHub Releases as the feed, notify-and-choose rather than silent install, and
`unsupported` reported honestly for builds that cannot update themselves. Written up in
[13-distribution.md](13-distribution.md#auto-update-d-7).

What it changed about the other items on this list: **R-14 is now urgent rather than tidy.**
Once several versions are in circulation, an older application opening a vault written by a
newer one is a real scenario rather than a hypothetical, and today it fails somewhere inside a
query instead of saying so.

**R-13 also moved up.** A user who takes an update and hits a problem has no log to send.

---

## If shared multi-user ever becomes the goal

Not planned — see [ADR 0007](adr/0007-single-user-per-install.md) for why this is a different
product rather than a feature. Recorded here so the cost is known rather than guessed.

Roughly in dependency order:

1. **An identity model.** Who a user is, and how they prove it. Currently there is no concept of
   a caller at all: services trust their input because there is only one possible caller.
2. **`owner_id` on `categories` and `items`**, with a backfill migration, plus an ownership
   filter on *every* repository query. The filter must be structural, not remembered — "load by
   id then check" is the pattern that leaks.
3. **A transport.** Either a server (contradicts the no-hosting-budget premise) or peer sync (a
   distributed-systems project of its own).
4. **Conflict resolution.** Text can merge. A 40 MB PDF edited on two machines cannot.
5. **A permission model**, once more than one person can see a thing.

Steps 3 and 4 are where the cost actually is, and neither is reachable from a local directory of
files. The honest answer at that point is a separate application with a server that shares this
one's domain model, not its storage.

---

## Explicitly not planned

| | Why |
|---|---|
| Sync between machines | Needs a server or a third-party account. The premise is neither. A vault on a synced drive is the user's own choice. |
| Shared multi-user vault | A different product. See [ADR 0007](adr/0007-single-user-per-install.md) and the section above. Many people *installing* their own copy is supported and is a different thing. |
| A vault on a network share, opened by two machines | Two SQLite writers over SMB is a corruption risk, not a feature. The single-instance lock does not span machines. |
| In-app document editing | Editing `.docx` well is a project of its own. *Open with the system application* covers it. |
| A web version | The design assumes direct filesystem access throughout. |
| Legacy `.doc` rendering | See [ADR 0006](adr/0006-document-rendering.md). Silently mis-rendering a binary format is worse than declining to try. |
| Plugins | A plugin API on an application with no security boundary between plugin and vault is a liability, not a feature. |

---

## Known limitations

Present in v0.1, not defects, worth stating plainly:

| Limitation | Consequence |
|---|---|
| PDF contents are not indexed | A PDF is findable by title, summary and tags only |
| Files above 2 MB are not text-indexed | Stored and viewable, but their body text is absent from search |
| Categories are flat | No hierarchy, however many you accumulate |
| No undo | Deleting anything is immediate; the confirmation dialog is the only safety net |
| Saving a document overwrites it | No version history — R-10. The editor's own buffer is the only undo |
| `.docx` cannot be edited in place | Only Markdown and text round-trip; see [ADR 0009](adr/0009-compose-documents-in-app.md) |
| A stored file cannot be renamed | The item's title is editable, but the filename on disk is fixed at upload; delete and re-add to change it |
| Typed documents are capped at 5 MB | Uploads are still 200 MB; text crosses IPC rather than being a path |
| A note belongs to no category and carries no tags | Findable by kind, by text and by due date only — R-17 |
| A due date is passive | It orders the list; nothing notifies you — R-18 |
| Notes are not in the item search index | The notes screen has its own search box; one query cannot cover both |
| Single instance only | A second launch focuses the first window rather than opening another |
| `'unsafe-inline'` in the CSP | Unavoidable for a static-export Next renderer; see [07-security.md](07-security.md#unsafe-inline-on-scripts-honestly) |
