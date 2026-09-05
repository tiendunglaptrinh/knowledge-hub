/**
 * Schema migrations.
 *
 * Rules, borrowed from how Flyway is used on the PFM project:
 *   1. Migrations are append-only. Once a version has shipped it is immutable;
 *      correct it with a new version.
 *   2. Versions are consecutive integers starting at 1.
 *   3. Each runs inside its own transaction; a failure leaves the database at
 *      the previous version rather than half-migrated.
 *
 * They are embedded as strings rather than read from .sql files because the
 * packaged app runs from inside an asar archive, where reading a data
 * directory is possible but needlessly fragile.
 *
 * See docs/04-data-model.md.
 */

export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
-- Categories -----------------------------------------------------------------
-- parent_id exists from day one so that sub-categories can be introduced
-- without rewriting rows. v0.1 always writes NULL.
CREATE TABLE categories (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  parent_id   TEXT    REFERENCES categories(id) ON DELETE SET NULL,
  color       TEXT    NOT NULL DEFAULT '#64748b',
  icon        TEXT    NOT NULL DEFAULT 'Folder',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

-- Case-insensitive uniqueness on the display name. The slug unique index is
-- not enough: "AI" and "ai" slug identically but users still expect the
-- clearer duplicate error on the name they typed.
CREATE UNIQUE INDEX ux_categories_name_ci ON categories (lower(name));
CREATE INDEX ix_categories_parent ON categories (parent_id);
CREATE INDEX ix_categories_sort ON categories (sort_order, name);

-- Items ------------------------------------------------------------------------
CREATE TABLE items (
  id           TEXT NOT NULL PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  title        TEXT NOT NULL,
  summary      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX ix_items_category ON items (category_id, updated_at DESC);
CREATE INDEX ix_items_updated ON items (updated_at DESC);

-- Assets -----------------------------------------------------------------------
-- rel_path is relative to the vault root so the whole vault can be moved to
-- another drive by editing KB_DATA_DIR alone.
CREATE TABLE assets (
  id          TEXT    NOT NULL PRIMARY KEY,
  item_id     TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  filename    TEXT    NOT NULL,
  ext         TEXT    NOT NULL DEFAULT '',
  mime        TEXT    NOT NULL,
  size_bytes  INTEGER NOT NULL,
  rel_path    TEXT    NOT NULL UNIQUE,
  checksum    TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL
);

CREATE INDEX ix_assets_item ON assets (item_id, sort_order);
CREATE INDEX ix_assets_checksum ON assets (checksum);

-- Tags -------------------------------------------------------------------------
CREATE TABLE tags (
  id   TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_tags_name_ci ON tags (lower(name));

CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX ix_item_tags_tag ON item_tags (tag_id);

-- Full-text search --------------------------------------------------------------
-- A standalone (not external-content) FTS5 table. It duplicates title and
-- summary, which costs a little disk and removes the trigger machinery that
-- external-content tables need to stay in sync. Rows are maintained by
-- SqliteItemRepository.reindex / removeFromIndex.
CREATE VIRTUAL TABLE items_fts USING fts5(
  item_id UNINDEXED,
  title,
  summary,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
`,
  },
  {
    version: 2,
    name: 'notes',
    sql: `
-- Notes ------------------------------------------------------------------------
-- A note is written here rather than uploaded, so unlike an item it owns no
-- assets and belongs to no category. \`kind\` is a plain TEXT with a CHECK
-- rather than a lookup table: the set is closed, small, and defined in
-- src/shared/types.ts, where the UI reads it from anyway.
CREATE TABLE notes (
  id          TEXT NOT NULL PRIMARY KEY,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'study'
                CHECK (kind IN ('study','daily','deadline','task','idea','meeting','snippet','other')),
  format      TEXT NOT NULL DEFAULT 'markdown'
                CHECK (format IN ('markdown','text')),
  content     TEXT NOT NULL DEFAULT '',
  -- ISO-8601 UTC, or NULL for an undated note. Notes that have one sort above
  -- those that do not, which is the whole point of a deadline note.
  due_at      TEXT,
  done_at     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX ix_notes_updated ON notes (updated_at DESC);
CREATE INDEX ix_notes_kind    ON notes (kind, updated_at DESC);
-- Partial: only dated, still-open notes are ever ordered by due_at.
CREATE INDEX ix_notes_due     ON notes (due_at) WHERE due_at IS NOT NULL AND done_at IS NULL;

-- Same standalone-FTS5 approach as items_fts, and for the same reason: no
-- triggers to silently stop firing. Maintained by SqliteNoteRepository.
CREATE VIRTUAL TABLE notes_fts USING fts5(
  note_id UNINDEXED,
  title,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);
`,
  },
  {
    version: 3,
    name: 'note_rel_path',
    sql: `
-- Where the note's mirror file actually is.
--
-- Until now the filename began with the note id, so the file belonging to a
-- note could always be found by scanning the directory for that prefix. Names
-- are now slugged from the title (\`on-tap-spring-security.md\`) and carry no
-- id, which is far more useful to a person browsing the vault and leaves
-- nothing to scan for — so the path is recorded.
--
-- Empty string, not NULL, for rows written before this migration: "not known
-- yet" and "no file" are the same state here, and the next save fills it in.
ALTER TABLE notes ADD COLUMN rel_path TEXT NOT NULL DEFAULT '';
`,
  },
  {
    version: 4,
    name: 'checklists',
    sql: `
-- Checklists -------------------------------------------------------------------
-- Two kinds share one table because they are the same thing — a plan with
-- tasks — differing only in what identifies them and in how a task's priority
-- is expressed. Splitting them would duplicate the tasks table as well.
--
-- The CHECK is the load-bearing part: it makes "a daily plan with a title" and
-- "a module plan pinned to a day" unrepresentable rather than merely rejected
-- by a service that could be bypassed.
CREATE TABLE checklists (
  id          TEXT NOT NULL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('daily','module')),
  -- 'YYYY-MM-DD' in the user's own timezone. A calendar day, not an instant:
  -- the plan for the 5th must stay on the 5th regardless of the clock.
  day         TEXT,
  title       TEXT,
  description TEXT,
  due_at      TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (
    (kind = 'daily'  AND day IS NOT NULL AND title IS NULL)
    OR
    (kind = 'module' AND day IS NULL     AND title IS NOT NULL)
  )
);

-- One day, one plan. Partial, so every module row (day IS NULL) is exempt
-- rather than colliding with every other module row.
CREATE UNIQUE INDEX ux_checklists_day ON checklists (day) WHERE day IS NOT NULL;
CREATE INDEX ix_checklists_kind ON checklists (kind, day DESC, updated_at DESC);

-- Tasks --------------------------------------------------------------------------
-- parent_id is a self-reference one level deep: a big task and its break-down.
-- The depth limit is a service rule, not a schema one — SQLite cannot express
-- "at most one level" without a trigger, and the service is the only writer.
--
-- priority and quadrant are both nullable and mutually exclusive in practice:
-- a daily task carries the first, a module task the second, and a sub-task
-- neither, because it inherits the standing of the task it breaks down.
CREATE TABLE checklist_tasks (
  id           TEXT NOT NULL PRIMARY KEY,
  checklist_id TEXT NOT NULL REFERENCES checklists(id)      ON DELETE CASCADE,
  parent_id    TEXT          REFERENCES checklist_tasks(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  due_at       TEXT,
  status       TEXT NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo','doing','done')),
  priority     TEXT CHECK (priority IS NULL OR priority IN ('high','normal')),
  quadrant     TEXT CHECK (quadrant IS NULL OR
                           quadrant IN ('do','schedule','delegate','eliminate')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  done_at      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX ix_checklist_tasks_owner  ON checklist_tasks (checklist_id, parent_id, sort_order);
CREATE INDEX ix_checklist_tasks_parent ON checklist_tasks (parent_id);
-- Only open, dated tasks are ever ordered by due_at, so the index carries only
-- those — the same shape as ix_notes_due.
CREATE INDEX ix_checklist_tasks_due    ON checklist_tasks (due_at)
  WHERE due_at IS NOT NULL AND status <> 'done';
`,
  },
]

/** The version a freshly migrated database ends up at. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version
