/**
 * Simple art drawn by code: a cover pattern seeded from the title and a small chapter ornament per genre.
 * Everything is plain SVG text, deterministic, with no fonts, images or network.
 */

export type PatternKind = 'stripes' | 'waves' | 'dots' | 'shapes'
export const PATTERN_KINDS: PatternKind[] = ['stripes', 'waves', 'dots', 'shapes']

/** FNV-1a, 32 bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: a small seeded random number generator returning [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const n = (x: number) => String(Math.round(x * 10) / 10)
const seedOf = (title: string) => hashString(title.trim().toLowerCase())

/** Which pattern a title gets. The same title always gives the same kind. */
export function patternKind(title: string): PatternKind {
  return PATTERN_KINDS[seedOf(title) % PATTERN_KINDS.length]!
}

/**
 * Full-bleed cover pattern as inline SVG. Colours come from the CSS variables of the cover template
 * (`--accent` and `--fg`), so the genre class decides them. The template puts a panel over the text area.
 */
export function coverPatternSvg(title: string, width = 1600, height = 2560, kind: PatternKind = patternKind(title)): string {
  const rnd = seededRandom(seedOf(title) ^ 0x9e3779b9)
  const A = 'style="color:var(--accent)" fill="currentColor"'
  const F = 'style="color:var(--fg)" fill="currentColor"'
  const parts: string[] = []
  if (kind === 'stripes') {
    const angle = -35 + Math.floor(rnd() * 70)
    const diag = Math.hypot(width, height)
    let x = -diag / 2
    const items: string[] = []
    while (x < diag) {
      const w = 14 + Math.floor(rnd() * 56)
      items.push(`<rect x="${n(x)}" y="${n(-diag / 2)}" width="${w}" height="${n(diag * 2)}" ${rnd() < 0.7 ? A : F}/>`)
      x += w + 30 + Math.floor(rnd() * 90)
    }
    parts.push(`<g transform="rotate(${angle} ${width / 2} ${height / 2})">${items.join('')}</g>`)
  } else if (kind === 'waves') {
    const amp = 28 + rnd() * 40
    const len = 220 + rnd() * 200
    const gap = 62 + rnd() * 30
    const sw = 5 + rnd() * 5
    let row = 0
    for (let y = -40; y < height + 40; y += gap, row++) {
      const phase = rnd() * len
      let d = `M ${n(-len - phase)} ${n(y)}`
      for (let x = -len - phase; x < width + len; x += len) d += ` q ${n(len / 4)} ${n(-amp)} ${n(len / 2)} 0 t ${n(len / 2)} 0`
      parts.push(
        `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${n(sw)}" stroke-linecap="round" style="color:var(${row % 3 === 2 ? '--fg' : '--accent'})"/>`
      )
    }
  } else if (kind === 'dots') {
    const step = 96 + Math.floor(rnd() * 56)
    const maxR = step * (0.22 + rnd() * 0.16)
    const cx = rnd() * width
    const cy = rnd() * height
    const reach = Math.hypot(width, height)
    let r = 0
    for (let y = 0; y < height + step; y += step * 0.866, r++) {
      for (let x = r % 2 ? step / 2 : 0; x < width + step; x += step) {
        const k = 1 - Math.min(1, Math.hypot(x - cx, y - cy) / reach) * 0.75
        parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(maxR * k)}" ${(Math.floor(x / step) + r) % 5 === 0 ? F : A}/>`)
      }
    }
  } else {
    const cell = 240
    for (let gy = 0; gy * cell < height + cell; gy++) {
      for (let gx = 0; gx * cell < width + cell; gx++) {
        if (rnd() < 0.3) continue
        const x = gx * cell + rnd() * cell * 0.6
        const y = gy * cell + rnd() * cell * 0.6
        const s = 50 + rnd() * 90
        const rot = Math.floor(rnd() * 180)
        const style = rnd() < 0.7 ? A : F
        const shape = Math.floor(rnd() * 3)
        const tr = `transform="rotate(${rot} ${n(x)} ${n(y)})"`
        if (shape === 0) parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(s / 2)}" ${style}/>`)
        else if (shape === 1) parts.push(`<rect x="${n(x - s / 2)}" y="${n(y - s / 2)}" width="${n(s)}" height="${n(s)}" ${tr} ${style}/>`)
        else parts.push(`<polygon points="${n(x)},${n(y - s * 0.6)} ${n(x + s * 0.55)},${n(y + s * 0.4)} ${n(x - s * 0.55)},${n(y + s * 0.4)}" ${tr} ${style}/>`)
      }
    }
  }
  return `<svg class="pattern" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g opacity="${kind === 'stripes' ? 0.14 : 0.22}">${parts.join('')}</g></svg>`
}

/** Font size in px for the cover title, so that long titles wrap inside the text area instead of running into the author. */
export function coverTitleSize(title: string): number {
  const len = title.trim().length
  if (len <= 12) return 200
  if (len <= 24) return 170
  if (len <= 40) return 140
  if (len <= 60) return 116
  return 96
}

