import { entryKey } from '../memory/bible'
import { lightBibleEntries, sameName } from '../pipeline/series'
import { CAST, cueOf, isDirectionLabel, LINE, NARRATION, puzzleLineOf, reservedLabel, SCENE, SPEAKER_TOKEN, speakerTokens } from './xhtml'
import type { CueKind } from './xhtml'

export type ScriptBeat =
  | { type: 'cast'; cast: { name: string; look: string; alias?: string }[] }
  | { type: 'line'; speaker: string; expression: string; text: string; alias?: string }
  /** A picture or sound line (`CG:`, `INSERT:`, `SFX:`, `AMBIENCE:`); `text` is null for `CG: none`, `END CG` and `AMBIENCE: none`. */
  | { type: 'cue'; cue: CueKind; text: string | null }
  /** A clue of a puzzle found here (`CLUE: <puzzle>/<clue>: prose`). */
  | { type: 'clue'; puzzle: string; clue: string; text: string }
  /** An item for the court record (`EVIDENCE: <key>: prose`). */
  | { type: 'evidence'; key: string; text: string }
  /** The puzzle is played here (`PUZZLE: <key> (<kind>)`; `kind` null when the line has none). */
  | { type: 'puzzle'; puzzle: string; kind: string | null }
  /** A cross-examination: the statements between `TESTIMONY: <witness>` and `END TESTIMONY`, `n` from 1. */
  | { type: 'testimony'; witness: string; statements: { n: number; speaker: string; expression: string; text: string; alias?: string }[] }
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

/** `a, b, c` split at the last comma: place `a, b`, time `c`. Without a comma the whole text is the place. Used for a `## heading` scene. */
export function placeAndTime(text: string): { place: string; time: string } {
  const at = text.lastIndexOf(',')
  if (at < 0) return { place: text.trim(), time: '' }
  return { place: text.slice(0, at).trim(), time: text.slice(at + 1).trim() }
}

/**
 * The canonical time named in a short text, or null: the words VN Studio's `detectTime` knows (English and Croatian). A time word is
 * recognised anywhere in the tail, so `late afternoon` is an afternoon.
 */
const TIME_WORDS: Record<string, string> = {
  dawn: 'dawn', daybreak: 'dawn', sunrise: 'dawn', zora: 'dawn', zorom: 'dawn', svitanje: 'dawn',
  morning: 'morning', jutro: 'morning', jutra: 'morning', jutru: 'morning', jutarnje: 'morning', ujutro: 'morning',
  day: 'day', daytime: 'day', noon: 'day', midday: 'day', dan: 'day', podne: 'day', podnevu: 'day', danju: 'day',
  afternoon: 'afternoon', poslijepodne: 'afternoon', popodne: 'afternoon',
  evening: 'evening', vecer: 'evening', veceri: 'evening', navecer: 'evening', uvecer: 'evening',
  dusk: 'dusk', sunset: 'dusk', twilight: 'dusk', sumrak: 'dusk', sumraku: 'dusk', zalazak: 'dusk',
  night: 'night', midnight: 'night', noc: 'night', nocu: 'night', ponoc: 'night', noci: 'night'
}

const timeWords = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

/** The canonical time named in a short text (`morning`, `afternoon`), or null. */
export function detectTime(text: string): string | null {
  for (const token of timeWords(text)) {
    const time = TIME_WORDS[token]
    if (time) return time
  }
  return null
}

export interface SceneHead {
  /** The place phrase: the head before its last comma, or the whole head when the tail is not a time. */
  place: string
  /** The time exactly as written (`morning`, `midday`, `late afternoon`, `ujutro`); VN Studio canonicalises it. Empty when there is none. */
  time: string
  /** What follows the head's first full stop: the scene description. */
  rest: string
}

/**
 * A `SCENE:` text as VN Studio's legacy `parseSceneLine` reads it (SCP-45): split at the **first full stop** into the head and the rest;
 * in the head the **last comma** starts the time only when that tail is at most four words and names a known time (`morning`, `dusk`,
 * `late afternoon`, `midday`, Croatian too); otherwise the whole head is the place and the time is empty. The rest is the scene
 * description. The time is returned as written, not canonicalised.
 */
export function sceneHead(text: string): SceneHead {
  const t = text.replace(/\*+/g, '').trim()
  const m = /^(.*?)\.(?=\s|$)\s*(.*)$/s.exec(t)
  const head = (m ? m[1]! : t).trim()
  const rest = (m ? m[2]! : '').trim()
  const at = head.lastIndexOf(',')
  if (at >= 0) {
    const tail = head.slice(at + 1).trim()
    const words = tail.split(/\s+/).filter(Boolean)
    if (words.length > 0 && words.length <= 4 && detectTime(tail)) return { place: head.slice(0, at).trim(), time: tail, rest }
  }
  return { place: head, time: '', rest }
}

