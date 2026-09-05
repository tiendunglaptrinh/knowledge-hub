/**
 * Slug generation and filename sanitisation.
 *
 * Category names are typed in Vietnamese ("Lập trình", "Tiếng Anh"), but slugs
 * are used as a stable unique key and may end up in a path or a URL, so they
 * must be ASCII. `NFD` splits a precomposed character into base + combining
 * mark, which the diacritic range then strips; `đ`/`Đ` carry no combining mark
 * and are replaced explicitly.
 */

/** Unicode combining diacritical marks (U+0300–U+036F), exposed by NFD. */
const COMBINING_MARKS = /[\u0300-\u036f]/g

export function slugify(input: string): string {
  const ascii = input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd') // đ
    .replace(/Đ/g, 'D') // Đ

  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  // A name made entirely of characters we cannot transliterate (e.g. CJK)
  // would otherwise produce an empty, non-unique slug.
  return slug.length > 0 ? slug : 'untitled'
}

/**
 * Appends `-2`, `-3`, … until the slug is free.
 * `isTaken` is injected so this stays free of any storage dependency.
 */
export function uniqueSlug(base: string, isTaken: (candidate: string) => boolean): string {
  const root = slugify(base)
  if (!isTaken(root)) return root

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root}-${n}`
    if (!isTaken(candidate)) return candidate
  }
  throw new Error(`could not derive a unique slug from "${base}"`)
}

/** Characters that are illegal in a Windows filename, plus C0 control codes. */
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f<>:"/\\|?*]/g

/**
 * Makes a user-supplied filename safe to write on every platform: strips path
 * separators, Windows-reserved characters and control codes, refuses leading
 * dots (hidden files) and trailing dots/spaces (which Windows silently drops),
 * and caps the length so directory + filename stays inside MAX_PATH.
 */
export function safeFilename(filename: string): string {
  const cleaned = filename
    .replace(UNSAFE_FILENAME_CHARS, '_')
    .replace(/^\.+/, '_')
    .replace(/[. ]+$/, '')
    .trim()

  const fallback = cleaned.length > 0 ? cleaned : 'file'
  return fallback.length > 120 ? fallback.slice(0, 120) : fallback
}

/** Lowercase extension without the leading dot; empty string when absent. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0 || dot === filename.length - 1) return ''
  return filename.slice(dot + 1).toLowerCase()
}

/** A stored name longer than this is unhelpful and risks MAX_PATH on Windows. */
const STEM_MAX = 80

/**
 * The name a file is *stored* under, as opposed to the name it is shown under.
 *
 *   'Spring Boot'          -> 'spring-boot'
 *   'OWASP Top 10.docx'    -> 'owasp-top-10.docx'
 *   'Tiếng Anh.pdf'        -> 'tieng-anh.pdf'
 *
 * The display name lives in `assets.filename` and is never touched — the user
 * still sees `OWASP Top 10.docx` everywhere in the interface. This is only
 * about what a person finds when they open the vault in a file manager.
 *
 * Slugged rather than merely sanitised, because a stored name has to survive
 * three things a display name does not: a case-insensitive filesystem sitting
 * next to a case-sensitive one, a shell that treats spaces as separators, and
 * Vietnamese diacritics travelling through a zip, a sync client or an email
 * attachment. `safeFilename` only removes what is illegal; this produces
 * something that is *boring* everywhere.
 *
 * Uniqueness is not this function's job — the caller retries with `-2`, `-3`
 * on collision. See `FsAssetStore.writeUnique`.
 */
export function slugFilename(filename: string): string {
  const ext = extensionOf(filename)
  const dot = filename.lastIndexOf('.')
  const rawStem = ext.length > 0 && dot > 0 ? filename.slice(0, dot) : filename

  const stem = slugify(rawStem).slice(0, STEM_MAX).replace(/-+$/, '') || 'untitled'
  return ext.length > 0 ? `${stem}.${ext}` : stem
}
