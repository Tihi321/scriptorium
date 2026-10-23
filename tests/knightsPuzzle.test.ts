import { describe, expect, it } from 'vitest'
import { clueChapters, clueIdsOf, dropClueChangeProblems, placePuzzles, PUZZLE_REVIEW_NOTE, puzzlesChapterSection, puzzlesOutlineSection, solutionWords } from '../src/engine/pipeline/puzzles'
import { parsePuzzleEntries } from '../src/shared/puzzles'
import type { PuzzleEntry } from '../src/shared/puzzles'

/** The knights core of the hub's `the-winter-garden-clock` (VN Studio seed 55): Anselm is the knight, Tobias and Odile are knaves. */
const BELFRY: PuzzleEntry = parsePuzzleEntries([
  {
    key: 'belfry',
    kind: 'knights',
    title: 'The Three Keepers',
    core: {
      format: 1,
      kind: 'knights',
      size: 3,
      speakers: ['k1', 'k2', 'k3'],
      statements: [
        { id: 't1', speaker: 'k3', claim: { type: 'all_knight', of: ['k1', 'k3'] } },
        { id: 't2', speaker: 'k2', claim: { type: 'knight', who: 'k3' } },
        { id: 't3', speaker: 'k1', claim: { type: 'knave', who: 'k2' } }
      ],
      solution: { k1: 'knight', k2: 'knave', k3: 'knave' }
    },
    names: { k1: 'Brother Anselm', k2: 'Brother Tobias', k3: 'Sister Odile' },
    text: {
      intro: 'In the belfry, the keepers sworn to the Struck Hour always tell the truth (knights) and the others always lie (knaves).',
      t1: 'Sister Odile says: "Brother Anselm and I are both knights."',
      t2: 'Brother Tobias says: "Sister Odile is a knight."',
      t3: 'Brother Anselm says: "Brother Tobias is a knave."'
    }
  }
])[0]!

/** A Murdle with a `clues` array, for the contrast and the clue filter. */
const MURDLE: PuzzleEntry = parsePuzzleEntries([
  {
    key: 'winter_garden',
    kind: 'murdle',
    core: { format: 1, kind: 'murdle', clues: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }, { id: 'c5' }], murder: { answer: { suspect: 's2' } } },
    names: { s2: 'Madame Verac' },
    text: { c1: 'x', c2: 'x', c3: 'Remy Castel had either the clock or the cord.', c4: 'x', c5: 'Madame Verac had the clock.' }
  }
])[0]!

describe('SCP-30: the statements of a knights puzzle go to the puzzle chapter', () => {
  it('plants the intro and every statement in the puzzle chapter, never before the keepers appear', () => {
    expect(clueIdsOf(BELFRY)).toEqual(['intro', 't1', 't2', 't3'])
    expect(clueChapters(BELFRY, 3)).toEqual({ intro: 3, t1: 3, t2: 3, t3: 3 })
    // the outline of the hub's book: the knights puzzle in chapter 3 of 4
    const placed = placePuzzles([BELFRY], 4, { belfry: 3 })[0]!
    expect(placed.chapter).toBe(3)
    expect(placed.clueAt).toEqual({ intro: 3, t1: 3, t2: 3, t3: 3 })
  })

  it('writers of chapters 1 and 2 are not asked to plant a statement; the writer of chapter 3 is', () => {
    const placed = placePuzzles([BELFRY], 4, { belfry: 3 })
    for (const n of [1, 2]) {
      const section = puzzlesChapterSection(placed, n, 4)
      expect(section).not.toContain('belfry/t1')
      expect(section).not.toContain('belfry/intro')
    }
    const ch3 = puzzlesChapterSection(placed, 3, 4)
    for (const id of ['intro', 't1', 't2', 't3']) expect(ch3).toContain(`- belfry/${id}:`)
    expect(puzzlesOutlineSection(placed, [3, 8])).toContain('statements are planted in that chapter')
  })

  it('a Murdle still spreads its clues over the chapters before its puzzle', () => {
    expect(clueChapters(MURDLE, 3)).toEqual({ c1: 1, c2: 1, c3: 2, c4: 2, c5: 3 })
  })
})

describe('SCP-31: the writer is told who is a knight and who a knave', () => {
  it('says the solution in words, with the rule that a knave lies in every line', () => {
    const words = solutionWords(BELFRY)
    expect(words).toContain('Brother Anselm is a knight')
    expect(words).toContain('Brother Tobias is a knave')
    expect(words).toContain('Sister Odile is a knave')
    expect(words).toContain('always lies')
  })

  it('the puzzle chapter gets the answer with "do not reveal it before PUZZLE"; later chapters get it as settled fact; earlier ones get nothing', () => {
    const placed = placePuzzles([BELFRY], 4, { belfry: 3 })
    const ch3 = puzzlesChapterSection(placed, 3, 4)
    expect(ch3).toContain('Brother Anselm is a knight')
    expect(ch3).toContain('do not state it or hint at it before the PUZZLE line')
    expect(ch3).not.toContain('The truth: see the testimony')
    const ch4 = puzzlesChapterSection(placed, 4, 4)
    expect(ch4).toContain('was solved in chapter 3')
    expect(ch4).toContain('Brother Tobias is a knave')
    expect(ch4).toContain('never contradict')
    expect(puzzlesChapterSection(placed, 2, 4)).not.toContain('is a knave')
    expect(puzzlesOutlineSection(placed, [3, 8])).toContain('Sister Odile is a knave')
  })

  it('a Murdle solved in an earlier chapter is told to the later chapters too', () => {
    const placed = placePuzzles([MURDLE], 4, { winter_garden: 2 })
    expect(puzzlesChapterSection(placed, 3, 4)).toContain('suspect: Madame Verac')
  })
})

describe('SCP-32: the continuity review leaves the CLUE lines alone', () => {
  it('the reviewer note says the clues are fixed and that either/or clues are expected', () => {
    expect(PUZZLE_REVIEW_NOTE).toContain('fixed puzzle clues')
    expect(PUZZLE_REVIEW_NOTE).toContain('never ask for one to be changed')
    expect(PUZZLE_REVIEW_NOTE).toContain('either ... or')
  })

  it('drops a problem that asks to change a clue or calls it a contradiction (the c3 of the hub book), keeps the others', () => {
    const c3 = 'Chapter 2, clue winter_garden/c3: Remy says he had either the brass carriage clock or the curtain cord, but clue winter_garden/c5 has Madame Verac hold the clock. Two people cannot both hold the same clock; change Remy\'s alternatives.'
    const c3Short = 'Clue c3 contradicts c5: rewrite c3.'
    const caneProblem = 'Chapter 1: the Baron\'s cane leaves marks everywhere, but chapter 2 says the gravel was raked; state that the gravel was raked after nine.'
    const notPlanted = 'Chapter 2: the clue c4 is never found by a character, only narrated.'
    const out = dropClueChangeProblems([c3, caneProblem, c3Short, notPlanted], [MURDLE, BELFRY])
    expect(out.dropped).toEqual([c3, c3Short])
    expect(out.kept).toEqual([caneProblem, notPlanted])
  })

  it('keeps everything when the book has no puzzle', () => {
    const out = dropClueChangeProblems(['change the ending'], [])
    expect(out.kept).toEqual(['change the ending'])
    expect(out.dropped).toEqual([])
  })
})
