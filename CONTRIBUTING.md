# Contributing

Mostly a note to my future self.

## Before you change anything

Read [docs/03-architecture.md](docs/03-architecture.md). The layer rules there are the whole
reason this codebase can absorb features without being rewritten, and they are not obvious from
any single file.

## The loop

```bash
npm run dev          # renderer hot-reloads; the main process does not — restart after src/ edits
npm run typecheck
npm run smoke        # run this before trusting anything
```

`npm run smoke` executes 53 checks against a real SQLite database and real files in a temporary
vault. It takes about three seconds and has no flaky checks. If it fails, the change is wrong
until proven otherwise.

## Rules that are not negotiable

| | |
|---|---|
| Business rules live in `src/modules/*` | Not in an IPC handler, not in a repository |
| `src/core` imports nothing concrete | No `electron`, no `better-sqlite3`, no `node:fs` |
| Everything is constructed in `src/main/container.ts` | A service that constructs its own repository has hard-coded its storage engine |
| No `await` inside `uow.run` | It is typed synchronous so this is a compile error. See [ADR 0005](docs/adr/0005-copy-then-insert.md) |
| Copy files before writing rows | Same ADR |
| Migrations are append-only | A shipped migration is immutable; correct it with a new version |
| Never mock the database | [docs/12-testing.md](docs/12-testing.md) explains why |
| UI strings are Vietnamese, everything else is English | Including comments, commit messages and error codes |

## Adding things

| Adding | Sequence |
|---|---|
| A field | `shared/types.ts` → migration → `rows.ts` → repository → service → UI |
| A viewer format | `core/domain/asset-kind.ts` → `DocumentService.render` → `AssetViewer` |
| An operation | `shared/ipc.ts` → `preload.ts` → `ipc/register.ts` → service |
| An error code | `shared/errors.ts` **and** `renderer/src/lib/messages.ts`, same commit |

The compiler catches a missing IPC handler. It does not catch a missing message-catalogue
entry — a code with no entry silently falls back to the generic text. That one is on you.

## Element ids

Every interactive element has a stable `id`, listed in
[docs/08-ui-guide.md](docs/08-ui-guide.md#element-ids). `scripts/screenshot.ts` drives the UI
through several of them and throws when one is missing, so renaming an id breaks `npm run
shots`. That is intended. Update the table in the same commit.

## Documentation

A change that alters observable behaviour updates its document **in the same commit**. The
table in [docs/README.md](docs/README.md#keeping-documents-true) says which one.

Write an [ADR](docs/adr/README.md) when the answer to "why is it like this?" would otherwise be
lost — particularly when a future reader could reasonably conclude the current design is a
mistake.

## Commits

One logical change. Imperative mood, English.

```
Add tag browsing view

Tags were stored and searchable but not clickable. Adds a `tag` variant to
the View union, one IPC channel, and a tag list in the sidebar.

Closes R-6.
```

No `Co-Authored-By` trailers.

## Before pushing

```bash
npm run typecheck
npm run smoke
npm run shots        # if the UI changed — then check the PNGs actually show what you expect
```

A screenshot is evidence about pixels, not about state. When the two disagree, query the DOM —
see [docs/12-testing.md](docs/12-testing.md#a-caveat-about-screenshots).
