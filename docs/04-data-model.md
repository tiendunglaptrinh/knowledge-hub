# 04 · Data model

Authoritative schema: `src/storage/migrations.ts`. This document explains it.

---

## Entities

```
categories ──1───────< items ──1───────< assets
                         │
                         └──< item_tags >── tags

notes       (stands alone — no category, no assets, no tags)

checklists ──1───────< checklist_tasks ──1───< checklist_tasks   (one level deep)

items_fts   (FTS5, one row per item, maintained by the repository)
notes_fts   (FTS5, one row per note, maintained by the repository)
```

| Entity | Cardinality | Notes |
|---|---|---|
| `categories` | — | Flat in v0.1; `parent_id` reserved for nesting |
| `items` | one category, many items | The unit the user thinks in |
| `assets` | one item, many assets | One stored file each |
| `tags` | many-to-many with items | Global, not scoped to a category |
| `notes` | — | Written in the app, not uploaded. Unrelated to every table above |
| `checklists` | — | A plan: one per calendar day, or one per body of work |
| `checklist_tasks` | one checklist, many tasks | Self-referencing once: a big task and its break-down |
| `items_fts` | one row per item | Search index, not a source of truth |
| `notes_fts` | one row per note | Same, for notes |

**Notes are deliberately not items.** They were prototyped as an item with no assets, and every
query grew a "but not the ones that are really notes" clause: the category becomes a required
field with nothing to put in it, `primaryExt` is meaningless, the asset count is always zero,
and a due date belongs to none of it. Two small tables with nothing in common cost less than
one table with two meanings. Recorded in full as [ADR 0008](adr/0008-notes-as-a-separate-entity.md);
the consequence — a note cannot live in a category and cannot be tagged — is in
[11-roadmap.md](11-roadmap.md).

**Checklists are not notes either, for the same reason and with the same test.** A note is a
body of text with a title; a checklist is a set of rows with state, ranking and a percentage
over them. Modelling tasks as lines inside a note's `content` would mean parsing Markdown to
answer "how much of this week is done", and every tick would rewrite the whole body. The two
kinds of checklist *do* share a table, because they differ in exactly two ways — what
identifies them, and which column their rank lives in — and a `CHECK` expresses that better
than a second pair of tables would.

---

## Tables

### `categories`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `name` | TEXT NOT NULL | 1–60 chars, as typed by the user |
| `slug` | TEXT NOT NULL UNIQUE | ASCII, diacritics transliterated |
| `parent_id` | TEXT NULL → categories | Always NULL in v0.1 |
| `color` | TEXT NOT NULL | Hex, default `#64748b` |
| `icon` | TEXT NOT NULL | Lucide icon name, default `Folder` |
| `sort_order` | INTEGER NOT NULL | Insertion order |
| `created_at` / `updated_at` | TEXT NOT NULL | ISO-8601 UTC |

Indexes: `ux_categories_name_ci` on `lower(name)`, `ix_categories_parent`,
`ix_categories_sort`.

**Two uniqueness constraints, on purpose.** The slug is unique because it is a key. The *name*
is separately unique, case-insensitively, because `AI` and `ai` produce the same slug and the
user who typed the second one deserves "that name is taken" rather than a silent
`ai-2`.

### `items`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `category_id` | TEXT NOT NULL → categories **ON DELETE RESTRICT** | |
| `title` | TEXT NOT NULL | 1–200 chars |
| `summary` | TEXT NULL | Empty string is normalised to NULL |
| `created_at` / `updated_at` | TEXT NOT NULL | ISO-8601 UTC |

Indexes: `ix_items_category (category_id, updated_at DESC)`, `ix_items_updated (updated_at DESC)`.

**`ON DELETE RESTRICT` is the schema half of a two-layer rule.** `CategoryService.delete`
already refuses a non-empty category with `CATEGORY_NOT_EMPTY`; the constraint means that even
a bug that bypasses the service cannot cascade-delete a category's worth of documents.

**`created_at` decides where an item's files live** (`assets/YYYY/MM/<itemId>/`), so it is
never updated.

