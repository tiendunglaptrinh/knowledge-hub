/**
 * Runtime configuration.
 *
 * Resolution order for every value: environment variable, then a documented
 * default. There is no config UI and no second config file — one place to
 * look when a path is not what you expected.
 *
 * `.env` is read by hand rather than with `dotenv`: it is a dozen lines of
 * `KEY=value`, and the main process should not gain a dependency for that.
 * Values already present in the real environment win over the file, so
 * `KB_DATA_DIR=/tmp/x npm run dev` behaves the way you would expect.
 *
 * See docs/09-development.md#configuration.
 */

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface AppConfig {
  isDev: boolean
  /** Vault root: SQLite file plus the assets tree. */
  dataDir: string
  databasePath: string
  /** Renderer origin in development; unused in a packaged build. */
  devServerUrl: string
  logLevel: LogLevel
}

const DEFAULT_DEV_SERVER_URL = 'http://localhost:3100'

export function loadConfig(): AppConfig {
  // Packaged builds are always production. Running unpackaged is development
  // *unless* NODE_ENV says otherwise — that is what lets `npm start` preview
  // the real static renderer from source, without building an installer.
  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production'
  const projectRoot = resolveProjectRoot(!app.isPackaged)

  loadDotEnv(path.join(resolveEnvDir(projectRoot), '.env'))

  // The vault follows "packaged or not", not "dev or not": `npm start` in
  // production mode must still read the same data the dev run wrote.
  const dataDir = resolveDataDir(!app.isPackaged, projectRoot)

  return {
    isDev,
    dataDir,
    databasePath: path.join(dataDir, 'knowledge.db'),
    devServerUrl: process.env.KB_DEV_SERVER_URL || DEFAULT_DEV_SERVER_URL,
    logLevel: parseLogLevel(process.env.KB_LOG_LEVEL),
  }
}

/** Presence of this file beside the executable selects portable mode. */
const PORTABLE_MARKER = 'portable.txt'

/**
 * Where the vault lives.
 *
 *   1. KB_DATA_DIR, if set — an explicit path always wins. This is how the
 *      vault is moved to another drive.
 *   2. development (unpackaged) -> <project>/data, so a clone works with no
 *      setup and the vault is easy to inspect.
 *   3. packaged, portable       -> <exe dir>/data
 *   4. packaged, installed      -> the OS per-user application data directory
 *
 * Rule 4 is the default, and it is what makes the application safe to hand to
 * someone else. An installed copy commonly lives somewhere a standard user
 * cannot write (Program Files, /opt, /Applications), and on a shared machine
 * two accounts must not end up pointing at one vault. `app.getPath('userData')`
 * resolves per account and is always writable:
 *
 *   Windows  %APPDATA%\Knowledge Hub
 *   macOS    ~/Library/Application Support/Knowledge Hub
 *   Linux    ~/.config/Knowledge Hub
 *
 * Rule 3 is opt-in: drop a `portable.txt` next to the executable and the vault
 * sits beside the application, so the whole thing can live on a USB stick or a
 * second drive and move as one folder. That is the mode this machine uses,
 * because C: is nearly full — though here `.env` sets KB_DATA_DIR explicitly,
 * so rule 1 applies first.
 *
 * The directory is created on first use by FsAssetStore.init().
 * See docs/06-storage-layout.md and docs/13-distribution.md.
 */
function resolveDataDir(isDev: boolean, projectRoot: string): string {
  const configured = process.env.KB_DATA_DIR?.trim()
  if (configured) return path.resolve(configured)

  if (isDev) return path.join(projectRoot, 'data')

  const exeDir = path.dirname(app.getPath('exe'))
  if (fs.existsSync(path.join(exeDir, PORTABLE_MARKER))) {
    return path.join(exeDir, 'data')
  }

  return path.join(app.getPath('userData'), 'data')
}

/**
 * In development the compiled main process sits at `<root>/dist/main/main.js`,
 * so the project root is two levels up. When packaged, `getAppPath()` already
 * points at the app root inside the asar.
 */
function resolveProjectRoot(isDev: boolean): string {
  return isDev ? path.resolve(__dirname, '..', '..') : app.getAppPath()
}

/**
 * Where to look for `.env`.
 *
 * Unpackaged, that is the project root. Packaged, it must be the folder
 * containing the executable — NOT `getAppPath()`, which points inside the asar
 * archive where the user cannot place or edit a file. Reading it from there
 * would make `KB_DATA_DIR` unreachable for an installed application, which is
 * precisely the case that needs it: the default install location on Windows is
 * under AppData on C:, and on this machine C: is nearly full.
 *
 * It also sits next to the default vault (`<exe dir>/data`), so configuration
 * and data stay together and an installation remains portable.
 */
function resolveEnvDir(projectRoot: string): string {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : projectRoot
}

/** Minimal `KEY=value` reader. Ignores blank lines and `#` comments. */
function loadDotEnv(envPath: string): void {
  let raw: string
  try {
    raw = fs.readFileSync(envPath, 'utf8')
  } catch {
    return // no .env is a normal, supported state
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue

    const key = trimmed.slice(0, eq).trim()
    if (key in process.env) continue // real environment wins

    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function parseLogLevel(value: string | undefined): LogLevel {
  const allowed: LogLevel[] = ['error', 'warn', 'info', 'debug']
  const candidate = (value ?? '').toLowerCase() as LogLevel
  return allowed.includes(candidate) ? candidate : 'info'
}
