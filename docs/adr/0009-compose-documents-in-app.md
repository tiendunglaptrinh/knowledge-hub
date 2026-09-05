# 0009 · A composed document is an ordinary asset, and assets become editable

**Status:** Accepted
**Date:** 2026-08-02

## Context

Until now a category could only hold files that already existed. Someone who wanted to write
something had to leave the application, open an editor, save a `.md` somewhere, come back and
upload it — and then had no way to fix a typo except to repeat the whole loop.

Two things were being asked for at once, and they are separable:

1. **Write a document here**, with a live preview, the way the note editor already works.
2. **Edit it afterwards**, which is the half that makes the first half worth having.

The second is the awkward one. `assets/` was built on an invariant that made everything else
simple: *a stored file is never modified after it is written*. That is what lets the backup
advice say "copy `assets/` whenever you like", what makes the `checksum` column meaningful as a
fingerprint, and what makes [ADR 0005](0005-copy-then-insert.md)'s copy-then-insert ordering
sufficient.

## Options considered

### A composed document is a new entity, beside items and notes

A third table, `documents`, with its content in a column.

**Against it:** it would be the second place the application stores prose, three months after
[ADR 0008](0008-notes-as-a-separate-entity.md) argued for the first. And the argument that
justified separating *notes* does not transfer: a note has no category, no tags and no
attachments, whereas a composed document has all three and sits alongside a PDF in the same
item. It is an attachment. The only thing that differs is where the bytes came from, which is
not a property worth a table.

### Composed documents are assets, but flagged, and only flagged ones are editable

Add `is_composed` to `assets`.

**For it:** the immutability invariant survives for uploaded files, which is where it matters
most — nobody edits a PDF here.

**Against it:** it makes provenance a permanent property of the file, and provenance is exactly
what should stop mattering the moment the bytes are on disk. A `.md` the user uploaded and a
`.md` the user typed are the same file; refusing to edit one of them because of how it arrived
is a rule the user would experience as arbitrary. It also breaks the general rule in
[04-data-model.md](../04-data-model.md#derived-not-stored): *store what the user gave you,
derive what you decided.* Editability is a decision, and it is derivable — from the kind.

### Assets are editable when their kind is editable

No new column. `classifyAsset(ext)` already answers "what is this", and the editor is offered
for `markdown` and `text`.

**Against it:** the immutability invariant is genuinely lost, and it has to be replaced with
something rather than merely abandoned.

## Decision

**A composed document is an ordinary `assets` row**, in the item's directory, with the same
`<assetId>-<name>` filename shape, the same checksum discipline and the same search indexing.
`ComposedDocument` exists only as an input to `item:create` and `asset:compose`; nothing
downstream can tell the difference, and no column records one.

**Editability is derived from `AssetKind`.** `markdown` and `text` round-trip; `pdf`, `image`
and `other` have no editor. `word` is excluded deliberately — mammoth converts one way, and
writing back an approximation of a `.docx` would destroy formatting nobody asked us to touch.
`AssetService.requireEditable` enforces this, so hiding the button is a UI courtesy rather than
the mechanism.

**The lost invariant is replaced by an atomic write.** `FsAssetStore.replaceText` writes to a
temporary name in the same directory and `rename`s it over the target. A rename within one
filesystem is atomic, so the weaker property that actually matters is preserved:

> A reader of `assets/` sees either the whole old version of a file or the whole new one, never
> a partial write.

That is what the "copy the vault while it is running" advice depended on, and it still holds.

**The file is written before the row is updated**, inverting nothing from ADR 0005: if the row
update then failed, the result is a correct file with a stale recorded size and checksum —
wrong metadata about real bytes, which a re-save fixes — rather than a row describing bytes
that were never written.

## Consequences

**What it buys**

- One kind of document. The viewer, the search index, external-open, reveal-in-folder, delete
  and the `item.json` sidecar all work on a composed document without a line of new code,
  because there was never anything to special-case.
- Editing works on uploaded Markdown too. That was not the request, and it is the feature
  people will use most: a `.md` dragged in from Obsidian is now fixable in place.
- `checksum` keeps meaning "the fingerprint of what is on disk right now", because the row is
  updated in the same operation.

**Costs**

- **`assets` rows are no longer write-once.** Anything later that assumes a checksum is stable
  for the life of a row — deduplication across items, a content-addressed store, an incremental
  backup keyed on checksum — has to account for edits. `findByChecksum` is currently used only
  within one item at upload time, so nothing breaks today.
- **No version history.** Saving overwrites. For a document being drafted that is the expected
  behaviour, but there is no undo beyond the editor's own buffer, and the temporary file is
  gone the moment the rename completes. [R-10](../11-roadmap.md) covers versioning and is
  larger than it looks.
- **A 5 MB ceiling on typed content**, far below the 200 MB upload limit. Text arrives over IPC
  rather than as a path, so it is structured-cloned; a five-megabyte textarea is a paste loop,
  not an essay.
- The editor holds the whole document in renderer memory. Fine at 5 MB, and the reason the
  ceiling exists.

**What would make this worth revisiting:** wanting to edit a `.docx` in place. That needs a
writer, not a converter, and is a different project — recorded as out of scope in
[ADR 0006](0006-document-rendering.md).
