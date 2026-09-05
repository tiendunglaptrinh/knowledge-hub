'use client'

/**
 * Appearance preferences: theme, fonts, and the two zoom scales.
 *
 * These are deliberately *not* in the vault. Nothing here is knowledge — it is
 * how this machine's copy of the application should look, so it lives in
 * `localStorage` beside the sidebar's collapsed state rather than in SQLite,
 * needs no IPC channel, and no schema migration when a new option is added.
 *
 * Two separate scales exist because they solve two different problems:
 *
 *   contentScale  multiplies type size inside documents and editing panes only.
 *                 Applied as a CSS variable the panes read. Use it to make a
 *                 document comfortable without inflating the chrome around it.
 *
 *   appZoom       Electron's own zoom factor for the whole window. It is the
 *                 only thing that can scale Chromium's built-in PDF viewer, an
 *                 image, or a size written in pixels — no stylesheet of ours
 *                 reaches inside an <iframe> or an <img>.
 *
 * Font stacks are named here but defined in globals.css (`--font-stack-*`), so
 * the list of families exists once. This module only ever writes
 * `var(--font-stack-<key>)`, never a family list.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { getBridge } from './bridge'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type ThemeName = 'dark' | 'light' | 'sepia' | 'contrast'

export interface ThemeOption {
  value: ThemeName
  label: string
  hint: string
  /** Three colours for the picker's preview chip: background, panel, accent. */
  swatch: [string, string, string]
}

export const THEMES: readonly ThemeOption[] = [
  {
    value: 'dark',
    label: 'Tối',
    hint: 'Mặc định. Nền tối làm nội dung sáng nhất trên màn hình.',
    swatch: ['#0b1020', '#1b2540', '#38bdf8'],
  },
  {
    value: 'light',
    label: 'Sáng',
    hint: 'Nền trắng, phù hợp phòng nhiều ánh sáng.',
    swatch: ['#ffffff', '#eef2f9', '#0369a1'],
  },
  {
    value: 'sepia',
    label: 'Ngả vàng',
    hint: 'Màu giấy, dịu mắt khi đọc tài liệu dài.',
    swatch: ['#f6efe1', '#e7dcc6', '#9a5b1c'],
  },
  {
    value: 'contrast',
    label: 'Tương phản cao',
    hint: 'Nền đen tuyệt đối, chữ trắng — dễ đọc nhất.',
    swatch: ['#000000', '#17171a', '#4cc9ff'],
  },
] as const

export interface FontOption {
  /** Matches a `--font-stack-<value>` variable in globals.css. */
  value: string
  label: string
}

/** Families offered for the chrome and for rendered documents. */
export const TEXT_FONTS: readonly FontOption[] = [
  { value: 'system', label: 'Hệ thống (Inter / Segoe UI)' },
  { value: 'segoe', label: 'Segoe UI' },
  { value: 'arial', label: 'Arial' },
  { value: 'tahoma', label: 'Tahoma' },
  { value: 'georgia', label: 'Georgia (có chân)' },
  { value: 'times', label: 'Times New Roman (có chân)' },
] as const

/** Families offered for source panes, code and verbatim text. */
export const MONO_FONTS: readonly FontOption[] = [
  { value: 'mono', label: 'JetBrains Mono / Cascadia' },
  { value: 'consolas', label: 'Consolas' },
  { value: 'courier', label: 'Courier New' },
] as const

export interface Prefs {
  theme: ThemeName
  /** Key into TEXT_FONTS — application chrome. */
  uiFont: string
  /** Key into TEXT_FONTS — rendered documents and notes. */
  docFont: string
  /** Key into MONO_FONTS — source panes, code, verbatim text. */
  monoFont: string
  /** Multiplier on document and editor type size. */
  contentScale: number
  /** Electron zoom factor for the whole window. */
  appZoom: number
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  uiFont: 'system',
  docFont: 'system',
  monoFont: 'mono',
  contentScale: 1,
  appZoom: 1,
}

/**
 * Discrete steps rather than a free slider, so `−` and `+` always land on a
 * round number and the same press produces the same result every time.
 */
export const APP_ZOOM_STEPS: readonly number[] = [
  0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.5, 1.75, 2,
] as const

export const CONTENT_SCALE_STEPS: readonly number[] = [
  0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2, 2.25, 2.5,
] as const

/**
 * The ends of each range, so a component can grey out `−` at the bottom without
 * indexing into the step list — which under `noUncheckedIndexedAccess` is a
 * `number | undefined` every caller would have to narrow.
 */
