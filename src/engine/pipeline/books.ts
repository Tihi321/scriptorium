import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { briefOf, isEmptyBrief } from '../../shared/brief'
import type { StoryBrief } from '../../shared/brief'
import { parseMd, parseMdWith } from '../../shared/md'
import { bookSchema } from '../../shared/schemas'
import type { BookFrontmatter } from '../../shared/schemas'
import { atomicWrite, readMd, writeMd } from '../store/atomic'
import { buildEpub } from '../publish/epub'
import { writeReaderDir } from '../publish/reader'
import { buildReferences, citedNumbers, FactBase } from '../memory/factbase'
import { buildArticleHtml, buildArticleMarkdown } from '../publish/article'
import { endLine, isBranching, renderOutlineBody } from './branches'
import { slugify as slugOf } from '../../shared/slug'
import type { Choice } from './branches'

export const MADE_COLUMNS = ['job', 'task', 'role', 'unit', 'round', 'agent', 'model', 'prompt_version', 'cost_usd', 'ms']

export const pad2 = (n: number) => String(n).padStart(2, '0')

/** A book's folder name: at most 40 characters and 8 words, never cut inside a word (SCP-14). Existing books keep their slugs. */
export const slugify = (s: string) => slugOf(s, { max: 40, maxWords: 8, fallback: 'untitled' })

/** Stages in which a book needs no more work. */
export const TERMINAL_BOOK_STAGES = new Set(['published', 'rejected', 'failed'])

/**
 * Books and articles that are not finished, counted apart: articles (`article: true` in book.md) have their own limit and do not count
 * toward `max_books_in_progress`. A folder whose book.md can't be read right now (it is being written) counts as a book in progress.
 */
export async function countInProgress(books: BookStore): Promise<{ books: number; articles: number }> {
  const n = { books: 0, articles: 0 }
  for (const slug of await books.slugs()) {
    const b = await books.read(slug)
    if (!b) n.books++
    else if (!TERMINAL_BOOK_STAGES.has(b.data.stage)) n[b.data.article === true ? 'articles' : 'books']++
  }
  return n
}

/** Books (not articles) that are not finished. */
export async function countBooksInProgress(books: BookStore): Promise<number> {
  return (await countInProgress(books)).books
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
  /** The round the humanizer last rewrote this chapter in (`humanized` in the chapter file). Missing: not humanized since it was last written. */
  humanized?: number
}

export interface OutlineChapter {
  n: number
  title: string
  summary: string
  /** A story with choices: the choices that end this chapter (none for an ending). */
  choices?: Choice[]
  /** A story with choices: how this ending ends. */
  ending?: string
  /** An adaptation: the chapters of the source book this chapter is made from. */
  source_chapters?: number[]
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

  /**
   * The owner's story brief of a book: books/<slug>/brief.md, else (older books) the body of the idea it started from.
   * Null when the book came from a generated idea or from none, or the brief says nothing.
   */
  async brief(slug: string): Promise<StoryBrief | null> {
    let text = await this.readText(slug, 'brief.md')
    if (text === null) {
      const idea = (await this.read(slug))?.data.idea
      if (typeof idea !== 'string' || !/^[\w.-]+$/.test(idea)) return null
      try {
        text = await fs.readFile(path.join(this.dataDir, 'ideas', `${idea}.md`), 'utf8')
      } catch {
        return null
      }
    }
    const doc = parseMd(text)
    if (doc.data.source === 'generated') return null
    const brief = briefOf(doc.data, doc.body)
    return isEmptyBrief(brief) ? null : brief
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
    const chapters = raw.map((c, i): OutlineChapter => ({
      n: Number(c.n ?? i + 1),
      title: String(c.title ?? `Chapter ${i + 1}`),
      summary: String(c.summary ?? ''),
      ...(Array.isArray(c.choices) ? { choices: (c.choices as Record<string, unknown>[]).map((ch) => ({ text: String(ch.text ?? ''), to: Number(ch.to) })) } : {}),
      ...(typeof c.ending === 'string' ? { ending: c.ending } : {}),
      ...(Array.isArray(c.source_chapters) && c.source_chapters.length ? { source_chapters: (c.source_chapters as unknown[]).map(Number).filter((x) => Number.isInteger(x) && x > 0) } : {})
    }))
    return { chapters, body: doc.body }
  }

