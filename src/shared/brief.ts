import { parsePuzzleEntries } from './puzzles'
import type { PuzzleEntry } from './puzzles'
/**
 * The owner's story brief. A story is a file in ideas/ (and, once a book is started, books/<slug>/brief.md). Its body is
 * markdown sections, so it can be edited by hand. The engine, the UI and MCP all read and write it through this module.
 * There are no length limits anywhere.
 */

export interface BriefCharacter {
  name: string
  /** Who they are in the story ("the hero", "the lighthouse keeper's daughter"). */
  role: string
  /** Looks, voice, history: free text. */
  description: string
}

export interface BriefSection {
  heading: string
  text: string
}

export interface StoryBrief {
  /** Empty: the editor-in-chief picks the title. */
  title: string
  premise: string
  plot: string
  characters: BriefCharacter[]
  setting: string
  style: string
  /** Any other `## Heading` of the body, passed to the agents as it is. */
  sections: BriefSection[]
  /** A format id from config/formats.md. Empty: the editor-in-chief picks. */
  format?: string
  topic?: string
  genre?: string
  /** Series slug (a file in series/): the book made from this story continues that series. */
  series?: string
  /** Position in the series (frontmatter `series_index`). Empty: the next free number. */
  seriesIndex?: number
  /** Role -> `provider/model` for the book made from this story (frontmatter `role_models`). */
  models?: Record<string, string>
  /** Slug of a published book this story adapts (frontmatter `source_book`): the script writer's story. */
  sourceBook?: string
  /** `false`: the book gets no humanizer pass (frontmatter `humanize: false`). Unset: the format decides. */
  humanize?: boolean
  /** The puzzles of a mystery with puzzles (frontmatter `puzzles`): VN Studio's puzzle cores with names and canonical clue sentences. Not part of the text. */
  puzzles?: PuzzleEntry[]
}

export const emptyBrief = (): StoryBrief => ({ title: '', premise: '', plot: '', characters: [], setting: '', style: '', sections: [] })

/** The fields the body can hold, in the order `renderBrief` writes them. */
const KNOWN = ['premise', 'plot', 'characters', 'setting', 'style'] as const

const norm = (s: string) => s.replace(/\r\n/g, '\n')

/** Splits text at lines that start with `marker` (`## ` or `### `). The text before the first one comes back as `lead`. */
function splitAt(text: string, marker: '## ' | '### '): { lead: string; parts: { heading: string; text: string }[] } {
  const lines = norm(text).split('\n')
  const parts: { heading: string; lines: string[] }[] = []
  const lead: string[] = []
  let fence = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && line.startsWith(marker)) parts.push({ heading: line.slice(marker.length).trim(), lines: [] })
    else (parts.length ? parts[parts.length - 1]!.lines : lead).push(line)
  }
  return { lead: lead.join('\n').trim(), parts: parts.map((p) => ({ heading: p.heading, text: p.lines.join('\n').trim() })) }
}

/**
 * Reads the body of a story file. `## Premise`, `## Plot`, `## Characters` (a `### Name` block per character, with an
 * optional `Role:` first line), `## Setting` and `## Style` are the known sections, any other `## Heading` goes to `sections`.
 * A body with no `##` headings is the premise, so a plain one-line idea still works.
 */
export function parseBrief(body: string): StoryBrief {
  const brief = emptyBrief()
  const { lead, parts } = splitAt(body, '## ')
  if (parts.length === 0) {
    brief.premise = lead
    return brief
  }
  // text above the first heading belongs to the premise
  if (lead) brief.premise = lead
  for (const p of parts) {
    const key = KNOWN.find((k) => k === p.heading.toLowerCase())
    if (key === 'characters') {
      const chars = splitAt(p.text, '### ')
      if (chars.lead) brief.sections.push({ heading: 'Characters (notes)', text: chars.lead })
      for (const c of chars.parts) brief.characters.push(parseCharacter(c.heading, c.text))
    } else if (key) {
      brief[key] = brief[key] ? `${brief[key]}\n\n${p.text}` : p.text
    } else {
      brief.sections.push({ heading: p.heading, text: p.text })
    }
  }
  return brief
}

function parseCharacter(name: string, text: string): BriefCharacter {
  const lines = text.split('\n')
  const first = lines.findIndex((l) => l.trim())
  const m = first >= 0 ? /^role:\s*(.*)$/i.exec(lines[first]!.trim()) : null
  if (!m) return { name, role: '', description: text.trim() }
  return { name, role: m[1]!.trim(), description: lines.slice(first + 1).join('\n').trim() }
}

/** The body of a story file. `parseBrief` reads it back. Empty sections are left out. */
export function renderBrief(brief: StoryBrief): string {
  const out: string[] = []
  const add = (heading: string, text: string) => {
    if (text.trim()) out.push(`## ${heading}\n\n${text.trim()}`)
  }
  add('Premise', brief.premise)
  add('Plot', brief.plot)
  const chars = brief.characters.filter((c) => c.name.trim())
  if (chars.length) {
    out.push(
      '## Characters\n\n' +
        chars
          .map((c) => [`### ${c.name.trim()}`, c.role.trim() ? `Role: ${c.role.trim()}` : '', c.description.trim()].filter(Boolean).join('\n'))
          .join('\n\n')
    )
  }
  add('Setting', brief.setting)
  add('Style', brief.style)
  for (const s of brief.sections) if (s.heading.trim()) add(s.heading.trim(), s.text)
  return out.join('\n\n')
}

/** True when the brief says nothing (no title and no text anywhere). */
export function isEmptyBrief(brief: StoryBrief): boolean {
  return !brief.title.trim() && !renderBrief(brief).trim()
}

/** The first line of the premise (else of the plot), cut to a label of at most 70 characters. Only the label is cut: the text keeps everything. */
export function briefLabel(brief: Pick<StoryBrief, 'premise' | 'plot'>): string {
  const line = (brief.premise.trim() || brief.plot.trim()).split('\n')[0]!.replace(/^#+\s*/, '').trim()
  return line.length > 70 ? line.slice(0, 67).trimEnd() + '...' : line
}

/** The brief as prompt text for the agents: the title and every section. */
export function briefPromptText(brief: StoryBrief): string {
  return [brief.title.trim() ? `Title: ${brief.title.trim()}` : '', renderBrief(brief)].filter(Boolean).join('\n\n')
}

/**
 * The brief of an idea or book file: the body parsed, plus `format`, `topic` and `genre` from the frontmatter.
 * The title is only the owner's when the file says `title_fixed: true`; a label made from the text is not a title.
 */
export function briefOf(data: Record<string, unknown>, body: string): StoryBrief {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const brief = parseBrief(body)
  if (data.title_fixed === true) brief.title = str(data.title) ?? ''
  const format = str(data.format)
  const topic = str(data.topic)
  const genre = str(data.genre)
  const series = str(data.series)
  if (series) brief.series = series
  if (typeof data.series_index === 'number' && Number.isInteger(data.series_index) && data.series_index > 0) brief.seriesIndex = data.series_index
  if (format) brief.format = format
  if (topic) brief.topic = topic
  if (genre) brief.genre = genre
  if (data.humanize === false) brief.humanize = false
  const sourceBook = str(data.source_book)
  if (sourceBook) brief.sourceBook = sourceBook
  const puzzles = parsePuzzleEntries(data.puzzles)
  if (puzzles.length) brief.puzzles = puzzles
  const rm = data.role_models
  if (rm && typeof rm === 'object' && !Array.isArray(rm)) {
    const models = Object.fromEntries(Object.entries(rm).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()]))
    if (Object.keys(models).length) brief.models = models
  }
  return brief
}
