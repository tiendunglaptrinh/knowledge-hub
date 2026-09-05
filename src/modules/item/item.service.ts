/**
 * Items — the centre of the model, and the only place that coordinates the
 * other three stores (items, tags, assets, search index).
 *
 * Every mutating method has the same three-phase shape:
 *
 *   1. async, outside the transaction — validate, copy files into the vault,
 *      extract text for the index
 *   2. sync, inside one transaction — every database write, all or nothing
 *   3. async, after commit — the `item.json` sidecar, best-effort
 *
 * Phase 2 never awaits. That is what makes "the item, its tags, its files and
 * its index entry all appear together, or none of them do" true.
 */

import type {
  AssetRepository,
  AssetStore,
  ItemRepository,
  TagRepository,
  UnitOfWork,
} from '../../core/ports/repositories'
import type {
  AddAssetsInput,
  Asset,
  ComposeAssetInput,
  CreateItemInput,
  Item,
  ItemDetail,
  ItemSummary,
  SearchInput,
  UpdateAssetTextInput,
  UpdateItemInput,
} from '../../shared/types'
import { AppError, ErrorCode } from '../../shared/errors'
import { newId, nowIso } from '../../core/domain/ids'
import type { CategoryService } from '../category/category.service'
import type { AssetService, StagedAsset } from '../asset/asset.service'
import type { DocumentService } from '../document/document.service'

const TITLE_MAX = 200
const DEFAULT_RECENT_LIMIT = 30
const DEFAULT_SEARCH_LIMIT = 50

export class ItemService {
  constructor(
    private readonly items: ItemRepository,
    private readonly tags: TagRepository,
    private readonly assetRepo: AssetRepository,
    private readonly store: AssetStore,
    private readonly uow: UnitOfWork,
    private readonly categories: CategoryService,
    private readonly assetService: AssetService,
    private readonly documents: DocumentService,
  ) {}

  // -------------------------------------------------------------- queries

  listByCategory(categoryId: string): ItemSummary[] {
    this.categories.require(categoryId)
    return this.items.listByCategory(categoryId)
  }

  listRecent(limit = DEFAULT_RECENT_LIMIT): ItemSummary[] {
    return this.items.listRecent(clampLimit(limit, DEFAULT_RECENT_LIMIT))
  }

  search(input: SearchInput): ItemSummary[] {
    return this.items.search(
      input.query,
      input.categoryId,
      clampLimit(input.limit, DEFAULT_SEARCH_LIMIT),
    )
  }

  get(id: string): ItemDetail {
    return this.detail(this.require(id))
  }

  require(id: string): Item {
    const item = this.items.findById(id)
    if (!item) {
      throw new AppError(ErrorCode.ITEM_NOT_FOUND, `no item with id ${id}`, { id })
    }
    return item
  }

  // -------------------------------------------------------------- commands

  async create(input: CreateItemInput): Promise<ItemDetail> {
    const category = this.categories.require(input.categoryId)
    const title = normaliseTitle(input.title)
    const summary = normaliseSummary(input.summary)
    const at = nowIso()

    const item: Item = {
      id: newId(),
      categoryId: category.id,
      title,
      summary,
      createdAt: at,
      updatedAt: at,
    }

    // Phase 1 — files land in the vault before the database hears about them.
    // Uploads and typed documents are staged the same way and end up in one
    // list; from here on nothing distinguishes them.
    const uploaded = await this.assetService.stage(item.id, item.createdAt, input.filePaths ?? [], 0)

    let staged = uploaded
    try {
      const composed = await this.assetService.compose(
        item.id,
        item.createdAt,
        input.composed ?? [],
        uploaded.length,
      )
      staged = [...uploaded, ...composed]
    } catch (error) {
      // `compose` unwound its own copies; the uploads before it are ours.
      await this.assetService.discard(uploaded)
      throw error
    }

    const body = await this.indexBody(staged.map((s) => s.asset))

    // Phase 2 — one transaction.
    try {
      this.uow.run(() => {
        this.items.insert(item)
        this.applyTags(item.id, input.tags ?? [])
        for (const { asset } of staged) this.assetRepo.insert(asset)
        this.items.reindex(item.id, title, summary ?? '', body)
      })
    } catch (error) {
      await this.assetService.discard(staged)
      throw error
    }

    // Phase 3 — after commit; a failed sidecar must not fail the operation.
    const detail = this.detail(item)
    await this.writeSidecar(detail)
    return detail
  }

