import { endLine, waysIn } from './branches'
import type { BranchChapter } from './branches'
import { headTail } from './series'

/** The editors' notes about one chapter (`chapterNotes`), and how many items of how many were kept. */
export interface ChapterNotes {
  text: string
  kept: number
  total: number
}

/** At most this many characters of notes that name no chapter are kept for each reviewer. */
export const GENERAL_NOTES_CAP = 1200

/** The share of the writer's window that the neighbouring chapters in full may take. */
const NEIGHBOUR_SHARE = 0.35

const PHRASE = /\b(?:chapters?|chs?\.?)\s*(\d+(?:\s*(?:-|–|—|to|and|,|&)\s*\d+)*)/gi

/** The chapter numbers a phrase such as "2-4", "2, 5 and 7" names: a range `a-b` or `a to b` is expanded. */
function numbersOf(list: string): number[] {
  const out: number[] = []
  for (const m of list.matchAll(/(\d+)\s*(?:-|–|—|to)\s*(\d+)|(\d+)/g)) {
    if (m[3]) out.push(Number(m[3]))
    else {
      const a = Number(m[1])
      const b = Number(m[2])
      if (b >= a && b - a < 60) for (let i = a; i <= b; i++) out.push(i)
      else out.push(a, b)
    }
  }
  return out
}

/** The chapters an item of notes names ("chapter 5", "chapters 2-4", "ch. 3 and 6"), or null when it names none. */
export function chaptersNamed(item: string): number[] | null {
  const found: number[] = []
  for (const m of item.matchAll(PHRASE)) found.push(...numbersOf(m[1]!))
  return found.length ? found : null
}

/** The items of a review's notes: numbered or bulleted items, else paragraphs. Headings are not items. */
export function splitItems(notes: string): string[] {
  const lines = notes.replace(/\r\n/g, '\n').split('\n')
  const listed = lines.some((l) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l))
  const items: string[] = []
  if (listed) {
    for (const line of lines) {
      if (/^\s*#{1,6}\s/.test(line)) continue
      if (/^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)) items.push(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
      else if (line.trim() && items.length) items[items.length - 1] += ` ${line.trim()}`
      else if (line.trim()) items.push(line.trim())
    }
  } else {
    for (const para of notes.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
      const t = para.replace(/^\s*#{1,6}\s.*\n?/, '').trim()
      if (t) items.push(t.replace(/\s*\n\s*/g, ' '))
    }
  }
  return items.filter(Boolean)
}

/**
 * The editors' notes that concern chapter `n`, as `- From the <role>: <items>` lines. Each revise review's notes are split into items. An item
 * that names chapters (or sits under an `(act k)` marker, the notes of an act review) is kept only when chapter `n` is among them; an item that
 * names none is general: at most 1,200 characters of general items are kept for each reviewer. A reviewer with nothing kept is left out.
 */
export function chapterNotes(reviews: { role: string; verdict: string; notes: string }[], n: number, acts: { n: number; chapters: number[] }[] = [], generalCap = GENERAL_NOTES_CAP): ChapterNotes {
  const lines: string[] = []
  let kept = 0
  let total = 0
  for (const r of reviews) {
    if (r.verdict !== 'revise') continue
    // the notes of an act review start with "(act k) "; several acts are joined by blank lines
    const parts: { act: number | null; text: string }[] = []
    let last = 0
    let act: number | null = null
    for (const m of r.notes.matchAll(/(?:^|\n\n)\(act (\d+)\)\s*/g)) {
      if (m.index! > last || act !== null) parts.push({ act, text: r.notes.slice(last, m.index) })
      act = Number(m[1])
      last = m.index! + m[0].length
    }
    parts.push({ act, text: r.notes.slice(last) })
    const mine: string[] = []
    let general = 0
    for (const part of parts) {
      const actChapters = part.act === null ? null : (acts.find((a) => a.n === part.act)?.chapters ?? null)
      for (const item of splitItems(part.text)) {
        total++
        const named = chaptersNamed(item)
        if (named) {
          if (named.includes(n)) {
            mine.push(item)
            kept++
          }
        } else if (actChapters) {
          if (actChapters.includes(n)) {
            mine.push(item)
            kept++
          }
        } else if (general + item.length <= generalCap) {
          general += item.length
          mine.push(item)
          kept++
        }
      }
    }
    if (mine.length) lines.push(`- From the ${r.role.replace(/-/g, ' ')}: ${mine.join(' ')}`)
  }
  return { text: lines.join('\n'), kept, total }
}

export interface OtherChapters {
  text: string
  /** The chapters given in full. */
  full: number[]
  /** How many chapters are given as a summary. */
  summaries: number
}

/**
 * The chapters around the one being rewritten: the chapters right before and after it in full (a story with choices: the chapters that
 * lead into it and the ones its choices lead to), every other chapter as `### Chapter k: Title` and its summary. With the writer's window
 * known the full chapters take at most 35% of it, each cut from the middle when it would not fit.
 */
export function otherChapters(o: {
  chapters: { n: number; title: string; body: string }[]
  n: number
  /** The outline of a story with choices, else null. */
  branches: BranchChapter[] | null
  /** The summary of chapter k: its summary file for a long book, else its outline entry. */
  summaryOf: (k: number) => string
  /** The writer's window in tokens, when known. */
  windowTokens?: number
}): OtherChapters {
  const { chapters, n, branches } = o
  const wanted = branches
    ? new Set<number>([...waysIn(branches, n).map((w) => w.from), ...(branches.find((c) => c.n === n)?.choices ?? []).map((c) => c.to)])
    : new Set<number>([n - 1, n + 1])
  const others = chapters.filter((c) => c.n !== n).sort((a, b) => a.n - b.n)
  const full = others.filter((c) => wanted.has(c.n))
  const room = o.windowTokens ? Math.floor((o.windowTokens * 4 * NEIGHBOUR_SHARE) / Math.max(1, full.length)) : Infinity
  const block = (c: { n: number; title: string; body: string }) => {
    const body = c.body.length > room ? headTail(c.body, Math.floor(room * 0.5), Math.floor(room * 0.5)) : c.body
    const place = branches?.find((x) => x.n === c.n)
    return `### Chapter ${c.n}: ${c.title}\n\n${body}${place ? `\n\n[${endLine(place)}]` : ''}`
  }
  const text = others
    .map((c) => (wanted.has(c.n) ? block(c) : `### Chapter ${c.n}: ${c.title}\n${o.summaryOf(c.n) || '(no summary)'}`))
    .join('\n\n')
  return { text, full: full.map((c) => c.n), summaries: others.length - full.length }
}
