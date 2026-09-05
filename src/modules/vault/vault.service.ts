import type { VaultInfo } from '../../shared/types'
import type { Db } from '../../storage/database'
import { currentVersion } from '../../storage/database'
import type { SqliteAssetRepository } from '../../storage/sqlite/asset.repository'
import type { FsAssetStore } from '../../storage/fs/asset-store'
import type { FsNoteStore } from '../../storage/fs/note-store'

/**
 * Read-only facts about the vault, surfaced in Settings.
 *
 * The point of this screen is that the user always knows where their files
 * physically are. Data they cannot find is data they will not trust — and the
 * vault deliberately lives outside the application directory, possibly on a
 * different drive, so it is not guessable.
 */
export class VaultService {
  constructor(
    private readonly db: Db,
    private readonly assets: SqliteAssetRepository,
    private readonly store: FsAssetStore,
    private readonly noteStore: FsNoteStore,
    private readonly databasePath: string,
  ) {}

  info(): VaultInfo {
    const count = (table: 'categories' | 'items' | 'assets' | 'notes' | 'checklists'): number =>
      (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

    return {
      dataDir: this.store.rootDir,
      databasePath: this.databasePath,
      assetsDir: this.store.assetsDir,
      notesDir: this.noteStore.notesDir,
      // Summed from the index rather than by walking the tree: on a /mnt/*
      // drive a recursive stat of a few thousand files is visibly slow.
      totalAssetBytes: this.assets.totalBytes(),
      categoryCount: count('categories'),
      itemCount: count('items'),
      assetCount: count('assets'),
      noteCount: count('notes'),
      checklistCount: count('checklists'),
      schemaVersion: currentVersion(this.db),
    }
  }
}
