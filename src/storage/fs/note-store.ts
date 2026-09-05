/**
 * The note half of the vault.
 *
 * Layout:
 *
 *   <dataDir>/
 *     notes/
 *       2026/08/
 *         on-tap-spring-security.md
 *         chuan-bi-demo.txt
 *
 * One file per note, named after its title, with the metadata in YAML front
 * matter so the file is self-describing and opens correctly in Obsidian or any
 * Markdown editor.
 *
 * The name carries no note id. An earlier version prefixed one, which made
 * collisions impossible and the folder unreadable; the id now lives in
 * `notes.rel_path` instead, which is also what lets a rename find the file it
 * is replacing.
 *
 * Why notes get a file at all: everything else in this application is a copy
 * of a file the user already had, so a lost index costs organisation but never
 * content. A note is written *here* — without a mirror it would live in
 * `knowledge.db` and nowhere else, which is the one shape of data loss the
 * vault design exists to prevent. See docs/06-storage-layout.md#notes.
 *
 * Like `item.json`, this is a mirror and not a source of truth. SQLite is
 * authoritative; writing the file is best-effort and happens after the commit.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import type { NoteStore } from '../../core/ports/repositories'
import { slugFilename } from '../../core/domain/slug'
import { monthDir, resolveInVault } from './vault-path'

/** Enough suffixes for any real directory; a guard against an infinite loop. */
const MAX_NAME_ATTEMPTS = 500

export class FsNoteStore implements NoteStore {
  readonly rootDir: string
  readonly notesDir: string

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir)
    this.notesDir = path.join(this.rootDir, 'notes')
  }

  /** Creates `notes/`. Called once during startup, after the vault probe. */
  async init(): Promise<void> {
    await fs.mkdir(this.notesDir, { recursive: true })
  }

  async write(input: {
    noteId: string
    noteCreatedAt: string
    filename: string
    contents: string
    /** Where this note's file was last written, so a rename can clean up. */
    previousRelPath?: string
  }): Promise<string> {
    const dirRel = monthDir('notes', input.noteCreatedAt)
    const dir = resolveInVault(this.rootDir, dirRel)
    await fs.mkdir(dir, { recursive: true })

    const relPath = await this.writeUnique(dirRel, input.filename, input.contents)

    // The title is in the filename and the format is in the extension, so both
    // move when the user edits them. Removing the file the note used to live
    // in is what stops a rename from leaving a stale copy behind.
    if (input.previousRelPath && input.previousRelPath !== relPath) {
      await fs.rm(resolveInVault(this.rootDir, input.previousRelPath), { force: true })
    }
    // Vaults written before rel_path existed named files `<noteId>-title.md`.
    // One readdir per save is cheap, and it means an upgraded vault tidies
    // itself as the user edits rather than needing a migration that touches
    // the filesystem.
    await this.removeLegacySiblings(dir, input.noteId)

    return relPath
  }

  async remove(noteId: string, noteCreatedAt: string, relPath?: string): Promise<void> {
    if (relPath) {
      await fs.rm(resolveInVault(this.rootDir, relPath), { force: true })
    }
    await this.removeLegacySiblings(this.dirFor(noteCreatedAt), noteId)
  }

  /**
   * Writes under a slugged filename, retrying with `-2`, `-3`, … until one is
   * free. `wx` makes the write itself the uniqueness test, so there is no
   * window between checking and creating.
   */
  private async writeUnique(dirRel: string, filename: string, contents: string): Promise<string> {
    const slug = slugFilename(filename)
    const dot = slug.lastIndexOf('.')
    const stem = dot > 0 ? slug.slice(0, dot) : slug
    const suffix = dot > 0 ? slug.slice(dot) : ''

    for (let n = 1; n <= MAX_NAME_ATTEMPTS; n += 1) {
      const candidate = n === 1 ? slug : `${stem}-${n}${suffix}`
      const relPath = `${dirRel}/${candidate}`

      try {
        await fs.writeFile(resolveInVault(this.rootDir, relPath), contents, {
          encoding: 'utf8',
          flag: 'wx',
        })
        return relPath
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException)?.code !== 'EEXIST') throw cause
      }
    }

    throw new Error(`could not find a free filename for ${filename}`)
  }

  /** Absolute path of `notes/YYYY/MM` for a note created at that instant. */
  private dirFor(noteCreatedAt: string): string {
    return resolveInVault(this.rootDir, monthDir('notes', noteCreatedAt))
  }

  /**
   * Deletes files left by the pre-`rel_path` naming scheme, `<noteId>-title.md`.
   * A missing directory means there was nothing to clean up.
   */
  private async removeLegacySiblings(dir: string, noteId: string): Promise<void> {
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }

    await Promise.all(
      entries
        .filter((name) => name.startsWith(`${noteId}-`))
        .map((name) => fs.rm(path.join(dir, name), { force: true })),
    )
  }
}
