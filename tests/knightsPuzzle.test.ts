import { describe, expect, it } from 'vitest'
import { clueChapters, clueIdsOf, placePuzzles, puzzlesChapterSection, puzzlesOutlineSection } from '../src/engine/pipeline/puzzles'
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
