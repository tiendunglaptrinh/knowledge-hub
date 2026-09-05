/**
 * Composition root.
 *
 * Every `new` in the application happens here. Services receive their
 * collaborators as constructor arguments and never construct or import a
 * concrete repository, which is what keeps `src/modules` testable with a fake
 * store and no Electron in sight.
 *
 * Startup order matters and is enforced by the code below:
 *   1. resolve configuration (where is the vault?)
 *   2. create and probe the vault directory — fail loudly if unwritable
 *   3. open SQLite and run migrations
 *   4. wire services
 *
 * See docs/03-architecture.md#composition-root.
 */

import type { AppConfig } from './config'
import { openDatabase, type Db } from '../storage/database'
import { FsAssetStore } from '../storage/fs/asset-store'
import { FsNoteStore } from '../storage/fs/note-store'
import { SqliteAssetRepository } from '../storage/sqlite/asset.repository'
import { SqliteCategoryRepository } from '../storage/sqlite/category.repository'
import { SqliteChecklistRepository } from '../storage/sqlite/checklist.repository'
import { SqliteItemRepository } from '../storage/sqlite/item.repository'
import { SqliteNoteRepository } from '../storage/sqlite/note.repository'
import { SqliteTagRepository } from '../storage/sqlite/tag.repository'
import type { UnitOfWork } from '../core/ports/repositories'
import { AssetService } from '../modules/asset/asset.service'
import { CategoryService } from '../modules/category/category.service'
import { ChecklistService } from '../modules/checklist/checklist.service'
import { DocumentService } from '../modules/document/document.service'
import { ItemService } from '../modules/item/item.service'
import { NoteService } from '../modules/note/note.service'
import { VaultService } from '../modules/vault/vault.service'
import { UpdateService } from './updater'
import { logger } from './logger'

export interface Container {
  config: AppConfig
  db: Db
  store: FsAssetStore
  noteStore: FsNoteStore
  categories: CategoryService
  items: ItemService
  notes: NoteService
  checklists: ChecklistService
  assets: AssetService
  documents: DocumentService
  vault: VaultService
  updates: UpdateService
  dispose(): void
}

export async function createContainer(config: AppConfig): Promise<Container> {
  const store = new FsAssetStore(config.dataDir)
  await store.init()

  // After the asset store, which is what proves the vault is writable at all.
  const noteStore = new FsNoteStore(config.dataDir)
  await noteStore.init()

  const { db, fromVersion, toVersion } = openDatabase(config.databasePath)
  if (fromVersion !== toVersion) {
    logger.info(`database migrated from schema v${fromVersion} to v${toVersion}`)
  }

  const categoryRepo = new SqliteCategoryRepository(db)
  const itemRepo = new SqliteItemRepository(db)
  const tagRepo = new SqliteTagRepository(db)
  const assetRepo = new SqliteAssetRepository(db)
  const noteRepo = new SqliteNoteRepository(db)
  const checklistRepo = new SqliteChecklistRepository(db)

  // better-sqlite3 returns a callable wrapper from `db.transaction`; calling
  // one inside another nests via SAVEPOINT, which is why services may compose
  // freely without tracking depth themselves.
  const uow: UnitOfWork = { run: (work) => db.transaction(work)() }

  const documents = new DocumentService(store)
  const assets = new AssetService(assetRepo, store)
  const categories = new CategoryService(categoryRepo)
  const items = new ItemService(
    itemRepo,
    tagRepo,
    assetRepo,
    store,
    uow,
    categories,
    assets,
    documents,
  )
  const notes = new NoteService(noteRepo, noteStore, uow)
  const checklists = new ChecklistService(checklistRepo, uow)
  const vault = new VaultService(db, assetRepo, store, noteStore, config.databasePath)

  // Not given the database or the vault: an update concerns the application
  // binary, and nothing it does touches the user's data.
  const updates = new UpdateService(UpdateService.isSupported())

  logger.info(`vault ready at ${store.rootDir}`)

  return {
    config,
    db,
    store,
    noteStore,
    categories,
    items,
    notes,
    checklists,
    assets,
    documents,
    vault,
    updates,
    dispose() {
      updates.dispose()
      // Checkpoints the WAL and releases the file lock. Without this a
      // -wal file can survive a hard quit and confuse a later backup.
      try {
        db.pragma('wal_checkpoint(TRUNCATE)')
        db.close()
      } catch (error) {
        logger.warn(`failed to close the database cleanly: ${String(error)}`)
      }
    },
  }
}
