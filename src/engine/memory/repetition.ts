/**
 * Repetition counter for long books: plain counting, no model. Finds repeated phrases, repeated sentence openers
 * and gesture tics over the whole text. The report goes to the line editor.
 */

export interface Counted {
  text: string
  count: number
  /** Chapters it appears in. */
  chapters: number[]
}

export interface RepetitionReport {
  words: number
  phrases: Counted[]
  openers: Counted[]
  gestures: Counted[]
  /** Number of things worth a look. */
  flagged: number
  markdown: string
}

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'at', 'it', 'was', 'he', 'she', 'they', 'his', 'her', 'i', 'you', 'that', 'with', 'for', 'as', 'but', 'is', 'had', 'them', 'him'])

/** Phrases that show up as tics in machine-written prose. */
const GESTURES: [string, RegExp][] = [
  ['let out a breath', /\b(let|lets|letting) out a (long |deep |slow |shaky )?breath/gi],
  ['breath she did not know she was holding', /breath (she|he|they|i) (hadn't|had not|didn't|did not) (know|realize|realise)/gi],
  ['nodded', /\bnodded\b/gi],
  ['shrugged', /\bshrugged\b/gi],
  ['sighed', /\bsighed\b/gi],
  ['raised an eyebrow', /\braised an eyebrow/gi],
  ['heart pounded', /\bheart (pounded|hammered|raced|skipped)/gi],
  ['eyes widened', /\beyes (widened|narrowed)/gi],
  ['a smile tugged', /\bsmile (tugged|played) at/gi],
  ['shiver ran down', /\bshiver (ran|crept|went) (down|up)/gi],
  ['a mix of', /\ba mix of\b/gi],
  ['something shifted', /\bsomething (shifted|stirred) (in|inside|between)/gi],
  ['the air was thick', /\bthe air (was|felt) thick/gi],
  ['couldn\'t help but', /\bcouldn'?t help (but|herself|himself)/gi]
]

const words = (t: string) => t.toLowerCase().match(/[\p{L}']+/gu) ?? []

function top(map: Map<string, { count: number; chapters: Set<number> }>, min: number, limit: number): Counted[] {
  return [...map.entries()]
    .filter(([, v]) => v.count >= min)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([text, v]) => ({ text, count: v.count, chapters: [...v.chapters].sort((a, b) => a - b) }))
}

export function analyzeRepetition(chapters: { n: number; text: string }[]): RepetitionReport {
  const grams = new Map<string, { count: number; chapters: Set<number> }>()
  const openers = new Map<string, { count: number; chapters: Set<number> }>()
  const gestures = new Map<string, { count: number; chapters: Set<number> }>()
  let total = 0
  let sentences = 0
  for (const ch of chapters) {
    const w = words(ch.text)
    total += w.length
    for (let i = 0; i + 4 <= w.length; i++) {
      const g = w.slice(i, i + 4)
      if (g.filter((x) => !STOP.has(x)).length < 2) continue
      const key = g.join(' ')
      const e = grams.get(key) ?? { count: 0, chapters: new Set<number>() }
      e.count++
      e.chapters.add(ch.n)
      grams.set(key, e)
    }
    for (const s of ch.text.split(/(?<=[.!?])\s+/)) {
      const o = words(s).slice(0, 2)
      if (o.length < 2) continue
      sentences++
      const key = o.join(' ')
      const e = openers.get(key) ?? { count: 0, chapters: new Set<number>() }
      e.count++
      e.chapters.add(ch.n)
      openers.set(key, e)
    }
    for (const [label, re] of GESTURES) {
      const n = ch.text.match(re)?.length ?? 0
      if (!n) continue
      const e = gestures.get(label) ?? { count: 0, chapters: new Set<number>() }
      e.count += n
      e.chapters.add(ch.n)
      gestures.set(label, e)
    }
  }
  const phraseMin = Math.max(4, Math.round(total / 8000))
  // a phrase's four-word windows overlap: keep only the most frequent of overlapping ones
  const phrases: Counted[] = []
  for (const p of top(grams, phraseMin, 40)) {
    if (!phrases.some((q) => q.text.includes(p.text) || p.text.includes(q.text) || q.text.split(' ').slice(1).join(' ') === p.text.split(' ').slice(0, 3).join(' '))) phrases.push(p)
    if (phrases.length >= 12) break
  }
  const openerMin = Math.max(8, Math.round(sentences * 0.03))
  const openerList = top(openers, openerMin, 8)
  const gestureMin = Math.max(3, Math.round(total / 10000) * 2)
  const gestureList = top(gestures, gestureMin, 12)
  const flagged = phrases.length + openerList.length + gestureList.length

  const fmt = (c: Counted) => `- "${c.text}": ${c.count} times, chapters ${c.chapters.length > 8 ? `${c.chapters[0]}-${c.chapters[c.chapters.length - 1]}` : c.chapters.join(', ')}`
  const markdown = [
    '# Repetition report',
    '',
    `Counted over ${total} words in ${chapters.length} chapter(s), by a script (no model).`,
    '',
    '## Repeated phrases',
    phrases.length ? phrases.map(fmt).join('\n') : 'Nothing stands out.',
    '',
    '## Repeated sentence openers',
    openerList.length ? openerList.map(fmt).join('\n') : 'Nothing stands out.',
    '',
    '## Gesture and phrase tics',
    gestureList.length ? gestureList.map(fmt).join('\n') : 'Nothing stands out.',
    ''
  ].join('\n')
  return { words: total, phrases, openers: openerList, gestures: gestureList, flagged, markdown }
}
