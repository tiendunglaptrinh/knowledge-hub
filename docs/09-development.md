# 09 · Development

## Requirements

| | |
|---|---|
| Node.js | 20 or newer (developed on 22.22) |
| A desktop session | Under WSL that means WSLg, present by default on Windows 11 |
| A C++ toolchain | Only if `better-sqlite3` has no prebuilt binary for your platform |

## Setup

```bash
npm install     # installs, then runs `electron-builder install-app-deps`
cp .env.example .env
npm run dev
```

The `postinstall` step is not optional decoration. `better-sqlite3` ships a native `.node`
binary compiled against a specific V8 ABI, and Electron's differs from the system Node's.
Without the rebuild, `require('better-sqlite3')` fails at startup with a version-mismatch
error. If you ever see that, run `npx electron-builder install-app-deps` again.

---

## Configuration

Every value is optional and read from the environment, falling back to a documented default.
`.env` is parsed by a small reader in `src/main/config.ts` rather than by `dotenv` — it is a
dozen lines of `KEY=value` and the main process should not gain a dependency for that. Values
already present in the real environment win over the file, so
`KB_DATA_DIR=/tmp/x npm run dev` behaves as expected.

| Variable | Default | Purpose |
|---|---|---|
| `KB_DATA_DIR` | dev: `<project>/data` · packaged: `<exe dir>/data` | Vault location. See [06](06-storage-layout.md) |
| `KB_DEV_SERVER_URL` | `http://localhost:3100` | Must match `dev:renderer`'s port |
| `KB_LOG_LEVEL` | `info` | `error` · `warn` · `info` · `debug` |

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next dev server on :3100, then builds the main process and launches Electron against it |
| `npm start` | Production mode from source: static renderer over `app://`, no installer needed |
| `npm run build` | `build:main` + `build:renderer` |
| `npm run tidy:filenames` | Renames stored files in an existing vault to the readable scheme. `--dry-run` to preview |
| `npm run build:main` | esbuild → `dist/main/{main,preload}.js` |
| `npm run build:renderer` | `next build renderer` → `renderer/out` |
| `npm run package` | Full build, then electron-builder → `release/`. Add `--publish always` with `GH_TOKEN` set to upload to the release feed |
| `npm run package:dir` | Unpacked build, for inspecting the bundle without making an installer |
| `npm run typecheck` | Both TypeScript projects |
| `npm run smoke` | 186 end-to-end checks against a real database and real files |
| `npm run shots` | Boots the app, seeds it, writes `shots/*.png` |

### `dev` vs `start`

`dev` runs the Next dev server, so the renderer hot-reloads. The main process does **not** —
changing anything under `src/` needs the command restarted.

`start` runs the same code path a packaged application takes: the static export served over
`app://kb`. Use it to check anything protocol- or CSP-related, which the dev server hides
because it serves over `http://localhost`.

`isDev` is `!app.isPackaged && NODE_ENV !== 'production'`. Both halves matter — the first makes
a packaged build always production, the second is what lets `npm start` preview the real
renderer from source.

---

## Build pipeline

```
src/main/main.ts        ─esbuild→  dist/main/main.js       (cjs, node20)
src/preload/preload.ts  ─esbuild→  dist/main/preload.js    (cjs, node20)
renderer/               ─next  →   renderer/out/           (static html+js)
                        ─builder→  release/
```

**Externals.** `electron`, `better-sqlite3` and `mammoth` are marked external and loaded from
`node_modules` at runtime. `better-sqlite3` has no choice — a native binding cannot be bundled.
`mammoth` pulls in a large CommonJS tree and is cheaper to `require` lazily, which
`DocumentService` does on first use so startup does not pay for a converter that may go unused.

**`process.env.NODE_ENV` is deliberately not defined at build time** in the main bundle. It is
read at runtime to choose between the dev server and the static renderer; substituting it would
freeze that choice into the bundle. This was a real bug during development — `npm start` loaded
the dev server no matter what, because the build had baked in `'development'`.

**asar unpacking.** `better-sqlite3`'s `.node` binary cannot be read from inside an asar
archive, so `electron-builder.yml` lists it under `asarUnpack`. That is a requirement, not an
optimisation.

---

## Project layout

```
knowledge-hub/
├── src/                     main process — see docs/03-architecture.md
│   ├── shared/              types, IPC contract, error codes  (both processes)
│   ├── core/                domain logic + port interfaces    (no concrete deps)
│   ├── modules/             services — all business rules
│   ├── storage/             sqlite/ + fs/ implementations
│   ├── main/                Electron lifecycle, config, protocol, IPC, container
│   └── preload/             the bridge
├── renderer/                Next.js static export
│   └── src/{app,components,lib}
├── scripts/                 build-main · smoke · screenshot · make-docx · tidy-filenames
├── docs/                    this documentation
├── shots/                   generated screenshots
├── data/                    default dev vault (gitignored contents)
└── dist/, release/          build output
```

---

## Debugging

### Renderer

DevTools open automatically in development, detached. In production mode they do not; add
`window.webContents.openDevTools()` temporarily if needed.

