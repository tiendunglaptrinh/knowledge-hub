/**
 * Access to `window.knowledgeHub`, plus the unwrapping helpers every component
 * uses instead of touching the bridge directly.
 *
 * The bridge only exists inside Electron. Next's static export still runs a
 * prerender pass in Node during `next build`, and a browser opened at
 * localhost:3100 has no bridge either — so `getBridge()` returns null rather
 * than throwing, and the UI degrades to an explanatory screen.
 */

import { BRIDGE_KEY, type KnowledgeHubBridge, type Result } from '@shared/ipc'
import { ErrorCode, type SerializedError } from '@shared/errors'

declare global {
  interface Window {
    [BRIDGE_KEY]?: KnowledgeHubBridge
  }
}

export function getBridge(): KnowledgeHubBridge | null {
  if (typeof window === 'undefined') return null
  return window[BRIDGE_KEY] ?? null
}

/** Throws if called outside Electron; use after `useBridgeReady()` says yes. */
export function bridge(): KnowledgeHubBridge {
  const found = getBridge()
  if (!found) {
    throw new Error('the Electron bridge is unavailable; run the app with `npm run dev`')
  }
  return found
}

/**
 * Raised by `unwrap`. Carries the machine-readable code so a component can
 * branch on it (e.g. CATEGORY_NOT_EMPTY needs a different dialog than a
 * generic failure) instead of matching on message text.
 */
export class BridgeError extends Error {
  readonly code: SerializedError['code']
  readonly details: Record<string, unknown> | undefined

  constructor(error: SerializedError) {
    super(error.message)
    this.name = 'BridgeError'
    this.code = error.code
    this.details = error.details
  }
}

/** `Result<T>` -> `T`, turning the failure branch into a throw. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data
  throw new BridgeError(result.error)
}

/** Normalises anything caught in a component into a displayable code. */
export function codeOf(error: unknown): SerializedError['code'] {
  return error instanceof BridgeError ? error.code : ErrorCode.UNKNOWN
}
