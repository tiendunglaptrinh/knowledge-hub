import type { CategoryRepository } from '../../core/ports/repositories'
import type { Category, CategorySummary, CreateCategoryInput, UpdateCategoryInput } from '../../shared/types'
import { AppError, ErrorCode } from '../../shared/errors'
import { newId, nowIso } from '../../core/domain/ids'
import { slugify, uniqueSlug } from '../../core/domain/slug'

const NAME_MAX = 60

/**
 * Palette assigned round-robin to new categories, so a fresh vault looks
 * organised without asking the user to pick a colour. Sourced from the
 * Tailwind 500 ramp — see docs/08-ui-guide.md#colour.
 */
const PALETTE = [
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#34d399', // emerald
  '#fbbf24', // amber
  '#f472b6', // pink
  '#f87171', // red
  '#60a5fa', // blue
  '#4ade80', // green
] as const

export class CategoryService {
  constructor(private readonly categories: CategoryRepository) {}

  list(): CategorySummary[] {
    return this.categories.list()
  }

  /** Throws CATEGORY_NOT_FOUND rather than returning null; every caller needs it to exist. */
  require(id: string): Category {
    const found = this.categories.findById(id)
    if (!found) {
      throw new AppError(ErrorCode.CATEGORY_NOT_FOUND, `no category with id ${id}`, { id })
    }
    return found
  }

  create(input: CreateCategoryInput): CategorySummary {
    const name = normaliseName(input.name)
    this.assertNameFree(name)

    const existing = this.categories.list()
    const at = nowIso()

    const category: Category = {
      id: newId(),
      name,
      slug: uniqueSlug(name, (candidate) => this.categories.slugExists(candidate)),
      parentId: null,
      color: input.color?.trim() || PALETTE[existing.length % PALETTE.length]!,
      icon: input.icon?.trim() || 'Folder',
      sortOrder: existing.length,
      createdAt: at,
      updatedAt: at,
    }

    this.categories.insert(category)
    return { ...category, itemCount: 0 }
  }

  update(input: UpdateCategoryInput): CategorySummary {
    const current = this.require(input.id)

    const name = input.name === undefined ? current.name : normaliseName(input.name)
    if (name.toLowerCase() !== current.name.toLowerCase()) {
      this.assertNameFree(name, current.id)
    }

    // The slug only moves when the name does, and only if the derived value
    // actually differs — a rename from "AI" to "A.I." must not orphan the
    // existing slug for no reason.
    const derived = slugify(name)
    const slug =
      derived === current.slug
        ? current.slug
        : uniqueSlug(name, (candidate) => candidate !== current.slug && this.categories.slugExists(candidate))

    const next: Category = {
      ...current,
      name,
      slug,
      color: input.color?.trim() || current.color,
      icon: input.icon?.trim() || current.icon,
      updatedAt: nowIso(),
    }

    this.categories.update(next)
    return { ...next, itemCount: this.categories.countItems(next.id) }
  }

  /**
   * Deletion is refused while the category still holds items.
   *
   * The alternative — cascading — would delete files the user spent effort
   * collecting, in response to a single click on the wrong row. Making them
   * move or delete the items first is the safer default; the schema enforces
   * it too (`ON DELETE RESTRICT`).
   */
  delete(id: string): { id: string } {
    this.require(id)

    const itemCount = this.categories.countItems(id)
    if (itemCount > 0) {
      throw new AppError(
        ErrorCode.CATEGORY_NOT_EMPTY,
        `category ${id} still holds ${itemCount} item(s)`,
        { id, itemCount },
      )
    }

    this.categories.delete(id)
    return { id }
  }

  private assertNameFree(name: string, exceptId?: string): void {
    if (this.categories.nameExists(name, exceptId)) {
      throw new AppError(ErrorCode.CATEGORY_NAME_DUPLICATE, `category name already used: ${name}`, {
        name,
      })
    }
  }
}

function normaliseName(raw: string): string {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ')

  if (name.length === 0) {
    throw new AppError(ErrorCode.CATEGORY_NAME_REQUIRED, 'category name is empty')
  }
  if (name.length > NAME_MAX) {
    throw new AppError(
      ErrorCode.CATEGORY_NAME_TOO_LONG,
      `category name exceeds ${NAME_MAX} characters`,
      { max: NAME_MAX, actual: name.length },
    )
  }
  return name
}
