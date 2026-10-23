import type { Bible } from '../memory/bible'
import type { BookStore } from './books'
import { loadChoicesSection } from './prompts'
import { bibleEntriesOf, clip, headTail, sameName, summariesOf } from './series'

/**
 * Adapting a book: a story with `source_book` turns a published prose book into a visual novel script. The agents of its
 * pitch, outline, draft, rewrite and review get a section about the source, built here. Everything is bounded, like the
 * series section, so a long source never fills the prompt.
 */

type Deps = { books: BookStore; bible: Bible }

/** The parts of the digest, in characters. */
const PITCH_CHARS = 2500
const BLURB_CHARS = 1200
const OUTLINE_CHARS = 12000
const OUTLINE_PER_CHAPTER = 500
const SUMMARY_CHARS = 9000
const BIBLE_CHARS = 9000
/** The cast the bible of the script is seeded with, at most. */
const MAX_CAST = 20
const MAX_PLACES = 15
/** One carried entry: the start (the looks) and the end (the latest state). */
const ENTRY_HEAD = 450
const ENTRY_TAIL = 650
/** Without a known context window, the source chapters of one script chapter get this many tokens at most. */
const DEFAULT_EXCERPT_TOKENS = 20000
/** The share of the model's window the source chapters may take. */
const EXCERPT_SHARE = 0.3

export interface SourceBook {
  slug: string
  title: string
  genre: string
  format: string
  blurb: string
  /** The chapters of the source book that exist now. */
  chapterCount: number
}

/**
 * A visual novel script is about this many times the words of the prose it adapts: dialogue lines, one speaker each, and the scene and cue lines
 * add to the story (the hub's 5,900-word short story came out at 10,212 words in six chapters, 1.7 times).
 */
export const ADAPT_WORD_FACTOR = 1.7

/**
 * The length an adaptation is meant to have: the source's words times `ADAPT_WORD_FACTOR`, within the format's range. Only for a visual novel script
 * (a screenplay is held to its runtime, not its words). Null when the source has no words or the format is not a visual novel.
 */
export function adaptTargetWords(sourceWords: number, fmt: { words: [number, number]; script?: boolean; screenplay?: boolean }): number | null {
  if (!fmt.script || fmt.screenplay || !(sourceWords > 0)) return null
  return Math.min(fmt.words[1], Math.max(fmt.words[0], Math.round(sourceWords * ADAPT_WORD_FACTOR)))
}

/** The book a book adapts (its `source_book`), or null when it adapts none or the source is no longer in the library. */
export async function sourceOf(d: { books: BookStore }, slug: string): Promise<SourceBook | null> {
  const src = (await d.books.read(slug))?.data.source_book
  if (!src) return null
  const b = await d.books.read(src)
  if (!b) return null
  const data = b.data as Record<string, unknown>
  return {
    slug: src,
    title: b.data.title,
    genre: b.data.genre,
    format: b.data.format,
    blurb: typeof data.blurb === 'string' ? data.blurb.trim() : '',
    chapterCount: (await d.books.chapters(src)).length
  }
}

/** The slugs that must not count in the pitch similarity check of an adaptation: the source and the other adaptations of it. Empty for a book that adapts none. */
export async function adaptationFamily(d: { books: BookStore }, slug: string): Promise<string[]> {
  const src = (await d.books.read(slug))?.data.source_book
  if (!src) return []
  const out = [src]
  for (const s of await d.books.slugs()) if (s !== slug && (await d.books.read(s))?.data.source_book === src) out.push(s)
  return out
}

/** The line every reviewer gets: the book is an authorised adaptation, so likeness to its source is not a fault. */
export const adaptReviewNote = (title: string, screenplay = false): string =>
  screenplay
    ? `This screenplay is an authorised adaptation of the owner's own book "${title}". Its story, characters, names, places and ending come from that book on purpose: do not report likeness to the source as copying, plagiarism or lack of originality. Judge the screenplay as a screenplay: how faithful it is to the source, and how well it works as a short film (clear shots, spoken words that fit them, a runtime that fits the format).`
    : `This script is an authorised adaptation of the owner's own book "${title}". Its story, characters, names, places and ending come from that book on purpose: do not report likeness to the source as copying, plagiarism or lack of originality. Judge the script as a script: how faithful it is to the source, and how well it works as a visual novel.`

