import type { BookSummary } from '../../shared/protocol'

// Twin of C:\projects\Personal\visual-novels-orchestrator\src\renderer\lib\bookTypes.ts (same groups, labels and hues).
// The two files must change together.

/** One type group per book, shared in meaning and hues with VN Studio. */
export type TypeGroup = 'stories' | 'nonfiction' | 'vn' | 'picture' | 'scripts' | 'puzzle' | 'other'

/** Display order of the groups. */
export const TYPE_GROUPS: { id: TypeGroup; label: string }[] = [
  { id: 'stories', label: 'Novels & stories' },
  { id: 'vn', label: 'Visual novels' },
  { id: 'picture', label: 'Picture & bedtime' },
  { id: 'scripts', label: 'Scripts & film' },
  { id: 'puzzle', label: 'Puzzle' },
  { id: 'nonfiction', label: 'Non-fiction' },
  { id: 'other', label: 'Other' }
]

/** The seed format ids (`seed/config/formats.md`). A disabled format has no FormatSummary, so the renderer keeps this table. */
const FORMATS: Record<string, { group: TypeGroup; choices?: boolean }> = {
  'short-story': { group: 'stories' },
  'chapter-book': { group: 'stories' },
  'middle-grade': { group: 'stories' },
  novella: { group: 'stories' },
  novel: { group: 'stories' },
  gamebook: { group: 'stories', choices: true },
  'kids-choice-book': { group: 'stories', choices: true },
  'bedtime-toddler': { group: 'picture' },
  'bedtime-story': { group: 'picture' },
  'kids-picture-book': { group: 'picture' },
  'visual-novel': { group: 'vn' },
  'choice-visual-novel': { group: 'vn', choices: true },
  'kids-visual-story': { group: 'vn' },
  'kids-choice-visual-story': { group: 'vn', choices: true },
  'short-film': { group: 'scripts' },
  cartoon: { group: 'scripts' },
  'kids-cartoon': { group: 'scripts' },
  'mystery-puzzle-visual-novel': { group: 'puzzle' },
  'nonfiction-short': { group: 'nonfiction' },
  'nonfiction-kids': { group: 'nonfiction' },
  'science-blink': { group: 'nonfiction' },
  article: { group: 'nonfiction' },
  'feature-article': { group: 'nonfiction' }
}

function lookup(format: string): { group: TypeGroup; choices: boolean } {
  const known = FORMATS[format]
  if (known) return { group: known.group, choices: !!known.choices }
  const choices = /choice|gamebook/.test(format)
  // the puzzle test comes first: a "mystery-puzzle-visual-novel" is a puzzle, not a plain VN
  const group: TypeGroup = /film|cartoon|screenplay/.test(format)
    ? 'scripts'
    : /puzzle/.test(format)
      ? 'puzzle'
      : /visual|vn/.test(format)
        ? 'vn'
        : /picture|bedtime/.test(format)
          ? 'picture'
          : /nonfiction|article/.test(format)
            ? 'nonfiction'
            : 'other'
  return { group, choices }
}

export const typeGroupOf = (format: string): TypeGroup => lookup(format).group
export const hasChoices = (format: string): boolean => lookup(format).choices

/** The small label on a cover. Plain prose novels and stories have none (null). */
export function typeBadge(format: string): { text: string; group: TypeGroup; choices: boolean } | null {
  const { group, choices } = lookup(format)
  const make = (text: string) => ({ text, group, choices })
  switch (group) {
    case 'stories':
      return choices ? make('Choices') : null
    case 'vn':
      return make(choices ? 'Choice VN' : 'VN')
    case 'picture':
      return make(format === 'kids-picture-book' ? 'Picture book' : 'Bedtime')
    case 'scripts':
      return make(format === 'short-film' ? 'Film' : 'Cartoon')
    case 'puzzle':
      return make('Puzzle')
    case 'nonfiction':
      return make('Non-fiction')
    default:
      return make(format)
  }
}

export interface LibraryFilter {
  group: TypeGroup | 'all'
  choices: boolean
  query: string
}

export const NO_FILTER: LibraryFilter = { group: 'all', choices: false, query: '' }

export const filterActive = (f: LibraryFilter): boolean => f.group !== 'all' || f.choices || f.query.trim() !== ''

function matchesQuery(b: BookSummary, words: string[]): boolean {
  if (words.length === 0) return true
  const hay = `${b.title} ${b.author ?? ''} ${b.sourceBook?.title ?? ''}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

const wordsOf = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)

export function filterBooks(books: BookSummary[], f: LibraryFilter): BookSummary[] {
  const words = wordsOf(f.query)
  return books.filter((b) => {
    const t = lookup(b.format)
    return (f.group === 'all' || t.group === f.group) && (!f.choices || t.choices) && matchesQuery(b, words)
  })
}

/** Counts per group after the query and the choices toggle (ignoring the group), and `choices` after the query and the group. */
export function typeCounts(books: BookSummary[], f: LibraryFilter): { all: number; choices: number } & Record<TypeGroup, number> {
  const words = wordsOf(f.query)
  const out = { all: 0, choices: 0, stories: 0, nonfiction: 0, vn: 0, picture: 0, scripts: 0, puzzle: 0, other: 0 }
  for (const b of books) {
    if (!matchesQuery(b, words)) continue
    const t = lookup(b.format)
    if (!f.choices || t.choices) {
      out.all++
      out[t.group]++
    }
    if (t.choices && (f.group === 'all' || t.group === f.group)) out.choices++
  }
  return out
}
