import type { Asset } from '../../shared/types'
import type { AssetRepository } from '../../core/ports/repositories'
import type { Db } from '../database'
import { toAsset, type AssetRow } from './rows'

export class SqliteAssetRepository implements AssetRepository {
  private readonly stmt

  constructor(db: Db) {
    this.stmt = {
      listForItem: db.prepare<[string], AssetRow>(
        `SELECT * FROM assets WHERE item_id = ? ORDER BY sort_order, created_at`,
      ),

      findById: db.prepare<[string], AssetRow>(`SELECT * FROM assets WHERE id = ?`),

      // Scoped to the item on purpose: the same PDF attached to two different
      // items is two legitimate assets, not a duplicate.
      findByChecksum: db.prepare<[string, string], AssetRow>(
        `SELECT * FROM assets WHERE item_id = ? AND checksum = ? LIMIT 1`,
      ),

      insert: db.prepare<Asset>(`
        INSERT INTO assets
          (id, item_id, filename, ext, mime, size_bytes, rel_path, checksum, sort_order, created_at)
        VALUES
          (@id, @itemId, @filename, @ext, @mime, @sizeBytes, @relPath, @checksum, @sortOrder, @createdAt)
      `),

      updateContent: db.prepare<[number, string, string]>(
        `UPDATE assets SET size_bytes = ?, checksum = ? WHERE id = ?`,
      ),

      delete: db.prepare<[string]>(`DELETE FROM assets WHERE id = ?`),

      nextSortOrder: db.prepare<[string], { next: number }>(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM assets WHERE item_id = ?`,
      ),

      totalBytes: db.prepare<[], { total: number }>(
        `SELECT COALESCE(SUM(size_bytes), 0) AS total FROM assets`,
      ),
    }
  }

  listForItem(itemId: string): Asset[] {
    return this.stmt.listForItem.all(itemId).map(toAsset)
  }

  findById(id: string): Asset | null {
    const row = this.stmt.findById.get(id)
    return row ? toAsset(row) : null
  }

  findByChecksum(itemId: string, checksum: string): Asset | null {
    const row = this.stmt.findByChecksum.get(itemId, checksum)
    return row ? toAsset(row) : null
  }

  insert(asset: Asset): void {
    this.stmt.insert.run(asset)
  }

  updateContent(id: string, sizeBytes: number, checksum: string): void {
    this.stmt.updateContent.run(sizeBytes, checksum, id)
  }

  delete(id: string): void {
    this.stmt.delete.run(id)
  }

  nextSortOrder(itemId: string): number {
    return this.stmt.nextSortOrder.get(itemId)?.next ?? 0
  }

  /**
   * Sum of `size_bytes` across every asset. Reported in Settings and cheaper
   * than walking the vault directory, which on a /mnt/* mount is slow.
   */
  totalBytes(): number {
    return this.stmt.totalBytes.get()?.total ?? 0
  }
}
