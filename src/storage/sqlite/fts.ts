/**
 * Free text -> an FTS5 MATCH expression.
 *
 * Shared by the item and note indexes, which are separate tables but take the
 * same input: whatever the user typed into a search box.
 */

/**
 * FTS5 query syntax is a language of its own: bare `-`, `"`, `*`, `NEAR`, `OR`
 * and friends are operators, and an unbalanced quote is a syntax error that
 * would surface as a thrown exception on every keystroke. Rather than teach
 * the user that language, each run of characters is quoted as a literal term
 * and a trailing `*` gives prefix matching on the last one, so the list
 * narrows as you type.
 *
 * Returns null when the input contains nothing searchable.
 */
export function toMatchExpression(query: string): string | null {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ''))
    .filter((term) => term.length > 0)

  if (terms.length === 0) return null

  return terms.map((term, i) => (i === terms.length - 1 ? `"${term}"*` : `"${term}"`)).join(' ')
}