const intro: Record<string, (s: SourceBook, fmtName: string) => string> = {
  pitch: (s, f) =>
    `The owner wrote the book "${s.title}" and wants it as a ${f}: a script that a visual novel is built from. This is an authorised adaptation of the owner's own book, not a new story. Write the pitch of the visual novel version: keep the source's characters (names and looks), setting, plot and ending, and say how the story is told as a visual novel (what is shown, what is cut or merged). Where the instructions above ask for something original, originality here means the script form: do not invent a new premise, new characters or a new ending.`,
  outline: (s, f) =>
    `The owner wrote the book "${s.title}" (${s.chapterCount} chapters) and wants it as a ${f}. This is an authorised adaptation of the owner's own book, not a new story. Compress the source into the chapter range of this format: each chapter of the script is made from one or more chapters of the source, taken in order, and together they cover the whole story from its start to its ending. Keep the source's characters, names, places, order of events and ending; cut what pictures and short lines cannot carry (inner monologue, long description, side threads that do not change the story). For every chapter of the script, add "source_chapters": the numbers of the source chapters it is made from, like [1, 2], and make sure every source chapter number is in at least one script chapter. Seed the characters and places from the source below, keep their looks exactly (age, build, face, hair, eyes, skin, clothes and colours), because an artist draws from them, and give a look to any character or place the source leaves undrawn. If the source calls a character by another name (a nickname, a title, a description used before the name is known), put it in that character's aliases, and never give that person a second entry.`,
  review: (s) => adaptReviewNote(s.title),
  draft: (s, f) =>
    `This chapter adapts the owner's own book "${s.title}" into a ${f}. This is an authorised adaptation. The chapters of the source this chapter is made from are given in full below. Turn them into script scenes: keep the events, their order, the names, the places and the points of the dialogue that matter (shortened to fit a text box), and the feeling of each scene; cut inner monologue and description that a picture can show; do not copy the source sentence by sentence; do not add plot the source does not have. Use the picture and sound lines of the script format: a CG for the source's key moments, an INSERT for the letters and objects the story turns on. Follow the script format above for every line.`,
  rewrite: (s, f) =>
    `This chapter adapts the owner's own book "${s.title}" into a ${f}. This is an authorised adaptation. The chapters of the source this chapter is made from are given in full below: when you fix the chapter, keep it faithful to them (events, order, names, places, the points of the dialogue that matter) and do not add plot the source does not have. Keep the CG, INSERT, SFX and AMBIENCE lines unless a note asks you to change them.`
}

