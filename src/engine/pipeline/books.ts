import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd, parseMdWith } from '../../shared/md'
import { bookSchema } from '../../shared/schemas'
import type { BookFrontmatter } from '../../shared/schemas'
import { atomicWrite, readMd, writeMd } from '../store/atomic'
import { buildEpub } from '../publish/epub'
import { writeReaderDir } from '../publish/reader'
import { buildReferences, FactBase } from '../memory/factbase'

export const MADE_COLUMNS = ['job', 'task', 'role', 'unit', 'round', 'agent', 'model', 'prompt_version', 'cost_usd', 'ms']

export const pad2 = (n: number) => String(n).padStart(2, '0')

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'untitled'

/** Stages in which a book needs no more work. */
export const TERMINAL_BOOK_STAGES = new Set(['published', 'rejected', 'failed'])

/** Books that are not finished. A folder whose book.md can't be read right now (it is being written) counts as in progress. */
export async function countBooksInProgress(books: BookStore): Promise<number> {
  let n = 0
  for (const slug of await books.slugs()) {
    const b = await books.read(slug)
    if (!b || !TERMINAL_BOOK_STAGES.has(b.data.stage)) n++
  }
  return n
}

export const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

export interface ChapterFile {
  n: number
  title: string
  round: number
  words: number
  body: string
  agent?: string
  /** Fixes already applied to this chapter: `len` (length rewrite). */
  fixes: string[]
}

export interface OutlineChapter {
  n: number
  title: string
  summary: string
}

export class BookStore {
  private locks = new Map<string, Promise<unknown>>()

  constructor(private readonly dataDir: string) {}

  get root(): string {
    return path.join(this.dataDir, 'books')
  }
  dir(slug: string): string {
    return path.join(this.root, slug)
  }
  file(slug: string, ...parts: string[]): string {
    return path.join(this.dir(slug), ...parts)
  }
  chapterFile(slug: string, n: number): string {
    return this.file(slug, 'chapters', `ch-${pad2(n)}.md`)
  }

  async slugs(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
  }

