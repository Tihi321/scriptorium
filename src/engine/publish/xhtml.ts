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

const CUE_LABEL: Record<CueKind, string> = { cg: 'Picture:', insert: 'Close-up:', sfx: 'Sound:', ambience: 'Ambience:' }

/**
 * A visual novel script (formats with `script: true`) to XHTML, one element per line: `SCENE: place, time` opens a scene,
 * `ON SCREEN: Name (look), ...` says who is shown, `NAME (expression): words` is a spoken line, `---` is a scene break,
 * and any other line is narration (what the reader sees or the narrator says).
 */
export function scriptToXhtml(md: string, opts: { screenplay?: boolean } = {}): string {
  const out: string[] = []
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let m: RegExpExecArray | null
    let c: ReturnType<typeof cueOf>
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
    } else if ((m = CAST.exec(line))) out.push(`<p class="vn-cast"><span class="vn-label">On screen:</span> ${inline(m[1]!)}</p>`)
    else if ((m = LINE.exec(line)) && !/^(scene|on screen)$/i.test(m[1]!.trim())) {
      const how = m[2] ? ` <span class="vn-how">(${inline(m[2])})</span>` : ''
      out.push(`<p class="vn-line"><span class="vn-speaker">${escapeXml(m[1]!.trim())}</span>${how} ${inline(m[3]!)}</p>`)
    } else out.push(`<p class="vn-narration">${inline(line.replace(/^>\s?/, ''))}</p>`)
  }
  return out.join('\n')
}

/** A small markdown subset for prose (paragraphs, headings, scene breaks, quotes, emphasis) to well-formed XHTML. */
export function markdownToXhtml(md: string, opts: { script?: boolean; screenplay?: boolean } = {}): string {
  if (opts.script) return scriptToXhtml(md, { screenplay: opts.screenplay })
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
