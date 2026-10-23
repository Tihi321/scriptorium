import { parseMd } from '../../shared/md'
import { parsePuzzleEntries } from '../../shared/puzzles'
import type { PuzzleEntry } from '../../shared/puzzles'
import { writeMd } from '../store/atomic'
import type { BookStore } from './books'
import { puzzleLineOf } from '../publish/xhtml'
import type { PuzzleView } from '../publish/xhtml'

/**
 * A mystery with puzzles (docs/visual-novel.md "Puzzles"). VN Studio makes each puzzle core; the hub hands it over in the story brief;
 * here it is kept as `bible/puzzles.md`, placed in a chapter by the outline, and told to the writers, who plant its clues and write
 * the `PUZZLE:` line. There is no solver: the engine only checks that every clue is planted in time.
 */

const FILE = ['bible', 'puzzles.md']

/** The puzzles of a book: `bible/puzzles.md`, else the story brief's `puzzles` (the book keeps a copy of the story as brief.md). */
export async function puzzlesOf(d: { books: BookStore }, slug: string): Promise<PuzzleEntry[]> {
  const text = await d.books.readText(slug, ...FILE)
  if (text) {
    const entries = parsePuzzleEntries(parseMd(text).data.puzzles)
    if (entries.length) return entries
  }
  return (await d.books.brief(slug))?.puzzles ?? []
}

/** The ids of the clues of a puzzle: the core's `clues`, else the keys of `text` (the murder note is not a clue). */
export function clueIdsOf(p: PuzzleEntry): string[] {
  const clues = p.core?.clues
  if (Array.isArray(clues)) return clues.map((c) => (c && typeof c === 'object' ? String((c as { id?: unknown }).id ?? '') : '')).filter(Boolean)
  return Object.keys(p.text).filter((k) => k !== 'murder')
}

/** The evidence keys a testimony needs (the ones that break a statement, and the listed items). */
export function evidenceKeysOf(p: PuzzleEntry): string[] {
  const t = p.testimony
  if (!t) return []
  return [...new Set([...t.breaks.map((b) => b.evidence), ...t.evidence.map((e) => e.key)])]
}

const nameOf = (p: PuzzleEntry, id: string) => p.names[id] ?? id

/** The solution of a knights puzzle in words: who is a knight (always tells the truth) and who a knave (always lies). Empty for any other core. */
function knightsWords(p: PuzzleEntry): string {
  if (p.kind !== 'knights' && p.core?.kind !== 'knights') return ''
  const sol = p.core?.solution
  if (!sol || typeof sol !== 'object') return ''
  const parts = Object.entries(sol as Record<string, unknown>)
    .filter(([, v]) => v === 'knight' || v === 'knave')
    .map(([who, v]) => `${nameOf(p, who)} is a ${String(v)}`)
  return parts.length ? `${parts.join(', ')}. A knight always tells the truth and a knave always lies, in every line they speak, also outside the puzzle` : ''
}

/** The solution of a puzzle in words, for the writers (never to be stated before the puzzle). Empty when the core has no answer. */
export function solutionWords(p: PuzzleEntry): string {
  const a = (p.core?.murder as { answer?: Record<string, string> } | undefined)?.answer
  const knights = knightsWords(p)
  if (knights) return knights
  if (!a) return p.testimony ? `${p.testimony.witness}'s statement ${p.testimony.breaks.map((b) => `${b.statement} is broken by the evidence ${b.evidence}`).join('; ')}` : ''
  const parts = Object.entries(a).map(([cat, item]) => `${cat}: ${nameOf(p, item)}`)
  return parts.join(', ')
}

/**
 * The chapter each clue of a puzzle placed in chapter `chapter` is planted in. A Murdle's clues are spread over chapters 1 to `chapter` (a clue is never
 * planted after its puzzle). A puzzle with no `clues` in its core (knights: the `intro` and the statements of the speakers) plants all of them in the
 * puzzle's own chapter: the speakers are in the story from there on, so a statement is never planted before the person who says it appears.
 */
