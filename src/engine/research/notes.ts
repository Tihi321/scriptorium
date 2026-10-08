import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import { writeMd } from '../store/atomic'

/** Lowercase words of a question: the key under which notes and research jobs are matched. "How long did it take?" and "how long did it take" are one question. */
export function questionKey(question: string): string {
  return (question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ')
}

export const questionHash = (question: string): string => createHash('sha1').update(questionKey(question)).digest('hex').slice(0, 10)

/** The id of the research job for a question: the same question in the same scope is the same job. */
export const researchJobId = (book: string | null, question: string): string => `research--${book ?? 'shared'}--${questionHash(question)}--r0`

export interface NoteFact {
  fact: string
  /** Where it came from. Missing for facts from the model's own knowledge (those notes are `unverified`). */
  source?: { url: string; title?: string }
}

export interface NoteFile {
  /** Path relative to the data folder, forward slashes. */
  file: string
  /** The book it belongs to, or null for a shared note. */
  book: string | null
  slug: string
  question: string
  unverified: boolean
  body: string
  created: string
  /** The pages the facts come from (empty for unverified notes). */
  sources: { url: string; title: string; retrieved: string }[]
}

const stampOf = (d = new Date()) => d.toISOString().slice(0, 10)

/** Research notes as markdown files: `research/<slug>.md` (shared) and `books/<book>/research/<slug>.md`. */
export class ResearchStore {
  constructor(private readonly dataDir: string) {}

  dirFor(book: string | null): string {
    return book ? path.join(this.dataDir, 'books', book, 'research') : path.join(this.dataDir, 'research')
  }

  relDir(book: string | null): string {
    return book ? `books/${book}/research` : 'research'
  }

  private async readNote(book: string | null, name: string): Promise<NoteFile | null> {
    try {
      const doc = parseMd(await fs.readFile(path.join(this.dirFor(book), name), 'utf8'))
      const slug = name.replace(/\.md$/, '')
      return {
        file: `${this.relDir(book)}/${name}`,
        book,
        slug,
        question: String(doc.data.question ?? slug),
        unverified: doc.data.unverified === true,
        body: doc.body.trim(),
        created: String(doc.data.created ?? ''),
        sources: (Array.isArray(doc.data.sources) ? (doc.data.sources as Record<string, unknown>[]) : [])
          .filter((x) => x && typeof x.url === 'string')
          .map((x) => ({ url: String(x.url), title: String(x.title ?? ''), retrieved: String(x.retrieved ?? doc.data.created ?? '') }))
      }
    } catch {
      return null
    }
  }

  async list(book: string | null): Promise<NoteFile[]> {
    let names: string[]
    try {
      names = (await fs.readdir(this.dirFor(book))).filter((f) => f.endsWith('.md')).sort()
    } catch {
      return []
    }
    const out: NoteFile[] = []
    for (const n of names) {
      const note = await this.readNote(book, n)
      if (note) out.push(note)
    }
    return out
  }

  /** The notes a book can use: its own and the shared ones. */
  async available(book: string | null): Promise<NoteFile[]> {
    return [...(book ? await this.list(book) : []), ...(await this.list(null))]
  }

  /** A note that answers exactly this question (same words), in the book's notes first, then the shared notes. */
  async findExact(question: string, book: string | null): Promise<NoteFile | null> {
    const key = questionKey(question)
    if (!key) return null
    for (const scope of book ? [book, null] : [null]) {
      const hit = (await this.list(scope)).find((n) => questionKey(n.question) === key)
      if (hit) return hit
    }
    return null
  }

  /** A free file name for a question inside one folder. */
  private async freeSlug(book: string | null, question: string): Promise<string> {
    const base = (questionKey(question).replace(/ /g, '-').slice(0, 56).replace(/-+$/, '') || 'note') as string
    let slug = base
    for (let i = 2; await fs.access(path.join(this.dirFor(book), `${slug}.md`)).then(() => true, () => false); i++) slug = `${base}-${i}`
    return slug
  }

  /**
   * Writes a note. The facts are in the researcher's own words, one per line, each with its source URL and the date it was read.
   * `unverified: true` marks notes that come from the model's own knowledge.
   */
  async write(o: { question: string; book: string | null; facts: NoteFact[]; unverified: boolean; askedBy: string; purpose?: string; provider?: string; idea?: string; now?: Date }): Promise<NoteFile> {
    const date = stampOf(o.now)
    const slug = await this.freeSlug(o.book, o.question)
    const sources = [...new Map(o.facts.filter((f) => f.source).map((f) => [f.source!.url, { url: f.source!.url, title: f.source!.title ?? '', retrieved: date }])).values()]
    const lines = o.facts.map((f) => `- ${f.fact.replace(/\s+/g, ' ').trim()} ${f.source ? `(source: ${f.source.url}, ${date})` : `(source: none, the model's own knowledge, ${date}; unverified)`}`)
    const body = `\n# ${o.question.replace(/\s+/g, ' ').trim()}\n\n${o.unverified ? '**Unverified:** no web source was found. These facts come from the model\'s own knowledge. Treat them with suspicion.\n\n' : ''}${lines.join('\n')}\n`
    const file = path.join(this.dirFor(o.book), `${slug}.md`)
    await writeMd(
      file,
      {
        kind: 'research',
        question: o.question.replace(/\s+/g, ' ').trim(),
        scope: o.book ? 'book' : 'shared',
        book: o.book,
        ...(o.idea ? { idea: o.idea } : {}),
        created: date,
        asked_by: o.askedBy,
        ...(o.purpose ? { purpose: o.purpose } : {}),
        ...(o.provider ? { provider: o.provider } : {}),
        unverified: o.unverified,
        sources
      },
      body
    )
    return (await this.readNote(o.book, `${slug}.md`))!
  }
}

/** The note text a writer sees: the facts, framed as data. */
export function formatNote(n: NoteFile, maxChars = 1800): string {
  const body = n.body.replace(/^# .*\n+/, '').trim()
  const cut = body.length > maxChars ? body.slice(0, maxChars).replace(/\n[^\n]*$/, '') + '\n- (more facts in the file)' : body
  return `### ${n.question}${n.unverified ? ' (unverified)' : ''}\n${cut}`
}
