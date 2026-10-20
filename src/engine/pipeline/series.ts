import { briefPromptText } from '../../shared/brief'
import { parseMd } from '../../shared/md'
import { entryKey } from '../memory/bible'
import type { Bible, BibleEntry } from '../memory/bible'
import { bookRefs } from '../store/series'
import type { BookRef, SeriesFile, SeriesStore } from '../store/series'
import type { BookStore } from './books'

type Deps = { books: BookStore; series: SeriesStore }
type DepsWithBible = Deps & { bible: Bible }

/** What one earlier book may take into the prompt of a later book, at most (characters). Keeps the prompts bounded. */
const BOOK_CHARS = 7000
/** All earlier books together: summaries, cast and threads. */
const TOTAL_CHARS = 28000
/** One cast member's end state: the start of the entry and its end (the latest updates). */
const ENTRY_HEAD = 400
const ENTRY_TAIL = 900

const clip = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, Math.max(0, max - 3)).trimEnd() + '...')

/** The start and the end of a long text: the end holds the latest state. */
const headTail = (text: string, head: number, tail: number): string => {
  const t = text.trim()
  return t.length <= head + tail ? t : `${t.slice(0, head).trimEnd()} [...] ${t.slice(-tail).trimStart()}`
}

const words = (name: string) => new Set(entryKey(name).split('-').filter(Boolean))

/** Two names are the same person or place when one has all the words of the other ("Dec Hartley", "Declan 'Dec' Hartley"). */
export function sameName(a: string, b: string): boolean {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return false
  const [small, big] = x.size <= y.size ? [x, y] : [y, x]
  return [...small].every((w) => big.has(w))
}

export interface SeriesPlace {
  series: SeriesFile
  /** This book's position (`series_index`), 0 when it has none. */
  index: number
  /** The books of the series before this one, in order. */
  earlier: BookRef[]
}

/** The series a book belongs to and the books before it, or null when the book is in no series (or the series file is gone). */
export async function seriesOf(d: Deps, slug: string): Promise<SeriesPlace | null> {
  const book = (await d.books.read(slug))?.data
  if (!book?.series) return null
  const series = await d.series.get(book.series)
  if (!series) return null
  const index = book.series_index ?? 0
  const earlier = (await bookRefs(d.books)).filter((b) => b.series === series.slug && b.slug !== slug && (b.index ?? 0) < index).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  return { series, index, earlier }
}

/** Slugs of the books before this one in its series (for the search over their text). */
export async function earlierSeriesBooks(d: Deps, slug: string): Promise<string[]> {
  return (await seriesOf(d, slug))?.earlier.map((b) => b.slug) ?? []
}

/** The characters and places of a book's bible, long bible or light. */
async function bibleEntriesOf(d: { books: BookStore; bible: Bible }, slug: string): Promise<BibleEntry[]> {
  const long = await d.bible.entries(slug)
  if (long.length) return long
  // a light bible is one file: "- **Name**: description" lines under Characters
  const text = await d.books.bible(slug)
  const out: BibleEntry[] = []
  for (const m of text.matchAll(/^- \*\*(.+?)\*\*: (.*)$/gm)) out.push({ group: 'characters', slug: entryKey(m[1]!), name: m[1]!.trim(), voice: '', text: m[2]!.trim() })
  return out
}

/** The recurring cast of a series that an earlier book's bible has an entry for, with that entry's text (cut to its start and its end). */
async function endStates(d: { books: BookStore; bible: Bible }, slug: string, cast: string[]): Promise<{ name: string; voice: string; text: string }[]> {
  const out: { name: string; voice: string; text: string }[] = []
  for (const e of await bibleEntriesOf(d, slug)) {
    if (e.group !== 'characters' || !cast.some((c) => sameName(c, e.name))) continue
    out.push({ name: e.name, voice: e.voice, text: headTail(e.text, ENTRY_HEAD, ENTRY_TAIL) })
  }
  return out
}

/** The summaries of one earlier book: its act summaries, then as many chapter summaries as fit, in reading order. */
async function summariesOf(d: Deps, slug: string, budget: number): Promise<string> {
  const read = async (...parts: string[]) => {
    const t = await d.books.readText(slug, ...parts)
    return t ? parseMd(t).body.trim() : ''
  }
  const acts = await d.books.acts(slug)
  const actTexts: string[] = []
  for (const a of acts) {
    const t = await read('summaries', `act-${a.n}.md`)
    if (t) actTexts.push(`${a.title}: ${t}`)
  }
  const chapterTexts: string[] = []
  for (const c of await d.books.chapters(slug)) {
    const t = await read('summaries', `ch-${String(c.n).padStart(2, '0')}.md`)
    if (t) chapterTexts.push(`Chapter ${c.n} (${c.title}): ${t}`)
  }
  const parts: string[] = []
  let left = budget
  if (actTexts.length) {
    const each = Math.floor((left * 0.6) / actTexts.length)
    for (const t of actTexts) parts.push(clip(t, each))
    left -= parts.reduce((s, p) => s + p.length, 0)
  }
  if (chapterTexts.length && left > 200) {
    const each = Math.floor(left / chapterTexts.length)
    if (each > 80) for (const t of chapterTexts) parts.push(clip(t, each))
  }
  if (!parts.length) {
    // no summaries (a short book, or one written before the series): the pitch tells what the book is about
    const pitch = (await d.books.pitch(slug)) ?? ''
    if (pitch) parts.push(clip(pitch, budget))
  }
  return parts.join('\n')
}

/**
 * The series of a book as prompt text: the series premise, recurring cast, setting and style, and for every earlier book
 * of the series, in order, its title, blurb, act and chapter summaries, the end state of the recurring characters and the
 * threads it left open. Book 1 gets only the series header. Empty when the book is in no series.
 */
