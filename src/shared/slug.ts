const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'to', 'for', 'with'])

export interface SlugOptions {
  /** The slug is at most this many characters. A first word longer than that is cut. Default 40. */
  max?: number
  /** At most this many words. Default 8. */
  maxWords?: number
  /** What an empty text gives. Default `untitled`. */
  fallback?: string
}

/**
 * A short file name from a title or a premise: lower case, no accents, no apostrophes ("France's" is "frances"), words of a-z and 0-9 joined
 * with `-`. Whole words are added while the slug stays within `max` characters and `maxWords` words (nothing is cut in the middle of a word,
 * except a first word that is too long by itself), and a trailing "the", "of", "and" ... is dropped.
 */
export function slugify(text: string, opts: SlugOptions = {}): string {
  const max = opts.max ?? 40
  const maxWords = opts.maxWords ?? 8
  const words = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const out: string[] = []
  let length = 0
  for (const w of words) {
    if (out.length >= maxWords) break
    const next = length + (out.length ? 1 : 0) + w.length
    if (next > max) {
      if (out.length === 0) out.push(w.slice(0, max))
      break
    }
    out.push(w)
    length = next
  }
  while (out.length > 1 && STOPWORDS.has(out[out.length - 1]!)) out.pop()
  const slug = out.join('-').replace(/-+$/g, '')
  return slug && !(out.length === 1 && STOPWORDS.has(slug)) ? slug : opts.fallback ?? 'untitled'
}
