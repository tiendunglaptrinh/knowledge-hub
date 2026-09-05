/**
 * Renames stored files in an existing vault to the readable scheme.
 *
 *   npm run tidy:filenames                 # against the configured vault
 *   KB_DATA_DIR=/tmp/x npm run tidy:filenames
 *   npm run tidy:filenames -- --dry-run    # print what would change
 *
 * Vaults written before this change name every file after the row that owns
 * it — `7b1e2c3d-…-OWASP Top 10.docx`, `3f2a9c14-…-Ôn tập.md`. That guaranteed
 * uniqueness for free and made the vault unreadable, which works against the
 * reason files are stored as plain files at all. New writes use a slug of the
 * document's own name; this brings the rest of an existing vault into line.
 *
 * What it does, per file:
 *   1. work out the name the current code would have chosen
 *   2. skip if the file already has it, or is missing from disk
 *   3. rename on disk, suffixing `-2`, `-3` … if that name is taken
 *   4. update `rel_path` in the row that points at it
 *   5. rewrite the affected `item.json` sidecars
 *
 * **Disk first, database second**, the same ordering as everywhere else: a
 * crash between the two leaves a row pointing at a moved file, which this
 * script fixes on the next run because step 2 finds the old path missing —
 * whereas updating the row first would point it at a file that does not exist
 * yet, and a second run could not tell that from real corruption.
 *
 * Close the application first. It does not take the SQLite lock politely.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { openDatabase } from '../src/storage/database'
import { FsAssetStore } from '../src/storage/fs/asset-store'
import { SqliteAssetRepository } from '../src/storage/sqlite/asset.repository'
import { SqliteCategoryRepository } from '../src/storage/sqlite/category.repository'
import { SqliteItemRepository } from '../src/storage/sqlite/item.repository'
import { SqliteTagRepository } from '../src/storage/sqlite/tag.repository'
import { AssetService } from '../src/modules/asset/asset.service'
import { CategoryService } from '../src/modules/category/category.service'
import { DocumentService } from '../src/modules/document/document.service'
import { ItemService } from '../src/modules/item/item.service'
import { slugFilename } from '../src/core/domain/slug'
import { noteFilename } from '../src/core/domain/note'
import type { UnitOfWork } from '../src/core/ports/repositories'

const DRY_RUN = process.argv.includes('--dry-run')

interface Row {
  id: string
  rel_path: string
  /** The display name the new stored name is derived from. */
  display: string
  /** Item id, for assets, so the sidecar can be refreshed afterwards. */
  itemId?: string
}

async function main(): Promise<void> {
  const dataDir = await resolveDataDir()
  console.log(`vault: ${dataDir}${DRY_RUN ? '   (dry run)' : ''}\n`)

  // One store for both halves: `resolve` only enforces the vault root, so it
  // handles `notes/…` as happily as `assets/…`.
  const store = new FsAssetStore(dataDir)
  const { db } = openDatabase(path.join(dataDir, 'knowledge.db'))

  const assets = db
    .prepare<[], { id: string; item_id: string; filename: string; rel_path: string }>(
      `SELECT id, item_id, filename, rel_path FROM assets ORDER BY item_id, sort_order`,
    )
    .all()
    .map<Row>((r) => ({ id: r.id, rel_path: r.rel_path, display: r.filename, itemId: r.item_id }))

  const notes = db
    .prepare<[], { id: string; title: string; format: string; rel_path: string; created_at: string }>(
      `SELECT id, title, format, rel_path, created_at FROM notes ORDER BY created_at`,
    )
    .all()
    .map<Row>((r) => ({
      id: r.id,
      // A vault upgraded from before rel_path existed has nothing recorded;
      // fall back to the old `<noteId>-…` name so those files are found too.
      rel_path: r.rel_path,
      display: noteFilename({ title: r.title, format: r.format === 'text' ? 'text' : 'markdown' }),
    }))

  const setAssetPath = db.prepare<[string, string]>(`UPDATE assets SET rel_path = ? WHERE id = ?`)
  const setNotePath = db.prepare<[string, string]>(`UPDATE notes SET rel_path = ? WHERE id = ?`)

  const touchedItems = new Set<string>()
  let renamed = 0
  let skipped = 0
  let missing = 0

  const tidy = async (rows: Row[], label: string, persist: (id: string, rel: string) => void) => {
    console.log(label)
    if (rows.length === 0) console.log('  (none)')

    for (const row of rows) {
      const current = row.rel_path
      if (current.length === 0) {
        console.log(`  ?   ${row.display} — no path recorded, leaving alone`)
        missing += 1
        continue
      }

      const desired = slugFilename(row.display)
      const dir = path.posix.dirname(current)

      if (path.posix.basename(current) === desired) {
        skipped += 1
        continue
      }

      const absoluteFrom = store.resolve(current)
      if (!(await exists(absoluteFrom))) {
        console.log(`  !   ${current} — not on disk, leaving the row alone`)
        missing += 1
        continue
      }

      const target = await freeName(store, dir, desired)
      console.log(`  ->  ${path.posix.basename(current)}\n      ${path.posix.basename(target)}`)

      if (!DRY_RUN) {
        await fs.rename(absoluteFrom, store.resolve(target))
        persist(row.id, target)
      }
      renamed += 1
      if (row.itemId) touchedItems.add(row.itemId)
    }
  }

  await tidy(assets, 'assets', (id, rel) => setAssetPath.run(rel, id))
  await tidy(notes, '\nnotes', (id, rel) => setNotePath.run(rel, id))

  // The sidecar lists every asset's rel_path, so any item whose files moved
  // now describes paths that are gone.
  if (!DRY_RUN && touchedItems.size > 0) {
    const items = buildItemService(db, store)
    console.log(`\nrewriting ${touchedItems.size} item.json sidecar(s)`)
    for (const itemId of touchedItems) await items.refreshSidecar(itemId)
  }

  db.pragma('wal_checkpoint(TRUNCATE)')
  db.close()

  console.log(
    `\n${renamed} renamed, ${skipped} already tidy, ${missing} skipped` +
      (DRY_RUN ? '  — nothing was written' : ''),
  )
  if (DRY_RUN && renamed > 0) console.log('run again without --dry-run to apply')
}