/** `Mara (soaked raincoat, worried), Tomas (grinning)`: the commas inside the brackets do not split. */
export function castOf(text: string): { name: string; look: string }[] {
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
 * first scene go into a scene with no place. A puzzle line (`CLUE:`, `EVIDENCE:`, `PUZZLE:`, `TESTIMONY:` with its speaker lines up to `END TESTIMONY`) is a `clue`, `evidence`, `puzzle` or `testimony` beat (docs/visual-novel.md "Puzzles"). A cue line (`CG:`, `INSERT:`, `SFX:`, `AMBIENCE:`, `END CG`) is a `cue` beat, never a speaker, and does not
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
  /** The testimony beat that is open: speaker lines go into it until `END TESTIMONY` or a line of another kind. */
  let testimony: Extract<ScriptBeat, { type: 'testimony' }> | null = null
  /** `C1`, `petra`, `petra#1`: a speaker token that names a bible character (contract §3: no translated name is a structural token). */
  const tokens = speakerTokens(
    bibleNames,
    aliases.map((c) => ({ name: c.name, aliases: c.aliases }))
  )
  const isSpeaker = (line: string): RegExpExecArray | null => {
    const sm = LINE.exec(line)
    return sm && !/^(scene|on screen)$/i.test(sm[1]!.trim()) && !cueOf(line) && !puzzleLineOf(line) && !SCENE.exec(line) && !reservedLabel(sm[1]!) && !isDirectionLabel(sm[1]!) && !NARRATION.exec(line) ? sm : null
  }
  /** Opens a scene. A `SCENE:` line is read as VN Studio reads it (first full stop, then the last comma's time); a `## heading` keeps place/time. */
  const open = (text: string, sceneLine = false) => {
    if (sceneLine) {
      const head = sceneHead(text)
      scene = { place: head.place, time: head.time, background: head.rest, beats: [] }
    } else {
      scene = { ...placeAndTime(text), background: '', beats: [] }
    }
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
    let pz: ReturnType<typeof puzzleLineOf>
    if (testimony) {
      const sm = isSpeaker(line)
      if (sm) {
        const name = sm[1]!.trim()
        const v = viaAlias(name)
        testimony.statements.push({ n: testimony.statements.length + 1, speaker: v ? v.name : canon(name, name), expression: sm[2]?.trim() ?? '', text: sm[3]!.trim(), ...(v ? { alias: v.alias } : {}) })
        continue
      }
      testimony = null // END TESTIMONY, or a line of another kind, closes it
      if (puzzleLineOf(line)?.kind === 'end-testimony') continue
    }
    if (/^(\*\s*){3,}$|^-{3,}$|^_{3,}$|^#$/.test(line)) {
      current().beats.push({ type: 'break' })
      background = false
    } else if ((m = /^#{1,6}\s+(.*)$/.exec(line))) open(m[1]!.replace(/\*+/g, '').trim())
    else if ((m = SCENE.exec(line))) open(m[1]!, true)
    else if ((c = cueOf(line))) {
      if (c.text !== '') current().beats.push({ type: 'cue', cue: c.cue, text: c.text })
    } else if ((pz = puzzleLineOf(line))) {
      if (pz.kind === 'clue') current().beats.push({ type: 'clue', puzzle: pz.puzzle, clue: pz.clue, text: pz.text })
      else if (pz.kind === 'evidence') current().beats.push({ type: 'evidence', key: pz.key, text: pz.text })
      else if (pz.kind === 'puzzle') current().beats.push({ type: 'puzzle', puzzle: pz.puzzle, kind: pz.puzzleKind })
      else if (pz.kind === 'testimony') {
        const witness = canon(pz.witness, pz.witness)
        testimony = { type: 'testimony', witness: viaAlias(pz.witness)?.name ?? witness, statements: [] }
        current().beats.push(testimony)
        background = false
      }
    } else if ((m = NARRATION.exec(line))) {
      // `NARRATION:`, `NARRATOR (calm):`, `N:`: a narrator text box, never a speaker called "Narration" (SCP-45)
      const text = m[1]!.trim()
      if (text) current().beats.push({ type: 'narration', text })
    } else if ((m = SPEAKER_TOKEN.exec(line)) && tokens.get(m[1]!.toLowerCase())) {
      // a speaker token (`C1`, `petra`, `petra#1`) writes a name without ever making a translated name structural (SCP-45)
      const token = tokens.get(m[1]!.toLowerCase())!
      current().beats.push({ type: 'line', speaker: canon(token.name, token.name), expression: m[2]?.trim() ?? '', text: m[3]!.trim(), ...(token.alias ? { alias: token.alias } : {}) })
      background = false
    } else if ((m = CAST.exec(line))) {
      current().beats.push({
        type: 'cast',
        cast: castOf(m[1]!).map((p) => {
          const v = viaAlias(p.name)
          return v ? { name: v.name, look: p.look, alias: v.alias } : { name: canon(p.name, p.name), look: p.look }
        })
      })
      background = false
    } else if ((m = LINE.exec(line)) && !/^(scene|on screen)$/i.test(m[1]!.trim()) && !reservedLabel(m[1]!)) {
      if (isDirectionLabel(m[1]!)) {
        // `SMASH CUT TO: Grumble sets the soother down.` is a stage direction, not a speaker: the text stays narration
        const text = m[3]!.trim()
        if (text) current().beats.push({ type: 'narration', text })
      } else {
        const name = m[1]!.trim()
        const v = viaAlias(name)
        current().beats.push({ type: 'line', speaker: v ? v.name : canon(name, name), expression: m[2]?.trim() ?? '', text: m[3]!.trim(), ...(v ? { alias: v.alias } : {}) })
      }
      background = false
    } else {
      const text = line.replace(/^>\s?/, '')
      const s = current()
      if (background && s.beats.every((b) => b.type === 'cue' || b.type === 'clue' || b.type === 'evidence' || b.type === 'puzzle')) s.background = s.background ? `${s.background} ${text}` : text
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
