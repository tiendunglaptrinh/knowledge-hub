/**
 * IPC handler registration — the equivalent of a controller layer.
 *
 * Rules, mirroring "thin controllers":
 *   - no business logic here; every handler is validate-shape → call service →
 *     return
 *   - no direct repository access
 *   - every handler is wrapped by `handle()`, so a thrown AppError becomes
 *     `{ ok: false, error }` and an unexpected throw becomes UNKNOWN with the
 *     detail logged rather than shipped to the renderer
 *
 * See docs/05-ipc-contract.md.
 */

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'

import type { Container } from '../container'
import { logger } from '../logger'
import { AppError, ErrorCode, type SerializedError } from '../../shared/errors'
import { IpcChannel, type ApiMap, type Result } from '../../shared/ipc'
import { FILE_DIALOG_FILTERS } from '../../core/domain/asset-kind'
import type { PickedFile } from '../../shared/types'

type Handler<C extends keyof ApiMap> = (
  payload: ApiMap[C]['req'],
) => ApiMap[C]['res'] | Promise<ApiMap[C]['res']>

export function registerIpcHandlers(container: Container): void {
  const { categories, items, notes, checklists, assets, documents, vault, updates } =
    container

  /**
   * Wraps one channel. Typed against `ApiMap`, so a handler returning the
   * wrong shape — or a channel with no handler — fails to compile.
   */
  function handle<C extends keyof ApiMap>(channel: C, fn: Handler<C>): void {
    ipcMain.handle(channel, async (_event, payload): Promise<Result<ApiMap[C]['res']>> => {
      try {
        return { ok: true, data: await fn(payload as ApiMap[C]['req']) }
      } catch (error) {
        return { ok: false, error: serialize(channel, error) }
      }
    })
  }

  // ------------------------------------------------------------- categories

  handle(IpcChannel.categoryList, () => categories.list())
  handle(IpcChannel.categoryCreate, (input) => categories.create(input))
  handle(IpcChannel.categoryUpdate, (input) => categories.update(input))
  handle(IpcChannel.categoryDelete, ({ id }) => categories.delete(id))

  // ------------------------------------------------------------------ items

  handle(IpcChannel.itemListByCategory, ({ categoryId }) => items.listByCategory(categoryId))
  handle(IpcChannel.itemRecent, ({ limit }) => items.listRecent(limit))
  handle(IpcChannel.itemGet, ({ id }) => items.get(id))
  handle(IpcChannel.itemCreate, (input) => items.create(input))
  handle(IpcChannel.itemUpdate, (input) => items.update(input))
  handle(IpcChannel.itemDelete, ({ id }) => items.delete(id))
  handle(IpcChannel.itemSearch, (input) => items.search(input))

  // ------------------------------------------------------------------ notes

  handle(IpcChannel.noteList, (input) => notes.list(input))
  handle(IpcChannel.noteGet, ({ id }) => notes.get(id))
  handle(IpcChannel.noteCreate, (input) => notes.create(input))
  handle(IpcChannel.noteUpdate, (input) => notes.update(input))
  handle(IpcChannel.noteDelete, ({ id }) => notes.delete(id))

  // ------------------------------------------------------------- checklists

  handle(IpcChannel.checklistList, (input) => checklists.list(input))
  handle(IpcChannel.checklistGet, ({ id }) => checklists.get(id))
  handle(IpcChannel.checklistGetByDay, ({ day }) => checklists.findByDay(day))
  handle(IpcChannel.checklistCreate, (input) => checklists.create(input))
  handle(IpcChannel.checklistUpdate, (input) => checklists.update(input))
  handle(IpcChannel.checklistDelete, ({ id }) => checklists.delete(id))
  handle(IpcChannel.checklistStats, (input) => checklists.stats(input))

  handle(IpcChannel.checklistTaskAdd, (input) => checklists.addTask(input))
  handle(IpcChannel.checklistTaskUpdate, (input) => checklists.updateTask(input))
  handle(IpcChannel.checklistTaskDelete, ({ id }) => checklists.deleteTask(id))
  handle(IpcChannel.checklistTaskMove, (input) => checklists.moveTask(input))

  // ----------------------------------------------------------------- assets

  handle(IpcChannel.assetPick, async () => {
    const window = BrowserWindow.getFocusedWindow()
    const result = window
      ? await dialog.showOpenDialog(window, openDialogOptions())
      : await dialog.showOpenDialog(openDialogOptions())

    if (result.canceled) return []

    // Describing each file validates size and readability now, so the dialog
    // can report "too large" before the user fills in a title.
    const described: PickedFile[] = []
    for (const filePath of result.filePaths) {
      described.push(await assets.describe(filePath))
    }
    return described
  })

  handle(IpcChannel.assetAdd, (input) => items.addAssets(input))
  handle(IpcChannel.assetCompose, (input) => items.composeAsset(input))
  handle(IpcChannel.assetUpdateText, (input) => items.updateAssetText(input))
  handle(IpcChannel.assetDelete, ({ id }) => items.removeAsset(id))
  handle(IpcChannel.assetRender, ({ id }) => documents.render(assets.require(id)))

  handle(IpcChannel.assetOpenExternal, async ({ id }) => {
    const asset = assets.require(id)
    const error = await shell.openPath(assets.absolutePath(asset))
    if (error) {
      throw new AppError(ErrorCode.ASSET_UNREADABLE, `the system could not open the file: ${error}`, {
        assetId: id,
      })
    }
    return null
  })

  handle(IpcChannel.assetRevealInFolder, ({ id }) => {
    shell.showItemInFolder(assets.absolutePath(assets.require(id)))
    return null
  })

  // ------------------------------------------------------------------ vault

  handle(IpcChannel.vaultInfo, () => vault.info())
  handle(IpcChannel.vaultOpenFolder, async () => {
    await shell.openPath(container.store.rootDir)
    return null
  })

  // ---------------------------------------------------------------- updates

  handle(IpcChannel.updateGet, () => updates.get())
  handle(IpcChannel.updateCheck, () => updates.check())
  handle(IpcChannel.updateDownload, () => updates.download())
  handle(IpcChannel.updateInstall, () => updates.install())

  logger.info(`registered ${Object.keys(IpcChannel).length} IPC channels`)
}

function openDialogOptions(): Electron.OpenDialogOptions {
  return {
    title: 'Chọn tệp để tải lên',
    buttonLabel: 'Thêm',
    properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
    filters: FILE_DIALOG_FILTERS.map((f) => ({ name: f.name, extensions: [...f.extensions] })),
  }
}

/**
 * Turns anything thrown into the wire format.
 *
 * An AppError is an outcome the UI knows how to explain, so it crosses intact.
 * Anything else is a bug: the message could contain a filesystem path or a
 * stack, so the renderer gets UNKNOWN and the detail goes to the log only.
 */
function serialize(channel: string, error: unknown): SerializedError {
  if (error instanceof AppError) {
    logger.warn(`${channel} -> ${error.code}: ${error.message}`)
    return { code: error.code, message: error.message, details: error.details }
  }

  logger.error(`${channel} -> unhandled: ${error instanceof Error ? error.stack : String(error)}`)
  return { code: ErrorCode.UNKNOWN, message: 'unexpected error; see the application log' }
}
