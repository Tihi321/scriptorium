/**
 * Shared gamebook section numbering (HUB-25 "Shared section algorithm").
 *
 * The same algorithm lives in VN Studio (src/engine/export/sections.ts) and in Scriptorium
 * (src/engine/publish/sections.ts), and both test the same golden vector. A change here is a
 * change to the spec in creative-hub/.claude/tickets/HUB-25-book-export-kindle-pdf/plan.md
 * first, then to both repos together.
 *
 * - Input: n chapters (1-based, chapter 1 is the start), a seed string (default the book slug),
 *   order 'shuffled' (default) or 'in-order'.
 * - in-order: chapter k gets section k.
 * - shuffled: h = FNV-1a 32-bit of the UTF-8 bytes of the seed; mulberry32 seeded with h;
 *   nums = [2..n], Fisher-Yates from the end (j = floor(rand() * (i + 1))). Chapter 1 gets
 *   section 1, chapters 2..n get nums in order.
 * - Output: index k-1 is the section number of chapter k, a bijection onto 1..n.
 * - Golden vector: fnv1a32('golden') = 386248004; sections('golden', 8) = [1,4,2,8,5,3,7,6];
 *   sections('clockless-god', 5) = [1,4,3,2,5].
 */

export type SectionOrder = 'shuffled' | 'in-order'

export function fnv1a32(text: string): number {
  let h = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildSections(n: number, seed: string, order: SectionOrder = 'shuffled'): number[] {
  const nums: number[] = []
  for (let k = 2; k <= n; k++) nums.push(k)
  if (order === 'shuffled') {
    const rand = mulberry32(fnv1a32(seed))
    for (let i = nums.length - 1; i >= 1; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[nums[i], nums[j]] = [nums[j]!, nums[i]!]
    }
  }
  return n >= 1 ? [1, ...nums] : []
}

// ---- Scriptorium additions (not part of the shared spec): the stored map and the phrase table ---------------------------------

import { promises as fs } from 'node:fs'
import { atomicWrite } from '../store/atomic'

/** `books/<slug>/gamebook.json`: the section numbers of one book, kept so a re-export (and the PDF) gives the same numbers. */
export interface StoredSections {
  seed: string
  order: SectionOrder
  /** Outline chapter number -> section number. */
  sections: Record<string, number>
}

export interface SectionPlan {
  /** Index k-1 is the section number of the k-th chapter (the same order as the chapters of the EPUB). */
  sections: number[]
  seed: string
  order: SectionOrder
  /** The numbers came from the stored file. */
  reused: boolean
  /** The stored file is for another set of chapters: nothing is returned in `sections`; export with `renumber` to recompute. */
  stale: boolean
}

/** Is `map` a usable stored map for exactly these chapter numbers (same set, section numbers a bijection onto 1..n, chapter 1 is section 1)? */
function storedFits(stored: StoredSections, chapterNs: number[]): boolean {
  const keys = Object.keys(stored.sections).map(Number).sort((a, b) => a - b)
  const want = [...chapterNs].sort((a, b) => a - b)
  if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) return false
  const nums = Object.values(stored.sections)
  if (new Set(nums).size !== nums.length || nums.some((x) => !Number.isInteger(x) || x < 1 || x > nums.length)) return false
  return stored.sections[String(chapterNs[0])] === 1
}

/**
 * The section numbers of a book whose chapters have these outline numbers (in reading order; the first is the start).
 * Reuses `gamebook.json` when its chapter set matches; a different set is stale (`stale: true`, no numbers) unless `renumber` is set,
 * which computes new numbers from the seed (default the slug) and stores them.
 */
export async function planSections(file: string, slug: string, chapterNs: number[], opts: { seed?: string; order?: SectionOrder; renumber?: boolean } = {}): Promise<SectionPlan> {
  let stored: StoredSections | null = null
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<StoredSections>
    if (raw && typeof raw === 'object' && raw.sections && typeof raw.sections === 'object') {
      stored = { seed: String(raw.seed ?? slug), order: raw.order === 'in-order' ? 'in-order' : 'shuffled', sections: raw.sections as Record<string, number> }
    }
  } catch {
    /* no stored map yet */
  }
  if (stored && !opts.renumber) {
    if (!storedFits(stored, chapterNs)) return { sections: [], seed: stored.seed, order: stored.order, reused: false, stale: true }
    return { sections: chapterNs.map((n) => stored.sections[String(n)]!), seed: stored.seed, order: stored.order, reused: true, stale: false }
  }
  const seed = opts.seed ?? stored?.seed ?? slug
  const order = opts.order ?? stored?.order ?? 'shuffled'
  const sections = buildSections(chapterNs.length, seed, order)
  const map: StoredSections = { seed, order, sections: Object.fromEntries(chapterNs.map((n, i) => [String(n), sections[i]!])) }
  await atomicWrite(file, JSON.stringify(map, null, 2) + '\n')
  return { sections, seed, order, reused: false, stale: false }
}

/** The words around a jump, by language. Other languages use English. The Croatian ending wording is inferred, not given by the user. */
export interface GamebookPhrases {
  /** Between the choice text and the jump: " - " (en), ", " (hr, the user's "Ako ..., idi na odlomak 56."). */
  sep: string
  /** "turn to section N." after the choice text; "section N" is the link. */
  turn: (no: number) => string
  theEnd: string
  startAgain: (no: number) => string
  /** The nav's start entry. */
  start: (no: number) => string
  contents: string
  section: string
}

const EN: GamebookPhrases = {
  sep: ' - ',
  turn: (n) => `turn to section ${n}.`,
  theEnd: 'The End.',
  startAgain: (n) => `Turn to section ${n} to start again.`,
  start: (n) => `Start: section ${n}`,
  contents: 'Sections',
  section: 'Section'
}
const HR: GamebookPhrases = {
  sep: ', ',
  turn: (n) => `idi na odlomak ${n}.`,
  theEnd: 'Kraj.',
  startAgain: (n) => `Idi na odlomak ${n} za novi početak.`,
  start: (n) => `Početak: odlomak ${n}`,
  contents: 'Odlomci',
  section: 'Odlomak'
}

export function gamebookPhrases(lang: string): GamebookPhrases {
  return /^hr(\b|-|_|$)/i.test(lang.trim()) ? HR : EN
}
