import type { Item, ItemSummary } from '../../shared/types'
import type { ItemRepository } from '../../core/ports/repositories'
import type { Db } from '../database'
import { toItem, toItemSummary, type ItemRow, type ItemSummaryRow } from './rows'
import { toMatchExpression } from './fts'

/** Bind object for UPDATE — `createdAt` is immutable, so it is not bound. */
type ItemUpdateParams = Omit<Item, 'createdAt'>

/**
 * The projection behind every list screen: an item plus the three things the
 * card needs (its category, how many files it has, its tags) in one round
 * trip. Doing the tag lookup as a correlated `group_concat` rather than a
 * second query is what keeps the list free of an N+1.
 *
 * `{{WHERE}}` and `{{ORDER}}` are substituted from string literals defined in
 * this file only — never from caller input.
 */
const SUMMARY_SELECT = `
  SELECT i.*,
         c.name  AS category_name,
         c.color AS category_color,
         (SELECT COUNT(*) FROM assets a WHERE a.item_id = i.id) AS asset_count,
         (SELECT a.ext FROM assets a
           WHERE a.item_id = i.id
           ORDER BY a.sort_order, a.created_at
           LIMIT 1) AS primary_ext,
         (SELECT group_concat(t.name, char(31))
            FROM item_tags it JOIN tags t ON t.id = it.tag_id
           WHERE it.item_id = i.id) AS tag_names
    FROM items i
    JOIN categories c ON c.id = i.category_id
   {{WHERE}}
   {{ORDER}}
`

function summarySql(where: string, order: string): string {
  return SUMMARY_SELECT.replace('{{WHERE}}', where).replace('{{ORDER}}', order)
}

export class SqliteItemRepository implements ItemRepository {
  private readonly stmt

  constructor(db: Db) {
    this.stmt = {
      listByCategory: db.prepare<[string], ItemSummaryRow>(
        summarySql('WHERE i.category_id = ?', 'ORDER BY i.updated_at DESC'),
      ),

      listRecent: db.prepare<[number], ItemSummaryRow>(
        summarySql('', 'ORDER BY i.updated_at DESC LIMIT ?'),
      ),

      findById: db.prepare<[string], ItemRow>(`SELECT * FROM items WHERE id = ?`),

      insert: db.prepare<Item>(`
        INSERT INTO items (id, category_id, title, summary, created_at, updated_at)
        VALUES (@id, @categoryId, @title, @summary, @createdAt, @updatedAt)
      `),

      update: db.prepare<ItemUpdateParams>(`
        UPDATE items
           SET category_id = @categoryId, title = @title, summary = @summary,
               updated_at = @updatedAt
         WHERE id = @id
      `),

      delete: db.prepare<[string]>(`DELETE FROM items WHERE id = ?`),

      touch: db.prepare<[string, string]>(`UPDATE items SET updated_at = ? WHERE id = ?`),

      // FTS5 `MATCH` against a ranked join back onto items. `bm25()` gives
      // relevance ordering; the negative sign is because bm25 returns a lower
      // score for a better match.
      search: db.prepare<[string, number], ItemSummaryRow>(
        summarySql(
          `WHERE i.id IN (SELECT item_id FROM items_fts WHERE items_fts MATCH ?)`,
          'ORDER BY i.updated_at DESC LIMIT ?',
        ),
      ),

      searchInCategory: db.prepare<[string, string, number], ItemSummaryRow>(
        summarySql(
          `WHERE i.category_id = ?
             AND i.id IN (SELECT item_id FROM items_fts WHERE items_fts MATCH ?)`,
          'ORDER BY i.updated_at DESC LIMIT ?',
        ),
      ),

      indexDelete: db.prepare<[string]>(`DELETE FROM items_fts WHERE item_id = ?`),

      indexInsert: db.prepare<[string, string, string, string]>(`
        INSERT INTO items_fts (item_id, title, summary, body) VALUES (?, ?, ?, ?)
      `),
    }
  }

  listByCategory(categoryId: string): ItemSummary[] {
    return this.stmt.listByCategory.all(categoryId).map(toItemSummary)
  }

  listRecent(limit: number): ItemSummary[] {
    return this.stmt.listRecent.all(limit).map(toItemSummary)
  }

  findById(id: string): Item | null {
    const row = this.stmt.findById.get(id)
    return row ? toItem(row) : null
  }

  insert(item: Item): void {
    this.stmt.insert.run(item)
  }

  update(item: Item): void {
    const { createdAt: _createdAt, ...params } = item
    this.stmt.update.run(params)
  }

  /** Bumps `updated_at` when something below the item changes, e.g. an asset. */
  touch(id: string, at: string): void {
    this.stmt.touch.run(at, id)
  }

  delete(id: string): void {
    this.stmt.delete.run(id)
  }

  search(query: string, categoryId: string | undefined, limit: number): ItemSummary[] {
    const expression = toMatchExpression(query)
    if (expression === null) return []

    const rows = categoryId
      ? this.stmt.searchInCategory.all(categoryId, expression, limit)
      : this.stmt.search.all(expression, limit)

    return rows.map(toItemSummary)
  }

  reindex(itemId: string, title: string, summary: string, body: string): void {
    this.stmt.indexDelete.run(itemId)
    this.stmt.indexInsert.run(itemId, title, summary, body)
  }

  removeFromIndex(itemId: string): void {
    this.stmt.indexDelete.run(itemId)
  }
}
