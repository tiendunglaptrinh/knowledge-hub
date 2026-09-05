import type { TagRepository } from '../../core/ports/repositories'
import { newId } from '../../core/domain/ids'
import type { Db } from '../database'

/**
 * Tags are global, not per-category: "spring-boot" means the same thing under
 * Software as it does under Interview, and the point of a tag is to cut across
 * the category tree.
 *
 * Matching is case-insensitive (`ux_tags_name_ci`) but the first spelling the
 * user types is the one stored and displayed.
 */
export class SqliteTagRepository implements TagRepository {
  private readonly stmt

  constructor(private readonly db: Db) {
    this.stmt = {
      findByName: db.prepare<[string], { id: string }>(
        `SELECT id FROM tags WHERE lower(name) = lower(?)`,
      ),

      insert: db.prepare<[string, string]>(`INSERT INTO tags (id, name) VALUES (?, ?)`),

      listForItem: db.prepare<[string], { name: string }>(`
        SELECT t.name FROM item_tags it
          JOIN tags t ON t.id = it.tag_id
         WHERE it.item_id = ?
         ORDER BY t.name COLLATE NOCASE
      `),

      clearForItem: db.prepare<[string]>(`DELETE FROM item_tags WHERE item_id = ?`),

      link: db.prepare<[string, string]>(
        `INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)`,
      ),

      pruneOrphans: db.prepare(`
        DELETE FROM tags
         WHERE id NOT IN (SELECT DISTINCT tag_id FROM item_tags)
      `),
    }
  }

  ensureAll(names: string[]): string[] {
    const ids: string[] = []

    // Normalising here rather than in the service keeps "  Spring  " and
    // "spring" from producing two rows that only the unique index catches.
    const normalised = [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))]

    for (const name of normalised) {
      const existing = this.stmt.findByName.get(name)
      if (existing) {
        ids.push(existing.id)
        continue
      }
      const id = newId()
      this.stmt.insert.run(id, name)
      ids.push(id)
    }

    return ids
  }

  listForItem(itemId: string): string[] {
    return this.stmt.listForItem.all(itemId).map((r) => r.name)
  }

  setForItem(itemId: string, tagIds: string[]): void {
    const replace = this.db.transaction(() => {
      this.stmt.clearForItem.run(itemId)
      for (const tagId of tagIds) this.stmt.link.run(itemId, tagId)
    })
    replace()
  }

  pruneOrphans(): void {
    this.stmt.pruneOrphans.run()
  }
}
