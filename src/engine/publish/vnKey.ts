import { createHash } from 'node:crypto'
import { transliterate } from './translit'

/**
 * The key rules of the VN pack (HUB-16 contract §3). Keys are VN Studio's keys: `vnKey` is `slugKey` (`src/engine/vn/ids.ts` in the VN Studio
 * repo): transliterated ASCII, lower case, runs of other characters to `_`, a leading non-letter prefixed with `x_`, and a short hash of the
 * text when some letters had no Latin form (Han, Thai ...). Never a translated name: the pack is language-independent.
 *
 * Do not "improve" this file on its own: the shared test vectors of the contract (Petra, Mango, Petra's House, Šime, The Bald Man) and VN
 * Studio's own tests must agree.
 */

/** Lowercases and strips diacritics (č ć đ š ž included). */
export function stripDiacritics(s: string): string {
  return s
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * An ASCII slug of any text: transliterated, diacritics stripped, lower case, runs of other characters turned into `sep`. When letters had no
 * Latin form a short hash of the text is added (`red_1a2b3c`), so two different titles never share a slug. `fallback` is the slug when nothing
 * is left. `max` cuts the readable part.
 */
export function asciiSlug(text: string, o: { sep: '-' | '_'; fallback: string; max?: number }): string {
  const { latin, dropped } = transliterate(text.normalize('NFKC'))
  const trim = new RegExp(`^${o.sep}+|${o.sep}+$`, 'g')
  let base = stripDiacritics(latin)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, o.sep)
    .replace(trim, '')
  const cut = o.max ? (dropped ? o.max - 7 : o.max) : 0 // room for the hash
  if (cut) base = base.slice(0, cut).replace(trim, '')
  if (dropped === 0) return base || o.fallback
  const hash = createHash('sha1').update(text).digest('hex').slice(0, 6)
  return `${base || o.fallback}${o.sep}${hash}`
}

/** A key from a name: `Petra's House` -> `petra_s_house`, `Šime` -> `sime`, `Наташа` -> `natasha`. Exactly VN Studio's `slugKey`. */
export function vnKey(name: string): string {
  const s = asciiSlug(name, { sep: '_', fallback: 'x' })
  return /^[a-z]/.test(s) ? s : `x_${s}`
}

/**
 * A key no other entry of its group has (contract §3: "append `_2`, `_3`, … in bible order and warn"). `used` carries the keys already given,
 * so a caller walks the bible in order and adds each result.
 */
export function uniqueVnKey(name: string, used: Set<string>): { key: string; collision: number } {
  const base = vnKey(name)
  let key = base
  let collision = 0
  for (let i = 2; used.has(key); i++) {
    key = `${base}_${i}`
    collision = i
  }
  used.add(key)
  return { key, collision }
}
