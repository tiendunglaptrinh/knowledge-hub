/**
 * Identifier generation.
 *
 * IDs are UUID v4 strings from the platform crypto module — available in both
 * Node and the browser, so this file stays importable from either side.
 *
 * They are opaque: nothing in the application parses an id or infers ordering
 * from it. Chronology comes from `createdAt`, which is also what determines an
 * asset's directory, so the vault layout stays browsable by date.
 */

export function newId(): string {
  return globalThis.crypto.randomUUID()
}

/** Current instant as an ISO-8601 UTC string. */
export function nowIso(): string {
  return new Date().toISOString()
}