  /** Runs `fn` with the book's lock, so book.md is never rewritten by two jobs at once. */
  private withLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(slug) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.locks.set(slug, next.catch(() => undefined))
    return next
  }

  async read(slug: string): Promise<{ data: BookFrontmatter; body: string } | null> {
    try {
      const file = this.file(slug, 'book.md')
      const doc = parseMdWith(await fs.readFile(file, 'utf8'), bookSchema, file)
      return doc
    } catch {
      return null
    }
  }

  /** Reads book.md again under the lock, applies the change, and writes it back. Unknown fields are kept. */
  update(slug: string, change: (data: Record<string, unknown>) => Record<string, unknown> | void): Promise<BookFrontmatter> {
    return this.withLock(slug, async () => {
      const file = this.file(slug, 'book.md')
      const doc = await readMd(file)
      const patch = change(doc.data)
      const data = patch ? { ...doc.data, ...patch } : doc.data
      await writeMd(file, data, doc.body)
      return bookSchema.parse(data)
    })
  }

  async create(slug: string, data: Record<string, unknown>, body = ''): Promise<void> {
    await fs.mkdir(this.dir(slug), { recursive: true })
    await writeMd(this.file(slug, 'book.md'), { kind: 'book', slug, ...data }, body)
  }

  /** A slug that isn't taken yet. */
  async freeSlug(title: string): Promise<string> {
    const base = slugify(title)
    const taken = new Set(await this.slugs())
    let slug = base
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
    return slug
  }

  /** Adds one line to books/<slug>/made.md (how the book was made) and keeps a summary in book.md. */
  recordMade(slug: string, entry: Record<string, unknown>, costUsd: number): Promise<BookFrontmatter> {
    return this.withLock(slug, async () => {
      const file = this.file(slug, 'made.md')
      const cells = [entry.job, entry.task, entry.role, entry.unit ?? '', entry.round ?? 0, entry.agent, entry.model ?? '', entry.prompt_version ?? '', entry.cost_usd ?? 0, entry.ms ?? 0]
      const row = `| ${cells.map((c) => String(c).replace(/[|\r\n]+/g, '/')).join(' | ')} |\n`
      let exists = true
      try {
        await fs.access(file)
      } catch {
        exists = false
      }
      const head = exists
        ? ''
        : `---\nkind: made\nbook: ${slug}\n---\n# How "${slug}" was made\n\nOne row per job: who did it, with which model and prompt version, what it cost.\n\n| ${MADE_COLUMNS.join(' | ')} |\n|${MADE_COLUMNS.map(() => '---').join('|')}|\n`
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.appendFile(file, head + row, 'utf8')
      const bookFile = this.file(slug, 'book.md')
      const doc = await readMd(bookFile)
      const models = { ...((doc.data.models as Record<string, number> | undefined) ?? {}) }
      if (entry.model) models[String(entry.model)] = (models[String(entry.model)] ?? 0) + 1
      const data = {
        ...doc.data,
        jobs: Number(doc.data.jobs ?? 0) + 1,
        models,
        cost_usd: Number((((doc.data.cost_usd as number) ?? 0) + costUsd).toFixed(6))
      }
      await writeMd(bookFile, data, doc.body)
      return bookSchema.parse(data)
    })
  }

  /** The rows of made.md. */
  async readMade(slug: string): Promise<Record<string, string>[]> {
    const t = await this.readText(slug, 'made.md')
    if (!t) return []
    const rows: Record<string, string>[] = []
    for (const line of t.split(/\r?\n/)) {
      if (!line.startsWith('|') || /^\|\s*-+/.test(line)) continue
      const cells = line
        .slice(1, line.lastIndexOf('|'))
        .split('|')
        .map((c) => c.trim())
      if (cells[0] === MADE_COLUMNS[0]) continue
      rows.push(Object.fromEntries(MADE_COLUMNS.map((c, i) => [c, cells[i] ?? ''])))
    }
    return rows
  }

  /** The acts of a long book, from outline.md. Empty for short books. */
  async acts(slug: string): Promise<{ n: number; title: string; chapters: number[] }[]> {
    const t = await this.readText(slug, 'outline.md')
    if (t === null) return []
    const raw = parseMd(t).data.acts
    if (!Array.isArray(raw)) return []
    return (raw as Record<string, unknown>[]).map((a, i) => ({
      n: Number(a.n ?? i + 1),
      title: String(a.title ?? `Act ${i + 1}`),
      chapters: Array.isArray(a.chapters) ? (a.chapters as unknown[]).map(Number) : []
    }))
  }

  async readText(slug: string, ...parts: string[]): Promise<string | null> {
    try {
      return await fs.readFile(this.file(slug, ...parts), 'utf8')
    } catch {
      return null
    }
  }

  async pitch(slug: string): Promise<string | null> {
    const t = await this.readText(slug, 'pitch.md')
    return t === null ? null : parseMd(t).body.trim()
  }

  async outline(slug: string): Promise<{ chapters: OutlineChapter[]; body: string } | null> {
    const t = await this.readText(slug, 'outline.md')
    if (t === null) return null
    const doc = parseMd(t)
    const raw = Array.isArray(doc.data.chapters) ? (doc.data.chapters as Record<string, unknown>[]) : []
    const chapters = raw.map((c, i) => ({ n: Number(c.n ?? i + 1), title: String(c.title ?? `Chapter ${i + 1}`), summary: String(c.summary ?? '') }))
    return { chapters, body: doc.body }
  }

  async bible(slug: string): Promise<string> {
    const t = await this.readText(slug, 'bible', 'bible.md')
    return t === null ? '' : parseMd(t).body.trim()
  }

  async chapters(slug: string): Promise<ChapterFile[]> {
    let names: string[]
    try {
      names = (await fs.readdir(this.file(slug, 'chapters'))).filter((f) => /^ch-\d+\.md$/.test(f)).sort()
    } catch {
      return []
    }
    const out: ChapterFile[] = []
    for (const f of names) {
      const doc = parseMd(await fs.readFile(this.file(slug, 'chapters', f), 'utf8'))
      const n = Number(doc.data.n ?? /\d+/.exec(f)![0])
      out.push({
        n,
        title: String(doc.data.title ?? `Chapter ${n}`),
        round: Number(doc.data.round ?? 0),
        words: Number(doc.data.words ?? countWords(doc.body)),
        body: doc.body.trim(),
        agent: doc.data.agent ? String(doc.data.agent) : undefined,
        fixes: Array.isArray(doc.data.fixes) ? (doc.data.fixes as unknown[]).map(String) : []
      })
    }
    return out.sort((a, b) => a.n - b.n)
  }

  /** Writes a chapter. The version it replaces is kept in chapters/history/. */
  async writeChapter(slug: string, ch: { n: number; title: string; round: number; body: string; agent?: string; model?: string; fixes?: string[] }): Promise<void> {
    const file = this.chapterFile(slug, ch.n)
    try {
      const old = await fs.readFile(file, 'utf8')
      const oldRound = Number(parseMd(old).data.round ?? 0)
      await atomicWrite(this.file(slug, 'chapters', 'history', `ch-${pad2(ch.n)}-r${oldRound}.md`), old)
    } catch {
      /* first version */
    }
    await writeMd(
      file,
      { kind: 'chapter', n: ch.n, title: ch.title, round: ch.round, words: countWords(ch.body), agent: ch.agent, model: ch.model, fixes: ch.fixes?.length ? ch.fixes : undefined },
      '\n' + ch.body.trim() + '\n'
    )
  }

  /** The whole book as one text with chapter headings, for reviewers. */
  async fullText(slug: string): Promise<string> {
    const chapters = await this.chapters(slug)
    if (chapters.length === 1) return `# ${chapters[0]!.title}\n\n${chapters[0]!.body}`
    return chapters.map((c) => `## Chapter ${c.n}: ${c.title}\n\n${c.body}`).join('\n\n')
  }

  /** The references section of a non-fiction book (the sources its chapters cite), or null. */
  async references(slug: string): Promise<{ title: string; body: string } | null> {
    const book = await this.read(slug)
    if (!book || book.data.nonfiction !== true) return null
    return buildReferences(this, new FactBase(this), slug)
  }

  /** Writes books/<slug>/out/reader/ (unzipped XHTML, CSS, cover, index.html) for the in-app reader. */
  async buildReader(slug: string): Promise<string> {
    const book = await this.read(slug)
    if (!book) throw new Error(`no book ${slug}`)
    const d = book.data
    const chapters = [...(await this.chapters(slug))]
    const refs = await this.references(slug)
    const cover = this.file(slug, 'out', 'cover.png')
    const dir = this.file(slug, 'out', 'reader')
    await writeReaderDir(dir, {
      title: d.title,
      author: d.author ?? 'Unknown',
      blurb: typeof d.blurb === 'string' ? d.blurb : undefined,
      year: Number(d.year ?? new Date().getFullYear()),
      genreClass: typeof d.genre_class === 'string' ? d.genre_class : undefined,
      chapters: [...chapters.map((c) => ({ title: c.title, body: c.body })), ...(refs ? [refs] : [])],
      coverPngPath: await fs.access(cover).then(() => cover, () => undefined)
    })
    return dir
  }

  /** Builds out/<slug>.epub from the files, with out/cover.png when it exists. */
  async buildEpubFile(slug: string): Promise<string> {
    const book = await this.read(slug)
    if (!book) throw new Error(`no book ${slug}`)
    const d = book.data
    const chapters = await this.chapters(slug)
    const refs = await this.references(slug)
    let coverPng: Uint8Array | undefined
    try {
      coverPng = await fs.readFile(this.file(slug, 'out', 'cover.png'))
    } catch {
      /* no cover image yet */
    }
    let uuid = d.uuid
    if (!uuid) {
      uuid = randomUUID()
      await this.update(slug, () => ({ uuid }))
    }
    const bytes = await buildEpub({
      title: d.title,
      author: d.author ?? 'Unknown',
      uuid,
      subject: d.topic_name ?? d.genre ?? 'Fiction',
      subjects: Array.isArray(d.subjects) ? (d.subjects as string[]) : [],
      description: typeof d.blurb === 'string' ? d.blurb : '',
      year: Number(d.year ?? new Date().getFullYear()),
      modified: new Date(),
      genreClass: typeof d.genre_class === 'string' ? d.genre_class : undefined,
      chapters: [...chapters.map((c) => ({ title: c.title, body: c.body })), ...(refs ? [refs] : [])],
      coverPng
    })
    const out = this.file(slug, 'out', `${slug}.epub`)
    await fs.mkdir(path.dirname(out), { recursive: true })
    await fs.writeFile(out, bytes)
    await this.buildReader(slug)
    return out
  }
}
