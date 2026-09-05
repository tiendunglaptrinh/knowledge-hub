# 0002 · Store metadata in SQLite and files on the filesystem

**Status:** Accepted
**Date:** 2026-08-01

## Context

The application stores two kinds of thing: metadata (categories, titles, tags, relationships)
and documents (PDF, `.docx`, Markdown, images). These have opposite access patterns. Metadata
is small, queried constantly, and needs joins and full-text search. Documents are large, written
once, and read whole.

## Options considered

### Filesystem only, with JSON sidecars

One directory per item, an `item.json` beside the files, no database.

For it: browsable and comprehensible with no tooling; trivially diffable in git; nothing to
corrupt.

Against it: every query is a full scan of the tree. Listing categories with counts means
reading every sidecar. Full-text search means opening every document on every keystroke. On a
`/mnt/*` mount, where each `stat` crosses a filesystem bridge, this degrades from slow to
unusable within a few hundred items.

### SQLite only, files as BLOBs

Everything in one file.

For it: one file to back up; atomic writes for both metadata and content.

Against it: the database grows to the size of every document ever added. A 200 MB PDF is a 200
MB row. The user cannot open a document with Word without the application exporting it first,
which breaks the *files stay files* goal outright. And a single corrupted file loses everything
rather than the index.

### SQLite for metadata, files on disk

Metadata in `knowledge.db`, documents in `assets/YYYY/MM/<itemId>/`, referenced by relative
path.

Against it: two things to keep consistent. A file write is not part of the SQLite transaction,
so a crash between them leaves them disagreeing.

## Decision

**SQLite for metadata, files on the filesystem, with a JSON sidecar next to each item's files.**

Each store does what it is good at. The consistency problem is real but bounded, and is solved
by ordering: copy the file first, write the row second, unwind the copy if the transaction
fails ([ADR 0005](0005-copy-then-insert.md)). That leaves exactly one failure mode — an
unreferenced file — and it is harmless.

The sidecar takes the third option's main advantage back. `item.json` mirrors the metadata next
to the files, so the vault stays comprehensible without the application and the index can be
rebuilt from the vault alone. SQLite remains authoritative; the sidecar is a recovery aid.

## Consequences

**What it buys**

- Listing a category with counts and tags is one query, no N+1.
- FTS5 gives diacritic-insensitive full-text search over document contents for free.
- Documents are openable by Word, Acrobat and a file manager, unmodified.
- Backup is `cp -r` of one directory.
- Losing the index does not lose documents.

**Costs**

- Two stores to keep consistent, handled by the ordering rule.
- The sidecar duplicates metadata and can go stale if written outside the application. It is
  explicitly not authoritative, so this is a recovery-quality issue, not a correctness one.
- `knowledge.db` is a binary blob for version control — every commit stores a whole new copy.
  Noted in [06-storage-layout.md](../06-storage-layout.md#version-control) so the choice is
  informed.

**Revisit if** the vault ever needs to be shared or synced, at which point the consistency
model changes shape entirely and this decision is not the one to patch.
