// Bundles the Electron main process and the preload script.
//
// Two separate bundles, both CommonJS, both emitted to dist/main:
//   src/main/main.ts       -> dist/main/main.js       (Node context, full Electron API)
//   src/preload/preload.ts -> dist/main/preload.js    (isolated context, contextBridge only)
//
// Native and heavy Node-only packages stay external so they are loaded from
// node_modules at runtime; electron-builder ships them unpacked from the asar.
// See docs/09-development.md#build-pipeline.

import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'dist', 'main')

/** Packages that must NOT be inlined into the bundle. */
const EXTERNAL = [
  'electron',
  'better-sqlite3', // native .node binding, cannot be bundled
  'mammoth', // pulls in a large tree of CJS deps; cheaper to require at runtime
  // Resolves `app-update.yml` and a handful of its own modules by dynamic
  // require at runtime; inlining it into one file breaks both.
  'electron-updater',
]

const isWatch = process.argv.includes('--watch')
const isDev = process.env.NODE_ENV !== 'production'

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20', // Electron 35 ships Node 22; node20 is a safe floor
  external: EXTERNAL,
  sourcemap: isDev ? 'inline' : false,
  minify: !isDev,
  logLevel: 'info',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
  // `process.env.NODE_ENV` is deliberately NOT defined here. The main process
  // reads it at runtime to decide between the dev server and the static
  // renderer; substituting it at build time would freeze that decision into
  // the bundle and make `npm start` load whatever the build machine had set.
}

await rm(OUT_DIR, { recursive: true, force: true })

const targets = [
  { entry: 'src/main/main.ts', outfile: 'main.js' },
  { entry: 'src/preload/preload.ts', outfile: 'preload.js' },
]

await Promise.all(
  targets.map((t) =>
    build({
      ...common,
      entryPoints: [path.join(ROOT, t.entry)],
      outfile: path.join(OUT_DIR, t.outfile),
    }),
  ),
)

if (isWatch) {
  console.log('[build-main] watch mode is not wired yet; re-run `npm run build:main` after edits')
}