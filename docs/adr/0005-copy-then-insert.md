# 0005 · Copy the file before writing the database row

**Status:** Accepted
**Date:** 2026-08-01

## Context

Adding a file to an item means two writes to two different systems: a copy into the vault, and
a row in `assets`. A file copy cannot participate in a SQLite transaction, so one must happen
first, and a crash or error between them leaves the two disagreeing.

The two orderings fail differently, and the difference is not symmetric.

| Order | Failure leaves |
|---|---|
| Insert row, then copy file | A row pointing at a file that does not exist |
| Copy file, then insert row | A file in the vault that no row references |

## Options considered

### Insert first, then copy

Arguably more natural: the database is the source of truth, so record the intent and then
fulfil it.

Against it: the resulting state is *visibly broken*. The item appears in the list with an
attachment. Clicking it produces an error. The user has an item they cannot open and no way to
understand why. Repairing it means detecting missing files and removing rows — a reconciliation
pass that has to exist and has to be run.

### Copy first, then insert

Against it: the resulting state wastes disk. A file sits in the vault that nothing points at.

But nothing *observable* is wrong. Every item the user sees works. The waste is bounded by how
often the operation fails, which is rarely, and cleaning it up is optional rather than
necessary.

### Two-phase commit with a journal

Write an intent record, do the copy, mark it done, reconcile on startup.

Against it: correct, and disproportionate. This is a single-user desktop application, not a
distributed system. The complexity would exceed the entire asset module for a failure mode
whose worst outcome is a few wasted megabytes.

## Decision

**Copy the file into the vault first. Write the database row second. Remove the copies if the
transaction fails.**

```ts
// 1. copy into the vault — outside any transaction
const staged = await this.assetService.stage(item.id, item.createdAt, filePaths, 0)

// 2. one transaction for every database write
try {
  this.uow.run(() => {
    this.items.insert(item)
    for (const { asset } of staged) this.assetRepo.insert(asset)
    this.items.reindex(item.id, title, summary ?? '', body)
  })
} catch (error) {
  await this.assetService.discard(staged)   // unwind
  throw error
}
```

`discard` uses `Promise.allSettled` and never throws — a failure to clean up must not mask the
original error, which is the one worth reporting.

**Deletion inverts the order, for the same reason.** Row first, then the file: if the file
removal fails, the result is an orphan, which is the harmless case again.

```ts
async delete(id: string) {
  const asset = this.require(id)
  this.assets.delete(id)              // row first
  await this.store.remove(asset.relPath)  // then the file
}
```

The principle underneath both: **when two stores can disagree, choose the ordering whose
failure mode is invisible to the user.**

## Consequences

**What it buys**

- Invariant DI-6 holds: every `assets` row points at a file that exists. It is what lets the
  viewer treat a missing file as an exceptional condition (`ASSET_FILE_MISSING`) rather than a
  routine one.
- No reconciliation pass is required for correctness.
- One bad file in a multi-file upload does not leave the others half-imported —
  `AssetService.stage` unwinds everything it copied before rethrowing.

**Costs**

- Orphaned files can accumulate in the vault after a failure. Nothing currently removes them; a
  `vault gc` command would be straightforward and is not urgent.
- An orphan is not invisible on disk: an item's directory may contain a file the sidecar does
  not list. That is a hint for anyone browsing the vault, and one a cleanup tool could use.

**This ordering is why the transaction is synchronous.** If `uow.run` accepted an async
function, the copy could be moved inside it, the transaction would commit at the first `await`,
and the guarantee would silently disappear. `run<T>(work: () => T): T` makes that a compile
error.
