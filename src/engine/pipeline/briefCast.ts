import { entryKey, sameName } from '../memory/bible'
import type { BriefCharacter } from '../../shared/brief'

/** A character of the outline: the name the architect gave, with its aliases. */
export interface CastCharacter {
  name: string
  description: string
  voice: string
  aliases?: string[]
}

/** The short name the brief gives a character: "Called Dec." or "known as Dec" in its role or description (one word, as written). */
export function briefShortName(c: BriefCharacter): string | null {
  const m = /\b(?:called|known as|nicknamed|a\.k\.a\.|aka)\s+["'“‘]?([\p{L}][\p{L}'’-]*)/iu.exec(`${c.role}\n${c.description}`)
  return m ? m[1]!.replace(/['’-]+$/, '') : null
}

/** Whether the label (a name or alias from the outline) is the brief character: the full name, a part of it (surname, first name, "Dec Hartley") or its short name. */
function labelMatches(label: string, c: BriefCharacter): boolean {
  if (!label.trim()) return false
  if (sameName(label, c.name)) return true
  const short = briefShortName(c)
  return !!short && entryKey(label) === entryKey(short)
}

/**
 * The outline's characters with the owner's brief merged in. An outline character that is a brief character under a shorter name ("Dec", "Pichon"
 * for "Declan Hartley", "Commissaire Albert Pichon") is the same person, matched by full name, surname, first name, an alias or the brief's short
 * name; it becomes one entry named as the brief names it, with the outline's name and aliases as aliases. A label that fits two brief characters
 * ("Brown" for two Browns) matches neither. Brief characters the outline does not have are added after it.
 */
export function mergeBriefCast(
  outline: CastCharacter[],
  brief: BriefCharacter[]
): { characters: CastCharacter[]; added: BriefCharacter[]; matched: { outline: string; brief: string }[] } {
  const people = brief.filter((c) => c.name.trim())
  const taken = new Set<number>()
  const matched: { outline: string; brief: string }[] = []
  // an outline character that already has the brief's name is that person (a shorter name for the same person is never merged into a second entry)
  people.forEach((c, i) => {
    if (outline.some((o) => entryKey(o.name) === entryKey(c.name))) taken.add(i)
  })
  const characters = outline.map((o) => {
    const labels = [o.name, ...(o.aliases ?? [])]
    // the brief characters each label fits: a label that fits one only counts
    const hits = new Map<number, number>()
    for (const label of labels) {
      const fits = people.map((c, i) => (labelMatches(label, c) ? i : -1)).filter((i) => i >= 0)
      if (fits.length === 1) hits.set(fits[0]!, (hits.get(fits[0]!) ?? 0) + 1)
    }
    const exact = [...hits.keys()].find((i) => entryKey(people[i]!.name) === entryKey(o.name))
    if (exact !== undefined) return o
    const best = [...hits.entries()].filter(([i]) => !taken.has(i)).sort((a, b) => b[1] - a[1])[0]
    if (!best) return o
    const person = people[best[0]]!
    taken.add(best[0])
    if (entryKey(person.name) === entryKey(o.name)) return o
    matched.push({ outline: o.name, brief: person.name.trim() })
    const aliases = [o.name, ...(o.aliases ?? [])].filter((a) => entryKey(a) !== entryKey(person.name))
    return { ...o, name: person.name.trim(), aliases: [...new Map(aliases.map((a) => [entryKey(a), a])).values()] }
  })
  const added = people.filter((_, i) => !taken.has(i))
  return { characters, added, matched }
}
