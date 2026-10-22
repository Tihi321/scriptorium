import { z } from 'zod'

/**
 * A puzzle of a mystery-with-puzzles book (docs/visual-novel.md "Puzzles"). The puzzle core is made by VN Studio (`vno_puzzle_generate`), handed
 * to Scriptorium in the story brief and kept as `bible/puzzles.md`. Scriptorium keeps `core`, `names`, `text` and `testimony` exactly as given
 * and has no solver; `chapter` and `clueAt` are its own placement.
 */
const id = z.string().regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, _ and - only')

export const puzzleEntrySchema = z.looseObject({
  /** The `<puzzle>` of the `CLUE:` and `PUZZLE:` lines. */
  key: id,
  /** `murdle` now; `knights`, `testimony` and `grid` later. */
  kind: z.string().default('murdle'),
  title: z.string().optional(),
  /** The chapter with the `PUZZLE:` line (set by the outline). */
  chapter: z.number().int().positive().optional(),
  /** VN Studio's puzzle core (format 1: categories, solution, clues, murder, difficulty, steps), as it came. */
  core: z.record(z.string(), z.unknown()).optional(),
  /** Item id (s1, w1, p1) -> the name in the story. */
  names: z.record(z.string(), z.string()).default({}),
  /** Clue id (c1, ..., murder) -> the canonical English sentence. */
  text: z.record(z.string(), z.string()).default({}),
  /** Clue id -> the chapter planned to plant it (set by the engine). */
  clueAt: z.record(z.string(), z.number().int().positive()).default({}),
  /** A cross-examination: the witness, which statement (1-based) breaks with which evidence, and the evidence items. */
  testimony: z
    .looseObject({
      witness: z.string(),
      breaks: z.array(z.looseObject({ statement: z.number().int().positive(), evidence: id })).default([]),
      evidence: z.array(z.looseObject({ key: id, description: z.string().default('') })).default([])
    })
    .optional()
})

export type PuzzleEntry = z.infer<typeof puzzleEntrySchema>

/** The valid entries of a frontmatter value (anything else is dropped). */
export function parsePuzzleEntries(value: unknown): PuzzleEntry[] {
  if (!Array.isArray(value)) return []
  const out: PuzzleEntry[] = []
  for (const v of value) {
    const r = puzzleEntrySchema.safeParse(v)
    if (r.success && !out.some((p) => p.key === r.data.key)) out.push(r.data)
  }
  return out
}
