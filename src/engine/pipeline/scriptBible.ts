import { entryKey } from '../memory/bible'

/** At most this many aliases per character, each at most `MAX_ALIAS` characters (the speaker label limit of a `NAME: line`). */
export const MAX_ALIASES = 5
export const MAX_ALIAS = 40

/**
 * The aliases of a character as VN Studio can read them: full stops inside an alias are dropped (`Dr. Vey` becomes `Dr Vey`, the list
 * stops at the first full stop), commas and semicolons become spaces, and an alias that is the character's own name, the name or alias of
 * another character (VN Studio would merge the two people), too long or a repeat is left out. At most five.
 */
export function cleanAliases(name: string, aliases: string[] | undefined, otherNames: string[] = []): string[] {
  const banned = new Set([entryKey(name), ...otherNames.map(entryKey)])
  const out: string[] = []
  for (const raw of aliases ?? []) {
    const a = String(raw)
      .replace(/\./g, '')
      .replace(/[,;\n]+/g, ' ')
      .replace(/^[\s"“„'‘]+|[\s"”'’]+$/g, '')
      .replace(/\s+/g, ' ')
    if (a.length < 2 || a.length > MAX_ALIAS) continue
    const key = entryKey(a)
    if (banned.has(key)) continue
    banned.add(key)
    out.push(a)
    if (out.length >= MAX_ALIASES) break
  }
  return out
}

/** `cleanAliases` for a whole cast: a name or alias of one character is never an alias of another (the first character to claim it keeps it). */
export function cleanCastAliases<T extends { name: string; aliases?: string[] }>(characters: T[]): T[] {
  const names = characters.map((c) => c.name)
  const claimed: string[] = []
  return characters.map((c) => {
    const others = names.filter((n) => n !== c.name)
    const aliases = cleanAliases(c.name, c.aliases, [...others, ...claimed])
    claimed.push(...aliases)
    return { ...c, aliases }
  })
}

/** The entry of a light bible character of a script book: `<description>[ Aliases: a, b.][ Voice: ...]`. The aliases come before the voice, because VN Studio reads the voice to the end of the line. */
export function scriptBibleLine(c: { name: string; description: string; voice?: string; aliases?: string[] }): string {
  let text = c.description.replace(/\s*\n\s*/g, ' ').trim()
  const aliases = c.aliases ?? []
  if (aliases.length && !/\baliases\s*:/i.test(text)) {
    if (text && !/[.!?]$/.test(text)) text += '.'
    text += `${text ? ' ' : ''}Aliases: ${aliases.join(', ')}.`
  }
  if (c.voice) text += `${text ? ' ' : ''}Voice: ${c.voice}`
  return `- **${c.name}**: ${text}`
}