  /**
   * Rewords the choices at the end of chapter `n` in outline.md (a rewrite asked for it): the same number of choices, each leading where it led,
   * with new texts. The outline's body is written again from the frontmatter. Returns false when the chapter has other choices than these.
   */
  async setChoiceTexts(slug: string, n: number, texts: string[]): Promise<boolean> {
    const file = this.file(slug, 'outline.md')
    const raw = await this.readText(slug, 'outline.md')
    if (raw === null) return false
    const doc = parseMd(raw)
    const chapters = Array.isArray(doc.data.chapters) ? (doc.data.chapters as Record<string, unknown>[]) : []
    const entry = chapters.find((c, i) => Number(c.n ?? i + 1) === n)
    const choices = Array.isArray(entry?.choices) ? (entry!.choices as Record<string, unknown>[]) : []
    if (!entry || choices.length === 0 || choices.length !== texts.length) return false
    choices.forEach((c, i) => (c.text = texts[i]))
    await writeMd(file, doc.data, doc.body)
    const outline = await this.outline(slug)
    await writeMd(file, doc.data, renderOutlineBody(outline?.chapters ?? [], Array.isArray(doc.data.acts) ? (doc.data.acts as { title: string; chapters: number[] }[]) : undefined, true))
    return true
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
        fixes: Array.isArray(doc.data.fixes) ? (doc.data.fixes as unknown[]).map(String) : [],
        ...(Number.isInteger(doc.data.humanized) ? { humanized: Number(doc.data.humanized) } : {})
      })
    }
    return out.sort((a, b) => a.n - b.n)
  }

  /** Writes a chapter. The version it replaces is kept in chapters/history/. */
  async writeChapter(slug: string, ch: { n: number; title: string; round: number; body: string; agent?: string; model?: string; fixes?: string[]; humanized?: number }): Promise<void> {
    const file = this.chapterFile(slug, ch.n)
    try {
      const old = await fs.readFile(file, 'utf8')
      const oldDoc = parseMd(old)
      const oldRound = Number(oldDoc.data.round ?? 0)
      // a humanized version is kept beside the version it was made from (the same round), not over it
      await atomicWrite(this.file(slug, 'chapters', 'history', `ch-${pad2(ch.n)}-r${oldRound}${Number.isInteger(oldDoc.data.humanized) ? '-humanized' : ''}.md`), old)
    } catch {
      /* first version */
    }
    await writeMd(
      file,
      { kind: 'chapter', n: ch.n, title: ch.title, round: ch.round, words: countWords(ch.body), agent: ch.agent, model: ch.model, fixes: ch.fixes?.length ? ch.fixes : undefined, humanized: ch.humanized },
      '\n' + ch.body.trim() + '\n'
    )
  }

  /** The whole book as one text with chapter headings, for reviewers. */
  async fullText(slug: string): Promise<string> {
    const chapters = await this.chapters(slug)
    if (chapters.length === 1) return `# ${chapters[0]!.title}\n\n${chapters[0]!.body}`
    // a story with choices: after each chapter, where its choices lead (or that it is an ending)
    const map = await this.branchMap(slug)
    return chapters.map((c) => `## Chapter ${c.n}: ${c.title}\n\n${c.body}${map?.has(c.n) ? `\n\n[${endLine(map.get(c.n)!)}]` : ''}`).join('\n\n')
  }

  /** The outline chapters of a story with choices by number, or null for a book read straight through. */
  async branchMap(slug: string): Promise<Map<number, OutlineChapter> | null> {
    const outline = await this.outline(slug)
    return outline && isBranching(outline.chapters) ? new Map(outline.chapters.map((c) => [c.n, c])) : null
  }

  /** The choices (`to` is the 1-based position of the target chapter) or the ending of each chapter, for the EPUB and the reader. */
  private async choiceLinks(slug: string, chapters: ChapterFile[]): Promise<(c: ChapterFile) => { choices?: { text: string; to: number }[]; ending?: string }> {
    const map = await this.branchMap(slug)
    if (!map) return () => ({})
    const pos = new Map(chapters.map((c, i) => [c.n, i + 1]))
    return (c) => {
      const o = map.get(c.n)
      const choices = (o?.choices ?? []).filter((ch) => pos.has(ch.to)).map((ch) => ({ text: ch.text, to: pos.get(ch.to)! }))
      return choices.length ? { choices } : { ending: o?.ending || 'the end' }
    }
  }

  /** The references section of a non-fiction book (the sources its chapters cite), or null. */
  async references(slug: string): Promise<{ title: string; body: string } | null> {
    const book = await this.read(slug)
    if (!book || book.data.nonfiction !== true) return null
    return buildReferences(this, new FactBase(this), slug)
  }

  /**
   * Writes a newspaper article's page: books/<slug>/out/article.html (masthead, section, headline, standfirst, byline, date, text and the numbered
   * references it cites, from the fact base) and out/article.md. Returns the path of article.html. The date is the day it was published.
   */
  async buildArticle(slug: string): Promise<string> {
    const book = await this.read(slug)
    if (!book) throw new Error(`no book ${slug}`)
    const d = book.data
    const body = (await this.chapters(slug)).map((c) => c.body.trim()).filter(Boolean).join('\n\n')
    const cited = new Set(citedNumbers(body))
    const sources = (await new FactBase(this).sources(slug)).filter((s) => cited.has(s.n))
    const published = typeof d.published === 'string' ? new Date(d.published) : new Date()
    const input = {
      headline: d.headline?.trim() || d.title,
      standfirst: d.standfirst?.trim() ?? '',
      section: d.topic_name ?? '',
      byline: d.author ?? '',
      date: Number.isNaN(published.getTime()) ? new Date() : published,
      body,
      sources
    }
    const html = this.file(slug, 'out', 'article.html')
    await fs.mkdir(path.dirname(html), { recursive: true })
    await atomicWrite(html, buildArticleHtml(input))
    await atomicWrite(this.file(slug, 'out', 'article.md'), buildArticleMarkdown(input))
    return html
  }

  /** Writes books/<slug>/out/reader/ (unzipped XHTML, CSS, cover, index.html) for the in-app reader. An article has no reader: its page is written instead. */
  async buildReader(slug: string): Promise<string> {
    const book = await this.read(slug)
    if (!book) throw new Error(`no book ${slug}`)
    const d = book.data
    if (d.article === true) return path.dirname(await this.buildArticle(slug))
    const chapters = [...(await this.chapters(slug))]
    const refs = await this.references(slug)
    const script = d.script === true
    const links = await this.choiceLinks(slug, chapters)
    const cover = this.file(slug, 'out', 'cover.png')
    const dir = this.file(slug, 'out', 'reader')
    await writeReaderDir(dir, {
      title: d.title,
      author: d.author ?? 'Unknown',
      blurb: typeof d.blurb === 'string' ? d.blurb : undefined,
      year: Number(d.year ?? new Date().getFullYear()),
      genreClass: typeof d.genre_class === 'string' ? d.genre_class : undefined,
      chapters: [...chapters.map((c) => ({ title: c.title, body: c.body, script, ...links(c) })), ...(refs ? [refs] : [])],
      coverPngPath: await fs.access(cover).then(() => cover, () => undefined)
    })
    return dir
  }

  /**
   * Writes books/<slug>/out/draft/ for reading a book that isn't finished: the chapters written so far, then a page
   * with the chapters the outline still plans, and your notes. Returns the folder relative to the data folder and its
   * pages in reading order (`n` is the chapter number, absent on the extra pages).
   */
  async buildDraft(slug: string): Promise<{ dir: string; pages: { file: string; title: string; n?: number }[] }> {
    const book = await this.read(slug)
    if (!book) throw new Error(`no book ${slug}`)
    const d = book.data
    const chapters = await this.chapters(slug)
    const outline = await this.outline(slug)
    const written = new Set(chapters.map((c) => c.n))
    const todo = (outline?.chapters ?? []).filter((c) => !written.has(c.n))
    const words = chapters.reduce((s, c) => s + c.words, 0)
    const planned = outline ? `${chapters.length} of ${outline.chapters.length} chapters` : `${chapters.length} chapter(s), no outline yet`
    const extra: { title: string; body: string }[] = []
    if (todo.length) extra.push({ title: 'Still to come', body: todo.map((c) => `**Chapter ${c.n}: ${c.title}**\n\n${c.summary}`).join('\n\n') })
    const notes = await this.ownerNotes(slug)
    if (notes) extra.push({ title: 'Your notes', body: notes })
    await writeReaderDir(this.file(slug, 'out', 'draft'), {
      title: d.title,
      author: d.author ?? 'Unknown',
      blurb: `Draft: ${planned}, ${words} words. Stage: ${d.stage}${d.round ? `, round ${d.round}` : ''}.`,
      year: new Date().getFullYear(),
      genreClass: typeof d.genre_class === 'string' ? d.genre_class : undefined,
      chapters: [...chapters.map((c) => ({ title: `${c.title} (${c.words} words${c.round ? `, rewrite ${c.round}` : ''})`, body: c.body })), ...extra]
    })
    // the reader names its pages chapter-01.xhtml, chapter-02.xhtml ... in this order
    const file = (i: number) => `chapter-${String(i + 1).padStart(2, '0')}.xhtml`
    const pages = [
      ...chapters.map((c, i) => ({ file: file(i), title: `Chapter ${c.n}: ${c.title}`, n: c.n })),
      ...extra.map((x, i) => ({ file: file(chapters.length + i), title: x.title }))
    ]
    return { dir: ['books', slug, 'out', 'draft'].join('/'), pages }
  }

  /** Your notes for this book (the body of notes.md), oldest first. Writers follow them. */
  async ownerNotes(slug: string): Promise<string> {
    const t = await this.readText(slug, 'notes.md')
    return t === null ? '' : parseMd(t).body.trim()
  }

  /** Adds one of your notes to notes.md, with the date and the chapter it is about. */
  addOwnerNote(slug: string, text: string, chapter?: number | null): Promise<void> {
    return this.withLock(slug, async () => {
      const file = this.file(slug, 'notes.md')
      let doc: { data: Record<string, unknown>; body: string }
      try {
        doc = await readMd(file)
      } catch {
        doc = { data: { kind: 'book-notes', book: slug }, body: '' }
      }
      const when = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const line = `- ${when}${chapter ? ` (chapter ${chapter})` : ''}: ${text.trim().replace(/\r?\n/g, '\n  ')}`
      await writeMd(file, doc.data, `${doc.body.trimEnd()}${doc.body.trim() ? '\n' : ''}${line}\n`)
    })
  }

  /** Builds out/<slug>.epub from the files, with out/cover.png when it exists. An article has no EPUB: its page is written instead and its path returned. */
  async buildEpubFile(slug: string): Promise<string> {
    const book = await this.read(slug)
    if (!book) throw new Error(`no book ${slug}`)
    const d = book.data
    if (d.article === true) return this.buildArticle(slug)
    const chapters = await this.chapters(slug)
    const refs = await this.references(slug)
    const links = await this.choiceLinks(slug, chapters)
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
      chapters: [...chapters.map((c) => ({ title: c.title, body: c.body, script: d.script === true, ...links(c) })), ...(refs ? [refs] : [])],
      coverPng
    })
    const out = this.file(slug, 'out', `${slug}.epub`)
    await fs.mkdir(path.dirname(out), { recursive: true })
    await fs.writeFile(out, bytes)
    await this.buildReader(slug)
    return out
  }
}