### `assets`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID v4. Not in the filename — see `rel_path` |
| `item_id` | TEXT NOT NULL → items **ON DELETE CASCADE** | |
| `filename` | TEXT NOT NULL | Original name, as chosen by the user |
| `ext` | TEXT NOT NULL | Lowercase, no dot; `''` when absent |
| `mime` | TEXT NOT NULL | From the extension table |
| `size_bytes` | INTEGER NOT NULL | |
| `rel_path` | TEXT NOT NULL UNIQUE | POSIX-style, relative to the vault root. The last segment is a *slug*, not `filename` |
| `checksum` | TEXT NOT NULL | SHA-256 hex |
| `sort_order` | INTEGER NOT NULL | Display order within the item |
| `created_at` | TEXT NOT NULL | |

Indexes: `ix_assets_item (item_id, sort_order)`, `ix_assets_checksum`.

**`rel_path` is relative, and the UNIQUE is on it.** Relative because the whole vault must be
movable to another drive by editing one environment variable; unique because two rows pointing
at one file would make deleting either one break the other.

**`filename` and the stored name are different strings, deliberately.** `filename` is what the
user chose and what every screen shows — `OWASP Tổng Hợp.PDF`. The file on disk is
`owasp-tong-hop.pdf`, because a stored name has to be boring on every filesystem. See
[06-storage-layout.md](06-storage-layout.md#stored-names).

**`ext` and `mime` are stored, `kind` is not.** See below.

**`size_bytes` and `checksum` are the only columns that ever change.** Editing a Markdown or
text asset rewrites the file and updates those two; `rel_path` deliberately cannot move, which
is why the repository exposes the narrow `updateContent` rather than a general `update`. A
moved path with a live file behind it is DI-6 gone.

#### Composed documents

A document typed in the editor is an `assets` row like any other: same directory, same naming
rule, same checksum, same search indexing. **No column records that it
was composed rather than uploaded**, because nothing downstream should behave differently —
and because provenance is a decision, not something the user gave us. `ComposedDocument`
exists only as an input shape on `item:create` and `asset:compose`.

**Editability is derived from `AssetKind`**, the same way the viewer is: `markdown` and `text`
round-trip, `word` deliberately does not. Reasoning in
[ADR 0009](adr/0009-compose-documents-in-app.md).

### `tags` and `item_tags`

`tags(id, name)` with `ux_tags_name_ci` on `lower(name)`; `item_tags(item_id, tag_id)` with a
composite primary key and `ix_item_tags_tag`.

Tags are global rather than per-category: `spring-boot` means the same thing under *Software*
as under *Phỏng vấn*, and the entire value of a tag is that it cuts across the category tree.

Orphans are pruned whenever an item's tags change or an item is deleted, so the tag list never
accumulates names nothing references.

### `notes`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID v4. Not in the filename — see `rel_path` |
| `title` | TEXT NOT NULL | 1–200 chars, trimmed and whitespace-collapsed |
| `kind` | TEXT NOT NULL | `study` · `daily` · `deadline` · `task` · `idea` · `meeting` · `snippet` · `other`, with a `CHECK` |
| `format` | TEXT NOT NULL | `markdown` or `text`, with a `CHECK`. Default `markdown` |
| `content` | TEXT NOT NULL | The body as typed. Empty string, never NULL |
| `due_at` | TEXT NULL | ISO-8601 UTC. Required when `kind = 'deadline'` |
| `done_at` | TEXT NULL | Set when ticked off; done notes sort last |
| `rel_path` | TEXT NOT NULL | Where the mirror file is. `''` until one has been written |
| `created_at` / `updated_at` | TEXT NOT NULL | ISO-8601 UTC |

Indexes: `ix_notes_updated (updated_at DESC)`, `ix_notes_kind (kind, updated_at DESC)`, and the
partial `ix_notes_due (due_at) WHERE due_at IS NOT NULL AND done_at IS NULL` — the only rows
ever ordered by `due_at` are the dated, still-open ones, so the index covers those and nothing
else.

**`kind` and `format` are stored with a `CHECK`, not in a lookup table.** Both sets are closed,
small, and already defined in `src/shared/types.ts`, which is where the UI reads them from. A
lookup table would add a join to every query and a migration to every new kind, to enforce
something the type system enforces at compile time and SQLite enforces at write time.

**This is the exception to "derive what you decided"** ([below](#derived-not-stored)). `format`
looks like `AssetKind` and is not: an asset's kind is inferred from a filename the user gave
us, whereas a note has no filename until we write one — the format *is* the user's choice, so
it is stored.

**The ordering is in SQL, not in a service.** Open-and-dated first by `due_at`, then open-and
-undated by recency, then everything done. It cannot be reproduced faithfully in JavaScript
without reading every row, which defeats the `LIMIT`.

### `checklists`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `kind` | TEXT NOT NULL | `daily` or `module`, with a `CHECK` |
| `day` | TEXT NULL | `YYYY-MM-DD` **in the user's own calendar**, not an instant. Required for `daily`, forbidden for `module` |
| `title` | TEXT NULL | Required for `module`, forbidden for `daily` |
| `description` | TEXT NULL | Free text, kept as typed minus the surrounding whitespace |
| `due_at` | TEXT NULL | ISO-8601 UTC. `module` only |
| `created_at` / `updated_at` | TEXT NOT NULL | ISO-8601 UTC. `updated_at` is bumped by any task change |

Indexes: the partial `ux_checklists_day (day) WHERE day IS NOT NULL` — one plan per day, with
every module row exempt rather than colliding — and `ix_checklists_kind (kind, day DESC,
updated_at DESC)`.

**The kind rule is a `CHECK`, not a service rule.**

```sql
CHECK (
  (kind = 'daily'  AND day IS NOT NULL AND title IS NULL)
  OR
  (kind = 'module' AND day IS NULL     AND title IS NOT NULL)
)
```

That makes "a daily plan with a title" and "a module plan pinned to a date" *unrepresentable*
rather than merely rejected by a layer that could be bypassed — by a future importer, or by
`sqlite3` on the command line.

**`day` is a calendar day, deliberately not a timestamp.** The plan for the 5th belongs to the
5th wherever the user is. Stored as an instant it would be the 4th for anyone east of
Greenwich after 17:00, and the unique index would stop meaning "one plan per day". The renderer
converts with `dayOf()`, which reads the *local* date rather than `toISOString().slice(0, 10)`.

### `checklist_tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `checklist_id` | TEXT NOT NULL | → `checklists(id)` `ON DELETE CASCADE` |
| `parent_id` | TEXT NULL | → `checklist_tasks(id)` `ON DELETE CASCADE`. NULL for a top-level task |
| `title` | TEXT NOT NULL | 1–200 chars, trimmed and whitespace-collapsed |
| `description` | TEXT NULL | Kept as typed; line breaks survive |
| `due_at` | TEXT NULL | ISO-8601 UTC |
| `status` | TEXT NOT NULL | `todo` · `doing` · `done`, with a `CHECK`. Default `todo` |
| `priority` | TEXT NULL | `high` or `normal`. Set on a top-level task of a `daily` plan |
| `quadrant` | TEXT NULL | `do` · `schedule` · `delegate` · `eliminate`. Set on a top-level task of a `module` plan |
| `sort_order` | INTEGER NOT NULL | Position among siblings. Renumbered 0…n on every move |
| `done_at` | TEXT NULL | Stamped when the status first becomes `done`, kept if it is ticked again |
| `created_at` / `updated_at` | TEXT NOT NULL | ISO-8601 UTC |

Indexes: `ix_checklist_tasks_owner (checklist_id, parent_id, sort_order)`,
`ix_checklist_tasks_parent (parent_id)`, and the partial
`ix_checklist_tasks_due (due_at) WHERE due_at IS NOT NULL AND status <> 'done'` — the same
shape, and the same reasoning, as `ix_notes_due`.

**A sub-task carries neither rank.** It inherits the standing of the task it breaks down, which
is what keeps the drag rule meaningful: every sibling of a sub-task is in the same group by
construction, so reordering a break-down never has to be refused.

**One level of nesting is a service rule, not a schema one.** SQLite cannot express "at most one
level" without a trigger, and `ChecklistService` is the only writer — see
`CHECKLIST_TASK_NESTING_TOO_DEEP`.

**Ordering is *not* in SQL here, unlike notes.** The rank that decides which group comes first
is a mapping in `src/core/domain/checklist.ts` (`PRIORITY_RANK`, `QUADRANT_RANK`); expressing it
in `ORDER BY` would mean a `CASE` expression that has to be edited in step with the domain
file. Rows come back grouped by parent and by `sort_order`, and the service sorts them with
`compareTasks`.

### `items_fts` and `notes_fts`

```sql
CREATE VIRTUAL TABLE items_fts USING fts5(
  item_id UNINDEXED, title, summary, body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  note_id UNINDEXED, title, content,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

Two indexes rather than one, because the two searches are two different questions asked from
two different screens; a single index would need a type column, a filter on every query, and a
result set the UI has to split again.

Both are standalone FTS5 tables, not external-content ones. External-content tables avoid duplicating
the text but require three triggers to stay in sync, and a trigger that silently stops firing
produces a search index that is quietly wrong. Here `SqliteItemRepository.reindex` and
`SqliteNoteRepository.reindex` each delete and re-insert one row, from code that is easy to
follow. Both take their MATCH expression from the same `toMatchExpression` in
`src/storage/sqlite/fts.ts`, so a `"` typed into either search box behaves identically.

`remove_diacritics 2` is what makes `ghi chu` find `ghi chú` — the mode that handles
multi-codepoint sequences, which Vietnamese needs.

`body` holds the extracted plain text of every readable asset on the item. PDFs contribute
nothing yet (see [11-roadmap.md](11-roadmap.md)); files above 2 MB are skipped.

---

## Derived, not stored

`AssetKind` — whether something is a `pdf`, `word`, `markdown`, `text`, `image` or `other` — is
computed from `ext` by `classifyAsset()` every time it is needed.

The alternative, a `kind` column, is tempting and wrong. The day `.pptx` gets a viewer, a stored
column means a migration that rewrites existing rows, and every row written by an older version
is stale. A derived value means one entry in one table in `src/core/domain/asset-kind.ts`, and
every existing row is instantly correct.

The general rule: **store what the user gave you; derive what you decided.** `filename` and
`ext` came from the user. `kind` is our interpretation, and interpretations change.

The same rule is why *whether an asset can be edited* has no column: it follows from `kind`,
which follows from `ext`. And it is why a note's `format` **is** stored — a note has no filename
to infer it from, so the format is the user's own answer rather than ours.

---

## Invariants

| # | Invariant | Enforced by |
|---|---|---|
| DI-1 | Category names are unique, case-insensitively | `ux_categories_name_ci` + `CategoryService.assertNameFree` |
| DI-2 | Category slugs are unique | `slug UNIQUE` + `uniqueSlug()` |
| DI-3 | A category with items cannot be deleted | `ON DELETE RESTRICT` + `CATEGORY_NOT_EMPTY` |
| DI-4 | Deleting an item removes its assets and tag links | `ON DELETE CASCADE` |
| DI-5 | Deleting an item removes its files from the vault | `ItemService.delete` → `store.removeItemDir` |
| DI-6 | Every `assets` row points at a file that exists | Copy-then-insert ordering; [ADR 0005](adr/0005-copy-then-insert.md) |
| DI-7 | `rel_path` never escapes the vault | `FsAssetStore.resolve` throws `VAULT_PATH_ESCAPE` |
| DI-8 | Every item has exactly one `items_fts` row | `reindex` deletes then inserts; `delete` removes |
| DI-9 | No tag exists without an item referencing it | `pruneOrphans()` after every tag mutation |
| DI-10 | `created_at` never changes | Not bound in any UPDATE statement |
| DI-11 | Every note has exactly one `notes_fts` row | `SqliteNoteRepository.reindex` / `removeFromIndex` |
| DI-12 | A `deadline` note always has a `due_at` | `NoteService.create` / `.update` raise `NOTE_DUE_REQUIRED` |
| DI-13 | A note's file in the vault matches its current title and format | `FsNoteStore.write` sweeps the note's earlier files |
| DI-14 | Deleting a note removes its file from the vault | `NoteService.delete` → `store.remove` |
| DI-15 | `rel_path` never changes once written | Only `updateContent` can touch an asset row |
| DI-16 | A row's `size_bytes` and `checksum` describe the bytes currently on disk | The file is written first, the row updated immediately after |
| DI-17 | A reader never sees a partially written asset | `replaceText` writes to a temp name and `rename`s over the target |
| DI-18 | Only `markdown` and `text` assets can be rewritten | `AssetService.requireEditable` raises `ASSET_NOT_EDITABLE` |
| DI-19 | Two files in one directory never share a stored name | The write is an exclusive create; `-2`, `-3` … on `EEXIST` |
| DI-20 | A note's `rel_path` points at its current file, or is empty | Set after each successful mirror write; the previous file is removed |
| DI-21 | A calendar day holds at most one checklist | `ux_checklists_day` + `CHECKLIST_DAY_TAKEN` |
| DI-22 | A `daily` checklist has a day and no title; a `module` checklist has a title and no day | The `CHECK` on `checklists` |
| DI-23 | A checklist always holds at least one top-level task | `ChecklistService.create` and `.deleteTask` raise `CHECKLIST_EMPTY` |
| DI-24 | Deleting a checklist removes every task under it | `ON DELETE CASCADE`, armed by `PRAGMA foreign_keys = ON` |
| DI-25 | Sub-tasks are one level deep | `ChecklistService.addTask` raises `CHECKLIST_TASK_NESTING_TOO_DEEP` |
| DI-26 | A big task's status agrees with its break-down | `statusFromChildren` after every child change; a tick on the parent cascades down |
| DI-27 | A task is only ever reordered among siblings of equal rank | `ChecklistService.moveTask` raises `CHECKLIST_TASK_PRIORITY_MISMATCH`; the drop target refuses the gesture first |
| DI-28 | An older build never writes to a vault a newer build has migrated | `openDatabase` refuses a `user_version` above `LATEST_SCHEMA_VERSION` with `VAULT_TOO_NEW` |

DI-3 through DI-28 are covered by `npm run smoke`.

---

## Migration policy

Same discipline as Flyway on a server project.

1. **Append-only.** A shipped migration is immutable. Fix it with a new version.
2. **Consecutive integers**, starting at 1.
3. **One transaction each.** A failure leaves the database at the previous version, never
   half-migrated.
4. **Embedded as strings** in `src/storage/migrations.ts`, not read from `.sql` files — the
   packaged app runs from inside an asar archive, where reading a data directory is possible
   but needlessly fragile.

The current version is tracked in `PRAGMA user_version`, a 32-bit integer in the SQLite file
header. No table of its own, and it cannot drift out of sync with the schema it describes.

**A vault from the future is refused, not opened.** Migrations only move forward, so a
`user_version` above `LATEST_SCHEMA_VERSION` means a newer build has been here — one that added
tables and columns this code knows nothing about. `openDatabase` throws `VAULT_TOO_NEW` before
touching anything, and the application shows a native dialog saying so.

Continuing would not fail cleanly, which is the point: queries would keep succeeding against the
columns that still exist, and every write would quietly leave the newer version's data
inconsistent. Note that this guard is only worth anything in the **older** application — a check
added alongside a future migration protects nobody running today's build, which is why it ships
before the first release anyone else installs.

### Shipped migrations

| Version | Name | What it added |
|---|---|---|
| 1 | `initial_schema` | `categories`, `items`, `assets`, `tags`, `item_tags`, `items_fts` |
| 2 | `notes` | `notes` and `notes_fts` |
| 3 | `note_rel_path` | `notes.rel_path` — needed once filenames stopped carrying the note id |
| 4 | `checklists` | `checklists` and `checklist_tasks` |

Migrations 2 to 4 only add tables and a defaulted column, so an older vault upgrades on next
launch with no rewrite of existing rows and nothing to undo if one fails.

### Adding a migration

```ts
// src/storage/migrations.ts
{
  version: 5,
  name: 'add_item_favourite',
  sql: `ALTER TABLE items ADD COLUMN is_favourite INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX ix_items_favourite ON items (is_favourite) WHERE is_favourite = 1;`,
}
```

Then: update `rows.ts`, the repository, the DTO in `src/shared/types.ts`, and this document.

### What SQLite will not let you do

No `DROP COLUMN` before 3.35, no `ALTER COLUMN` at all. Changing a column's type or constraints
means the twelve-step dance: create the new table, copy, drop, rename — inside one migration,
with `PRAGMA foreign_keys` handled correctly. Design the column right the first time where you
can.

---

## PRAGMA settings

Set in `openDatabase`:

| Pragma | Value | Why |
|---|---|---|
| `journal_mode` | `WAL` | Readers do not block the writer; far better crash behaviour mid-write |
| `synchronous` | `NORMAL` | Safe under WAL, and avoids an fsync per commit — which matters on a `/mnt/*` drive |
| `foreign_keys` | `ON` | Off by default in SQLite. Every FK here is load-bearing |
| `busy_timeout` | `5000` | Wait rather than throw `SQLITE_BUSY` under brief contention |

On shutdown, `wal_checkpoint(TRUNCATE)` runs before `close()`, so a `-wal` file does not
survive a quit and confuse a later backup.