/**
 * `src/main/config.ts` cannot be reused here: it reads `app.isPackaged`, and
 * under `ELECTRON_RUN_AS_NODE` there is no `app`. The same two inputs are
 * honoured — the environment variable, then `.env` beside the project — and
 * the resolved path is printed so it can be checked before anything moves.
 */
async function resolveDataDir(): Promise<string> {
  if (process.env.KB_DATA_DIR) return path.resolve(process.env.KB_DATA_DIR)

  try {
    const env = await fs.readFile(path.join(process.cwd(), '.env'), 'utf8')
    const line = env.split(/\r?\n/).find((l) => l.trim().startsWith('KB_DATA_DIR='))
    if (line) {
      const value = line.slice(line.indexOf('=') + 1).trim()
      if (value.length > 0) return path.resolve(value)
    }
  } catch {
    // no .env — fall through to the development default
  }

  return path.join(process.cwd(), 'data')
}

/** First free `name`, `name-2`, `name-3` … in `dirRel`. */
async function freeName(store: FsAssetStore, dirRel: string, desired: string): Promise<string> {
  const dot = desired.lastIndexOf('.')
  const stem = dot > 0 ? desired.slice(0, dot) : desired
  const suffix = dot > 0 ? desired.slice(dot) : ''

  for (let n = 1; n < 500; n += 1) {
    const candidate = n === 1 ? desired : `${stem}-${n}${suffix}`
    const relPath = `${dirRel}/${candidate}`
    if (!(await exists(store.resolve(relPath)))) return relPath
  }
  throw new Error(`no free filename for ${desired} in ${dirRel}`)
}

/**
 * The sidecar payload lives behind `ItemService`, so the service is wired up
 * rather than the JSON being rebuilt here — a second copy of that shape would
 * drift the first time a field is added.
 */
function buildItemService(
  db: ReturnType<typeof openDatabase>['db'],
  store: FsAssetStore,
): ItemService {
  const uow: UnitOfWork = { run: (work) => db.transaction(work)() }
  const assetRepo = new SqliteAssetRepository(db)
  const documents = new DocumentService(store)

  return new ItemService(
    new SqliteItemRepository(db),
    new SqliteTagRepository(db),
    assetRepo,
    store,
    uow,
    new CategoryService(new SqliteCategoryRepository(db)),
    new AssetService(assetRepo, store),
    documents,
  )
}

async function exists(absolute: string): Promise<boolean> {
  try {
    await fs.access(absolute)
    return true
  } catch {
    return false
  }
}

main().catch((error) => {
  console.error(`\n${String(error?.message ?? error)}`)
  assert.fail(String(error))
})
