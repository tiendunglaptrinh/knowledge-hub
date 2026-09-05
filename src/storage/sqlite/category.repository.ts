import type { Category, CategorySummary } from '../../shared/types'
import type { CategoryRepository } from '../../core/ports/repositories'
import type { Db } from '../database'
import { toCategory, toCategorySummary, type CategoryRow, type CategorySummaryRow } from './rows'

/** Bind object for UPDATE — `created_at` is immutable, so it is not bound. */
type CategoryUpdateParams = Omit<Category, 'createdAt'>

/**
 * SQLite-backed categories.
 *
 * Statements are prepared once in the constructor. better-sqlite3 caches the
 * compiled plan, so every later call is just a bind + step.
 *
 * Named parameters (`@id`) are used rather than positional `?` because
 * better-sqlite3 rejects an object with keys that match no parameter — which
 * turns "I added a column and forgot to bind it" into a runtime error at the
 * first call rather than a silently NULL column.
 */
export class SqliteCategoryRepository implements CategoryRepository {
  private readonly stmt

  constructor(db: Db) {
    this.stmt = {
      list: db.prepare<[], CategorySummaryRow>(`
        SELECT c.*,
               (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS item_count
        FROM categories c
        ORDER BY c.sort_order, c.name COLLATE NOCASE
      `),

      findById: db.prepare<[string], CategoryRow>(`SELECT * FROM categories WHERE id = ?`),

      slugExists: db.prepare<[string], { n: number }>(
        `SELECT COUNT(*) AS n FROM categories WHERE slug = ?`,
      ),

      // `exceptId` is bound twice so one statement serves both create
      // (exceptId = '') and update (exceptId = the row being edited).
      nameExists: db.prepare<[string, string, string], { n: number }>(`
        SELECT COUNT(*) AS n FROM categories
        WHERE lower(name) = lower(?) AND (? = '' OR id <> ?)
      `),

      insert: db.prepare<Category>(`
        INSERT INTO categories
          (id, name, slug, parent_id, color, icon, sort_order, created_at, updated_at)
        VALUES
          (@id, @name, @slug, @parentId, @color, @icon, @sortOrder, @createdAt, @updatedAt)
      `),

      update: db.prepare<CategoryUpdateParams>(`
        UPDATE categories
           SET name = @name, slug = @slug, parent_id = @parentId, color = @color,
               icon = @icon, sort_order = @sortOrder, updated_at = @updatedAt
         WHERE id = @id
      `),

      delete: db.prepare<[string]>(`DELETE FROM categories WHERE id = ?`),

      countItems: db.prepare<[string], { n: number }>(
        `SELECT COUNT(*) AS n FROM items WHERE category_id = ?`,
      ),
    }
  }

  list(): CategorySummary[] {
    return this.stmt.list.all().map(toCategorySummary)
  }

  findById(id: string): Category | null {
    const row = this.stmt.findById.get(id)
    return row ? toCategory(row) : null
  }

  slugExists(slug: string): boolean {
    return (this.stmt.slugExists.get(slug)?.n ?? 0) > 0
  }

  nameExists(name: string, exceptId = ''): boolean {
    return (this.stmt.nameExists.get(name, exceptId, exceptId)?.n ?? 0) > 0
  }

  insert(category: Category): void {
    this.stmt.insert.run(category)
  }

  update(category: Category): void {
    const { createdAt: _createdAt, ...params } = category
    this.stmt.update.run(params)
  }

  delete(id: string): void {
    this.stmt.delete.run(id)
  }

  countItems(categoryId: string): number {
    return this.stmt.countItems.get(categoryId)?.n ?? 0
  }
}