/** The intros for a screenplay (a `screenplay: true` format): the same tasks, the medium is a short film. */
const introScreenplay: Record<string, (s: SourceBook, fmtName: string) => string> = {
  pitch: (s, f) =>
    `The owner wrote the book "${s.title}" and wants it as a ${f}: a screenplay that a short video is made from. This is an authorised adaptation of the owner's own book, not a new story. Write the pitch of the film version: keep the source's characters (names and looks), setting, plot and ending, and say how the story is told in a few minutes of moving pictures (what is shown, what a narrator says, what is cut or merged). Where the instructions above ask for something original, originality here means the film form: do not invent a new premise, new characters or a new ending.`,
  outline: (s, f) =>
    `The owner wrote the book "${s.title}" (${s.chapterCount} chapters) and wants it as a ${f}. This is an authorised adaptation of the owner's own book, not a new story. Compress the source into the chapter range and the runtime of this format: each chapter of the screenplay is a sequence of the film, made from one or more chapters of the source taken in order, and together they cover the whole story from its start to its ending. Keep the source's characters, names, places, order of events and ending; cut what a few minutes of film cannot carry (inner monologue, long description, side threads that do not change the story). For every chapter, add "source_chapters": the numbers of the source chapters it is made from, like [1, 2], and make sure every source chapter number is in at least one chapter. Seed the characters and places from the source below, keep their looks exactly (age, build, face, hair, eyes, skin, clothes and colours), because a picture is made from them, and give a look to any character or place the source leaves undrawn.`,
  review: (s) => adaptReviewNote(s.title, true),
  draft: (s, f) =>
    `This chapter adapts the owner's own book "${s.title}" into a ${f}. This is an authorised adaptation. The chapters of the source this chapter is made from are given in full below. Turn them into screenplay scenes and shots: keep the events, their order, the names, the places and the points of the dialogue that matter (shortened to what fits a shot), and the feeling of each scene; show in pictures what the source tells, put a short voice-over where a picture cannot carry it, cut inner monologue; do not copy the source sentence by sentence; do not add plot the source does not have. Keep to the runtime of this chapter. Follow the screenplay format above for every line.`,
  rewrite: (s, f) =>
    `This chapter adapts the owner's own book "${s.title}" into a ${f}. This is an authorised adaptation. The chapters of the source this chapter is made from are given in full below: when you fix the chapter, keep it faithful to them (events, order, names, places, the points of the dialogue that matter) and do not add plot the source does not have. Keep the SHOT, MUSIC, SFX and TITLE lines unless a note asks you to change them.`
}

/** The source chapter numbers an outline's chapters map to: out-of-range numbers are dropped, and a chapter with none gets an even share of the source. */
export function normalizeSourceChapters(lists: (number[] | undefined)[], sourceCount: number): { mapped: number[][]; filled: number } {
  const count = lists.length
  let filled = 0
  const mapped = lists.map((l, i) => {
    const ok = [...new Set((l ?? []).map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= 1 && x <= sourceCount))].sort((a, b) => a - b)
    if (ok.length || sourceCount === 0) return ok
    filled++
    const from = Math.floor((i * sourceCount) / count) + 1
    const to = Math.max(from, Math.floor(((i + 1) * sourceCount) / count))
    return Array.from({ length: to - from + 1 }, (_, j) => from + j)
  })
  return { mapped, filled }
}

/** Source chapter numbers that no chapter of the script covers. */
export const uncovered = (mapped: number[][], sourceCount: number): number[] => {
  const seen = new Set(mapped.flat())
  return Array.from({ length: sourceCount }, (_, i) => i + 1).filter((n) => !seen.has(n))
}

/** The full text of the source chapters script chapter `n` is made from, cut to fit the writer's window when needed. Empty when nothing is mapped. */
export async function sourceExcerpt(
  d: { books: BookStore; contextTokens: (role: string) => number | undefined },
  slug: string,
  n: number,
  role = 'writer',
  log: (m: string) => void = () => {}
): Promise<string> {
  const src = await sourceOf(d, slug)
  if (!src) return ''
  const entry = (await d.books.outline(slug))?.chapters.find((c) => c.n === n)
  const nums = entry?.source_chapters ?? []
  if (!nums.length) return ''
  const chapters = (await d.books.chapters(src.slug)).filter((c) => nums.includes(c.n))
  if (!chapters.length) return ''
  const window = d.contextTokens(role)
  const budget = Math.floor((window ? window * EXCERPT_SHARE : DEFAULT_EXCERPT_TOKENS) * 4)
  const total = chapters.reduce((s, c) => s + c.body.length, 0)
  const each = Math.floor(budget / chapters.length)
  if (total > budget) log(`the source chapters ${nums.join(', ')} (${Math.round(total / 4)} tokens) are cut to fit the window (${Math.round(budget / 4)} tokens)`)
  return chapters
    .map((c) => `### Source chapter ${c.n}: ${c.title}\n\n${c.body.length > each ? cutMiddle(c.body, each) : c.body}`)
    .join('\n\n')
}

