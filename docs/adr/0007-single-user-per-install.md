# 0007 · One user per installation; many installations are fine

**Status:** Accepted
**Date:** 2026-08-01

## Context

The original design said "single user" and stopped there. The intent now includes handing the
application to other people, which forces the question of what "single user" actually rules out.

Two things get called multi-user and they cost about three orders of magnitude apart:

| | Description |
|---|---|
| **A** Many installations | Many people, each with their own copy and their own vault, on their own machine. Nothing shared. |
| **B** Many users, one vault | Several people reading and writing the same data. Accounts, ownership, permissions, conflict resolution. |

Deciding which one is being planned for changes almost everything downstream: whether an
`owner_id` column is needed, whether a service can trust its caller, whether the vault can be a
local directory at all.

## Options considered

### Build for B now

Add `users` and `owner_id`, scope every query by owner, add authentication.

For it: retrofitting ownership into a mature schema is genuinely painful. Adding a nullable
`owner_id` early is cheap.

Against it: an owner column with one possible value is not multi-user, it is a column. The
expensive parts of B are not the schema — they are authentication, a server or sync protocol,
conflict resolution, and a permission model. None of those can be usefully stubbed, and the
architecture that supports them is not a local-first desktop application with a directory of
files. Building the cheap 5% early buys nothing and adds a column that every query must
remember to filter.

Worse, it would contradict the premise. B requires either a server (no budget — the founding
constraint) or peer sync (a distributed-systems project of its own).

### Build for A, and write down what B would cost

Make the application safe for many people to install: per-user data directories, no
configuration required, no assumption about where it is installed or who is running it.

Against it: if B ever happens, the migration is real work.

### Say nothing and find out later

Against it: the current packaged default was `<exe dir>/data`, which on a shared machine gives
two accounts one vault, and under `C:\Program Files` is not writable at all. That is a
correctness bug for A that had already shipped, unnoticed, precisely because the question had
not been asked.

## Decision

**Target A. Treat B as a different product, and record its cost rather than partially building
it.**

Concretely, for A:

- The packaged default vault is `app.getPath('userData')/data` — per account, always writable.
- Portable mode (vault beside the executable) is **opt-in** via a `portable.txt` marker, not the
  default. It remains supported because a full system drive is a real situation.
- `KB_DATA_DIR` still overrides everything, for people who want the vault on another drive.
- Nothing in the schema gains an owner column, an account, or a permission check.

The requirement checklist for A, and its current status, is in
[13-distribution.md](../13-distribution.md#what-has-to-be-true-before-handing-it-to-someone-else).

## Consequences

**What it buys**

- The application is safe to hand to someone else today. No configuration, no shared state, no
  path that assumes the author's machine.
- Uninstalling cannot delete documents, because the vault is never inside the install directory.
- Every service stays free of authorisation logic, which is why they are short enough to read.

**Costs**

- If B ever becomes the goal, the work is real and roughly in this order: an identity model,
  an `owner_id` on `categories` and `items` with a backfill migration, an ownership filter in
  every repository query, a transport (server or sync), and a conflict-resolution policy for
  files that are not text. Scoped in
  [11-roadmap.md](../11-roadmap.md#if-shared-multi-user-ever-becomes-the-goal).
- A shared family vault on a NAS is not supported. Two instances pointing at one SQLite file
  over a network share is a corruption risk, not a feature, and the single-instance lock does
  not span machines.

**What would justify revisiting.** Not "more people use it" — that is A. Only a concrete need
for two people to see each other's changes in one vault. At that point the honest answer is
probably a different application with a server, sharing this one's domain model rather than its
storage.
