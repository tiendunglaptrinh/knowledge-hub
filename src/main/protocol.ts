/**
 * The `app://` scheme.
 *
 * Two hosts, one handler:
 *
 *   app://kb/...      the statically exported Next.js renderer (packaged only)
 *   app://asset/...   a file inside the vault
 *
 * Why a custom scheme instead of `file://`:
 *   - `file://` has an opaque origin, which disables `fetch`, `localStorage`
 *     and anything else keyed on origin, and makes Next's absolute `/_next/…`
 *     asset paths resolve against the filesystem root
 *   - registering the scheme as `standard` and `secure` gives the renderer a
 *     real, stable origin and lets a sane CSP apply
 *
 * The vault host is why `resolve()` in FsAssetStore refuses traversal: this
 * handler turns a renderer-supplied string into a filesystem read, so it is
 * the one place where a `../` would matter.
 */

import { app, net, protocol } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { FsAssetStore } from '../storage/fs/asset-store'
import { logger } from './logger'

export const APP_SCHEME = 'app'
export const RENDERER_ORIGIN = `${APP_SCHEME}://kb`

/**
 * Must run before `app.whenReady()`. Chromium reads the privilege table while
 * bootstrapping the network service; registering later is silently ignored.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true, // gives the scheme a parsable origin
        secure: true, // treated as a secure context, like https
        supportFetchAPI: true,
        stream: true, // range requests — the PDF viewer needs these
        codeCache: true,
      },
    },
  ])
}

/**
 * Call once, after the app is ready.
 *
 * `rendererRootOverride` exists because `app.getAppPath()` resolves relative
 * to whatever entry point Electron was given, which is the packaged app root
 * in production but the script's own directory when a tool under `scripts/`
 * boots the stack directly.
 */
export function installAppProtocol(store: FsAssetStore, rendererRootOverride?: string): void {
  const rendererRoot = rendererRootOverride ?? path.join(app.getAppPath(), 'renderer', 'out')

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)

    try {
      if (url.hostname === 'asset') {
        // decodeURIComponent per segment, mirroring how assetUrl() encoded it
        const relPath = url.pathname
          .replace(/^\//, '')
          .split('/')
          .map(decodeURIComponent)
          .join('/')

        return net.fetch(pathToFileURL(store.resolve(relPath)).toString())
      }

      if (url.hostname === 'kb') {
        // Static export path mapping. With `trailingSlash: true` Next emits
        // `out/<route>/index.html`, so a directory-looking path resolves to
        // its index; a bare extensionless path is still accepted for safety.
        let pathname = decodeURIComponent(url.pathname)
        if (pathname === '' || pathname === '/') pathname = '/index.html'
        else if (pathname.endsWith('/')) pathname = `${pathname}index.html`
        else if (!path.extname(pathname)) pathname = `${pathname}.html`

        const absolute = path.join(rendererRoot, pathname)

        // The renderer root is ours, but the pathname is not; normalising and
        // re-checking costs nothing and closes the same traversal hole.
        if (!absolute.startsWith(rendererRoot + path.sep)) {
          return new Response('forbidden', { status: 403 })
        }
        return net.fetch(pathToFileURL(absolute).toString())
      }

      return new Response('unknown host', { status: 404 })
    } catch (error) {
      logger.warn(`app:// request failed for ${request.url}: ${String(error)}`)
      return new Response('not found', { status: 404 })
    }
  })
}
