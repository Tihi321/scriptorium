/** Stories with choices: the reader picks what happens at the end of a chapter, and each choice leads to a later chapter. */

export interface Choice {
  text: string
  /** The chapter this choice leads to. */
  to: number
}

export interface BranchChapter {
  n: number
  title: string
  summary: string
  /** The choices at the end of the chapter. None: the chapter is an ending. */
  choices?: Choice[]
  /** For an ending: a few words on how it ends. */
  ending?: string
  /** An adaptation: the chapters of the source book this chapter is made from. */
  source_chapters?: number[]
}

/** At most this many choices end a chapter. */
export const MAX_CHOICES = 3

/**
 * Cleans the chapter map of a story with choices and checks it can be read: a choice leads to a later chapter
 * (bad ones are dropped), a chapter without choices is an ending, every chapter is reached from chapter 1,
 * there are at least two endings and at least one real choice. Throws with the reason when the map is broken.
 */
export function checkBranches(chapters: BranchChapter[]): BranchChapter[] {
  const count = chapters.length
  const out = chapters.map((c): BranchChapter => {
    const seen = new Set<number>()
    const choices: Choice[] = []
    for (const ch of c.choices ?? []) {
      const to = Math.round(Number(ch.to))
      const text = String(ch.text ?? '').replace(/\s+/g, ' ').trim()
      if (!text || !Number.isFinite(to) || to <= c.n || to > count || seen.has(to)) continue
      seen.add(to)
      choices.push({ text, to })
    }
    const { choices: _c, ending: _e, ...rest } = c
    return choices.length ? { ...rest, choices: choices.slice(0, MAX_CHOICES) } : { ...rest, ending: c.ending?.trim() || 'an ending' }
  })
  const reached = new Set([1])
  for (const c of out) if (reached.has(c.n)) for (const ch of c.choices ?? []) reached.add(ch.to)
  const lost = out.filter((c) => !reached.has(c.n)).map((c) => c.n)
  if (lost.length) throw new Error(`no choice leads to chapter(s) ${lost.join(', ')}: every chapter but the first must be reached by a choice from an earlier chapter`)
  if (out.filter((c) => !c.choices).length < 2) throw new Error('the story with choices needs at least two endings (chapters without choices)')
  if (!out.some((c) => (c.choices?.length ?? 0) >= 2)) throw new Error('the story with choices has no chapter that ends with two or more choices')
  return out
}

/** True when the outline's chapters carry choices (a story with choices). */
export const isBranching = (chapters: BranchChapter[]) => chapters.some((c) => (c.choices?.length ?? 0) > 0)

/** The chapters a reader can pass through before chapter `n` (every chapter with a path to it). */
export function ancestors(chapters: BranchChapter[], n: number): Set<number> {
  const found = new Set<number>()
  const todo = [n]
  while (todo.length) {
    const at = todo.pop()!
    for (const c of chapters) {
      if (!found.has(c.n) && c.choices?.some((ch) => ch.to === at)) {
        found.add(c.n)
        todo.push(c.n)
      }
    }
  }
  return found
}

/** The choices that lead into chapter `n`. */
export function waysIn(chapters: BranchChapter[], n: number): { from: number; text: string }[] {
  return chapters.flatMap((c) => (c.choices ?? []).filter((ch) => ch.to === n).map((ch) => ({ from: c.n, text: ch.text })))
}

/** One line on how a chapter ends: its choices, or that it is an ending. For outlines and the text reviewers read. */
export function endLine(c: Pick<BranchChapter, 'choices' | 'ending'>): string {
  return c.choices?.length ? `Choices: ${c.choices.map((ch) => `"${ch.text}" (to chapter ${ch.to})`).join('; ')}` : `An ending: ${c.ending || 'the story ends here'}`
}

/** What the writer needs to know about one chapter of a story with choices. */
export function chapterPlace(chapters: BranchChapter[], n: number): { ways_in: string; ways_out: string } {
  const c = chapters.find((x) => x.n === n)
  const ins = waysIn(chapters, n)
  return {
    ways_in: n === 1 ? 'This is chapter 1: every reader starts here.' : `Readers come into this chapter from: ${ins.map((i) => `chapter ${i.from}, after choosing "${i.text}"`).join('; ')}.`,
    ways_out: c?.choices?.length
      ? `This chapter ends with a choice. The reader will pick one of: ${c.choices.map((ch) => `"${ch.text}"`).join(', ')}.`
      : `This chapter is an ending (${c?.ending || 'the story ends here'}).`
  }
}
