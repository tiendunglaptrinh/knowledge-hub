/**
 * Main process entry point.
 *
 * Responsibilities, in order: read configuration, build the container, create
 * the window, register IPC. Nothing about categories, items or files is
 * decided here — this file only owns the Electron lifecycle.
 */

import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'

import { loadConfig } from './config'
import { createContainer, type Container } from './container'
import { registerIpcHandlers } from './ipc/register'
import { installAppProtocol, registerAppScheme, RENDERER_ORIGIN } from './protocol'
import { logger } from './logger'

// Must precede app.whenReady() — see protocol.ts.
registerAppScheme()

/**
 * A second instance would open the same SQLite file and the same vault. WAL
 * makes that survivable, but two windows silently diverging on the same data
 * is not a state worth supporting, so the second instance hands focus back to
 * the first and exits.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let container: Container | null = null
let mainWindow: BrowserWindow | null = null

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(bootstrap).catch(fatal)

async function bootstrap(): Promise<void> {
  const config = loadConfig()
  logger.info(`starting Knowledge Hub (${config.isDev ? 'development' : 'packaged'})`)

  container = await createContainer(config)
  installAppProtocol(container.store)
  registerIpcHandlers(container)

  mainWindow = createWindow(config.isDev)

  // After the window exists, because the service pushes state into it — and
  // before `loadURL`, so a renderer that mounts fast still gets every event.
  container.updates.attach(mainWindow)

  if (config.isDev) {
    await mainWindow.loadURL(config.devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadURL(`${RENDERER_ORIGIN}/index.html`)
  }

  app.on('activate', () => {
    // macOS: clicking the dock icon with no window open should reopen one.
    if (BrowserWindow.getAllWindows().length === 0 && container) {
      mainWindow = createWindow(container.config.isDev)
      void mainWindow.loadURL(
        container.config.isDev
          ? container.config.devServerUrl
          : `${RENDERER_ORIGIN}/index.html`,
      )
    }
  })
}

function createWindow(isDev: boolean): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0b1020',
    // Avoids the white flash between window creation and first paint.
    show: false,
    autoHideMenuBar: true,
    title: 'Knowledge Hub',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // The three settings that matter. Renderer code has no Node access and
      // runs in its own context; the only way into the main process is the
      // preload bridge. See docs/07-security.md.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Required for Chromium's built-in PDF viewer, which is what renders a
      // stored PDF inside an <iframe>.
      plugins: true,
      // In development the renderer is served over http from localhost, which
      // is a non-secure origin; nothing sensitive travels over it.
      webSecurity: !isDev,
      spellcheck: false,
    },
  })

  window.once('ready-to-show', () => window.show())

  // An external link must open in the user's browser, never as a new Electron
  // window with our preload attached.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Same reasoning for in-place navigation: the window shows our renderer and
  // nothing else, for its whole lifetime.
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith('http://localhost:') : url.startsWith(RENDERER_ORIGIN)
    if (!allowed) {
      event.preventDefault()
      if (url.startsWith('http')) void shell.openExternal(url)
    }
  })

  window.on('closed', () => {
    mainWindow = null
  })

  return window
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  container?.dispose()
  container = null
})

function fatal(error: unknown): void {
  logger.error(`startup failed: ${error instanceof Error ? error.stack : String(error)}`)
  app.exit(1)
}
