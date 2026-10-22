import { sameName } from '../pipeline/series'
import { castOf, placeAndTime } from './script'
import { CAST, cueOf, LINE, MUSIC, SCENE, SHOT, SP_SFX, TITLE } from './xhtml'

/** What a spoken line is: `dialogue` (seen speaking), `voice-over` (`NARRATOR:` or `NAME (V.O.):`) or `off-screen` (`NAME (O.S.):`). */
export type LineKind = 'dialogue' | 'voice-over' | 'off-screen'

export interface ShotLine {
  speaker: string
  delivery: string
  text: string
  kind: LineKind
}

export interface Shot {
  /** `ch01.s01.sh02`. */
  id: string
  /** `extreme wide`, `wide`, `medium`, `medium two-shot`, `close-up`, `over-the-shoulder`, ... (`title` for a title card). */
  framing: string
  /** `static`, `slow push-in`, `pan`, ... */
  move: string
  /** The length of the shot in seconds. */
  seconds: number
  /** The shot picks up exactly where the last one ended. */
  continuous: boolean
  /** What we see: the `SHOT` text and the action lines after it. */
  action: string
  /** Who is in frame. */
  cast: { name: string; look: string }[]
  sfx: string[]
  /** The text of a title card, else null. */
  title: string | null
  lines: ShotLine[]
  /** A music cue that starts at this shot. */
  music?: string
  /** The music ends after this shot (`MUSIC: stop`). */
  musicStop?: boolean
}

export interface ScreenplayScene {
  /** `ch01.s01`. */
  id: string
  place: string
  time: string
  /** The action lines before the scene's first shot. */
  background: string
  shots: Shot[]
}

export interface MusicCue {
  /** `m1`, `m2`, ... in film order. */
  id: string
  description: string
  /** The first and the last shot id of the cue. */
  from: string
  to: string
}

/** Words a second a spoken line needs. */
export const WORDS_PER_SECOND = 2.5
export const DEFAULT_SHOT_SECONDS = 4
export const MIN_SHOT_SECONDS = 4
export const MAX_SHOT_SECONDS = 10
export const TITLE_SECONDS = 3

const FRAMING = /\b(?:wide|medium|close|close-up|two-shot|over-the-shoulder|ots|pov|insert|establishing|full|cowboy|detail|macro|aerial|overhead)\b/i
const DURATION = /^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)$/i
const VOICE_OVER = /^(?:v\.?\s?o\.?|voice[- ]?over)$/i
const OFF_SCREEN = /^(?:o\.?\s?s\.?|o\.?\s?c\.?|off[- ]?screen)$/i

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const wordCount = (s: string) => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length

/** The seconds the spoken lines of a shot need: 2.5 words a second and a short pause. */
export function speechSeconds(lines: { text: string }[]): number {
  const words = lines.reduce((n, l) => n + wordCount(l.text), 0)
  return words === 0 ? 0 : words / WORDS_PER_SECOND + 0.5
}

/** A shot's length when the writer gave none: 4 seconds, or the next of 6, 8 and 10 that its lines need. */
export function defaultSeconds(lines: { text: string }[]): number {
  const need = speechSeconds(lines)
  return [DEFAULT_SHOT_SECONDS, 6, 8, MAX_SHOT_SECONDS].find((s) => need <= s) ?? MAX_SHOT_SECONDS
}

/** `wide, slow push-in, 6s, continuous`: the framing, the camera move, the length (null when none is given) and the flag. */
export function parseShotSpec(spec: string): { framing: string; move: string; seconds: number | null; continuous: boolean } {
  const parts = spec.split(',').map((p) => p.trim()).filter(Boolean)
  let seconds: number | null = null
  let continuous = false
  const rest: string[] = []
  for (const p of parts) {
    const d = DURATION.exec(p)
    if (d) seconds = clamp(Math.round(Number(d[1])), MIN_SHOT_SECONDS, MAX_SHOT_SECONDS)
    else if (/^continuous$/i.test(p)) continuous = true
    else rest.push(p)
  }
  const at = rest.findIndex((p) => FRAMING.test(p))
  const framing = at >= 0 ? rest.splice(at, 1)[0]! : 'medium'
  return { framing: framing.toLowerCase(), move: rest.join(', ').toLowerCase() || 'static', seconds, continuous }
}

const stripMarks = (s: string) => s.replace(/\*+/g, '').trim()

/** The kind of a line and its delivery from the bracket after the speaker: `V.O.`, `O.S.`, or a free delivery word. */
function lineKind(speaker: string, bracket: string): { kind: LineKind; delivery: string } {
  const parts = bracket.split(',').map((p) => p.trim()).filter(Boolean)
  let kind: LineKind = /^narrator$/i.test(speaker) ? 'voice-over' : 'dialogue'
  const rest: string[] = []
  for (const p of parts) {
    if (VOICE_OVER.test(p)) kind = 'voice-over'
    else if (OFF_SCREEN.test(p)) kind = 'off-screen'
    else rest.push(p)
  }
  return { kind, delivery: rest.join(', ') }
}

/**
 * A screenplay chapter (the grammar of docs/screenplay.md) as scenes and shots. `SCENE: place, time` and a `## heading` open a scene,
 * `SHOT (framing, move, 6s, continuous): what we see` opens a shot, `ON SCREEN:` says who is in frame (until the next such line),
 * `MUSIC:` / `MUSIC: stop`, `SFX:` and `TITLE:` are cues, `NARRATOR:` and `NAME (V.O.):` are voice-over, `NAME (delivery):` is dialogue and
 * any other line is action. A line before the first shot of a scene is the scene's background, a spoken line before it opens a `medium` shot.
 * The parser is lenient: an unknown line is action, and the visual novel cue lines (`CG:`, `INSERT:`, `AMBIENCE:`) are action too.
 * `chapter` is the 1-based chapter number, used in the ids; `bibleNames` makes speakers and cast names the bible's.
 */
