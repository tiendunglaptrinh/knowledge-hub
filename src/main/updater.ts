/**
 * Update checking, as a service.
 *
 * `electron-updater` is an event emitter with global state, which is exactly
 * the shape this application avoids everywhere else. So it is wrapped once,
 * here, and the rest of the code sees a single `UpdateState` value and four
 * commands. That is also what lets the renderer render one thing rather than
 * subscribing to six events and assembling the state itself.
 *
 * Two policy decisions are encoded below, and both are deliberate:
 *
 *   - **Nothing downloads on its own.** `autoDownload` is off. A user on a
 *     metered connection should not discover a 90 MB transfer after the fact.
 *   - **Nothing installs on its own.** `autoInstallOnAppQuit` is off too.
 *     This is a tool people leave open; replacing it underneath them — even at
 *     quit — is a decision they should make, not one made for them.
 *
 * See docs/13-distribution.md#auto-update-d-7.
 */

import { BrowserWindow, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { AppError, ErrorCode } from '../shared/errors'
import { IpcEvent } from '../shared/ipc'
import type { UpdateState, UpdateStatus } from '../shared/types'
import { logger } from './logger'

/**
 * How long after launch the first check runs.
 *
 * Not immediately: startup is already opening a database, running migrations
 * and painting a window, and a network round trip competing with that buys
 * nothing — the answer is equally useful eight seconds later.
 */
const FIRST_CHECK_DELAY_MS = 8_000

export class UpdateService {
  private state: UpdateState
  private window: BrowserWindow | null = null
  private updater: typeof import('electron-updater').autoUpdater | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly supported: boolean) {
    this.state = {
      status: supported ? 'idle' : 'unsupported',
      currentVersion: app.getVersion(),
      availableVersion: null,
      percent: null,
      releaseNotes: null,
      error: null,
      checkedAt: null,
    }

    if (supported) this.wire()
  }

  /**
   * Whether this build can update itself at all.
   *
   * `app-update.yml` is written into the resources directory by
   * electron-builder, and only when a `publish` block is configured. Its
   * absence is the honest test: a development run, a `--dir` copy and a build
   * made before the feed existed all lack it, and all three would otherwise
   * fail somewhere inside `electron-updater` with a message aimed at us rather
   * than at the user.
   */
  static isSupported(): boolean {
    if (!app.isPackaged) return false
    try {
      return fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))
    } catch {
      return false
    }
  }

  /** The window that receives push events. Set once, after it exists. */
  attach(window: BrowserWindow): void {
    this.window = window

    if (!this.supported) {
      logger.info('updates: this build cannot update itself; skipping the check')
      return
    }

    this.timer = setTimeout(() => {
      this.timer = null
      void this.check()
    }, FIRST_CHECK_DELAY_MS)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.window = null
  }

  get(): UpdateState {
    return this.state
  }

  /**
   * Asks the feed.
   *
   * Returns as soon as the check has *started*, not when it has finished: the
   * answer arrives as an event, and a renderer awaiting the round trip would
   * sit on a spinner for the length of a network timeout.
   */
  check(): UpdateState {
    const updater = this.require()
    if (this.state.status === 'checking' || this.state.status === 'downloading') {
      return this.state
    }

    this.set({ status: 'checking', error: null })

    updater.checkForUpdates().catch((cause: unknown) => {
      logger.warn(`updates: check failed — ${String(cause)}`)
      this.set({ status: 'error', error: ErrorCode.UPDATE_CHECK_FAILED })
    })

    return this.state
  }

  download(): UpdateState {
    const updater = this.require()
    if (this.state.status !== 'available') {
      throw new AppError(ErrorCode.UPDATE_NOT_READY, 'no update is waiting to be downloaded', {
        status: this.state.status,
      })
    }

    this.set({ status: 'downloading', percent: 0, error: null })

    updater.downloadUpdate().catch((cause: unknown) => {
      logger.warn(`updates: download failed — ${String(cause)}`)
      this.set({ status: 'error', error: ErrorCode.UPDATE_DOWNLOAD_FAILED })
    })

    return this.state
  }

  /** Quits and installs. Nothing after this returns. */
  install(): null {
    const updater = this.require()
    if (this.state.status !== 'downloaded') {
      throw new AppError(ErrorCode.UPDATE_NOT_READY, 'nothing has been downloaded to install', {
        status: this.state.status,
      })
    }

    logger.info(`updates: installing ${this.state.availableVersion}`)
    // `isSilent: false` so the NSIS installer shows its progress window —
    // a desktop that goes quiet for twenty seconds looks like a hang.
    setImmediate(() => updater.quitAndInstall(false, true))
    return null
  }

  // ------------------------------------------------------------- internals

  private require(): NonNullable<UpdateService['updater']> {
    if (!this.supported || !this.updater) {
      throw new AppError(ErrorCode.UPDATE_UNSUPPORTED, 'this build cannot update itself')
    }
    return this.updater
  }

  /**
   * Loads `electron-updater` and subscribes to it.
   *
   * Required lazily rather than imported at the top of the file: a development
   * run and a `--dir` copy never reach this method, and neither should pay to
   * load a module that would only tell them it cannot help.
   */
  private wire(): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    this.updater = autoUpdater

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.logger = {
      info: (message: unknown) => logger.debug(`updates: ${String(message)}`),
      warn: (message: unknown) => logger.warn(`updates: ${String(message)}`),
      error: (message: unknown) => logger.error(`updates: ${String(message)}`),
      debug: (message: unknown) => logger.debug(`updates: ${String(message)}`),
    }

    autoUpdater.on('checking-for-update', () => {
      this.set({ status: 'checking', error: null })
    })

    autoUpdater.on('update-available', (info) => {
      logger.info(`updates: ${info.version} is available (running ${app.getVersion()})`)
      this.set({
        status: 'available',
        availableVersion: info.version,
        releaseNotes: normaliseNotes(info.releaseNotes),
        checkedAt: new Date().toISOString(),
        error: null,
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.set({
        status: 'not-available',
        availableVersion: null,
        percent: null,
        checkedAt: new Date().toISOString(),
        error: null,
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      // Rounded here rather than in the renderer: this fires several times a
      // second, and a percentage with fourteen decimal places would repaint on
      // every one of them for no visible difference.
      this.set({ status: 'downloading', percent: Math.round(progress.percent) })
    })

    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`updates: ${info.version} downloaded and ready to install`)
      this.set({ status: 'downloaded', availableVersion: info.version, percent: 100 })
    })

    autoUpdater.on('error', (cause) => {
      logger.warn(`updates: ${String(cause)}`)
      this.set({
        status: 'error',
        error:
          this.state.status === 'downloading'
            ? ErrorCode.UPDATE_DOWNLOAD_FAILED
            : ErrorCode.UPDATE_CHECK_FAILED,
      })
    })
  }

  /** Applies a patch and pushes the whole state to the renderer. */
  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }

    // The window may be gone — a check in flight when the user quits is the
    // ordinary case, not an exceptional one.
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(IpcEvent.updateState, this.state)
    }
  }
}

/**
 * GitHub returns release notes as HTML, and electron-updater sometimes hands
 * back an array of them when several versions are being skipped at once. The
 * renderer wants one string or nothing.
 */
function normaliseNotes(notes: string | Array<{ note?: string | null }> | null | undefined): string | null {
  if (typeof notes === 'string') return notes.trim() || null
  if (!Array.isArray(notes)) return null

  const joined = notes
    .map((entry) => entry?.note ?? '')
    .filter((note) => note.trim().length > 0)
    .join('\n\n')

  return joined.trim() || null
}
