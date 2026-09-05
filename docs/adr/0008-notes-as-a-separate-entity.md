# 0008 · Notes are a separate entity, not an item without files

**Status:** Accepted
**Date:** 2026-08-02

## Context

The application stores **items**: a title, a summary, tags, a category, and one or more files
copied in from outside. Everything about that model assumes the file came first — the title
autofills from the filename, the card shows an extension chip and an attachment count, the
search index is built from extracted document text.

The new requirement is different in kind: the user wants to *write* something. A lesson
summary, a diary entry, a deadline to remember. No file arrives, nothing is uploaded, and the
thing that matters most about a deadline — when it is due — has no home anywhere in the item
model.

`items` already exists, has a search index, has a list projection, and has a UI. Reusing it is
the obvious move and the one worth arguing about.

## Options considered

### A note is an item with no assets

Add `kind`, `format`, `content` and `due_at` to `items`; a note is a row where `assetCount` is
zero.

**For it:** one table, one repository, one search index, one list screen. Search covers notes
for free. A note could be filed in a category and tagged on day one, which
[R-17](../11-roadmap.md) now has to add later.

**Against it:** every query grows a clause that says "but not the ones that are really notes".

- `category_id` is `NOT NULL` with `ON DELETE RESTRICT`. A note has no category, so either the
  column becomes nullable — weakening the constraint that protects every document — or the user
  is forced to pick a category before they can write a sentence.
- The list projection computes `primary_ext` and `asset_count`. Both are meaningless for a
  note, and both are in the `SELECT` of every list screen.
- `ORDER BY updated_at DESC` is right for documents and wrong for notes, which have to order by
  `due_at` first. One table cannot have two orderings without every call site choosing.
- The recent list and the category lists would have to exclude notes, and the notes list would
  have to exclude documents. That is four filters that must never be forgotten.
- `format` would be a column that is meaningful for a note and meaningless for an item, sitting
  beside `ext`, which is the reverse.

The pattern is familiar: a shared table where half the columns are `NULL` for half the rows,
and every query carries a discriminator. It is cheap to write and expensive to read.

### A note is a file in the vault, indexed as an item

Write the note to `assets/…` as a `.md` and let the existing pipeline index it.

**For it:** maximum reuse — the viewer, the search index and the storage layout all already
handle Markdown.

**Against it:** editing. Every save would be a file rewrite plus a re-extract plus a reindex,
through an `AssetStore` designed around *copy once, never modify* — the property that lets
`assets/` be backed up while the application is running. A due date still has nowhere to live
except front matter the application would have to parse back out on every read. This trades a
small schema for a large amount of parsing.

### A separate table

Two tables with nothing in common, two FTS indexes, two list screens.

**Against it:** duplicated shape. `notes` looks a lot like `items` at a glance: id, title,
timestamps, a search index, a repository with the same method names.

## Decision

**A note is its own entity.** Migration 2 adds `notes` and `notes_fts`. A note has no category,
no tags and no assets, and `NoteService` never touches `ItemService`.

The duplication is real but shallow: `SqliteNoteRepository` shares `toMatchExpression` with the
item repository, so both search boxes treat a stray `"` identically, and `FsNoteStore` shares
`resolveInVault` with the asset store, so the path check exists once. What is *not* shared is
the part that differs — the ordering, the projection, the validation.

The rule this follows: **two small tables with nothing in common cost less than one table with
two meanings.**

## Consequences

**What it buys**

- `items.category_id` stays `NOT NULL`, and `ON DELETE RESTRICT` keeps protecting documents.
- Note ordering lives in one `ORDER BY` — open-and-dated first by `due_at`, then open-and
  -undated by recency, then done — so a deadline surfaces itself even under a `LIMIT`. That is
  the feature, and it would not have survived being merged with `updated_at DESC`.
- `NoteService` is 200 lines with no collaborators except its repository, its store and the
  unit of work. It is the easiest service in the application to reason about.
- Adding a note field cannot break a document query.

**Costs**

- **A note cannot be filed in a category or tagged.** This is the real price, and the most
  likely thing to be asked for — [R-17](../11-roadmap.md) scopes it as a nullable `category_id`
  plus a `note_tags` table. Nullable is the right shape there precisely because it is *not*
  what `items` needs.
- **One search box cannot search both.** The header search queries notes on the notes screen
  and documents everywhere else, and clears when the user crosses between them. A single
  index would need a type column and a result list the UI has to split again.
- Some structural repetition between the two repositories. If a third entity of this shape ever
  appears, that is the signal to extract a base rather than to have written one table.

**What would make this worth revisiting:** notes and items becoming genuinely
interchangeable — if a note routinely grows attachments, or documents routinely acquire due
dates, the two models have converged and the merge that was wrong here becomes right.