  async update(input: UpdateItemInput): Promise<ItemDetail> {
    const current = this.require(input.id)

    const categoryId =
      input.categoryId === undefined ? current.categoryId : this.categories.require(input.categoryId).id

    const title = input.title === undefined ? current.title : normaliseTitle(input.title)
    const summary = input.summary === undefined ? current.summary : normaliseSummary(input.summary)

    const next: Item = { ...current, categoryId, title, summary, updatedAt: nowIso() }

    // Reindexing needs the body text, and reading it is async — so it has to
    // happen before the transaction opens, even though nothing about the
    // files changed here.
    const body = await this.indexBody(this.assetRepo.listForItem(current.id))

    this.uow.run(() => {
      this.items.update(next)
      if (input.tags !== undefined) this.applyTags(next.id, input.tags)
      this.items.reindex(next.id, title, summary ?? '', body)
    })

    const detail = this.detail(next)
    await this.writeSidecar(detail)
    return detail
  }

  async addAssets(input: AddAssetsInput): Promise<Asset[]> {
    const item = this.require(input.itemId)

    const staged = await this.assetService.stage(
      item.id,
      item.createdAt,
      input.filePaths,
      this.assetRepo.nextSortOrder(item.id),
    )

    const existing = this.assetRepo.listForItem(item.id)
    const body = await this.indexBody([...existing, ...staged.map((s) => s.asset)])
    const at = nowIso()

    try {
      this.uow.run(() => {
        for (const { asset } of staged) this.assetRepo.insert(asset)
        this.items.touch(item.id, at)
        this.items.reindex(item.id, item.title, item.summary ?? '', body)
      })
    } catch (error) {
      await this.assetService.discard(staged)
      throw error
    }

    await this.writeSidecar(this.detail({ ...item, updatedAt: at }))
    return staged.map((s) => s.asset)
  }

  /** Adds one document typed in the editor to an item that already exists. */
  async composeAsset(input: ComposeAssetInput): Promise<Asset> {
    const item = this.require(input.itemId)

    const staged = await this.assetService.compose(
      item.id,
      item.createdAt,
      [{ filename: input.filename, format: input.format, content: input.content }],
      this.assetRepo.nextSortOrder(item.id),
    )

    const existing = this.assetRepo.listForItem(item.id)
    const body = await this.indexBody([...existing, ...staged.map((s) => s.asset)])
    const at = nowIso()

    try {
      this.uow.run(() => {
        for (const { asset } of staged) this.assetRepo.insert(asset)
        this.items.touch(item.id, at)
        this.items.reindex(item.id, item.title, item.summary ?? '', body)
      })
    } catch (error) {
      await this.assetService.discard(staged)
      throw error
    }

    await this.writeSidecar(this.detail({ ...item, updatedAt: at }))
    return staged[0]!.asset
  }

  /**
   * Saves an edit to a stored Markdown or text document.
   *
   * The body text feeding the search index has to be recomputed from the
   * *new* contents, so the index cannot be built until after the file is
   * written — which is why the write is not inside the transaction. It could
   * not be anyway: a file write is not transactional with SQLite.
   */
  async updateAssetText(input: UpdateAssetTextInput): Promise<Asset> {
    const asset = this.assetService.requireEditable(input.id)
    const item = this.require(asset.itemId)

    const updated = await this.assetService.rewriteText(asset.id, input.content)

    const body = await this.indexBody(this.assetRepo.listForItem(item.id))
    const at = nowIso()

    this.uow.run(() => {
      this.items.touch(item.id, at)
      this.items.reindex(item.id, item.title, item.summary ?? '', body)
    })

    await this.writeSidecar(this.detail({ ...item, updatedAt: at }))
    return updated
  }

