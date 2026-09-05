/**
 * SQLite connection and migration runner.
 *
 * PRAGMA choices, and why:
 *   journal_mode = WAL   readers never block the writer; also survives a crash
 *                        mid-write far better than the default rollback journal
 *   synchronous  = NORMAL safe under WAL, and avoids an fsync per commit — which
 *                        matters a lot if the vault sits on a /mnt/* drive
 *   foreign_keys = ON    off by default in SQLite; every FK in the schema is
 *                        load-bearing, notably assets -> items ON DELETE CASCADE
 *   busy_timeout         a second instance of the app briefly contending is
 *                        better handled by waiting than by throwing SQLITE_BUSY
 */

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

import { AppError, ErrorCode } from '../shared/errors'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './migrations'

export type Db = Database.Database

export interface OpenDatabaseResult {
  db: Db
  /** Version the database was at before this process migrated it. */
  fromVersion: number
  toVersion: number
}

export function openDatabase(databasePath: string): OpenDatabaseResult {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })

  const db = new Database(databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  const fromVersion = currentVersion(db)

  // Refuse a vault from the future, before touching anything.
  //
  // Migrations only move forward, so a `user_version` ahead of ours means a
  // newer build has been here — one that added tables and columns this code
  // knows nothing about. Continuing would not fail cleanly: queries would
  // succeed against the columns that still exist, and every write would
  // silently leave the newer version's data inconsistent.
  //
  // This check has to exist in the *older* application to be worth anything,
  // which is why it ships now rather than alongside the next migration: a
  // guard added in a future version protects nobody running this one.
  if (fromVersion > LATEST_SCHEMA_VERSION) {
    db.close()
    throw new AppError(
      ErrorCode.VAULT_TOO_NEW,
      `vault is at schema v${fromVersion}; this build understands up to v${LATEST_SCHEMA_VERSION}`,
      { vaultVersion: fromVersion, supportedVersion: LATEST_SCHEMA_VERSION },
    )
  }

  migrate(db, fromVersion)

  return { db, fromVersion, toVersion: LATEST_SCHEMA_VERSION }
}

/**
 * `user_version` is a 32-bit integer SQLite stores in the database header. It
 * needs no table of its own and cannot drift out of sync with the schema,
 * which is exactly what a migration marker should be.
 */
export function currentVersion(db: Db): number {
  const rows = db.pragma('user_version') as Array<{ user_version: number }>
  return rows[0]?.user_version ?? 0
}

function migrate(db: Db, fromVersion: number): void {
  const pending = MIGRATIONS.filter((m) => m.version > fromVersion).sort(
    (a, b) => a.version - b.version,
  )
  if (pending.length === 0) return

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      // pragma values cannot be bound as parameters; the value is an integer
      // literal from our own source, never user input.
      db.pragma(`user_version = ${migration.version}`)
    })

    try {
      apply()
    } catch (cause) {
      throw new Error(
        `migration ${migration.version} (${migration.name}) failed; database left at version ${currentVersion(db)}`,
        { cause },
      )
    }
  }
}
