import { entryKey, sameName } from '../memory/bible'
import { writeMd } from '../store/atomic'
import type { BookStore } from './books'
import { lightBibleEntries } from './series'
import { parseScript } from '../publish/script'
import { SCENE } from '../publish/xhtml'

/** The place of a `SCENE: place, time` line: the text before the last comma (the whole text when there is none). */
const placeOf = (text: string): { place: string; time: string } => {
  const at = text.lastIndexOf(',')
  return at < 0 ? { place: text.trim(), time: '' } : { place: text.slice(0, at).trim(), time: text.slice(at + 1).trim() }
}

/** The place of every `SCENE:` line of a script, in order. */
export function scenePlaces(body: string): string[] {
  const out: string[] = []
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const m = SCENE.exec(raw.trim())
    if (m) out.push(placeOf(m[1]!).place)
  }
  return out
}

export interface CanonicalScenes {
  body: string
  /** A SCENE place that was written as the bible's own name: `from` was in the script, `to` is the bible's. */
  renamed: { from: string; to: string }[]
  /** Places the bible has no name for (each once, in the order they come). A place that fits two bible places is not unknown: it is left as it is. */
  unknown: string[]
}

/**
 * Makes the `SCENE:` places of a script the bible's names: a place that matches exactly one bible place (the same key, or one name has all the
 * words of the other) is rewritten to the bible's exact name, its time kept. A place that fits two or more bible places is left as it is, and
 * a place that fits none is reported as unknown (the engine adds it to the bible).
 */
export function canonicalScenes(body: string, places: string[]): CanonicalScenes {
  const renamed: { from: string; to: string }[] = []
  const unknown: string[] = []
  const lines = body.replace(/\r\n/g, '\n').split('\n').map((raw) => {
    const m = SCENE.exec(raw.trim())
    if (!m) return raw
    const { place, time } = placeOf(m[1]!)
    if (!place) return raw
    const same = places.filter((p) => entryKey(p) === entryKey(place) || sameName(p, place))
    const exact = same.filter((p) => entryKey(p) === entryKey(place))
    const pick = exact.length === 1 ? exact[0]! : same.length === 1 ? same[0]! : null
    if (pick) {
      if (pick === place) return raw
      renamed.push({ from: place, to: pick })
      return `SCENE: ${pick}${time ? `, ${time}` : ''}`
    }
    if (same.length === 0 && !unknown.some((u) => entryKey(u) === entryKey(place))) unknown.push(place)
    return raw
  })
  return { body: lines.join('\n'), renamed, unknown }
}

/** For each unknown place the first narration line of its first scene (at most 300 characters), for the bible entry. */
export function placeDescriptions(body: string, unknown: string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const scene of parseScript(body).scenes) {
    const u = unknown.find((x) => entryKey(x) === entryKey(scene.place))
    if (u && !out.has(u)) out.set(u, scene.background.replace(/\s+/g, ' ').trim().slice(0, 300))
  }
  return out
}

/** Every reviewer of a script book gets this: the cue lines are for the game, not prose. */
export const SCRIPT_CUES_NOTE =
  'Lines that start with CG:, INSERT:, SFX: or AMBIENCE:, and END CG lines, are picture and sound cues for the visual novel app. They are not text the reader sees: do not review them as prose.'

/** The block that tells the writer which place names the bible has. Empty when the bible has none. */
export function placesBlock(places: string[]): string {
  if (!places.length) return ''
  return `## Places\nIn every SCENE: line name the place exactly as one of these bible places: ${places.join('; ')}. A new place is allowed only when the story moves somewhere the bible does not have.`
}

/**
 * Adds places to the "## Places" section of a light bible's text, one line each: `- **<place>**: <what the scene shows> (first seen in chapter n)`.
 * The heading is created before "## Style" (or at the end) when the bible has none.
 */
export function addPlacesToBible(bible: string, entries: { place: string; text: string }[], chapter: number): string {
  if (!entries.length) return bible
  const lines = entries.map((e) => `- **${e.place}**: ${e.text ? `${e.text} ` : ''}(first seen in chapter ${chapter})`)
  const text = bible.replace(/\r\n/g, '\n')
  const heading = /^## Places\s*$/m.exec(text)
  if (heading) {
    const after = heading.index + heading[0].length
    const next = text.slice(after).search(/^## /m)
    const end = next < 0 ? text.length : after + next
    const section = text.slice(after, end).replace(/\s+$/, '')
    return `${text.slice(0, after)}${section}\n${lines.join('\n')}\n${next < 0 ? '' : '\n'}${text.slice(end)}`
  }
  const style = /^## Style\s*$/m.exec(text)
  const block = `## Places\n${lines.join('\n')}\n\n`
  if (style) return `${text.slice(0, style.index)}${block}${text.slice(style.index)}`
  return `${text.replace(/\s+$/, '')}\n\n${block.replace(/\s+$/, '')}\n`
}

/**
 * A visual novel script of chapter `n`: its SCENE places become the bible's names, and the places the bible lacks are added to the light bible
 * (under "## Places", with the chapter number). A structured bible keeps its places in files: the script is left as it is. Returns the script.
 */
export async function settleScenePlaces(d: { books: BookStore }, slug: string, n: number, body: string, log: (message: string) => void): Promise<string> {
  const bible = await d.books.bible(slug)
  if (!bible) return body
  const places = lightBibleEntries(bible).filter((e) => e.group === 'places').map((e) => e.name)
  const out = canonicalScenes(body, places)
  for (const r of out.renamed) log(`SCENE place "${r.from}" written as the bible's "${r.to}"`)
  if (out.unknown.length) {
    const text = placeDescriptions(out.body, out.unknown)
    await writeMd(d.books.file(slug, 'bible', 'bible.md'), { kind: 'bible' }, '\n' + addPlacesToBible(bible, out.unknown.map((p) => ({ place: p, text: text.get(p) ?? '' })), n))
    log(`new place(s) added to the bible: ${out.unknown.join(', ')}`)
  }
  return out.body
}
