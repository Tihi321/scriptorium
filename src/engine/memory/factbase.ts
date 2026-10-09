import { parseMd } from '../../shared/md'
import type { BookStore } from '../pipeline/books'
import type { NoteFile } from '../research/notes'
import { writeMd } from '../store/atomic'

/** One numbered source. The number is what the text cites in square brackets, for example `[3]`. */
export interface SourceEntry {
  n: number
  url: string
  title: string
  retrieved: string
}

export interface KeyFact {
  fact: string
  /** Source numbers (see `SourceEntry`). A fact without a valid source is never kept. */
  sources: number[]
}

export interface Term {
  term: string
  definition: string
}

export interface Thesis {
  thesis: string
  audience: string
  style: string
  /** The outline in one line per chapter, for the reader of the fact base. */
  structure: string[]
}

/** `[3]`, `[3, 4]` and `[3][4]` in a text: the source numbers it cites. */
export function citedNumbers(text: string): number[] {
  const out = new Set<number>()
  for (const m of text.matchAll(/\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g)) for (const x of m[1]!.split(/[,;]/)) out.add(Number(x))
  return [...out].sort((a, b) => a - b)
}

/** The source URL and date of every note line, written as `[n]` instead, for a prompt. Unverified lines say so. */
export function numberedNoteText(text: string, sources: SourceEntry[]): string {
  const byUrl = new Map(sources.map((s) => [s.url, s.n]))
  return text
    .replace(/\(source: (\S+?), \d{4}-\d{2}-\d{2}\)/g, (m, url: string) => (byUrl.has(url) ? `[${byUrl.get(url)}]` : m))
    .replace(/\(source: none, the model's own knowledge, [\d-]+; unverified\)/g, '(unverified, no source)')
}

/**
 * The fact base of a non-fiction book, in `books/<slug>/factbase/`:
 * `thesis.md` (argument, audience, style, structure), `terms.md`, `sources.md` (the numbered sources) and
 * `facts.md` (the key facts of each chapter, each with its source numbers). It takes the place of the story bible.
 * The architect writes the thesis and the first terms, the archivist adds the facts of each chapter after its research.
 */
export class FactBase {
  constructor(private readonly books: BookStore) {}

  private file(slug: string, name: string): string {
    return this.books.file(slug, 'factbase', name)
  }

  async writeThesis(slug: string, t: Thesis, terms: Term[]): Promise<void> {
    await writeMd(
      this.file(slug, 'thesis.md'),
      { kind: 'factbase', part: 'thesis', audience: t.audience, structure: t.structure },
      `\n# Argument\n\n${t.thesis.trim() || '(see the pitch)'}\n\n## Audience\n\n${t.audience.trim() || 'general readers'}\n\n## Style\n\n${t.style.trim() || '(see the format guidance)'}\n\n## Structure\n\n${t.structure.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
    )
    await this.writeTerms(slug, terms)
  }

  async thesis(slug: string): Promise<string> {
    const t = await this.books.readText(slug, 'factbase', 'thesis.md')
    return t ? parseMd(t).body.trim() : ''
  }

  async terms(slug: string): Promise<Term[]> {
    const t = await this.books.readText(slug, 'factbase', 'terms.md')
    const raw = t ? parseMd(t).data.terms : null
    return Array.isArray(raw) ? (raw as Term[]).filter((x) => x && x.term) : []
  }

  /** Adds terms (a term that is already there keeps its first definition). */
  async addTerms(slug: string, more: Term[]): Promise<void> {
    const have = await this.terms(slug)
    const seen = new Set(have.map((t) => t.term.toLowerCase()))
    for (const t of more) {
      const key = t.term.trim().toLowerCase()
      if (!key || !t.definition.trim() || seen.has(key)) continue
      seen.add(key)
      have.push({ term: t.term.trim(), definition: t.definition.trim() })
    }
    await this.writeTerms(slug, have)
  }

  private writeTerms(slug: string, terms: Term[]): Promise<void> {
    return writeMd(
      this.file(slug, 'terms.md'),
      { kind: 'factbase', part: 'terms', terms: terms.map((t) => ({ term: t.term.trim(), definition: t.definition.trim() })) },
      `\n# Terms\n\n${terms.map((t) => `- **${t.term.trim()}**: ${t.definition.trim()}`).join('\n') || '(none yet)'}\n`
    )
  }

  async sources(slug: string): Promise<SourceEntry[]> {
    const t = await this.books.readText(slug, 'factbase', 'sources.md')
    const raw = t ? parseMd(t).data.sources : null
    return Array.isArray(raw) ? (raw as SourceEntry[]).filter((s) => s && s.url && Number.isFinite(Number(s.n))).map((s) => ({ n: Number(s.n), url: String(s.url), title: String(s.title ?? ''), retrieved: String(s.retrieved ?? '') })) : []
  }

  /**
   * Gives every source of these notes a number, in order of first use, and writes `sources.md`.
   * Numbers never change once given, so the `[n]` in the chapters stay right. Unverified notes have no sources and add none.
   */
  async syncSources(slug: string, notes: NoteFile[]): Promise<SourceEntry[]> {
    const list = await this.sources(slug)
    const known = new Set(list.map((s) => s.url))
    let changed = false
    for (const note of notes) {
      if (note.unverified) continue
      for (const src of note.sources) {
        if (known.has(src.url)) continue
        known.add(src.url)
        list.push({ n: Math.max(0, ...list.map((s) => s.n)) + 1, url: src.url, title: src.title, retrieved: src.retrieved })
        changed = true
      }
    }
    if (changed) {
      await writeMd(
        this.file(slug, 'sources.md'),
        { kind: 'factbase', part: 'sources', sources: list },
        `\n# Sources\n\nThe numbers are cited in the text in square brackets.\n\n${list.map((s) => `${s.n}. ${s.title ? `${s.title}. ` : ''}${s.url} (retrieved ${s.retrieved})`).join('\n')}\n`
      )
    }
    return list
  }

  /** Key facts per chapter. A chapter that is in the map has had its fact step, even when it has no facts. */
  async facts(slug: string): Promise<Map<number, KeyFact[]>> {
    const t = await this.books.readText(slug, 'factbase', 'facts.md')
    const raw = t ? parseMd(t).data.chapters : null
    const out = new Map<number, KeyFact[]>()
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (Array.isArray(v)) out.set(Number(k), (v as KeyFact[]).filter((f) => f && f.fact).map((f) => ({ fact: String(f.fact), sources: (f.sources ?? []).map(Number) })))
      }
    }
    return out
  }

  async setChapterFacts(slug: string, n: number, facts: KeyFact[]): Promise<void> {
    const all = await this.facts(slug)
    all.set(n, facts)
    const sorted = [...all.entries()].sort((a, b) => a[0] - b[0])
    await writeMd(
      this.file(slug, 'facts.md'),
      { kind: 'factbase', part: 'facts', chapters: Object.fromEntries(sorted.map(([k, v]) => [String(k), v])) },
      `\n# Key facts\n\nEach fact ends with the numbers of its sources (see sources.md).\n\n${sorted.map(([k, v]) => `## Chapter ${k}\n\n${v.map((f) => `- ${f.fact} ${f.sources.map((s) => `[${s}]`).join('')}`).join('\n') || '(no sourced facts found)'}`).join('\n\n')}\n`
    )
  }

  /** The chapters whose fact step is done. */
  async doneChapters(slug: string): Promise<Set<number>> {
    return new Set((await this.facts(slug)).keys())
  }

  /** The numbered sources as lines: `[3] Title. URL`. */
  sourceLines(list: SourceEntry[], only?: Iterable<number>): string {
    const keep = only ? new Set(only) : null
    return list
      .filter((s) => !keep || keep.has(s.n))
      .map((s) => `[${s.n}] ${s.title ? `${s.title}. ` : ''}${s.url}`)
      .join('\n')
  }

  /** Facts as prompt lines. */
  factLines(facts: KeyFact[]): string {
    return facts.map((f) => `- ${f.fact} ${f.sources.map((s) => `[${s}]`).join('')}`).join('\n')
  }

  /** A short text of the whole fact base for reviewers and prompts that don't need the details. */
  async digest(slug: string): Promise<string> {
    const thesis = await this.thesis(slug)
    const terms = await this.terms(slug)
    const facts = await this.facts(slug)
    const sources = await this.sources(slug)
    const parts = [thesis ? `## Argument and structure\n${thesis.replace(/^# .*\n+/, '')}` : '']
    if (terms.length) parts.push(`## Terms\n${terms.map((t) => `- ${t.term}: ${t.definition}`).join('\n')}`)
    if (facts.size) parts.push(`## Key facts by chapter\n${[...facts.entries()].sort((a, b) => a[0] - b[0]).map(([n, f]) => `Chapter ${n}:\n${this.factLines(f)}`).join('\n')}`)
    if (sources.length) parts.push(`## Numbered sources\n${this.sourceLines(sources)}`)
    return parts.filter(Boolean).join('\n\n') || '(the fact base is empty)'
  }
}

/**
 * The references section of a non-fiction book: the sources the chapters actually cite, by number, as paragraphs.
 * Null when no chapter cites a known source.
 */
export async function buildReferences(books: BookStore, factbase: FactBase, slug: string): Promise<{ title: string; body: string } | null> {
  const sources = await factbase.sources(slug)
  if (sources.length === 0) return null
  const cited = new Set<number>()
  for (const c of await books.chapters(slug)) for (const n of citedNumbers(c.body)) cited.add(n)
  const used = sources.filter((s) => cited.has(s.n))
  if (used.length === 0) return null
  const lines = used.map((s) => `[${s.n}] ${s.title ? `${s.title.replace(/\s+/g, ' ').trim()}. ` : ''}${s.url}. Retrieved ${s.retrieved}.`)
  return {
    title: 'References',
    body: `The numbers in square brackets in the text refer to these sources. The facts were collected by an AI researcher from the pages named here and written up in the book's own words.\n\n${lines.join('\n\n')}`
  }
}
