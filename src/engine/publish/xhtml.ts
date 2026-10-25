import { vnKey } from './vnKey'

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(text: string): string {
  let t = escapeXml(text)
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
  t = t.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
  return t
}

export const SCENE = /^\**\s*scene\s*:\s*\**\s*(.+?)\s*\**$/i
export const CAST = /^\**\s*on screen\s*:\s*\**\s*(.+?)\s*\**$/i
/** `NAME: line` or `NAME (expression): line`. The name is in capitals, as in a script. */
export const LINE = /^\**([\p{Lu}][\p{Lu}\p{N}'’ .-]{0,40}?)\**(?:\s*\(([^)]{1,120})\))?\s*:\**\s+(.+)$/u
/**
 * A narrator line: `NARRATION: words`, `NARRATOR (calm): words`, `N: words` (also Croatian `NARACIJA`, `PRIPOVJEDAČ`). It is narration, not a
 * speaker called "Narration" (SCP-45; a book written by a model often uses it after `SCENE:`). A screenplay keeps `NARRATOR:` as its
 * voice-over speaker, so `scriptToXhtml` only reads this for the visual novel layout.
 */
export const NARRATION = /^\**\s*(?:n|narration|narrator|narracja|pripovjeda[čc])\s*\**(?:\s*\([^)]*\))?\s*:\**\s*(.*)$/iu

/**
 * Screenplay directions that look like a speaker label (`SMASH CUT TO: ...`, `FADE TO BLACK: ...`, `INT. KITCHEN: ...`). They are not
 * characters: the text after the label stays narration (the same list VN Studio's `src/engine/vn/script.ts` uses, `DIRECTION_RE`).
 */
const DIRECTION = /^(?:(?:(?:SMASH|MATCH|JUMP|HARD|QUICK) )?CUT(?: (?:TO|BACK TO|NA))?|FADE(?: (?:IN|OUT|TO(?: (?:BLACK|WHITE))?|U CRNO))?|DISSOLVE(?: TO)?|(?:INT|EXT)(?:[ ./].*)?|REZ(?: NA)?|PRIJELAZ(?: NA)?|ZATAMNJENJE)$/u

/** True for a label (the text before the colon of a line) that is a stage direction, not a speaker. */
export function isDirectionLabel(label: string): boolean {
  const l = label.replace(/\*+/g, '').replace(/[.:]+$/, '').replace(/\s+/g, ' ').trim().toUpperCase()
  return !!l && DIRECTION.test(l)
}

/**
 * A speaker token instead of a name: `C1` is the first bible character, `petra` the key of a character, `petra#1` one of its aliases. No
 * translated name is ever a structural token (contract §3). Only a known token is a line: `vent: he said` stays narration.
 */
export const SPEAKER_TOKEN = /^\**\s*(C\d+|[a-z][a-z0-9_]*(?:#[1-9]\d*)?)\**(?:\s*\(([^)]{1,120})\))?\s*:\**\s+(.+)$/u

/**
 * The labels that are never a speaker: the scene, cast, picture, sound and puzzle keywords (and the narrator words). A line that names one
 * of them without fitting its own pattern (`CLUE: no slash`) is narration, not a speaker called "CLUE" (SCP-45).
 */
const RESERVED = /^(?:scene|scena|on screen|na ekranu|cg|slika|insert|sfx|sound|zvuk|ambience|atmosfera|end cg|kraj slike|clue|trag|evidence|dokaz|puzzle|zagonetka|testimony|svjedočenje|end testimony|kraj svjedočenja|n|narration|narrator|narracja|pripovjeda[čc])$/iu

/** True for a label that is a script keyword and never a character ([SCP-45]). */
export function reservedLabel(label: string): boolean {
  return RESERVED.test(label.replace(/\*+/g, '').trim())
}

/** The speaker token a line names (`C1`, `petra`, `petra#1`), when its text is known to `known` (lower-case token -> the bible name). */
export function speakerTokenOf(line: string, known: Map<string, string>): { name: string; expression: string; text: string } | null {
  const m = SPEAKER_TOKEN.exec(line.trim())
  if (!m) return null
  const name = known.get(m[1]!.toLowerCase())
  if (!name) return null
  return { name, expression: m[2]?.trim() ?? '', text: m[3]!.trim() }
}

/** `C1`, `petra`, `petra#1` -> the bible name (and the alias as written for an alias token), for the lines that use a key instead of a name. */
export function speakerTokens(characters: string[], aliases: { name: string; aliases: string[] }[] = []): Map<string, { name: string; alias?: string }> {
  const known = new Map<string, { name: string; alias?: string }>()
  characters.forEach((name, i) => {
    known.set(`c${i + 1}`, { name })
    known.set(vnKey(name), { name })
  })
  for (const c of aliases) c.aliases.forEach((alias, i) => known.set(`${vnKey(c.name)}#${i + 1}`, { name: c.name, alias }))
  return known
}

/**
 * A cue line: `CG: ...`, `INSERT: ...`, `SFX: ...`, `AMBIENCE: ...` (Croatian `SLIKA`, `ZVUK`, `ATMOSFERA`); `CG: none` and `END CG` hide the picture.
 * Copied verbatim from VN Studio, `src/engine/vn/script.ts` (`CUE_RE`, `END_CG_RE`), so both tools read the same lines.
 */
export const CUE = /^\**\s*(CG|SLIKA|INSERT|SFX|SOUND|ZVUK|AMBIENCE|ATMOSFERA)\s*:\s*\**\s*(.*?)\s*\**$/iu
export const END_CG = /^\**\s*(?:END\s+CG|KRAJ\s+SLIKE)\s*\**$/iu

export type CueKind = 'cg' | 'insert' | 'sfx' | 'ambience'

/**
 * The cue a script line is, or null. `text` is null for `CG: none`, `INSERT: none`, `AMBIENCE: none` and `END CG` (the picture or sound
 * stops), and empty for a cue with no text (VN Studio ignores it, so callers skip it).
 */
export function cueOf(line: string): { cue: CueKind; text: string | null } | null {
  const t = line.trim()
  if (END_CG.test(t)) return { cue: 'cg', text: null }
  const m = CUE.exec(t)
  if (!m) return null
  const word = m[1]!.toUpperCase()
  const cue: CueKind = word === 'CG' || word === 'SLIKA' ? 'cg' : word === 'INSERT' ? 'insert' : word === 'SFX' || word === 'SOUND' || word === 'ZVUK' ? 'sfx' : 'ambience'
  const text = m[2]!.trim()
  if (cue !== 'sfx' && /^(none|ni[sš]ta)\.?$/iu.test(text)) return { cue, text: null }
  return { cue, text }
}

/**
 * The cue lines of a screenplay (`screenplay: true` formats, docs/screenplay.md): `SHOT (spec): what we see`, `MUSIC: mood` (or `MUSIC: stop`),
 * `SFX: sound` and `TITLE: text`. They are checked before `LINE`, which would read `SHOT (wide): ...` as a speaker. A screenplay does not use
 * the visual novel cues `CG:`, `INSERT:` and `AMBIENCE:`: a line that `cueOf` reads as one of those is action there, and `SFX:` means the same in both.
 */
export const SHOT = /^\**\s*SHOT\s*(?:\(([^)]*)\))?\s*:\s*\**\s*(.*?)\s*\**$/i
export const MUSIC = /^\**\s*MUSIC\s*:\s*\**\s*(.*?)\s*\**$/i
export const SP_SFX = /^\**\s*SFX\s*:\s*\**\s*(.*?)\s*\**$/i
export const TITLE = /^\**\s*TITLE\s*:\s*\**\s*(.*?)\s*\**$/i

/**
 * The puzzle lines of a mystery with puzzles (`puzzles: true` formats, docs/visual-novel.md "Puzzles"). Croatian keywords as for the cue lines. They are
 * checked right after the cue lines and before `CAST` and `LINE`, which would read `CLUE: ...` as a speaker. None is a picture, sound or screenplay keyword.
 */
export const CLUE_RE = /^\**\s*(CLUE|TRAG)\s*:\s*\**\s*([A-Za-z0-9_-]+)\s*\/\s*([A-Za-z0-9_-]+)\s*:\s*\**\s*(.*?)\s*\**$/iu
export const EVIDENCE_RE = /^\**\s*(EVIDENCE|DOKAZ)\s*:\s*\**\s*([A-Za-z0-9_-]+)\s*:\s*\**\s*(.*?)\s*\**$/iu
export const PUZZLE_RE = /^\**\s*(PUZZLE|ZAGONETKA)\s*:\s*\**\s*([A-Za-z0-9_-]+)\s*(?:\(\s*([A-Za-z0-9_-]+)\s*\))?\s*\**$/iu
export const TESTIMONY_RE = /^\**\s*(TESTIMONY|SVJEDOČENJE)\s*:\s*\**\s*(.+?)\s*\**$/iu
export const END_TESTIMONY_RE = /^\**\s*(?:END\s+TESTIMONY|KRAJ\s+SVJEDOČENJA)\s*\**$/iu

export type PuzzleLine =
  | { kind: 'clue'; puzzle: string; clue: string; text: string }
  | { kind: 'evidence'; key: string; text: string }
  | { kind: 'puzzle'; puzzle: string; puzzleKind: string | null }
  | { kind: 'testimony'; witness: string }
  | { kind: 'end-testimony' }

/** The puzzle line a script line is, or null. */
export function puzzleLineOf(line: string): PuzzleLine | null {
  const t = line.trim()
  let m: RegExpExecArray | null
  if ((m = CLUE_RE.exec(t))) return { kind: 'clue', puzzle: m[2]!, clue: m[3]!, text: m[4]!.trim() }
  if ((m = EVIDENCE_RE.exec(t))) return { kind: 'evidence', key: m[2]!, text: m[3]!.trim() }
  if ((m = PUZZLE_RE.exec(t))) return { kind: 'puzzle', puzzle: m[2]!, puzzleKind: m[3]?.toLowerCase() ?? null }
  if ((m = TESTIMONY_RE.exec(t))) return { kind: 'testimony', witness: m[2]!.trim() }
  if (END_TESTIMONY_RE.test(t)) return { kind: 'end-testimony' }
  return null
}

/** What the layout needs of a puzzle: its title and the canonical text of its clues (from bible/puzzles.md). */
export interface PuzzleView {
  title?: string
  clues: { id: string; text: string }[]
}

const CUE_LABEL: Record<CueKind, string> = { cg: 'Picture:', insert: 'Close-up:', sfx: 'Sound:', ambience: 'Ambience:' }

/**
 * A visual novel script (formats with `script: true`) to XHTML, one element per line: `SCENE: place, time` opens a scene,
 * `ON SCREEN: Name (look), ...` says who is shown, `NAME (expression): words` is a spoken line, `---` is a scene break,
 * and any other line is narration (what the reader sees or the narrator says).
 */
export function scriptToXhtml(md: string, opts: { screenplay?: boolean; puzzles?: Record<string, PuzzleView>; characters?: string[] } = {}): string {
  const out: string[] = []
  const tokens = opts.characters?.length ? speakerTokens(opts.characters) : null
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let m: RegExpExecArray | null
    let c: ReturnType<typeof cueOf>
    let pz: PuzzleLine | null
    if (/^(\*\s*){3,}$|^-{3,}$|^_{3,}$|^#$/.test(line)) out.push('<hr class="scene-break"/>')
    else if ((m = /^#{1,6}\s+(.*)$/.exec(line))) out.push(`<h3 class="vn-scene">${inline(m[1]!)}</h3>`)
    else if ((m = SCENE.exec(line))) out.push(`<h3 class="vn-scene">${inline(m[1]!)}</h3>`)
    else if (opts.screenplay && (m = SHOT.exec(line))) out.push(`<p class="vn-cue"><span class="vn-label">Shot${m[1]?.trim() ? ` (${escapeXml(m[1].trim())})` : ''}:</span> ${inline(m[2]!)}</p>`)
    else if (opts.screenplay && (m = MUSIC.exec(line))) out.push(`<p class="vn-cue"><span class="vn-label">Music:</span> ${inline(m[1]!)}</p>`)
    else if (opts.screenplay && (m = SP_SFX.exec(line))) out.push(`<p class="vn-cue"><span class="vn-label">Sound:</span> ${inline(m[1]!)}</p>`)
    else if (opts.screenplay && (m = TITLE.exec(line))) out.push(`<p class="vn-cue"><span class="vn-label">Title:</span> ${inline(m[1]!)}</p>`)
    else if (opts.screenplay && cueOf(line)) out.push(`<p class="vn-narration">${inline(line)}</p>`)
    else if (!opts.screenplay && (c = cueOf(line))) {
      if (c.text) out.push(`<p class="vn-cue"><span class="vn-label">${CUE_LABEL[c.cue]}</span> ${inline(c.text)}</p>`)
    } else if (!opts.screenplay && (pz = puzzleLineOf(line))) {
      if (pz.kind === 'clue') out.push(`<p class="vn-clue"><span class="vn-label">Clue:</span> ${inline(pz.text)}</p>`)
      else if (pz.kind === 'evidence') out.push(`<p class="vn-evidence"><span class="vn-label">Evidence:</span> ${inline(pz.text)}</p>`)
      else if (pz.kind === 'testimony') out.push(`<p class="vn-testimony"><span class="vn-label">Testimony:</span> ${inline(pz.witness)}</p>`)
      else if (pz.kind === 'end-testimony') out.push('<p class="vn-testimony vn-testimony-end"><span class="vn-label">End of testimony</span></p>')
      else {
        const view = opts.puzzles?.[pz.puzzle]
        const list = view?.clues.length ? `\n<ul>\n${view.clues.map((k) => `<li>${inline(k.text)}</li>`).join('\n')}\n</ul>` : ''
        out.push(`<div class="vn-puzzle"><p class="vn-puzzle-title"><span class="vn-label">Puzzle:</span> ${inline(view?.title ?? pz.puzzle)}</p>${list}</div>`)
      }
    } else if (!opts.screenplay && (m = NARRATION.exec(line))) {
      if (m[1]!.trim()) out.push(`<p class="vn-narration">${inline(m[1]!.trim())}</p>`)
    } else if (!opts.screenplay && tokens && (m = SPEAKER_TOKEN.exec(line)) && tokens.get(m[1]!.toLowerCase())) {
      const name = tokens.get(m[1]!.toLowerCase())!.name
      const how = m[2] ? ` <span class="vn-how">(${inline(m[2])})</span>` : ''
      out.push(`<p class="vn-line"><span class="vn-speaker">${escapeXml(name)}</span>${how} ${inline(m[3]!)}</p>`)
    } else if ((m = CAST.exec(line))) out.push(`<p class="vn-cast"><span class="vn-label">On screen:</span> ${inline(m[1]!)}</p>`)
    else if ((m = LINE.exec(line)) && (!reservedLabel(m[1]!) || opts.screenplay === true) && !/^(scene|on screen)$/i.test(m[1]!.trim())) {
      if (!opts.screenplay && isDirectionLabel(m[1]!)) {
        // a stage direction that looks like a speaker label: its text is narration, not a character
        out.push(`<p class="vn-narration">${inline(m[3]!)}</p>`)
      } else {
        const how = m[2] ? ` <span class="vn-how">(${inline(m[2])})</span>` : ''
        out.push(`<p class="vn-line"><span class="vn-speaker">${escapeXml(m[1]!.trim())}</span>${how} ${inline(m[3]!)}</p>`)
      }
    } else out.push(`<p class="vn-narration">${inline(line.replace(/^>\s?/, ''))}</p>`)
  }
  return out.join('\n')
}

/** A small markdown subset for prose (paragraphs, headings, scene breaks, quotes, emphasis) to well-formed XHTML. */
export function markdownToXhtml(md: string, opts: { script?: boolean; screenplay?: boolean; puzzles?: Record<string, PuzzleView>; characters?: string[] } = {}): string {
  if (opts.script) return scriptToXhtml(md, { screenplay: opts.screenplay, puzzles: opts.puzzles, characters: opts.characters })
  const blocks = md.replace(/\r\n/g, '\n').trim().split(/\n{2,}/)
  const out: string[] = []
  for (const raw of blocks) {
    const block = raw.trim()
    if (!block) continue
    const h = /^(#{1,6})\s+(.*)$/.exec(block)
    if (h && !block.includes('\n')) {
      const level = Math.min(6, h[1]!.length + 1) // the chapter title is h2, so shift down
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`)
    } else if (/^(\*\s*){3,}$|^-{3,}$|^_{3,}$|^#$/.test(block)) {
      out.push('<hr class="scene-break"/>')
    } else if (block.startsWith('>')) {
      const text = block.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n')
      out.push(`<blockquote><p>${inline(text).replace(/\n/g, '<br/>')}</p></blockquote>`)
    } else {
      out.push(`<p>${inline(block).replace(/\n/g, '<br/>')}</p>`)
    }
  }
  return out.join('\n')
}

/** The end of a chapter in a story with choices: links to the chapters the choices lead to (`to` is the chapter's 1-based position), or "The End" with a link back to the start. Empty for other books. */
export function choicesHtml(c: { choices?: { text: string; to: number }[]; ending?: string }): string {
  const file = (i: number) => `chapter-${String(i).padStart(2, '0')}.xhtml`
  if (c.choices?.length) return `<div class="choices">\n<p class="choices-ask">What do you choose?</p>\n<ul>\n${c.choices.map((ch) => `<li><a href="${file(ch.to)}">${inline(ch.text)}</a></li>`).join('\n')}\n</ul>\n</div>`
  if (c.ending) return `<div class="the-end">\n<p>The End</p>\n<p class="again"><a href="${file(1)}">Start again and choose differently</a></p>\n</div>`
  return ''
}

export function xhtmlPage(title: string, bodyHtml: string, opts: { css?: string; bodyClass?: string; epubType?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="${opts.css ?? 'style.css'}"/>
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ''}${opts.epubType ? ` epub:type="${opts.epubType}"` : ''}>
${bodyHtml}
</body>
</html>
`
}