export function clueChapters(p: PuzzleEntry, chapter: number): Record<string, number> {
  const ids = clueIdsOf(p)
  const out: Record<string, number> = {}
  if (!Array.isArray(p.core?.clues)) {
    ids.forEach((id) => (out[id] = chapter))
    return out
  }
  ids.forEach((id, i) => (out[id] = Math.min(chapter, 1 + Math.floor((i * chapter) / ids.length))))
  return out
}

/**
 * The chapter of every puzzle. A chapter the architect named (`wanted`, from the outline) is kept; the others are spread over the later chapters
 * (never chapter 1 when the book has more than one: its clues need earlier chapters), the last puzzle in the last chapter.
 */
export function placePuzzles(puzzles: PuzzleEntry[], chapterCount: number, wanted: Record<string, number | undefined> = {}): PuzzleEntry[] {
  const count = Math.max(1, chapterCount)
  const open = puzzles.filter((p) => !(wanted[p.key] && wanted[p.key]! >= 1 && wanted[p.key]! <= count))
  const auto = new Map<string, number>()
  open.forEach((p, i) => auto.set(p.key, count === 1 ? 1 : Math.max(2, count - Math.floor(((open.length - 1 - i) * (count - 1)) / open.length))))
  return puzzles.map((p) => {
    const chapter = auto.get(p.key) ?? wanted[p.key]!
    return { ...p, chapter, clueAt: clueChapters(p, chapter) }
  })
}

/** The readable body of `bible/puzzles.md`. */
function puzzlesBody(puzzles: PuzzleEntry[]): string {
  const out = ['# Puzzles', '']
  for (const p of puzzles) {
    out.push(`## ${p.title ?? p.key} (${p.key}, ${p.kind}${p.chapter ? `, chapter ${p.chapter}` : ''})`, '')
    const sol = solutionWords(p)
    if (sol) out.push(`The truth: ${sol}.`, '')
    for (const id of clueIdsOf(p)) out.push(`- ${id}${p.clueAt[id] ? ` (chapter ${p.clueAt[id]})` : ''}: ${p.text[id] ?? ''}`)
    if (p.text.murder) out.push(`- murder: ${p.text.murder}`)
    if (p.testimony) out.push('', `Testimony of ${p.testimony.witness}: ${p.testimony.breaks.map((b) => `statement ${b.statement} breaks with ${b.evidence}`).join('; ')}`)
    out.push('')
  }
  return out.join('\n')
}

/** Writes `bible/puzzles.md` (frontmatter `puzzles`, the entries as handed over plus `chapter` and `clueAt`). */
export async function writePuzzles(d: { books: BookStore }, slug: string, puzzles: PuzzleEntry[]): Promise<void> {
  await writeMd(d.books.file(slug, ...FILE), { kind: 'puzzles', puzzles }, '\n' + puzzlesBody(puzzles))
}

/** The title and clue texts of each puzzle for the EPUB and the reader. */
export function puzzleViews(puzzles: PuzzleEntry[]): Record<string, PuzzleView> {
  return Object.fromEntries(puzzles.map((p) => [p.key, { ...(p.title ? { title: p.title } : {}), clues: clueIdsOf(p).map((id) => ({ id, text: p.text[id] ?? '' })).filter((c) => c.text) }]))
}

// ---- the check ----------------------------------------------------------------------------------------------------------

export interface PuzzleProblem {
  /** The chapter to rewrite, or null for the whole book. */
  chapter: number | null
  text: string
}

/**
 * The deterministic check of a puzzle book: each puzzle has one `PUZZLE:` line; every clue of its core is in a `CLUE:` line of that chapter or an
 * earlier one, before the `PUZZLE:` line; no `CLUE:` names a clue the core does not have; the evidence of a testimony is planted before it.
 * The meaning of the prose is not checked here (VN Studio does it at import).
 */
