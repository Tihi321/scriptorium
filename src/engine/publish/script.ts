import { entryKey } from '../memory/bible'
import { lightBibleEntries, sameName } from '../pipeline/series'
import { CAST, cueOf, LINE, SCENE } from './xhtml'
import type { CueKind } from './xhtml'

export type ScriptBeat =
  | { type: 'cast'; cast: { name: string; look: string; alias?: string }[] }
  | { type: 'line'; speaker: string; expression: string; text: string; alias?: string }
  /** A picture or sound line (`CG:`, `INSERT:`, `SFX:`, `AMBIENCE:`); `text` is null for `CG: none`, `END CG` and `AMBIENCE: none`. */
  | { type: 'cue'; cue: CueKind; text: string | null }
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
  characters: { name: string; looks: string; voice: string; aliases: string[] }[]
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
 * first scene go into a scene with no place. A cue line (`CG:`, `INSERT:`, `SFX:`, `AMBIENCE:`, `END CG`) is a `cue` beat, never a speaker, and does not
 * end the scene's `background`. `aliases` are the bible characters with their other names: a speaker or cast name that is one of them is
 * given as the bible name, with `alias` set to the alias as the bible writes it.
 */
export function parseScript(body: string, bibleNames: string[] = [], aliases: { name: string; aliases: string[] }[] = []): { scenes: ScriptScene[] } {
  const scenes: ScriptScene[] = []
  let scene: ScriptScene | null = null
  let background = false
  const canon = (name: string, fallback: string) => bibleNames.find((b) => sameName(b, name)) ?? fallback
  const viaAlias = (name: string): { name: string; alias: string } | null => {
    const key = entryKey(name)
    for (const c of aliases) {
      const a = c.aliases.find((x) => entryKey(x) === key)
      if (a && entryKey(c.name) !== key) return { name: canon(c.name, c.name), alias: a }
    }
    return null
  }
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
    let c: ReturnType<typeof cueOf>
    if (/^(\*\s*){3,}$|^-{3,}$|^_{3,}$|^#$/.test(line)) {
      current().beats.push({ type: 'break' })
      background = false
    } else if ((m = /^#{1,6}\s+(.*)$/.exec(line))) open(m[1]!.replace(/\*+/g, '').trim())
    else if ((m = SCENE.exec(line))) open(m[1]!)
    else if ((c = cueOf(line))) {
      if (c.text !== '') current().beats.push({ type: 'cue', cue: c.cue, text: c.text })
    } else if ((m = CAST.exec(line))) {
      current().beats.push({
        type: 'cast',
        cast: castOf(m[1]!).map((p) => {
          const v = viaAlias(p.name)
          return v ? { name: v.name, look: p.look, alias: v.alias } : { name: canon(p.name, p.name), look: p.look }
        })
      })
      background = false
    } else if ((m = LINE.exec(line)) && !/^(scene|on screen)$/i.test(m[1]!.trim())) {
      const name = m[1]!.trim()
      const v = viaAlias(name)
      current().beats.push({ type: 'line', speaker: v ? v.name : canon(name, name), expression: m[2]?.trim() ?? '', text: m[3]!.trim(), ...(v ? { alias: v.alias } : {}) })
      background = false
    } else {
      const text = line.replace(/^>\s?/, '')
      const s = current()
      if (background && s.beats.every((b) => b.type === 'cue')) s.background = s.background ? `${s.background} ${text}` : text
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
        const head = v ? e.text.slice(0, v.index) : e.text
        const a = / Aliases: /.exec(head)
        return {
          name: e.name,
          looks: (a ? head.slice(0, a.index) : head).trim(),
          voice: v ? e.text.slice(v.index + v[0].length).trim() : '',
          aliases: e.aliases
        }
      }),
    places: entries.filter((e) => e.group === 'places').map((e) => ({ name: e.name, looks: e.text })),
    style: styleText
  }
}