export const APP_ZOOM_MIN = Math.min(...APP_ZOOM_STEPS)
export const APP_ZOOM_MAX = Math.max(...APP_ZOOM_STEPS)
export const CONTENT_SCALE_MIN = Math.min(...CONTENT_SCALE_STEPS)
export const CONTENT_SCALE_MAX = Math.max(...CONTENT_SCALE_STEPS)

/** Where the choices survive a restart. Read by the script in layout.tsx too. */
export const PREFS_KEY = 'kb.prefs'

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

/**
 * A key that will be interpolated into a CSS variable name has to be proved
 * safe first. `localStorage` is only writable by this renderer, so this is not
 * guarding against an attacker — it is guarding against a stale or hand-edited
 * value turning into a broken stylesheet.
 */
const SAFE_KEY = /^[a-z]+$/

function pickFont(options: readonly FontOption[], value: unknown, fallback: string): string {
  return typeof value === 'string' && SAFE_KEY.test(value) && options.some((o) => o.value === value)
    ? value
    : fallback
}

/** Snaps to the nearest allowed step, so an out-of-range value cannot persist. */
export function nearestStep(steps: readonly number[], value: number): number {
  return steps.reduce((best, step) =>
    Math.abs(step - value) < Math.abs(best - value) ? step : best,
  )
}

/** Moves `delta` places along the steps, clamped at both ends. */
function stepBy(steps: readonly number[], value: number, delta: number): number {
  const index = steps.indexOf(nearestStep(steps, value))
  const next = Math.min(steps.length - 1, Math.max(0, index + delta))
  return steps[next] ?? value
}

/** Anything unrecognised in storage falls back to the default for that field. */
function parsePrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_PREFS
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFS

  const value = parsed as Partial<Record<keyof Prefs, unknown>>
  const theme = THEMES.some((t) => t.value === value.theme)
    ? (value.theme as ThemeName)
    : DEFAULT_PREFS.theme

  return {
    theme,
    uiFont: pickFont(TEXT_FONTS, value.uiFont, DEFAULT_PREFS.uiFont),
    docFont: pickFont(TEXT_FONTS, value.docFont, DEFAULT_PREFS.docFont),
    monoFont: pickFont(MONO_FONTS, value.monoFont, DEFAULT_PREFS.monoFont),
    contentScale:
      typeof value.contentScale === 'number' && Number.isFinite(value.contentScale)
        ? nearestStep(CONTENT_SCALE_STEPS, value.contentScale)
        : DEFAULT_PREFS.contentScale,
    appZoom:
      typeof value.appZoom === 'number' && Number.isFinite(value.appZoom)
        ? nearestStep(APP_ZOOM_STEPS, value.appZoom)
        : DEFAULT_PREFS.appZoom,
  }
}

/**
 * Writes the preferences onto the document.
 *
 * Everything except `appZoom` is a custom property on `<html>`, which is why a
 * theme change repaints without a single component re-rendering. `appZoom`
 * goes through the bridge to Electron's `webFrame`, and is skipped in a plain
 * browser where there is no bridge.
 */
