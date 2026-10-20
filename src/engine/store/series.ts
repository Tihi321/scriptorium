import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseBrief, renderBrief } from '../../shared/brief'
import type { StoryBrief } from '../../shared/brief'
import { parseMd } from '../../shared/md'
import { seriesSchema } from '../../shared/schemas'
import type { SeriesFrontmatter } from '../../shared/schemas'
import type { BookStore } from '../pipeline/books'
import { writeMd } from './atomic'
import { slugify } from './ideas'
import type { IdeaFile } from './ideas'

export interface SeriesFile {
  slug: string
  file: string
  data: SeriesFrontmatter
  /** The body (Premise, Characters, Setting, Style, ...). */
  body: string
  title: string
  /** Title, genre, format and the body sections, as a brief. The premise is the series arc. */
  brief: StoryBrief
  createdMs: number
}

const readSeries = (slug: string, file: string, text: string, mtimeMs: number): SeriesFile | null => {
  const doc = parseMd(text, file)
  const parsed = seriesSchema.safeParse(doc.data)
  if (!parsed.success) return null
  const data = parsed.data
  const title = data.title?.trim() || slug
  const brief = parseBrief(doc.body)
  brief.title = title
  if (data.genre?.trim()) brief.genre = data.genre.trim()
  if (data.format?.trim()) brief.format = data.format.trim()
  const created = data.created ? Date.parse(data.created) : NaN
  return { slug, file, data, body: doc.body.trim(), title, brief, createdMs: Number.isFinite(created) ? created : mtimeMs }
}

/** The fields of a series file's frontmatter that come from a brief. */
const fields = (b: StoryBrief) => ({
  title: b.title.trim(),
  ...(b.genre?.trim() ? { genre: b.genre.trim() } : {}),
  ...(b.format?.trim() ? { format: b.format.trim() } : {})
})

/** Series: one markdown file per series in series/. The body is a brief (the series arc, the recurring cast, setting and style). */
export class SeriesStore {
  constructor(private readonly dataDir: string) {}

  get dir(): string {
    return path.join(this.dataDir, 'series')
  }

  async list(): Promise<SeriesFile[]> {
    let names: string[]
    try {
      names = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.md') && !f.includes('.tmp-'))
    } catch {
      return []
    }
    const out: SeriesFile[] = []
    for (const n of names) {
      const file = path.join(this.dir, n)
      try {
        const [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
        const s = readSeries(n.slice(0, -3), file, text, stat.mtimeMs)
        if (s) out.push(s)
      } catch {
        /* unreadable series: skipped */
      }
    }
    return out.sort((a, b) => a.createdMs - b.createdMs || a.slug.localeCompare(b.slug))
  }

  async get(slug: string): Promise<SeriesFile | null> {
    if (!/^[\w.-]+$/.test(slug) || slug.includes('..')) return null
    return (await this.list()).find((s) => s.slug === slug) ?? null
  }

  /** Creates a series from a brief (its title names it). */
  async create(brief: StoryBrief): Promise<SeriesFile> {
    const title = brief.title.trim()
    if (!title) throw new Error('a series needs a title')
    await fs.mkdir(this.dir, { recursive: true })
    const taken = new Set((await fs.readdir(this.dir)).map((f) => f.replace(/\.md$/, '')))
    const base = slugify(title)
    let slug = base
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
    const file = path.join(this.dir, `${slug}.md`)
    const data = { kind: 'series', ...fields(brief), books: [] as string[], created: new Date().toISOString() }
    await writeMd(file, data, '\n' + renderBrief(brief) + '\n')
    return (await this.get(slug))!
  }

  /** Replaces the title, genre, format and body of a series. The books and everything else in the frontmatter stay. */
  async update(slug: string, brief: StoryBrief): Promise<SeriesFile> {
    const old = await this.get(slug)
    if (!old) throw new Error(`no series "${slug}"`)
    if (!brief.title.trim()) throw new Error('a series needs a title')
    const doc = parseMd(await fs.readFile(old.file, 'utf8'), old.file)
    const { genre: _g, format: _f, ...rest } = doc.data
    await writeMd(old.file, { ...rest, kind: 'series', ...fields(brief) }, '\n' + renderBrief(brief) + '\n')
    return (await this.get(slug))!
  }

  /** Appends a book to the series' `books` (once). Keeps everything else in the file as it was. */
  async addBook(slug: string, book: string): Promise<void> {
    const old = await this.get(slug)
    if (!old) return
    const doc = parseMd(await fs.readFile(old.file, 'utf8'), old.file)
    const books = Array.isArray(doc.data.books) ? (doc.data.books as unknown[]).map(String) : []
    if (books.includes(book)) return
    await writeMd(old.file, { ...doc.data, kind: 'series', books: [...books, book] }, doc.body)
  }
}

// ---- who belongs to a series, and who comes first ----

/** What the series code needs to know about a book. */
export interface BookRef {
  slug: string
  title: string
  series?: string
  index?: number
  stage: string
  score: number | null
}

/** Every book's series fields, stage and score (reads each book.md only). */
export async function bookRefs(books: BookStore): Promise<BookRef[]> {
  const out: BookRef[] = []
  for (const slug of await books.slugs()) {
    const b = await books.read(slug)
    if (!b) continue
    const d = b.data as Record<string, unknown> & typeof b.data
    out.push({ slug, title: b.data.title, ...(d.series ? { series: d.series } : {}), ...(d.series_index ? { index: d.series_index } : {}), stage: b.data.stage, score: typeof d.score === 'number' ? d.score : null })
  }
  return out
}

export interface SeriesMember {
  slug: string
  title: string
  index: number
  kind: 'book' | 'story'
  stage: string
  score: number | null
}

/** The books of a series and its stories no book has started yet, in order of their `series_index`. */
export function seriesMembers(series: string, refs: BookRef[], ideas: IdeaFile[]): SeriesMember[] {
  const books = refs.filter((b) => b.series === series).map((b): SeriesMember => ({ slug: b.slug, title: b.title, index: b.index ?? 0, kind: 'book', stage: b.stage, score: b.score }))
  const stories = ideas
    .filter((i) => i.data.status === 'open' && i.data.series === series)
    .map((i): SeriesMember => ({ slug: i.slug, title: i.title, index: i.data.series_index ?? 0, kind: 'story', stage: 'story', score: null }))
  return [...books, ...stories].sort((a, b) => a.index - b.index || Number(a.kind === 'story') - Number(b.kind === 'story') || a.slug.localeCompare(b.slug))
}

/** The next free `series_index` of a series: one more than the highest among its books and open stories. */
export const nextSeriesIndex = (series: string, refs: BookRef[], ideas: IdeaFile[]): number => seriesMembers(series, refs, ideas).reduce((m, x) => Math.max(m, x.index), 0) + 1

/**
 * The open stories that must wait: a story of a series waits while an earlier book of the series is not published yet,
 * or an earlier story of the series has not been made into a book yet.
 */
export function waitingStories(ideas: IdeaFile[], refs: BookRef[]): Set<string> {
  const waiting = new Set<string>()
  for (const idea of ideas) {
    const series = idea.data.series
    const index = idea.data.series_index
    if (idea.data.status !== 'open' || !series || !index) continue
    const earlier = seriesMembers(series, refs, ideas).filter((m) => m.index < index && !(m.kind === 'story' && m.slug === idea.slug))
    if (earlier.some((m) => m.kind === 'story' || m.stage !== 'published')) waiting.add(idea.slug)
  }
  return waiting
}
