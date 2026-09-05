# 0003 · One npm package with enforced layers, not a workspace monorepo

**Status:** Accepted
**Date:** 2026-08-01

## Context

The stated requirement was an architecture that can absorb new features without being
rewritten. The natural expression of that in the Node ecosystem is a workspace monorepo:

```
apps/desktop      Electron main process
apps/renderer     Next.js UI
packages/core     domain
packages/storage  SQLite + filesystem
packages/viewers  document renderers
```

Package boundaries make the dependency arrows physical: `packages/core` cannot import
`packages/storage` because it is not in its `dependencies`. That is a real guarantee, stronger
than a convention.

## Options considered

### npm workspaces

Boundaries enforced by the package manager. Each package independently versionable and
testable. The layout is self-documenting.

Against it: `better-sqlite3` is a native module, and three separate tools have to agree on
where its compiled `.node` binary lives.

1. `electron-builder install-app-deps` rebuilds it against Electron's ABI.
2. `electron-builder` must unpack it from the asar archive at a specific path.
3. The main process must `require` it at runtime.

Workspace hoisting moves that binary to the root `node_modules`, or to a package's own, or to
both, depending on version resolution across the workspace. When those disagree, the failure is
not a compile error — it is a packaged application that installs, starts, and then cannot open
its database. Diagnosing that costs hours and it recurs on every dependency change.

### One package, layered directories

`src/core`, `src/storage`, `src/modules`, `src/main` in one `package.json`. Boundaries by
convention and code review rather than by resolution.

Against it: nothing mechanically prevents `src/core` importing `src/storage`. Discipline is
required where the alternative offers a guarantee.

## Decision

**One package, with the layer rules written down and enforced by review.**

The rules are L-1 to L-6 in [03-architecture.md](../03-architecture.md#layer-rules). The one
that carries the extensibility promise is L-4: *`src/core` imports nothing concrete* — no
`electron`, no `better-sqlite3`, no `node:fs`. It holds port interfaces and pure functions.

That rule is trivially checkable by eye and by grep. It is weaker than package resolution, but
it is not much weaker, and the thing it costs is nothing.

What the workspace layout was actually buying — independent versioning, independent publishing,
selective installation — is worth nothing to a single-user application that ships as one
binary. The cost was a packaging failure mode with a several-hour diagnosis and no compile-time
signal. That is a bad trade.

**Extracting workspaces later is mechanical**, precisely because the dependency arrows already
point the right way. The work would be creating `package.json` files and moving directories,
not untangling imports.

## Consequences

**Costs**

- Layer violations are caught by review, not by tooling. If the project grows contributors, an
  import lint rule (`eslint-plugin-import/no-restricted-paths`) should be added — cheap, and
  restores most of the guarantee.
- Every dependency is installed for every part of the application. Irrelevant here: the
  renderer's dependencies are bundled at build time and the main process ships two.

**What it buys**

- `electron-builder install-app-deps` works with no configuration.
- `asarUnpack: node_modules/better-sqlite3/**` is a single unambiguous path.
- One `npm install`, one lockfile, one place to look.

**Revisit if** a second application appears that shares `src/core`, or if contributors arrive
and review stops being sufficient enforcement.