  async removeAsset(assetId: string): Promise<{ id: string }> {
    const asset = this.assetService.require(assetId)
    const item = this.require(asset.itemId)

    await this.assetService.delete(assetId)

    const body = await this.indexBody(this.assetRepo.listForItem(item.id))
    const at = nowIso()

    this.uow.run(() => {
      this.items.touch(item.id, at)
      this.items.reindex(item.id, item.title, item.summary ?? '', body)
    })

    await this.writeSidecar(this.detail({ ...item, updatedAt: at }))
    return { id: assetId }
  }

  /**
   * Deleting an item deletes its files. Unlike a category, an item is a single
   * unit the user is looking at when they press delete — cascading is what
   * they mean. `assets` rows go with it through ON DELETE CASCADE.
   */
  async delete(id: string): Promise<{ id: string }> {
    const item = this.require(id)

    this.uow.run(() => {
      this.items.removeFromIndex(id)
      this.items.delete(id) // cascades to assets and item_tags
      this.tags.pruneOrphans()
    })

    await this.store.removeItemDir(item.id, item.createdAt)
    return { id }
  }

  /**
   * Rewrites an item's `item.json` from the current database state.
   *
   * Public because maintenance tooling needs it: anything that moves files
   * behind the services' backs — `npm run tidy:filenames` today, a
   * `rebuild-index` command later — leaves the sidecar describing paths that
   * no longer exist, and a recovery aid that is wrong is worse than none.
   */
  async refreshSidecar(itemId: string): Promise<void> {
    await this.writeSidecar(this.detail(this.require(itemId)))
  }

  // -------------------------------------------------------------- internals

  /** Must be called inside `uow.run`. */
  private applyTags(itemId: string, names: string[]): void {
    const tagIds = this.tags.ensureAll(names)
    this.tags.setForItem(itemId, tagIds)
    this.tags.pruneOrphans()
  }

  private detail(item: Item): ItemDetail {
    return {
      ...item,
      category: this.categories.require(item.categoryId),
      assets: this.assetRepo.listForItem(item.id),
      tags: this.tags.listForItem(item.id),
    }
  }

  /** Concatenated plain text of every readable asset, for the FTS row. */
  private async indexBody(assets: Asset[]): Promise<string> {
    const parts = await Promise.all(assets.map((asset) => this.documents.extractText(asset)))
    return parts.filter((p) => p.length > 0).join('\n\n')
  }

  /**
   * Mirrors the item's metadata next to its files. Failure is logged by the
   * caller's error boundary but never propagated: the sidecar is a recovery
   * aid, and losing it must not lose the user's work.
   */
  private async writeSidecar(detail: ItemDetail): Promise<void> {
    try {
      await this.store.writeSidecar(detail.id, detail.createdAt, {
        schema: 1,
        id: detail.id,
        title: detail.title,
        summary: detail.summary,
        category: { id: detail.category.id, name: detail.category.name },
        tags: detail.tags,
        assets: detail.assets.map((a) => ({
          id: a.id,
          filename: a.filename,
          relPath: a.relPath,
          sizeBytes: a.sizeBytes,
          checksum: a.checksum,
        })),
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      })
    } catch {
      // intentionally swallowed — see the doc comment
    }
  }
}

function normaliseTitle(raw: string): string {
  const title = (raw ?? '').trim().replace(/\s+/g, ' ')

  if (title.length === 0) {
    throw new AppError(ErrorCode.ITEM_TITLE_REQUIRED, 'item title is empty')
  }
  if (title.length > TITLE_MAX) {
    throw new AppError(ErrorCode.ITEM_TITLE_TOO_LONG, `item title exceeds ${TITLE_MAX} characters`, {
      max: TITLE_MAX,
      actual: title.length,
    })
  }
  return title
}

function normaliseSummary(raw: string | undefined): string | null {
  const summary = (raw ?? '').trim()
  return summary.length > 0 ? summary : null
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback
  return Math.min(Math.trunc(value), 200)
}