export function puzzleProblems(chapters: { n: number; body: string }[], puzzles: PuzzleEntry[]): PuzzleProblem[] {
  const problems: PuzzleProblem[] = []
  // every puzzle line of the book in reading order, with its chapter
  const lines = chapters
    .slice()
    .sort((a, b) => a.n - b.n)
    .flatMap((c) => c.body.replace(/\r\n/g, '\n').split('\n').map((l) => ({ n: c.n, line: puzzleLineOf(l) })))
    .filter((x) => x.line)
  const keys = new Set(puzzles.map((p) => p.key.toLowerCase()))
  for (const l of lines) {
    if (l.line!.kind === 'clue' && !keys.has(l.line!.puzzle.toLowerCase())) problems.push({ chapter: l.n, text: `chapter ${l.n}: CLUE: ${l.line!.puzzle}/${l.line!.clue} names a puzzle the book does not have (puzzles: ${[...keys].join(', ') || 'none'})` })
    if (l.line!.kind === 'puzzle' && !keys.has(l.line!.puzzle.toLowerCase())) problems.push({ chapter: l.n, text: `chapter ${l.n}: PUZZLE: ${l.line!.puzzle} is not a puzzle of the book (puzzles: ${[...keys].join(', ') || 'none'})` })
  }
  for (const p of puzzles) {
    const key = p.key.toLowerCase()
    const at = lines.map((x, i) => ({ ...x, i })).filter((x) => x.line!.kind === 'puzzle' && (x.line as { puzzle: string }).puzzle.toLowerCase() === key)
    const target = p.chapter ?? null
    if (at.length === 0) {
      problems.push({ chapter: target, text: `puzzle ${p.key}: there is no PUZZLE: ${p.key} line${target ? ` (it belongs in chapter ${target})` : ''}` })
      continue
    }
    if (at.length > 1) problems.push({ chapter: at[1]!.n, text: `puzzle ${p.key}: PUZZLE: ${p.key} is written ${at.length} times (chapters ${at.map((x) => x.n).join(', ')}): one is enough` })
    const first = at[0]!
    const before = lines.slice(0, first.i)
    const planted = new Set(before.filter((x) => x.line!.kind === 'clue' && (x.line as { puzzle: string }).puzzle.toLowerCase() === key).map((x) => (x.line as { clue: string }).clue))
    const ids = clueIdsOf(p)
    const missing = ids.filter((id) => !planted.has(id))
    // the missing clues, one problem for each chapter that was to plant them
    const byChapter = new Map<number, string[]>()
    for (const id of missing) byChapter.set(p.clueAt[id] ?? first.n, [...(byChapter.get(p.clueAt[id] ?? first.n) ?? []), id])
    for (const [chapter, list] of byChapter) {
      problems.push({ chapter, text: `puzzle ${p.key}: chapter ${chapter} must plant the clue(s) ${list.join(', ')} as CLUE: ${p.key}/<id>: lines (before PUZZLE: ${p.key} in chapter ${first.n})` })
    }
    for (const x of lines) {
      if (x.line!.kind === 'clue' && (x.line as { puzzle: string }).puzzle.toLowerCase() === key && !ids.includes((x.line as { clue: string }).clue)) {
        problems.push({ chapter: x.n, text: `chapter ${x.n}: CLUE: ${p.key}/${(x.line as { clue: string }).clue} is not a clue of the puzzle (clues: ${ids.join(', ')})` })
      }
    }
    // a testimony needs its evidence planted before it
    for (const ev of evidenceKeysOf(p)) {
      const seen = before.some((x) => x.line!.kind === 'evidence' && (x.line as { key: string }).key.toLowerCase() === ev.toLowerCase())
      if (!seen) problems.push({ chapter: first.n, text: `puzzle ${p.key}: the evidence ${ev} is not planted as EVIDENCE: ${ev}: before PUZZLE: ${p.key} (chapter ${first.n})` })
    }
    if (p.testimony && !before.some((x) => x.line!.kind === 'testimony')) {
      // the TESTIMONY: block comes with the puzzle line (before or in the same chapter)
      const any = lines.some((x) => x.line!.kind === 'testimony')
      if (!any) problems.push({ chapter: first.n, text: `puzzle ${p.key}: there is no TESTIMONY: ${p.testimony.witness} block` })
    }
  }
  return problems
}

/** The puzzle lines of a chapter, as written (whitespace folded), for the humanizer guard: they must not change in any word. */
export function puzzleLinesOf(body: string): string[] {
  return body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => puzzleLineOf(l))
    .map((l) => l.trim().replace(/\s+/g, ' '))
}

// ---- prompt sections ----------------------------------------------------------------------------------------------------

