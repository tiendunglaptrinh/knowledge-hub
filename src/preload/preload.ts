/**
 * The bridge.
 *
 * This is the entire attack surface between the renderer and the operating
 * system. It runs in an isolated context with `sandbox: true`, so it has no
 * `require`, no `fs`, and no way to reach Node beyond what `electron` exposes
 * to a sandboxed preload — `ipcRenderer`, `contextBridge`, `webUtils`.
 *
 * Every method is a one-line `invoke` on a channel declared in the shared
 * contract. Nothing is computed here, and no generic "call any channel"
 * escape hatch is exposed: a renderer compromise can only reach the operations
 * listed below, with the payloads the main process validates anyway.
 *
 * See docs/07-security.md.
 */

import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

import {
  BRIDGE_KEY,
  IpcChannel,
  IpcEvent,
  type ApiMap,
  type KnowledgeHubBridge,
  type Result,
} from '../shared/ipc'
import type { UpdateState } from '../shared/types'

function invoke<C extends keyof ApiMap>(
  channel: C,
  payload?: ApiMap[C]['req'],
): Promise<Result<ApiMap[C]['res']>> {
  return ipcRenderer.invoke(channel, payload)
}

const bridge: KnowledgeHubBridge = {
  category: {
    list: () => invoke(IpcChannel.categoryList),
    create: (input) => invoke(IpcChannel.categoryCreate, input),
    update: (input) => invoke(IpcChannel.categoryUpdate, input),
    remove: (id) => invoke(IpcChannel.categoryDelete, { id }),
  },

  item: {
    listByCategory: (categoryId) => invoke(IpcChannel.itemListByCategory, { categoryId }),
    recent: (limit) => invoke(IpcChannel.itemRecent, { limit }),
    get: (id) => invoke(IpcChannel.itemGet, { id }),
    create: (input) => invoke(IpcChannel.itemCreate, input),
    update: (input) => invoke(IpcChannel.itemUpdate, input),
    remove: (id) => invoke(IpcChannel.itemDelete, { id }),
    search: (input) => invoke(IpcChannel.itemSearch, input),
  },

  note: {
    list: (input) => invoke(IpcChannel.noteList, input),
    get: (id) => invoke(IpcChannel.noteGet, { id }),
    create: (input) => invoke(IpcChannel.noteCreate, input),
    update: (input) => invoke(IpcChannel.noteUpdate, input),
    remove: (id) => invoke(IpcChannel.noteDelete, { id }),
  },

  checklist: {
    list: (input) => invoke(IpcChannel.checklistList, input),
    get: (id) => invoke(IpcChannel.checklistGet, { id }),
    getByDay: (day) => invoke(IpcChannel.checklistGetByDay, { day }),
    create: (input) => invoke(IpcChannel.checklistCreate, input),
    update: (input) => invoke(IpcChannel.checklistUpdate, input),
    remove: (id) => invoke(IpcChannel.checklistDelete, { id }),
    stats: (input) => invoke(IpcChannel.checklistStats, input),

    addTask: (input) => invoke(IpcChannel.checklistTaskAdd, input),
    updateTask: (input) => invoke(IpcChannel.checklistTaskUpdate, input),
    removeTask: (id) => invoke(IpcChannel.checklistTaskDelete, { id }),
    moveTask: (input) => invoke(IpcChannel.checklistTaskMove, input),
  },

  asset: {
    pick: () => invoke(IpcChannel.assetPick),
    add: (input) => invoke(IpcChannel.assetAdd, input),
    compose: (input) => invoke(IpcChannel.assetCompose, input),
    updateText: (input) => invoke(IpcChannel.assetUpdateText, input),
    remove: (id) => invoke(IpcChannel.assetDelete, { id }),
    render: (id) => invoke(IpcChannel.assetRender, { id }),
    openExternal: (id) => invoke(IpcChannel.assetOpenExternal, { id }),
    revealInFolder: (id) => invoke(IpcChannel.assetRevealInFolder, { id }),

    // Electron 32 removed `File.path`. This is the supported replacement and
    // the only way drag-and-drop can learn where a dropped file actually is.
    pathForFile: (file: File) => webUtils.getPathForFile(file),
  },

  vault: {
    info: () => invoke(IpcChannel.vaultInfo),
    openFolder: () => invoke(IpcChannel.vaultOpenFolder),
  },

  update: {
    get: () => invoke(IpcChannel.updateGet),
    check: () => invoke(IpcChannel.updateCheck),
    download: () => invoke(IpcChannel.updateDownload),
    install: () => invoke(IpcChannel.updateInstall),

    /**
     * The only subscription in the bridge.
     *
     * The listener is wrapped rather than passed to `ipcRenderer.on` directly,
     * so the renderer never receives Electron's `IpcRendererEvent` — that
     * object carries `sender`, and handing a renderer a route back to the
     * main process would undo the point of the whole file.
     *
     * Returns the unsubscribe function; `removeListener` needs the *wrapper*,
     * which the caller has no way to name.
     */
    onStateChange: (listener: (state: UpdateState) => void) => {
      const wrapped = (_event: unknown, state: UpdateState) => listener(state)
      ipcRenderer.on(IpcEvent.updateState, wrapped)
      return () => ipcRenderer.removeListener(IpcEvent.updateState, wrapped)
    },
  },

  view: {
    // Not an `invoke`: `webFrame` is one of the few Electron modules a
    // sandboxed preload may use, and zoom is a property of this frame — routing
    // it through the main process would add a channel that changes nothing.
    // Clamped here rather than trusting the caller, because a stored value that
    // has been hand-edited to 40 would leave a window nobody can read to fix it.
    setZoomFactor: (factor: number) => {
      if (!Number.isFinite(factor)) return
      webFrame.setZoomFactor(Math.min(3, Math.max(0.5, factor)))
    },
    getZoomFactor: () => webFrame.getZoomFactor(),
  },
}

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge)
