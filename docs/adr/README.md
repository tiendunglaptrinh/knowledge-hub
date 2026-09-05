# Architecture Decision Records

A record per decision that was expensive to make and would be expensive to reverse. Each says
what was decided, what the alternatives were, and what the decision costs — because a decision
whose cost is not written down gets re-litigated by whoever meets that cost later.

Format: a trimmed [Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
record. Numbered sequentially, never renumbered. A superseded record stays in place with its
status changed and a pointer to its replacement — the reasoning that was valid at the time is
part of the history.

| # | Decision | Status |
|---|---|---|
| [0001](0001-electron-nextjs.md) | Electron + Next.js over Tauri | Accepted |
| [0002](0002-sqlite-plus-filesystem.md) | SQLite index alongside files on disk | Accepted |
| [0003](0003-single-package-layered.md) | One npm package with enforced layers, not workspaces | Accepted |
| [0004](0004-vault-location.md) | The vault is configurable and lives outside the app | Accepted |
| [0005](0005-copy-then-insert.md) | Copy the file before writing the database row | Accepted |
| [0006](0006-document-rendering.md) | Per-format rendering, split across the process boundary | Accepted |
| [0007](0007-single-user-per-install.md) | One user per installation; many installations are fine | Accepted |
| [0008](0008-notes-as-a-separate-entity.md) | Notes are a separate entity, not an item without files | Accepted |
| [0009](0009-compose-documents-in-app.md) | A composed document is an ordinary asset, and assets become editable | Accepted |

## When to write one

Write an ADR when the answer to "why is it like this?" would otherwise be lost, and when a
future reader could reasonably conclude the current design is a mistake. That usually means:

- a choice between two defensible options where the loser has real advantages
- a constraint that is not visible in the code (hardware, budget, the author's toolchain)
- a deliberate omission that looks like an oversight

Do not write one for a choice with an obvious default and no cost. A file full of
non-decisions makes the real ones harder to find.

## Template

```markdown
# NNNN · Title in the imperative

**Status:** Proposed | Accepted | Superseded by ADR-NNNN
**Date:** YYYY-MM-DD

## Context
What forced a decision. Constraints, including the ones outside the code.

## Options considered
Each with its real advantages — especially the ones that were rejected.

## Decision
What was chosen.

## Consequences
What this costs, what it makes harder, and what would have to be true to revisit it.
```
