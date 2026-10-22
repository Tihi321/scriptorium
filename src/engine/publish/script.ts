import { lightBibleEntries, sameName } from '../pipeline/series'
import { CAST, LINE, SCENE } from './xhtml'

export type ScriptBeat =
  | { type: 'cast'; cast: { name: string; look: string }[] }
  | { type: 'line'; speaker: string; expression: string; text: string }
  | { type: 'narration'; text: string }
  | { type: 'break' }

export interface ScriptScene {
  place: string
  time: string
  /** The narration lines right after the SCENE line, up to the first speaker or cast line. */
  background: string
  beats: ScriptBeat[]
}

export interface LightBible {
  characters: { name: string; looks: string; voice: string }[]
  places: { name: string; looks: string }[]
  style: string
}

/** `a, b, c` split at the last comma outside brackets: place `a, b`, time `c`. Without a comma the whole text is the place. */
function placeAndTime(text: string): { place: string; time: string } {
  const at = text.lastIndexOf(',')
  if (at < 0) return { place: text.trim(), time: '' }
  return { place: text.slice(0, at).trim(), time: text.slice(at + 1).trim() }
}

/** `Mara (soaked raincoat, worried), Tomas (grinning)`: the commas inside the brackets do not split. */
function castOf(text: string): { name: string; look: string }[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^(.*?)\s*\((.*)\)\s*$/.exec(p)
      return m ? { name: m[1]!.trim(), look: m[2]!.trim() } : { name: p, look: '' }
    })
}

/**
 * A visual novel script chapter (the grammar of docs/visual-novel.md) as scenes and beats. `SCENE: place, time` and a `## heading` open a
 * scene, `ON SCREEN: Name (look), ...` is a cast beat, `NAME (expression): words` a line, `---` a break, anything else narration. Names are
 * written as the bible has them when one matches (`sameName`), else a speaker keeps the capitals it was written in. Lines before the
 * first scene go into a scene with no place.
 */
export function parseScript(body: string, bibleNames: string[] = []): { scenes: ScriptScene[] } {
  const scenes: ScriptScene[] = []
  let scene: ScriptScene | null = null
  let background = false
  const canon = (name: string, fallback: string) => bibleNames.find((b) => sameName(b, name)) ?? fallback
  const open = (text: string) => {
    scene = { ...placeAndTime(text), background: '', beats: [] }
    scenes.push(scene)
    background = true
  }
  const current = (): ScriptScene => {
    if (!scene) {
      scene = { place: '', time: '', background: '', beats: [] }
      scenes.push(scene)
    }
    return scene
  }
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let m: RegExpExecArray | null
    if (/^(\*\s*){3,}$|^-{3,}$|^_{3,}$|^#$/.test(line)) {
      current().beats.push({ type: 'break' })
      background = false
    } else if ((m = /^#{1,6}\s+(.*)$/.exec(line))) open(m[1]!.replace(/\*+/g, '').trim())
    else if ((m = SCENE.exec(line))) open(m[1]!)
    else if ((m = CAST.exec(line))) {
      current().beats.push({ type: 'cast', cast: castOf(m[1]!).map((c) => ({ name: canon(c.name, c.name), look: c.look })) })
      background = false
    } else if ((m = LINE.exec(line)) && !/^(scene|on screen)$/i.test(m[1]!.trim())) {
      const name = m[1]!.trim()
      current().beats.push({ type: 'line', speaker: canon(name, name), expression: m[2]?.trim() ?? '', text: m[3]!.trim() })
      background = false
    } else {
      const text = line.replace(/^>\s?/, '')
      const s = current()
      if (background && s.beats.length === 0) s.background = s.background ? `${s.background} ${text}` : text
      else s.beats.push({ type: 'narration', text })
    }
  }
  return { scenes }
}

/** The light bible of a visual novel (`bible/bible.md`): characters with looks and voice, places with looks, and the style text. */
export function parseLightBible(text: string): LightBible {
  const entries = lightBibleEntries(text)
  const style = /^##\s+Style\s*$/im.exec(text)
  let styleText = ''
  if (style) {
    const rest = text.slice(style.index + style[0].length)
    const next = rest.search(/^##\s/m)
    styleText = (next < 0 ? rest : rest.slice(0, next)).trim()
  }
  return {
    characters: entries
      .filter((e) => e.group === 'characters')
      .map((e) => {
        const v = / Voice: /.exec(e.text)
        return { name: e.name, looks: (v ? e.text.slice(0, v.index) : e.text).trim(), voice: v ? e.text.slice(v.index + v[0].length).trim() : '' }
      }),
    places: entries.filter((e) => e.group === 'places').map((e) => ({ name: e.name, looks: e.text })),
    style: styleText
  }
}
