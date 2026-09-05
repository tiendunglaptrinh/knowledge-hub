# 13 · Distribution

How to turn the source into something another person can install, and what that person
experiences. Read [09-development.md](09-development.md) first for the build pipeline itself.

---

## First: two different meanings of "multi-user"

They are constantly conflated and they cost wildly different amounts.

| | What it means | Status |
|---|---|---|
| **Many installations** | Many people each install their own copy, each with their own vault on their own machine. Nobody shares anything. | **Supported.** Needs packaging and a first-run experience, not architecture. |
| **Many users, one vault** | Several people read and write the same data, with accounts, permissions and conflict resolution. | **Not supported, and not a small change.** See [ADR 0007](adr/0007-single-user-per-install.md). |

This document is about the first. The second is scoped in
[11-roadmap.md](11-roadmap.md#if-shared-multi-user-ever-becomes-the-goal).

---

## What has to be true before handing it to someone else

A checklist, because most of these are invisible until a stranger runs the application.

| | Requirement | Status |
|---|---|---|
| D-1 | The vault must land somewhere the user can write, without configuration | **Done** — defaults to the OS per-user data directory |
| D-2 | Two accounts on one machine must not share a vault | **Done** — same mechanism |
| D-3 | Uninstalling must not silently delete the user's documents | **Done** — the vault is outside the install directory |
| D-4 | The application must not require a terminal, a `.env`, or Node | **Done** — every value has a working default |
| D-5 | The first launch must explain itself with an empty vault | **Done** — empty states say what to do next |
| D-6 | The installer must not warn that the publisher is unknown | **Not done** — needs code signing, see below |
| D-7 | Users must be able to get fixes without a manual re-download | **Done** — GitHub Releases feed, notify-and-choose; see below |
| D-8 | A crash on someone else's machine must be diagnosable | **Partial** — a startup failure now shows a dialog; everything after it still goes to stdout, which an installed user never sees |

D-1 through D-5 are what make distribution *possible*. D-6 and D-8 are what would make it
*pleasant*, and each is scoped below. D-7 is built.

---

## Where an installed copy keeps its data

Resolution order lives in `resolveDataDir()` in `src/main/config.ts`:

1. **`KB_DATA_DIR`** — an explicit path always wins
2. **Development** → `<project>/data`
3. **Packaged, portable** → `<exe dir>/data`, opt in with a `portable.txt` beside the executable
4. **Packaged, installed** → the OS per-user application data directory

```
Windows   %APPDATA%\Knowledge Hub\data
macOS     ~/Library/Application Support/Knowledge Hub/data
Linux     ~/.config/Knowledge Hub/data
```

Rule 4 is the default, and it is the one that matters for distribution. An installed
application usually lives somewhere a standard user cannot write — `C:\Program Files`, `/opt`,
`/Applications` — so a vault beside the executable would fail on first save. Worse, on a shared
machine it would be *one* vault for every account on the computer.

`app.getPath('userData')` is per account and always writable, which satisfies D-1 and D-2 at
once.

**Rule 3 exists because the default is wrong for some people, including the author.** A machine
whose system drive is full, or a vault meant to live on a USB stick, wants the data beside the
application. Creating an empty `portable.txt` next to the executable switches to that. It is
opt-in rather than automatic because "portable" must be a decision, not an accident of where
the folder happens to sit.

The **Nơi lưu trữ** screen always shows the resolved paths, so a support question never starts
with guessing.

---

## Building installers

Build each target on its own platform. Cross-compiling needs Wine (Windows) or is impossible
(macOS signing), and neither is worth the trouble.

```bash
npm run package                # current platform, per electron-builder.yml
```

| Platform | Targets | Output |
|---|---|---|
| Windows | `nsis`, `portable` | `release/Knowledge Hub Setup <version>.exe`, `release/Knowledge Hub <version>.exe` |
| Linux | `AppImage`, `deb` | `release/Knowledge Hub-<version>.AppImage`, `release/knowledge-hub_<version>_amd64.deb` |
| macOS | `dmg` | `release/Knowledge Hub-<version>.dmg` |

The NSIS installer is configured (`electron-builder.yml`) to let the user choose the install
directory, install per-user rather than per-machine, and create both a desktop and a Start Menu
shortcut. Per-user is deliberate: it avoids an admin prompt, and it is the correct scope for an
application whose data is per-user anyway.

Known obstacle on Windows — the winCodeSign symlink extraction failure — and its workaround are
in [09-development.md](09-development.md#the-wincodesign-symlink-error).

---

## Code signing (D-6)

**Unsigned today.** The practical consequence for anyone you send this to:

| Platform | What they see |
|---|---|
| Windows | SmartScreen: *"Windows protected your PC — Unknown publisher"*. Runs only after **More info → Run anyway** |
| macOS | Gatekeeper refuses outright. Needs right-click → Open, or a trip to System Settings |
| Linux | Nothing. AppImage and `.deb` have no equivalent gate |

This is fine for a handful of people you can warn in advance. It is not fine for strangers —
most will not click through a security warning, and they are right not to.

### What it would take

**Windows.** An OV or EV code-signing certificate, roughly 200–400 USD a year from a CA. Since
June 2023 the private key must live on hardware or in a cloud HSM, so the build machine needs
access to it. electron-builder reads `CSC_LINK` and `CSC_KEY_PASSWORD`. An OV certificate still
accumulates SmartScreen reputation slowly; an EV certificate is trusted immediately and costs
more.

**macOS.** An Apple Developer Program membership, 99 USD a year. Sign with a Developer ID
certificate, then **notarise** — upload to Apple, wait for a scan, staple the ticket. Without
notarisation, signing alone no longer satisfies Gatekeeper. electron-builder does this with
`notarize: true` plus an app-specific password or an API key.

**Linux.** Nothing required. If you publish a `.deb` through a repository, sign the repository
rather than the package.

Until then, tell people what the warning is and why it appears. A short line in the download
page is more honest than hoping they will not notice.

---

## Auto-update (D-7)

**Built.** The feed is GitHub Releases on a public repository, which costs nothing and needs no
token in the application: `latest.yml` and the installer are fetched over anonymous HTTPS. A
token is required only on the *build* machine, to upload.

```yaml
# electron-builder.yml
publish:
  provider: github
  owner: tiendunglaptrinh
  repo: knowledge-hub
  releaseType: release
```

### The policy, and why

Two switches are off, deliberately:

```ts
autoUpdater.autoDownload = false          // nothing downloads on its own
autoUpdater.autoInstallOnAppQuit = false  // nothing installs on its own
```

**Nothing downloads on its own** because a user on a metered connection should not discover a
90 MB transfer after the fact. **Nothing installs on its own** — not even at quit — because
this is a tool people leave open, and replacing it underneath them is a decision they should
make. Every step is a click.

The flow, therefore:

```
launch ──8s──> check ──> update-available ──> banner: "Đã có phiên bản 0.2.1"
                                                  │ user clicks Tải bản mới
                                                  ▼
                                            download-progress ──> banner shows %
                                                  │
                                                  ▼
                                            update-downloaded ──> banner: "Khởi động lại"
                                                  │ user clicks
                                                  ▼
                                            quitAndInstall()
```

The eight-second delay exists so the check does not compete with opening a database, running
migrations and painting a window. The answer is equally useful eight seconds later.

### What the user sees, and where

| State | Banner across the top | Settings → Nơi lưu trữ |
|---|---|---|
| `available` · `downloading` · `downloaded` | Yes — it needs a decision | Yes |
| `idle` · `checking` · `not-available` · `error` · `unsupported` | **No** | Yes |

The split is the whole design: a strip across the top of someone's window is an interruption,
and "you are already up to date" does not earn one. Those states report themselves in Settings,
where the user went looking for them.

The banner is dismissible, and dismissal lasts **only for the session**. Someone who does not
want to update today should not re-read the strip on every screen change — but should be told
again next launch, because an update never installed is a bug they keep.

### `unsupported` is a state, not an error

`UpdateService.isSupported()` tests for `app-update.yml` in the resources directory, which
electron-builder writes only when a `publish` block is configured. A development run, a `--dir`
copy and any build made before the feed existed all lack it.

That test matters because **auto-update works from the `nsis` target only**. A portable build
and a `--dir` copy have nothing to write over. Reporting `unsupported` plainly beats surfacing
whatever `electron-updater` throws when it cannot find its own configuration — a message
written for us, shown to them.

### Three things that are still true

- **Updates require signing on macOS.** An unsigned update will not install. On Windows an
  unsigned update installs but re-triggers SmartScreen, so the user sees the warning on every
  release rather than once.
- **A migration that runs on someone else's data is unrecoverable if wrong.** The migration
  policy in [04-data-model.md](04-data-model.md#migration-policy) — append-only, one transaction
  each — exists for exactly this. Once other people have vaults, a bad migration is not a
  `docker compose down -v` away from being fixed.
- **The version in `package.json` is the whole mechanism.** The feed compares it. Ship a build
  without bumping it and no one is told anything.

---

## Diagnostics on someone else's machine (D-8)

Today `logger` writes to stdout. A developer running `npm run dev` sees it; a user who
double-clicked an icon never will.

Before real distribution, `src/main/logger.ts` should also write to a rotating file under
`app.getPath('logs')`, and the **Nơi lưu trữ** screen should gain a button that opens it. That
turns "it crashed" into "here is the log", which is the difference between a bug report you can
act on and one you cannot.

The rule that already holds and must keep holding: **the log records error codes and
identifiers, never document contents.** A log a user emails you must not contain their notes.

---

## Versioning and release

Semantic versioning, tracked in `package.json` and `CHANGELOG.md`.

| Bump | When |
|---|---|
| Patch | Fixes, no schema change |
| Minor | New features; a migration that is additive and backward-safe |
| Major | A migration an older version could not read, or a breaking change to the vault layout |

The schema version (`PRAGMA user_version`) moves independently and only forward. An older
application opening a newer vault **is handled**: `openDatabase` refuses a `user_version` above
`LATEST_SCHEMA_VERSION` with `VAULT_TOO_NEW`, before any migration runs, and the user gets a
dialog saying their data is intact and to install the current version.

That guard shipped in 0.2.0 rather than later on purpose — it only ever runs in the *older*
build, so adding it alongside a future migration would protect nobody who installed this one.
Auto-update is what makes the scenario real: several versions in circulation, and a user who
reinstalls an older download after their vault has moved on.

### Release checklist

```bash
npm run typecheck                 # both projects
npm run smoke                     # 188 checks, real database and files
npm run shots                     # if the UI changed; check the PNGs
# bump version in package.json — the feed compares exactly this
# write the CHANGELOG entry; it becomes the release notes
npm run package                   # on each platform you support
```

To publish the built artefacts to the feed, on the Windows build machine:

```bat
set GH_TOKEN=<a token with `repo` scope>
npx electron-builder --win nsis --publish always
```

`--publish always` uploads the installer **and** `latest.yml`, which is the file every running
copy polls. Uploading the installer without `latest.yml` publishes an update nobody is told
about; uploading `latest.yml` without the installer publishes an update nobody can download.
`electron-builder` does both or neither.

The release starts as a **draft** on GitHub. Nothing reaches users until it is published there —
which is the intended safety catch: build, install the draft artefact on a second machine, then
publish.

**Do not upload the installer by hand.** `latest.yml` refers to the asset as
`Knowledge-Hub-Setup-0.2.0.exe`, with hyphens, while the file on disk is
`Knowledge Hub Setup 0.2.0.exe`, with spaces — electron-builder renames it during upload because
GitHub rewrites spaces in asset names. Drag the file into a release yourself and GitHub stores
it as `Knowledge.Hub.Setup.0.2.0.exe`, with dots; `latest.yml` then points at a name that does
not exist and every client's download 404s while the check itself still reports an update. Use
`--publish always` and let it do both files.

### Testing a build while another copy is installed

Two installs of this application cannot run at once — `requestSingleInstanceLock()` is per
`appId`, and both copies share one. The second exits **silently**: it logs
`starting Knowledge Hub (packaged)` and nothing else, because `app.quit()` tears the process
down partway through `createContainer`. That looks exactly like a broken build.

Close the other copy first. It is worth knowing before spending an afternoon on it.

Then verify the built artefact on a machine that has never run the application — not the build
machine. The failures that only distribution surfaces are all first-run failures: a missing
native module, a vault path that is not writable, a default that assumed your own setup.

---

## What a new user experiences

Worth reading as a script, because it is the part no amount of unit testing covers.

1. Downloads and runs the installer. **Sees a publisher warning** (D-6).
2. Chooses an install directory, or accepts the default.
3. Launches from the desktop shortcut.
4. The vault is created under their own account data directory. **No configuration.**
5. The window opens on an empty state: *"Hãy bắt đầu bằng một nhóm"* — with the sidebar's `+`
   the only meaningful control.
6. They create a category, add a document, and it renders.
7. If they wonder where the file went, **Nơi lưu trữ** shows the exact path and opens the
   folder.
8. Eight seconds after some later launch, a strip appears: *"Đã có phiên bản 0.2.1"*. They
   click, it downloads, they restart when it suits them.

Steps 4 to 8 work today. Step 1 is the honest rough edge — and it repeats on **every** update
until the build is signed, which is the strongest argument for D-6.

---

## Uninstalling

The NSIS uninstaller removes the application directory. **It does not remove the vault**, which
is the correct default — deleting someone's documents because they uninstalled a viewer would be
indefensible.

That should be stated on screen at uninstall time rather than left as a surprise, along with the
path, so a user who genuinely wants the data gone can remove it themselves. Not yet implemented.

For a portable installation, deleting the folder removes both the application and the vault,
because that is what portable means.