### Main process

`console.log` through the `logger` in `src/main/logger.ts`, which respects `KB_LOG_LEVEL`.
Output goes to the terminal that launched Electron.

For a real debugger:

```bash
npm run build:main
npx electron --inspect=9229 .
# then chrome://inspect
```

### SQLite

```bash
sqlite3 data/knowledge.db
sqlite> .tables
sqlite> PRAGMA user_version;
sqlite> SELECT title, updated_at FROM items ORDER BY updated_at DESC LIMIT 10;
sqlite> SELECT item_id, title FROM items_fts WHERE items_fts MATCH '"spring"*';
```

### A blank window

Almost always the CSP blocking Next's inline bootstrap scripts, or a JavaScript error. Read the
console — a blank window with no console output is a different problem from a blank window with
seven `Refused to execute inline script` lines. See [07-security.md](07-security.md#content-security-policy).

### `better-sqlite3` version mismatch

```
Error: The module was compiled against a different Node.js version
```

Run `npx electron-builder install-app-deps`.

---

## Verifying a change

In order of cost:

```bash
npm run typecheck    # seconds
npm run smoke        # seconds — real database, real files, no mocks
npm run shots        # ~30s — proves the window renders and the ids hold
npm start            # manual check of the production code path
```

`npm run smoke` is the one that matters. It runs the actual storage layer and the actual
services against a throwaway vault, and it covers the paths that are impossible to see from a
screenshot: migrations, FTS behaviour, transaction ordering, cascade deletes, path traversal.
See [12-testing.md](12-testing.md).

---

## Packaging

```bash
npm run package
```

Outputs to `release/`. Icons come from `build/icon.{png,ico,icns}`, generated by
`node scripts/make-icon.mjs` — a dependency-free renderer of the tile in the application's own
palette. Re-run and commit its output if the palette changes.

A packaged application puts its vault at `<exe dir>/data` unless `KB_DATA_DIR` says otherwise —
deliberately not in AppData, which on this machine lives on the nearly-full C: drive. It reads
`.env` from **beside the executable**, not from inside the asar, which is what makes
`KB_DATA_DIR` configurable for an installed copy.

---

## Tidying an older vault's filenames

Vaults created before stored names were slugged have every file prefixed with the id of the row
that owns it — `7b1e2c3d-…-OWASP Top 10.docx`. New writes no longer do that. One command brings
the rest into line:

```bash
# close the application first — this does not take the SQLite lock politely
npm run tidy:filenames -- --dry-run    # print what would change
npm run tidy:filenames                 # apply
```

It resolves the vault from `KB_DATA_DIR`, then from `.env`, then falls back to `<project>/data`,
and prints the path it settled on before touching anything.

Per file it renames on disk, updates `rel_path`, and afterwards rewrites the `item.json` sidecars
of any item whose files moved — a sidecar listing paths that no longer exist is worse than none,
since rebuilding the index from it is the one job it has.

**Disk first, database second**, matching every other write in the application. A crash between
the two leaves a row pointing at a moved file, which the next run repairs because it finds the
old path missing. The other order would point a row at a file that does not exist yet, and a
second run could not tell that from real corruption.

Re-running is a no-op: files already named correctly are counted as *already tidy* and skipped.

---

## Building the Windows application

Running under WSL is fine for development but not for daily use: WSLg projects the window into
Windows over an RDP channel, and Electron gets no GPU acceleration there
(`gpu_compositing: disabled_software`, confirmed against `--use-gl=angle`, `egl`, ozone
wayland, `--ignore-gpu-blocklist` and a forced `d3d12` — none help). The result is a Linux
window with a GTK file dialog, drawn pixel by pixel on the CPU.

A native Windows build has a real window, a working GPU process, the Explorer file dialog, and
reaches `D:` as NTFS rather than through the 9p mount.

### Procedure

Build **on Windows**. Cross-compiling from WSL needs Wine, which is not installed.

```bash
# 1. copy the source to a Windows path (not \\wsl$ — npm on that path is slow and fragile)
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude release \
  --exclude 'renderer/.next' --exclude 'renderer/out' \
  --exclude data --exclude .git \
  /home/app/knowledge-hub/ /mnt/d/dev/knowledge-hub/
```

Then, from `cmd.exe` in `D:\dev\knowledge-hub`:

```bat
npm install --ignore-scripts
node node_modules\electron\install.js
npx electron-builder install-app-deps
npm run build
npx electron-builder --win --x64 --dir
```

### Why `--ignore-scripts`

A plain `npm install` fails. `better-sqlite3`'s own install script targets the *Node* ABI, and
this machine runs Node 24, for which no prebuilt binary is published — so it falls through to
`node-gyp`, which needs Python and Visual Studio Build Tools. Neither is installed.

None of that is necessary. The application runs on Electron, not Node, and
`better-sqlite3` **does** publish `electron-v133-win32-x64` (Electron 35 = ABI 133). Skipping
the install scripts and then running `electron-builder install-app-deps` fetches exactly that
prebuild. No compiler required.

### The winCodeSign symlink error

`electron-builder` downloads a code-signing bundle and extracts it with `7za -snld`. Two entries
in that archive are macOS `.dylib` **symlinks**, and creating a symlink on Windows needs
Developer Mode or an elevated shell:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
        ...\winCodeSign\<hash>\darwin\10.12\lib\libcrypto.dylib
```

The build fails even with `--dir`, and even though nothing is being signed. The fix is to
pre-extract the archive *without* `-snld`, so those two entries are skipped and everything
Windows actually needs — `rcedit-x64.exe`, `windows-10\signtool.exe` — lands correctly:

```bat
set CACHE=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign
"node_modules\7zip-bin\win\x64\7za.exe" x -bd -y "%CACHE%\<hash>.7z" -o"%CACHE%\winCodeSign-2.6.0"
```

`7za` still reports `Sub items Errors: 2` for the two symlinks. That is expected and harmless.
`electron-builder` finds `winCodeSign-2.6.0` already present and skips its own extraction.

The alternative is enabling Windows Developer Mode, which is cleaner if you control the machine.

### Updating an installed copy without rebuilding it

A full Windows rebuild is only necessary when something *outside* `app.asar` changes: the
Electron version, a native module, an `electron-builder.yml` setting, the icon. For a change
that touches only application code — which is most changes — the packaged application can be
updated by replacing the archive.

Everything the build produces from source lands in two places:

```
resources/app.asar            dist/main/**, renderer/out/**, package.json, production node_modules
resources/app.asar.unpacked   better-sqlite3 and jszip, incl. the native better_sqlite3.node
```

Only `better_sqlite3.node` is platform-specific. Everything else is JavaScript, so an archive
built under WSL is byte-for-byte as valid on Windows as one built there.

```bash
npm run build                 # dist/main + renderer/out must be current

APP='/mnt/d/Apps/Knowledge Hub'
cp "$APP/resources/app.asar" "$APP/resources/app.asar.bak-$(date +%F)"

npx asar extract "$APP/resources/app.asar" /tmp/app     # keeps the shipped node_modules tree
rm -rf /tmp/app/dist/main /tmp/app/renderer/out
cp -r dist/main /tmp/app/dist/main
cp -r renderer/out /tmp/app/renderer/out

npx asar pack /tmp/app /tmp/app.asar \
  --unpack-dir "node_modules/{better-sqlite3,jszip}"
```

Three rules, each of which produces a broken install if ignored:

1. **Quit the application first.** Windows will not let a running Electron process's archive be
   replaced.
2. **Extract rather than packing from `node_modules/`.** The working tree carries devDependencies
   — Next, React, TypeScript, Electron itself. `electron-builder` prunes those; a hand-rolled
   pack does not, and the archive goes from 6 MB to several hundred.
3. **Install `app.asar` and `app.asar.unpacked` from the same pack run.** The archive records
   which paths are unpacked, and Electron then reads those from the sidecar directory. An
   archive whose flags disagree with the directory beside it fails at `require` time, not at
   install time. Before copying, confirm the native binary is unchanged:

   ```bash
   cmp /tmp/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node \
       "$APP/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
   ```

   It must be identical. If it is not, a Linux `.node` has been packed over the Windows one and
   the application will not open its database.

Verifying afterwards, without opening a second connection to a live SQLite file over the 9p
mount: the vault's `notes/` directory appearing proves the new main process ran, and
`grep -a "CREATE TABLE notes" <vault>/knowledge.db-wal` proves the migration committed.
`user_version` in the `.db` header only moves once the WAL is checkpointed on quit.

To roll back, put `app.asar.bak-*` and `app.asar.unpacked.bak-*` back.

### Deployment used here

```
D:\Apps\Knowledge Hub\        the unpacked application (~303 MB)
D:\Apps\Knowledge Hub\.env    KB_DATA_DIR=D:\KnowledgeHub
D:\KnowledgeHub\              the vault, on native NTFS
Desktop\Knowledge Hub.lnk     shortcut
```

Unpacked rather than an NSIS installer, on purpose: the default install location is under
AppData on C:, which is nearly full. A folder on D: plus a shortcut is portable, avoids C:
entirely, and needs no uninstaller.

Two build directories exist and serve different purposes:

| | |
|---|---|
| `/home/app/knowledge-hub` | Development. `npm run dev`, `npm run smoke`. Fast ext4. |
| `D:\dev\knowledge-hub` | Windows build only. Re-`rsync` from the first before building. |

---

## Conventions

| | |
|---|---|
| Language | English for code, comments, docs, commit messages. Vietnamese for UI strings only |
| Naming | `PascalCase` types, `camelCase` values, `snake_case` database columns, `UPPER_SNAKE_CASE` error codes |
| Types | Strict TypeScript, `noUncheckedIndexedAccess` on. No `any` without a comment saying why |
| Comments | Explain *why*, not *what*. A comment restating the line below it is noise |
| Imports | Node built-ins with the `node:` prefix |
| Commits | One logical change. A change to observable behaviour updates its document in the same commit |