/** Keeps the start and the end of a text and says what was left out. */
function cutMiddle(text: string, max: number): string {
  const note = '\n\n[... the middle of this chapter is left out to fit the window ...]\n\n'
  const room = Math.max(200, max - note.length)
  return `${text.slice(0, Math.floor(room * 0.65)).trimEnd()}${note}${text.slice(-Math.floor(room * 0.35)).trimStart()}`
}

/** The bible of the source as lines for the prompt: characters first (looks first in each entry), then places. */
async function bibleDigest(d: Deps, slug: string): Promise<string> {
  const entries = (await bibleEntriesOf(d, slug)).filter((e) => e.group === 'characters' || e.group === 'places')
  if (!entries.length) return ''
  const each = Math.max(250, Math.min(1100, Math.floor(BIBLE_CHARS / entries.length)))
  const line = (e: (typeof entries)[number]) => `- ${e.name}${e.voice ? ` (voice: ${e.voice})` : ''}: ${headTail(e.text.replace(/\s+/g, ' '), Math.floor(each * 0.65), Math.floor(each * 0.35))}`
  const chars = entries.filter((e) => e.group === 'characters').map(line)
  const places = entries.filter((e) => e.group === 'places').map(line)
  return [chars.length ? `Characters:\n${chars.join('\n')}` : '', places.length ? `Places:\n${places.join('\n')}` : ''].filter(Boolean).join('\n\n')
}

/** The source's outline, one line per chapter, within a total size. */
async function outlineDigest(d: { books: BookStore }, slug: string): Promise<string> {
  const chapters = (await d.books.outline(slug))?.chapters ?? []
  if (!chapters.length) return ''
  const each = Math.max(120, Math.min(OUTLINE_PER_CHAPTER, Math.floor(OUTLINE_CHARS / chapters.length)))
  return chapters.map((c) => `${c.n}. ${c.title}: ${clip(c.summary.replace(/\s+/g, ' '), each)}`).join('\n')
}

/** How the chapters of the script map to the chapters of the source, one line each. */
async function mappingLines(d: { books: BookStore }, slug: string): Promise<string> {
  const chapters = (await d.books.outline(slug))?.chapters ?? []
  return chapters.filter((c) => c.source_chapters?.length).map((c) => `- Chapter ${c.n} (${c.title}) is made from source chapter(s) ${c.source_chapters!.join(', ')}`).join('\n')
}

export type AdaptTask = 'pitch' | 'outline' | 'draft' | 'rewrite' | 'review'

/**
 * The adaptation of a book as prompt text, for the architect (`pitch`, `outline`: the source's pitch, blurb, outline, act and
 * chapter summaries and the digest of its bible), the writer (`draft`, `rewrite`: the instruction; the source chapters come
 * from `sourceExcerpt`) and the reviewers (`review`: the authorised-adaptation line and the mapping). Empty when the book adapts none.
 */
export async function adaptSection(d: Deps, slug: string, task: AdaptTask = 'outline', opts: { formatName?: string } = {}): Promise<string> {
  const src = await sourceOf(d, slug)
  if (!src) return ''
  // a screenplay (a short film) is told apart by the book's own flag
  const screenplay = (await d.books.read(slug))?.data.screenplay === true
  const fmtName = opts.formatName ?? (screenplay ? 'short film' : 'visual novel')
  const parts = [`## The book this ${screenplay ? 'screenplay' : 'script'} adapts`, (screenplay ? introScreenplay : intro)[task]!(src, fmtName)]
  if (task === 'draft' || task === 'rewrite') return parts.join('\n\n')
  if (task === 'review') {
    const map = await mappingLines(d, slug)
    if (map) parts.push(`How the chapters map to the source:\n${map}`)
    return parts.join('\n\n')
  }
  // pitch and outline: the digest of the source
  const head = [`### The source book: ${src.title} (${src.format}, ${src.chapterCount} chapter(s), genre: ${src.genre || 'none'})`]
  const pitch = (await d.books.pitch(src.slug)) ?? ''
  if (pitch) head.push(`Pitch:\n${clip(pitch, PITCH_CHARS)}`)
  if (src.blurb) head.push(`Blurb: ${clip(src.blurb, BLURB_CHARS)}`)
  parts.push(head.join('\n\n'))
  const outline = await outlineDigest(d, src.slug)
  if (outline) parts.push(`### The source outline\n${outline}`)
  const summaries = await summariesOf(d, src.slug, SUMMARY_CHARS)
  // a short book has no summaries: summariesOf then returns its pitch, which is above already
  if (summaries && summaries !== clip(pitch, SUMMARY_CHARS)) parts.push(`### What happens in the source (act and chapter summaries)\n${summaries}`)
  const bible = await bibleDigest(d, src.slug)
  if (bible) parts.push(`### The source's characters and places\n${bible}`)
  return parts.join('\n\n')
}