export function parseScreenplay(body: string, bibleNames: string[] = [], chapter = 1): { scenes: ScreenplayScene[] } {
  const scenes: ScreenplayScene[] = []
  let scene: ScreenplayScene | null = null
  let shot: Shot | null = null
  let cast: { name: string; look: string }[] = []
  let pending: { music?: string; sfx: string[] } = { sfx: [] }
  let background = false
  const canon = (name: string) => bibleNames.find((b) => sameName(b, name)) ?? name
  const pad = (n: number) => String(n).padStart(2, '0')
  const open = (text: string) => {
    const { place, time } = placeAndTime(text)
    scene = { id: `ch${pad(chapter)}.s${pad(scenes.length + 1)}`, place, time, background: '', shots: [] }
    scenes.push(scene)
    shot = null
    cast = []
    background = true
  }
  const current = (): ScreenplayScene => {
    if (!scene) open('')
    return scene!
  }
  /** Opens a shot; what a cue before it left pending goes into it. */
  const newShot = (init: Partial<Shot>): Shot => {
    const s = current()
    const made: Shot = {
      id: `${s.id}.sh${pad(s.shots.length + 1)}`,
      framing: 'medium',
      move: 'static',
      seconds: 0,
      continuous: false,
      action: '',
      cast: cast.map((c) => ({ ...c })),
      sfx: pending.sfx,
      title: null,
      lines: [],
      ...init
    }
    if (pending.music) made.music = pending.music
    pending = { sfx: [] }
    s.shots.push(made)
    shot = made
    background = false
    return made
  }
  const ensureShot = (): Shot => shot ?? newShot({})
  const lastShot = (): Shot | null => {
    for (let i = scenes.length - 1; i >= 0; i--) {
      const last = scenes[i]!.shots.at(-1)
      if (last) return last
    }
    return null
  }
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let m: RegExpExecArray | null
    if (/^(\*\s*){3,}$|^-{3,}$|^_{3,}$|^#$/.test(line)) {
      cast = []
      background = false
    } else if ((m = /^#{1,6}\s+(.*)$/.exec(line))) open(m[1]!.replace(/\*+/g, '').trim())
    else if ((m = SCENE.exec(line))) open(m[1]!)
    else if ((m = SHOT.exec(line))) {
      const spec = parseShotSpec(m[1] ?? '')
      newShot({ framing: spec.framing, move: spec.move, seconds: spec.seconds ?? 0, continuous: spec.continuous, action: stripMarks(m[2]!) })
    } else if ((m = MUSIC.exec(line))) {
      const text = stripMarks(m[1]!)
      const here = shot as Shot | null
      if (/^(stop|end|none|off)\.?$/i.test(text)) {
        const target = here ?? lastShot()
        if (target) target.musicStop = true
      } else if (here) here.music = text
      else pending.music = text
    } else if ((m = SP_SFX.exec(line))) {
      const text = stripMarks(m[1]!)
      const here = shot as Shot | null
      if (text) (here ? here.sfx : pending.sfx).push(text)
    } else if ((m = TITLE.exec(line))) {
      newShot({ framing: 'title', move: 'static', seconds: TITLE_SECONDS, title: stripMarks(m[1]!), cast: [] })
    } else if ((m = CAST.exec(line))) {
      cast = castOf(m[1]!).map((c) => ({ name: canon(c.name), look: c.look }))
      const here = shot as Shot | null
      if (here) here.cast = cast.map((c) => ({ ...c }))
    } else if (!cueOf(line) && (m = LINE.exec(line)) && !/^(scene|on screen|shot|music|sfx|title)$/i.test(m[1]!.trim())) {
      const name = m[1]!.trim()
      const { kind, delivery } = lineKind(name, m[2] ?? '')
      ensureShot().lines.push({ speaker: /^narrator$/i.test(name) ? 'Narrator' : canon(name), delivery, text: m[3]!.trim(), kind })
    } else {
      const text = line.replace(/^>\s?/, '')
      const s = current()
      const here = shot as Shot | null
      if (background && !here) s.background = s.background ? `${s.background} ${text}` : text
      else {
        const sh = ensureShot()
        sh.action = sh.action ? `${sh.action} ${text}` : text
      }
    }
  }
  // lengths: the writer's, else 4 s, or longer when the lines need it
  for (const s of scenes) for (const sh of s.shots) if (!sh.seconds) sh.seconds = defaultSeconds(sh.lines)
  return { scenes }
}

/** The music cues of a film, in order: a cue starts at the shot with `music`, ends at the shot with `musicStop`, or before the next cue, or at the last shot. */
export function musicCues(chapters: { scenes: ScreenplayScene[] }[]): MusicCue[] {
  const shots = chapters.flatMap((c) => c.scenes.flatMap((s) => s.shots))
  const cues: MusicCue[] = []
  let started: { description: string; from: string } | null = null
  const close = (to: string) => {
    if (started) cues.push({ id: `m${cues.length + 1}`, description: started.description, from: started.from, to })
    started = null
  }
  shots.forEach((sh, i) => {
    if (sh.music) {
      close(shots[i - 1]?.id ?? sh.id)
      started = { description: sh.music, from: sh.id }
    }
    if (sh.musicStop) close(sh.id)
  })
  if (shots.length) close(shots.at(-1)!.id)
  return cues
}

/** The runtime of a film: the seconds of all its shots. */
export function runtimeOf(chapters: { scenes: ScreenplayScene[] }[]): number {
  return chapters.reduce((n, c) => n + c.scenes.reduce((m, s) => m + s.shots.reduce((k, sh) => k + sh.seconds, 0), 0), 0)
}
