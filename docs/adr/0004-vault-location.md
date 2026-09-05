# 0004 · The vault is configurable and lives outside the application directory

**Status:** Accepted
**Date:** 2026-08-01

## Context

The original intent was to store everything inside the source directory: no hosting budget, so
the project folder is the storage. That is a reasonable instinct and it is nearly right.

Two facts complicate it.

**Disk space.** The development machine:

```
C:\   201G total   186G used    15G free   93%
D:\   256G total    44G used   212G free   18%
/     1007G          13G       944G         2%    (WSL ext4 volume)
```

C: is effectively full. The vault is the only part of this project that grows without bound —
a few hundred PDFs and Word documents is several gigabytes. The user's instruction was
explicit: put storage on D:.

**Filesystem performance.** Under WSL, `/mnt/c` and `/mnt/d` are 9p mounts. Every `stat` and
every small read crosses a protocol bridge. For `node_modules` — tens of thousands of small
files read on every build — this is the difference between a fast build and a painful one. The
Linux-native volume is dramatically faster.

So "everything on D:" and "everything in the source folder" are both wrong, for different
reasons.

## Options considered

### Everything in the source folder, on the Linux volume

Simple; the vault is committable to git alongside the code.

Against it: the WSL volume is backed by a `.vhdx` file that lives on a physical Windows drive.
`df` reporting 944 GB free is the virtual disk's size, not a guarantee of physical space behind
it. Growing the vault there may consume C: after all — and the user's instruction was to avoid
exactly that.

### Everything on D:

Honours the instruction directly.

Against it: `node_modules` and the build on a 9p mount, for no reason. Code is small and does
not need the space; it needs the speed.

### Split: code on the Linux volume, vault configurable and defaulting to D:

Each part where it belongs.

Against it: two locations to know about, and the vault is no longer inside the repository.

### A hidden default in AppData / `~/.config`

The platform convention.

Against it: on this machine AppData is on C:, the drive that is full. It also makes the data
invisible, which contradicts the *the user always knows where their data is* goal.

## Decision

**The vault location is configuration, resolved in this order:**

1. `KB_DATA_DIR`, if set
2. Development (unpackaged) → `<project>/data`
3. Packaged → `<folder containing the executable>/data`

**`.env.example` documents `KB_DATA_DIR=/mnt/d/KnowledgeHub` as the recommended value on this
machine**, with the disk figures written down so the recommendation can be re-evaluated when
they change.

Source code and `node_modules` stay on the Linux volume.

The application **creates the directory on first run and does not write anywhere else**. It
does not pick a drive for the user; the user does, in one line of `.env`.

The packaged default deliberately avoids AppData in favour of a folder beside the executable —
an installation stays portable, and data does not silently accumulate on C:.

## Consequences

**What it buys**

- Fast builds, roomy storage.
- The vault survives reinstalling or deleting the application.
- Moving the vault is: quit, move the directory, edit one line. Nothing in the database stores
  an absolute path, which is what makes that true.
- The **Nơi lưu trữ** screen shows the resolved paths, so this is never a guess.
- No file is ever written outside the vault without the user having named the location.

**Costs**

- Two locations to understand instead of one. Mitigated by `.env.example`,
  [06-storage-layout.md](../06-storage-layout.md) and the settings screen.
- The vault is not inside the repository, so committing it is a separate decision rather than
  automatic.
- A relative `KB_DATA_DIR` resolves against the process working directory, which differs
  between `npm run dev` and a packaged launch. Absolute paths are what the documentation shows.

**Failing loudly.** `FsAssetStore.init()` creates the directory *and writes a probe file*. A
vault on an unmounted drive or an unwritable path raises `VAULT_UNWRITABLE` at startup, not at
the moment the user first tries to save something.