type OutlineCharacter = { name: string; description: string; voice: string; aliases?: string[] }
type OutlinePlace = { name: string; description: string }

/**
 * Seeds the bible of an adaptation with the characters and places of the source's bible (long or light), looks kept. A name the
 * architect already has gets the source's text added to its description; the others are added as they are. The cast is capped.
 */
export async function withSourceBible(
  d: Deps,
  slug: string,
  characters: OutlineCharacter[],
  places: OutlinePlace[],
  log: (m: string) => void
): Promise<{ characters: OutlineCharacter[]; places: OutlinePlace[] }> {
  const src = await sourceOf(d, slug)
  if (!src) return { characters, places }
  const entries = await bibleEntriesOf(d, src.slug)
  // the source's `Aliases:` sentence is not copied into the description: its names go into the character's aliases (and the engine writes one sentence)
  const note = (text: string) => `From the source book "${src.title}": ${headTail(text.replace(/\s*\b(?:aliases|alias)\s*:[^.\n]*\.?/gi, '').replace(/\s+/g, ' '), ENTRY_HEAD, ENTRY_TAIL)}`
  const seen = new Set<string>()
  const merge = <T extends { name: string; description: string }>(list: T[], group: string, max: number, make: (e: (typeof entries)[number]) => T): T[] => {
    const out = list.map((x) => ({ ...x }))
    let added = 0
    for (const e of entries.filter((x) => x.group === group)) {
      const own = out.find((x) => sameName(x.name, e.name))
      if (own) {
        own.description = `${own.description.trim()}\n${note(e.text)}`.trim()
        seen.add(e.name)
      } else if (added < max) {
        out.push(make(e))
        added++
        seen.add(e.name)
      }
    }
    return out
  }
  // the source's other names for a person (its `Aliases:` or `aliases`) go into the script character's aliases, after the architect's
  const mergedChars = merge<OutlineCharacter>(characters, 'characters', MAX_CAST, (e) => ({ name: e.name, description: note(e.text), voice: e.voice })).map((c) => {
    const src = entries.find((e) => e.group === 'characters' && sameName(e.name, c.name))
    return src?.aliases.length ? { ...c, aliases: [...(c.aliases ?? []), ...src.aliases] } : c
  })
  const mergedPlaces = merge(places, 'places', MAX_PLACES, (e) => ({ name: e.name, description: note(e.text) }))
  if (seen.size) log(`carried over from the source book "${src.title}": ${[...seen].join(', ')}`)
  return { characters: mergedChars, places: mergedPlaces }
}

/** What the outline of a story with choices must do with the source's ending: it stays as one canon path. */
export const CANON_PATH_DEFAULT =
  'This story with choices adapts a book that has one ending. Keep the source book as the canon path: one route through the map follows the source in order from its first chapter to its own ending, with the same events and the same ending. The other routes branch off that story with choices that matter and end in endings of their own, but the canon path is plain: mark its ending in "ending" as "canon: " followed by how the source ends, and let the source chapters stay in order along it (the "source_chapters" of the later chapters are never lower than those before them on the canon path).'

/** The `## adapt` section of prompts/_choices.md, or the built-in text when the data folder's file has none. */
export async function canonPathNote(dataDir: string): Promise<string> {
  return (await loadChoicesSection(dataDir, 'adapt')) || CANON_PATH_DEFAULT
}