/** Font size in px for the author line. */
export function coverAuthorSize(author: string): number {
  const len = author.trim().length
  return len <= 22 ? 96 : len <= 34 ? 80 : 64
}

interface OrnamentDef {
  color: string
  /** Shapes inside a 240 x 48 box, centred on x = 120, y = 24. */
  art: string
}

const line = (x1: number, x2: number) => `<path d="M${x1} 24 H${x2}" stroke-width="2" fill="none"/>`
const sides = (mid: string, gap = 26) => `${line(20, 120 - gap)}${line(120 + gap, 220)}${mid}`
const diamond = (cx: number, r: number) => `<path d="M${cx} ${24 - r} L${cx + r} 24 L${cx} ${24 + r} L${cx - r} 24 Z"/>`
const star = (cx: number, cy: number, r: number) => {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.42 : r
    const a = (Math.PI / 5) * i - Math.PI / 2
    pts.push(`${n(cx + rr * Math.cos(a))},${n(cy + rr * Math.sin(a))}`)
  }
  return `<polygon points="${pts.join(' ')}"/>`
}
const moon = (cx: number) => `<path d="M${cx + 6} 10 A15 15 0 1 0 ${cx + 6} 38 A12 12 0 1 1 ${cx + 6} 10 Z"/>`

const ORNAMENTS: Record<string, OrnamentDef> = {
  'g-fantasy': { color: '#8a6a1f', art: sides(`${star(120, 24, 14)}${star(96, 24, 6)}${star(144, 24, 6)}`, 34) },
  'g-mystery': {
    color: '#8a3b2b',
    art: sides('<circle cx="114" cy="21" r="10" fill="none" stroke-width="3.5"/><path d="M121 28 L132 39" stroke-width="4.5" stroke-linecap="round"/>', 30)
  },
  'g-scifi': { color: '#1f7a74', art: sides('<circle cx="120" cy="24" r="6"/><ellipse cx="120" cy="24" rx="20" ry="8" fill="none" stroke-width="2.5"/>', 30) },
  'g-romance': { color: '#9a3a4e', art: sides('<path d="M120 36 C100 22 106 10 114 12 C118 13 120 17 120 17 C120 17 122 13 126 12 C134 10 140 22 120 36 Z"/>', 26) },
  'g-horror': { color: '#7a1216', art: sides(moon(120), 26) },
  'g-historical': { color: '#7a5a14', art: sides(`${diamond(120, 11)}${diamond(96, 5)}${diamond(144, 5)}`, 36) },
  'g-adventure': {
    color: '#b06a10',
    art: sides('<circle cx="120" cy="24" r="13" fill="none" stroke-width="2.5"/><path d="M120 8 L125 24 L120 40 L115 24 Z"/>', 30)
  },
  'g-literary': { color: '#6e4328', art: sides(diamond(120, 8), 20) },
  'g-humor': {
    color: '#c2325a',
    art: sides(
      '<circle cx="120" cy="24" r="14" fill="none" stroke-width="3"/><circle cx="114" cy="20" r="2"/><circle cx="126" cy="20" r="2"/><path d="M112 28 Q120 37 128 28" fill="none" stroke-width="2.5" stroke-linecap="round"/>',
      28
    )
  },
  'g-bedtime': { color: '#5b64a8', art: sides(`${moon(108)}${star(136, 18, 6)}${star(146, 32, 4)}`, 34) },
  'g-children': {
    color: '#1f8a7f',
    art: sides('<circle cx="120" cy="24" r="6"/><circle cx="120" cy="10" r="5"/><circle cx="120" cy="38" r="5"/><circle cx="106" cy="24" r="5"/><circle cx="134" cy="24" r="5"/>', 28)
  },
  'g-nonfiction': { color: '#3a5a6a', art: sides('<rect x="112" y="16" width="16" height="16"/><rect x="88" y="20" width="8" height="8"/><rect x="144" y="20" width="8" height="8"/>', 36) }
}

export const ORNAMENT_GENRES = Object.keys(ORNAMENTS)

/** A small chapter-head ornament as a standalone SVG file (declare it image/svg+xml in the EPUB manifest). */
export function ornamentSvg(genreClass: string): string {
  const def = ORNAMENTS[genreClass] ?? ORNAMENTS['g-literary']!
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 48" width="240" height="48" fill="${def.color}" stroke="${def.color}">
<g>${def.art}</g>
</svg>
`
}

/** The XHTML put above a chapter title. The image path is relative to the chapter file. */
export function ornamentHtml(): string {
  return '<div class="ornament"><img src="images/ornament.svg" alt=""/></div>'
}

export const ORNAMENT_CSS = `.ornament { text-align: center; margin: 2em 0 0; }
.ornament img { width: 9em; height: auto; }
.ornament + h2 { margin-top: 0.4em; }
`