export async function seriesSection(d: DepsWithBible, slug: string): Promise<string> {
  const place = await seriesOf(d, slug)
  if (!place) return ''
  const { series, index, earlier } = place
  const cast = series.brief.characters.map((c) => c.name)
  const head = [
    '## The series this book belongs to',
    `This book is book ${index || earlier.length + 1} of the series "${series.title}". Keep the series premise, its recurring characters (names, roles, looks, voices), its setting and its style. ` +
      (earlier.length
        ? "The earlier books below are canon: what happened in them happened, and the recurring characters are who they were at the end of those books. Do not contradict them, do not retell them, and let this book carry the series on. Where the owner's story brief for this book conflicts with the series, the brief wins for this book."
        : 'This is the first book of the series: set up the series premise and the recurring characters, and leave the story room to go on in later books.'),
    briefPromptText({ ...series.brief, title: '' })
  ]
  const perBook = Math.min(BOOK_CHARS, Math.floor(TOTAL_CHARS / Math.max(1, earlier.length)))
  const books: string[] = []
  for (const b of earlier) {
    const meta = (await d.books.read(b.slug))?.data as Record<string, unknown> | undefined
    const lines = [`### Book ${b.index ?? '?'}: ${b.title} (${b.stage})`]
    const blurb = typeof meta?.blurb === 'string' ? meta.blurb.trim() : ''
    if (blurb) lines.push(`Blurb: ${clip(blurb, 900)}`)
    const states = await endStates(d, b.slug, cast)
    const stateText = states.map((s) => `- ${s.name}${s.voice ? ` (voice: ${s.voice})` : ''}: ${s.text.replace(/\s+/g, ' ')}`).join('\n')
    const open = (await d.bible.threads(b.slug)).filter((t) => t.status === 'open').map((t) => `- ${t.text}`)
    const left = Array.isArray(meta?.open_threads) ? (meta.open_threads as unknown[]).map((t) => `- ${String(t).replace(/^t\d+:\s*/, '')}`) : []
    const threads = (open.length ? open : left).join('\n')
    const fixed = lines.join('\n').length + stateText.length + threads.length + 120
    const summaries = await summariesOf(d, b.slug, Math.max(800, perBook - fixed))
    if (summaries) lines.push(`What happened:\n${summaries}`)
    if (stateText) lines.push(`The recurring characters at the end of the book:\n${stateText}`)
    if (threads) lines.push(`Threads the book left open:\n${threads}`)
    books.push(lines.join('\n'))
  }
  return [...head, ...(books.length ? [`## The earlier books of the series\n\n${books.join('\n\n')}`] : [])].join('\n\n')
}

type OutlineCharacter = { name: string; description: string; voice: string }
type OutlinePlace = { name: string; description: string }
type Carried = { name: string; text: string; from: string; voice?: string }

/**
 * Seeds the bible of book N>1 with what the earlier books' bibles say about the recurring characters (the series cast) and
 * places (those named in the series text). The entry of the latest earlier book that has the character is taken: it holds that
 * book's end state. A character the architect already has gets the earlier text added to its description. The archivist
 * then grows the entries as the chapters are written.
 */
export async function withSeriesBible(
  d: DepsWithBible,
  slug: string,
  characters: OutlineCharacter[],
  places: OutlinePlace[],
  log: (m: string) => void
): Promise<{ characters: OutlineCharacter[]; places: OutlinePlace[] }> {
  const place = await seriesOf(d, slug)
  if (!place || !place.earlier.length) return { characters, places }
  const { series, earlier } = place
  const cast = series.brief.characters.map((c) => c.name)
  const seriesText = [series.brief.premise, series.brief.setting, series.brief.style, ...series.brief.sections.map((s) => s.text), ...series.brief.characters.map((c) => `${c.role} ${c.description}`)].join('\n').toLowerCase()
  const carriedChars = new Map<string, Carried>()
  const carriedPlaces = new Map<string, Carried>()
  for (const b of earlier) {
    for (const e of await bibleEntriesOf(d, b.slug)) {
      const text = headTail(e.text, ENTRY_HEAD, ENTRY_TAIL)
      if (e.group === 'characters' && cast.some((c) => sameName(c, e.name))) carriedChars.set(entryKey(e.name), { name: e.name, voice: e.voice, text, from: b.title })
      else if (e.group === 'places' && seriesText.includes(e.name.toLowerCase())) carriedPlaces.set(entryKey(e.name), { name: e.name, text, from: b.title })
    }
  }
  const note = (c: Carried) => `From the earlier book "${c.from}": ${c.text.replace(/\s+/g, ' ')}`
  const merge = <T extends { name: string; description: string }>(list: T[], carried: Carried[], make: (c: Carried) => T): T[] => {
    const out = list.map((x) => ({ ...x }))
    for (const c of carried) {
      const own = out.find((x) => sameName(x.name, c.name))
      if (own) own.description = `${own.description.trim()}\n${note(c)}`.trim()
      else out.push(make(c))
    }
    return out
  }
  const mergedChars = merge(characters, [...carriedChars.values()], (c) => ({ name: c.name, description: note(c), voice: c.voice ?? '' }))
  const mergedPlaces = merge(places, [...carriedPlaces.values()], (c) => ({ name: c.name, description: note(c) }))
  const names = [...carriedChars.values(), ...carriedPlaces.values()].map((c) => c.name)
  if (names.length) log(`carried over from the earlier books of the series: ${names.join(', ')}`)
  return { characters: mergedChars, places: mergedPlaces }
}