function apply(prefs: Prefs): void {
  const root = document.documentElement

  root.dataset.theme = prefs.theme
  root.style.setProperty('--ui-font', `var(--font-stack-${prefs.uiFont})`)
  root.style.setProperty('--doc-font', `var(--font-stack-${prefs.docFont})`)
  root.style.setProperty('--mono-font', `var(--font-stack-${prefs.monoFont})`)
  root.style.setProperty('--content-scale', String(prefs.contentScale))

  getBridge()?.view.setZoomFactor(prefs.appZoom)
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface PrefsStore extends Prefs {
  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void
  /** `+1` / `−1` along CONTENT_SCALE_STEPS. */
  stepContentScale(delta: number): void
  resetContentScale(): void
  /** `+1` / `−1` along APP_ZOOM_STEPS. */
  stepAppZoom(delta: number): void
  resetAppZoom(): void
  resetAll(): void
  /** True once storage has been read, so the UI can avoid showing defaults. */
  loaded: boolean
}

const PrefsContext = createContext<PrefsStore | null>(null)

export function PrefsProvider({ children }: { children: ReactNode }) {
  /*
   * Starts at the defaults and is corrected from storage on mount, for the same
   * reason the sidebar's collapsed state is: reading storage during the first
   * render would disagree with the HTML Next's static export prerendered, and
   * React would discard the tree. The visible flash this would otherwise cause
   * is already prevented by the pre-paint script in layout.tsx, which applies
   * the stored theme and fonts before anything is drawn.
   */
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const stored = parsePrefs(window.localStorage.getItem(PREFS_KEY))
    setPrefs(stored)
    setLoaded(true)
    // Re-applied even though the pre-paint script already ran: that script
    // ignores anything it cannot validate, and this is the parse that decides
    // what the rest of the session sees.
    apply(stored)
  }, [])

  const commit = useCallback((next: Prefs) => {
    setPrefs(next)
    apply(next)
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next))
    } catch {
      // A full or blocked storage quota must not stop the appearance change
      // the user just asked for; it only means it is forgotten on restart.
    }
  }, [])

  const store = useMemo<PrefsStore>(
    () => ({
      ...prefs,
      loaded,

      set: (key, value) => commit({ ...prefs, [key]: value }),

      stepContentScale: (delta) =>
        commit({
          ...prefs,
          contentScale: stepBy(CONTENT_SCALE_STEPS, prefs.contentScale, delta),
        }),
      resetContentScale: () => commit({ ...prefs, contentScale: DEFAULT_PREFS.contentScale }),

      stepAppZoom: (delta) =>
        commit({ ...prefs, appZoom: stepBy(APP_ZOOM_STEPS, prefs.appZoom, delta) }),
      resetAppZoom: () => commit({ ...prefs, appZoom: DEFAULT_PREFS.appZoom }),

      resetAll: () => commit(DEFAULT_PREFS),
    }),
    [prefs, loaded, commit],
  )

  /*
   * Ctrl/Cmd +, − and 0 zoom the application, which is what those keys do in
   * every other desktop application — so they are bound globally and always
   * do something visible. Content-only zoom is the editor's and the viewer's
   * own control, because it would be invisible from a list screen.
   *
   * `event.code` rather than `event.key`: the plus key reports as `=` unshifted
   * and `+` shifted, and on other layouts as neither.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return

      const plus = event.code === 'Equal' || event.code === 'NumpadAdd' || event.key === '+'
      const minus = event.code === 'Minus' || event.code === 'NumpadSubtract' || event.key === '-'
      const zero = event.code === 'Digit0' || event.code === 'Numpad0'

      if (!plus && !minus && !zero) return
      event.preventDefault()

      if (zero) store.resetAppZoom()
      else store.stepAppZoom(plus ? 1 : -1)
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [store])

  return <PrefsContext.Provider value={store}>{children}</PrefsContext.Provider>
}

export function usePrefs(): PrefsStore {
  const store = useContext(PrefsContext)
  if (!store) throw new Error('usePrefs must be used inside <PrefsProvider>')
  return store
}

/**
 * Ctrl+wheel over a document or an editing pane, for content-only zoom.
 *
 * Electron leaves Chromium's own Ctrl+wheel zoom disabled, so the gesture is
 * free to mean this instead. Scoped to an element rather than the document so
 * it applies to the surface the pointer is actually over.
 *
 * Returns a **ref callback**, not an `onWheel` handler, and this is load-bearing:
 * React registers `wheel` on its root as a *passive* listener, where
 * `preventDefault()` does nothing but log a warning. Via `onWheel` the zoom
 * would still happen, but the document would scroll at the same time — the
 * gesture has to be able to cancel the scroll, which needs
 * `{ passive: false }`, which needs the listener attached directly.
 *
 * The node is held in state rather than a ref because the surface it attaches
 * to mounts and unmounts as the viewer switches between formats; a `useRef`
 * would not re-run the effect when it changed.
 */
export function useContentZoomWheel<T extends HTMLElement>(): (node: T | null) => void {
  const { stepContentScale } = usePrefs()
  const [node, setNode] = useState<T | null>(null)

  useEffect(() => {
    if (!node) return

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      if (event.deltaY === 0) return
      event.preventDefault()
      // Wheel up (negative deltaY) enlarges, matching every browser's zoom.
      stepContentScale(event.deltaY < 0 ? 1 : -1)
    }

    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [node, stepContentScale])

  // `setNode` is a stable function, so React calls it once on mount and once
  // with null on unmount — exactly the ref-callback contract.
  return setNode
}

/** `1.25` -> `125%`, for the zoom readouts. */
export function formatScale(scale: number): string {
  return `${Math.round(scale * 100)}%`
}