const FORMAT_LINES = [
  'Lines of a puzzle, each on its own line:',
  'CLUE: <puzzle>/<id>: <clue as prose>',
  'EVIDENCE: <key>: <what the item is>',
  'PUZZLE: <puzzle>',
  'TESTIMONY: <witness>',
  'END TESTIMONY'
].join('\n')

/** What every writer of a puzzle book is told, once. */
const RULES = [
  'This book is a mystery with puzzles. Code made each puzzle: its solution and its clues are fixed, and you only tell them as a story.',
  '- A clue line says exactly what the canonical sentence of that clue says: the same people, things and places, no more and no less. Do not change a name, drop an option ("either ... or"), turn a "not" into a "was", or add a hint that makes another clue true.',
  '- Write each clue line in the story\'s own words and voice (a character notices it, says it, reads it), always with the names the list gives.',
  '- Plant every clue before the PUZZLE line of its puzzle, in the chapter the list names, each on its own line. The PUZZLE line goes where the player stops to solve it: never the last line of a scene.',
  '- The facts of the story follow the truth of the puzzle: the culprit, the weapon and the place. Never state the answer before the puzzle, and never contradict it.',
  '- EVIDENCE: a thing the player can pick up (a letter, a watch, a photo). A testimony needs its evidence planted before the TESTIMONY line.',
  '- TESTIMONY: a witness speaks short statements, one speaker line each, in order, then END TESTIMONY. A statement may be true or false as the list says.',
  '- Write the lines exactly in the form above (ids as given, no spaces in them). Do not write CG:, INSERT: or AMBIENCE: lines for a clue.'
].join('\n')

const nice = (p: PuzzleEntry) => `${p.title ?? p.key} (key ${p.key}, ${p.kind})`

/** The names a puzzle uses, as a legend. */
function legend(p: PuzzleEntry): string {
  const names = Object.entries(p.names)
  return names.length ? `Names: ${names.map(([, n]) => n).join(', ')}.` : ''
}

/** The architect's section: which puzzles the book has, and that the outline places them. */
export function puzzlesOutlineSection(puzzles: PuzzleEntry[], chapters: [number, number]): string {
  if (!puzzles.length) return ''
  const list = puzzles.map((p) => `- ${nice(p)}: the truth is ${solutionWords(p) || 'in its testimony'}; ${clueIdsOf(p).length} clue(s)${p.testimony ? `, a testimony of ${p.testimony.witness}` : ''}. ${legend(p)}`).join('\n')
  return `## Puzzles of this book

This book is a mystery with puzzles. Code made these puzzles; their solutions are fixed. The story must lead to each of them and its facts must agree with the truth below.

${list}

Place every puzzle in one chapter with "puzzles": ["<key>"] on that chapter in the JSON (a chapter may have none, one or two). Never put a puzzle in chapter 1 (the chapters before it plant its clues), and keep the puzzles apart: the story goes on between them. The characters and places of the story use the names above. A clue is found by what a character sees, hears or is told: say in each chapter summary what is found. The people who speak the statements of a knights puzzle appear in that puzzle's chapter or earlier, and their statements are planted in that chapter. The book has ${chapters[0]} to ${chapters[1]} chapters.`
}

