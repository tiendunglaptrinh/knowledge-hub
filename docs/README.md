# Documentation

## How to read this

Documents are numbered in the order they answer questions for someone new to the project.
Read 01 → 03 for orientation; the rest is reference you consult when touching that area.

| # | Document | Read it when |
|---|---|---|
| 01 | [Overview](01-overview.md) | You want to know what this is and what it deliberately is not |
| 02 | [Requirements](02-requirements.md) | You are adding a feature and need to know if it belongs |
| 03 | [Architecture](03-architecture.md) | You are changing anything structural |
| 04 | [Data model](04-data-model.md) | You are touching the schema, an entity or a migration |
| 05 | [IPC contract](05-ipc-contract.md) | You are adding a channel, a payload or an error code |
| 06 | [Storage layout](06-storage-layout.md) | You are touching the vault, backup or recovery |
| 07 | [Security](07-security.md) | You are changing the preload bridge, CSP or window options |
| 08 | [UI guide](08-ui-guide.md) | You are building or restyling a screen |
| 09 | [Development](09-development.md) | You are setting up, building, packaging or debugging |
| 10 | [User guide](10-user-guide.md) | You are the user (tiếng Việt) |
| 11 | [Roadmap](11-roadmap.md) | You are planning what comes next |
| 12 | [Testing](12-testing.md) | You are adding a test or wondering what is covered |
| 13 | [Distribution](13-distribution.md) | You are packaging this for other people to install |
| — | [Decision records](adr/README.md) | You disagree with a decision and want to know why it was made |

## Language

**Technical documents are written in English.** They describe code whose identifiers, types
and error codes are English, and a document that switches language halfway through a sentence
to name `CATEGORY_NOT_EMPTY` reads worse than one that stays in English throughout.

**The user guide ([10](10-user-guide.md)) is written in Vietnamese**, because the interface is
Vietnamese and the person reading it is the person using the application.

This is the same split the author's other project uses: code, specifications and commit
messages in English; interface text in Vietnamese.

## Keeping documents true

A document that describes something the code no longer does is worse than no document, because
it is trusted. Two rules:

1. **A change that alters observable behaviour updates its document in the same commit.** The
   table below says which one.
2. **No document describes a plan as though it were built.** Unbuilt work goes in
   [11-roadmap.md](11-roadmap.md) and nowhere else.

| If you change… | Update |
|---|---|
| A database table, column or index | [04](04-data-model.md) + a new migration |
| An IPC channel, payload or error code | [05](05-ipc-contract.md) + `renderer/src/lib/messages.ts` |
| The vault directory layout or sidecar format | [06](06-storage-layout.md) |
| `webPreferences`, the CSP, or the preload bridge | [07](07-security.md) |
| An element `id` on anything interactive | [08](08-ui-guide.md) + `scripts/screenshot.ts` |
| A build script or an environment variable | [09](09-development.md) + `.env.example` |
| A user-visible flow | [10](10-user-guide.md) + regenerate `shots/` |
| A packaging target, an installer option, or the default vault path | [13](13-distribution.md) + [06](06-storage-layout.md) |
| Anything you had to think hard about | A new [ADR](adr/README.md) |