/** The writer's section for chapter `n`: the rules, the puzzles placed here, the clues to plant here and the evidence. */
export function puzzlesChapterSection(puzzles: PuzzleEntry[], n: number, chapterCount: number): string {
  if (!puzzles.length) return ''
  const here = puzzles.filter((p) => p.chapter === n)
  const plant = puzzles.flatMap((p) => clueIdsOf(p).filter((id) => (p.clueAt[id] ?? Math.min(p.chapter ?? chapterCount, 1)) === n).map((id) => ({ p, id })))
  const parts = ['## Puzzles in this chapter', RULES, FORMAT_LINES]
  if (plant.length) {
    parts.push(`Plant these clues in this chapter, each as one CLUE line (the sentence is what it must mean):\n${plant.map(({ p, id }) => `- ${p.key}/${id}: ${p.text[id] ?? ''}`).join('\n')}`)
  }
  for (const p of here) {
    const lines = [`Puzzle ${nice(p)} is solved at the end of this chapter: write the line PUZZLE: ${p.key} where the player stops to solve it, after all its clues. The truth: ${solutionWords(p) || 'see the testimony'}. Keep every line of the prose true to it, but do not state it or hint at it before the PUZZLE line. ${legend(p)}`]
    if (p.text.murder) lines.push(`The note of the puzzle: ${p.text.murder}`)
    if (p.testimony) {
      lines.push(`Testimony of ${p.testimony.witness}: write TESTIMONY: ${p.testimony.witness}, the statements, END TESTIMONY, then the PUZZLE line. Statement ${p.testimony.breaks.map((b) => `${b.statement} is broken by the evidence "${b.evidence}"`).join('; ')}: it must be a lie or a mistake that this evidence shows. Plant the evidence before: ${evidenceKeysOf(p).map((k) => `EVIDENCE: ${k}: ${p.testimony!.evidence.find((e) => e.key === k)?.description ?? ''}`).join(' | ')}`)
    }
    parts.push(lines.join('\n'))
  }
  // a puzzle solved in an earlier chapter: its answer is now known to the story, and the prose must not contradict it
  for (const p of puzzles.filter((x) => x.chapter !== undefined && x.chapter < n && solutionWords(x))) {
    parts.push(`Puzzle ${nice(p)} was solved in chapter ${p.chapter}. The truth, which the story now knows and must never contradict: ${solutionWords(p)}. ${legend(p)}`)
  }
  if (!plant.length && !here.length) parts.push('No clue of a puzzle is planted in this chapter, and no puzzle is solved: write the story as the outline says. Earlier CLUE lines stay as they are.')
  return parts.join('\n\n')
}

/** For every reviewer of a puzzle book. */
export const PUZZLE_REVIEW_NOTE =
  'Lines that start with CLUE:, EVIDENCE:, PUZZLE: or TESTIMONY:, and END TESTIMONY lines, belong to the book\'s logic puzzles. They are made and checked by code: do not review them as prose and do not ask for changes in their form or ids. A clue line should read naturally in the story. Judge whether the mystery is fair: the clues are found in the story before the puzzle, and the story does not give the answer away. The CLUE lines are fixed puzzle clues, proved solvable by code: never report one as a contradiction (of another clue, of the prose or of itself) and never ask for one to be changed. Clues that look as if they clash, or that say "either ... or", are expected: that is the deduction. Two clues that seem to put one object or person in two places are the puzzle, not a continuity error.'

/**
 * Review problems that ask to change a puzzle clue or call it a contradiction (`winter_garden/c3`, "clue c3", "CLUE:" with "change", "contradicts" ...).
 * The clues are fixed by the puzzle core, so the continuity review drops such a problem: a rewrite could only break the puzzle.
 */
export function dropClueChangeProblems(problems: string[], puzzles: PuzzleEntry[]): { kept: string[]; dropped: string[] } {
  const ids = [...new Set(puzzles.flatMap((p) => clueIdsOf(p)))]
  const keys = puzzles.map((p) => p.key)
  const alt = (list: string[]) => (list.length ? list.map((x) => x.replace(/[^A-Za-z0-9_-]/g, '')).join('|') : '(?!)')
  const ref = new RegExp(`\\b(?:${alt(keys)})/(?:${alt(ids)})\\b|\\bclues?\\s+\\W?(?:${alt(ids)})\\b|\\bCLUE:`, 'i')
  const asks = /\b(chang\w*|alter\w*|reword\w*|rewrit\w*|replac\w*|remov\w*|contradict\w*|conflict\w*|clash\w*|inconsisten\w*|cannot both|can't both|both hold|break\w*)\b/i
  const kept: string[] = []
  const dropped: string[] = []
  for (const x of problems) (ref.test(x) && asks.test(x) ? dropped : kept).push(x)
  return { kept, dropped }
}

/** For the humanizer of a puzzle book. */
export const PUZZLE_HUMANIZER_NOTE =
  'Keep every CLUE, EVIDENCE, PUZZLE, TESTIMONY and END TESTIMONY line exactly as it is, word for word and in the same place: they are made by code, and a changed word changes the puzzle. The statements of a testimony keep their meaning and their order.'
