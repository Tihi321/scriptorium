import { promises as fs } from 'node:fs'
import { z } from 'zod'
import { parseMd } from '../../shared/md'
import type { BookStore } from '../pipeline/books'
import { writeMd } from '../store/atomic'

/** The most open threads a long book should carry at once. Above this the archivist's notes say so. */
export const MAX_OPEN_THREADS = 12

export const memoryUpdateSchema = z.object({
  summary: z.string().min(10),
  characters: z.array(z.object({ name: z.string(), update: z.string(), description: z.string().default(''), aliases: z.array(z.string()).default([]) })).default([]),
  places: z.array(z.object({ name: z.string(), update: z.string(), description: z.string().default(''), aliases: z.array(z.string()).default([]) })).default([]),
  threads_opened: z.array(z.string()).default([]),
  /** Ids (`t3`) of threads that were closed in this chapter. */
  threads_closed: z.array(z.string()).default([]),
  timeline: z.array(z.string()).default([])
})
export type MemoryUpdate = z.infer<typeof memoryUpdateSchema>

export interface BibleEntry {
  group: 'characters' | 'places'
  slug: string
  name: string
  voice: string
  /** Other names the entry is known by (`aliases` in its file): a first name, a nickname, a title. */
  aliases: string[]
  /** The entry's whole text: description plus the updates chapter by chapter. */
  text: string
}

export interface Thread {
  id: string
  text: string
  status: 'open' | 'closed'
  opened: number
  closed?: number
}

export interface InitialBible {
  setting?: string
  style?: string
  characters: { name: string; description: string; voice?: string }[]
  places?: { name: string; description: string }[]
  threads?: string[]
}

/**
 * The key two names must share to be the same entry: lowercase, punctuation and a leading article
 * ("the", "a", "an") removed. "The Lighthouse Cottage" and "lighthouse-cottage" give the same key.
 */
export function entryKey(name: string): string {
  const words = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`"“”.,;:!?()[\]]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  while (words.length > 1 && ['the', 'a', 'an'].includes(words[0]!)) words.shift()
  return words.join('-') || 'untitled'
}

const words = (name: string) => new Set(entryKey(name).split('-').filter(Boolean))

/** Two names are the same person or place when one has all the words of the other ("Dec Hartley", "Declan 'Dec' Hartley"). */
export function sameName(a: string, b: string): boolean {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return false
  const [small, big] = x.size <= y.size ? [x, y] : [y, x]
  return [...small].every((w) => big.has(w))
}

/** The names of an entry as a list, deduplicated by key, without the entry's own name. */
const mergeAliases = (own: string, ...lists: string[][]): string[] => {
  const seen = new Set([entryKey(own)])
  const out: string[] = []
  for (const a of lists.flat().map((x) => x.trim())) {
    if (!a || seen.has(entryKey(a))) continue
    seen.add(entryKey(a))
    out.push(a)
  }
  return out
}

/** `T3`, `#t3` and ` t3 ` all mean thread `t3`. */
export const normThreadId = (id: string) => id.trim().toLowerCase().replace(/^#/, '')

export class Bible {
  constructor(private readonly books: BookStore) {}

  private entryFile(slug: string, group: string, name: string): string {
    return this.books.file(slug, 'bible', group, `${entryKey(name).slice(0, 60)}.md`)
  }

  private async readEntryDoc(file: string): Promise<{ data: Record<string, unknown>; body: string } | null> {
    try {
      return parseMd(await fs.readFile(file, 'utf8'))
    } catch {
      return null
    }
  }

  /**
   * The file for a character or place: an existing entry whose name has the same key
   * (see `entryKey`) is reused, so "lighthouse-cottage" and "the-lighthouse-cottage" are one entry.
   * A name that matches nothing gets a new file.
   */
  async resolveEntryFile(slug: string, group: 'characters' | 'places', name: string): Promise<string> {
    return (await this.resolveEntry(slug, group, name)).file
  }

  /**
   * Finds the entry a name belongs to, in this order: the same key as the file name or the entry's name; an entry that lists the name
   * (or one of the update's own `aliases`) in its `aliases`; the one entry that has all the words of the name, or whose name has all
   * the words of this one ("Dec" is "Dec Hartley"). Two or more entries that fit ("Hartley" with a Dec and a Mara Hartley) are no match:
   * the name gets a new entry and `ambiguous` lists the entries it could have been. `how` says how it was found.
   */
  async resolveEntry(
    slug: string,
    group: 'characters' | 'places',
    name: string,
    aliases: string[] = []
  ): Promise<{ file: string; how: 'exact' | 'alias' | 'subset' | 'new'; ambiguous?: string[] }> {
    let names: string[] = []
    try {
      names = (await fs.readdir(this.books.file(slug, 'bible', group))).filter((f) => f.endsWith('.md')).sort()
    } catch {
      /* no entries yet */
    }
    const list: { file: string; stem: string; name: string; aliases: string[] }[] = []
    for (const n of names) {
      const file = this.books.file(slug, 'bible', group, n)
      const doc = await this.readEntryDoc(file)
      list.push({ file, stem: n.slice(0, -3), name: typeof doc?.data.name === 'string' ? doc.data.name : n.slice(0, -3), aliases: Array.isArray(doc?.data.aliases) ? doc.data.aliases.map(String) : [] })
    }
    const exact = (nm: string) => {
      const key = entryKey(nm)
      return list.find((e) => entryKey(e.stem) === key) ?? list.find((e) => entryKey(e.name) === key)
    }
    const listed = (nm: string) => {
      const key = entryKey(nm)
      return list.find((e) => e.aliases.some((a) => entryKey(a) === key))
    }
    const hit = exact(name)
    if (hit) return { file: hit.file, how: 'exact' }
    const byAlias = listed(name)
    if (byAlias) return { file: byAlias.file, how: 'alias' }
    for (const a of aliases.filter((x) => x.trim())) {
      const found = exact(a) ?? listed(a)
      if (found) return { file: found.file, how: 'alias' }
    }
    const subset = list.filter((e) => sameName(name, e.name) || sameName(name, e.stem))
    if (subset.length === 1) return { file: subset[0]!.file, how: 'subset' }
    return { file: this.entryFile(slug, group, name), how: 'new', ...(subset.length > 1 ? { ambiguous: subset.map((e) => e.name) } : {}) }
  }

  /** The structured bible for a long book: characters/ and places/ (one file each), threads.md, timeline.md, style.md. */
  async writeInitial(slug: string, b: InitialBible): Promise<void> {
    // the outline can list the same entry twice under slightly different names: the first one wins, the description of a repeat is added to it
    const put = async (group: 'characters' | 'places', kind: string, name: string, description: string, voice: string) => {
      const file = await this.resolveEntryFile(slug, group, name)
      const old = await this.readEntryDoc(file)
      await writeMd(file, old ? old.data : { kind, name, voice }, old ? `${old.body.replace(/\s*$/, '\n')}\n${description.trim()}\n` : `\n${description.trim()}\n`)
    }
    for (const c of b.characters) await put('characters', 'character', c.name, c.description, c.voice ?? '')
    for (const p of b.places ?? []) await put('places', 'place', p.name, p.description, '')
    await this.writeThreads(
      slug,
      (b.threads ?? []).map((text, i) => ({ id: `t${i + 1}`, text, status: 'open' as const, opened: 0 }))
    )
    await writeMd(this.books.file(slug, 'bible', 'timeline.md'), { kind: 'timeline', events: [] }, '\n# Timeline\n\n(nothing yet)\n')
    await writeMd(this.books.file(slug, 'bible', 'style.md'), { kind: 'style' }, `\n# Style\n\n${b.style?.trim() || '(see the format guidance)'}\n\n## Setting\n\n${b.setting?.trim() || '(see the pitch)'}\n`)
  }

  async style(slug: string): Promise<string> {
    const t = await this.books.readText(slug, 'bible', 'style.md')
    return t ? parseMd(t).body.trim() : ''
  }

  async entries(slug: string): Promise<BibleEntry[]> {
    const out: BibleEntry[] = []
    for (const group of ['characters', 'places'] as const) {
      let names: string[]
      try {
        names = (await fs.readdir(this.books.file(slug, 'bible', group))).filter((f) => f.endsWith('.md')).sort()
      } catch {
        continue
      }
      for (const n of names) {
        const doc = parseMd(await fs.readFile(this.books.file(slug, 'bible', group, n), 'utf8'))
        out.push({
          group,
          slug: n.slice(0, -3),
          name: String(doc.data.name ?? n.slice(0, -3)),
          voice: String(doc.data.voice ?? ''),
          aliases: Array.isArray(doc.data.aliases) ? doc.data.aliases.map(String) : [],
          text: doc.body.trim()
        })
      }
    }
    return out
  }

  /** A short text of the whole bible for reviewers: every entry cut to its first lines, then the open threads. */
  async digest(slug: string): Promise<string> {
    const entries = await this.entries(slug)
    const lines = entries.map((e) => `- ${e.name}${e.aliases.length ? ` (also: ${e.aliases.join(', ')})` : ''}${e.voice ? ` (voice: ${e.voice})` : ''}: ${e.text.replace(/\s+/g, ' ').slice(0, 280)}`)
    const open = (await this.threads(slug)).filter((t) => t.status === 'open')
    const threads = open.length ? 'Open threads:\n' + open.map((t) => `- ${t.text}`).join('\n') : ''
    return [lines.join('\n') || '(no entries)', threads].filter(Boolean).join('\n\n')
  }

  async threads(slug: string): Promise<Thread[]> {
    const t = await this.books.readText(slug, 'bible', 'threads.md')
    if (!t) return []
    const raw = parseMd(t).data.threads
    return Array.isArray(raw) ? (raw as Thread[]) : []
  }

  private async writeThreads(slug: string, threads: Thread[]): Promise<void> {
    const open = threads.filter((t) => t.status === 'open')
    const closed = threads.filter((t) => t.status === 'closed')
    await writeMd(
      this.books.file(slug, 'bible', 'threads.md'),
      { kind: 'threads', threads },
      `\n# Open threads (${open.length}, at most ${MAX_OPEN_THREADS})\n\n${open.map((t) => `- ${t.id}: ${t.text} (opened ch ${t.opened})`).join('\n') || '(none)'}\n\n# Closed\n\n${closed.map((t) => `- ${t.id}: ${t.text} (closed ch ${t.closed})`).join('\n') || '(none)'}\n`
    )
  }

  /** Closes open threads by id (the end-of-book thread check found them resolved in the text). Returns the ids it closed. */
  async closeThreads(slug: string, ids: string[], chapter: number): Promise<string[]> {
    const threads = await this.threads(slug)
    const closed: string[] = []
    for (const id of ids) {
      const t = threads.find((x) => x.id === normThreadId(id) && x.status === 'open')
      if (t) {
        t.status = 'closed'
        t.closed = chapter
        closed.push(t.id)
      }
    }
    if (closed.length) await this.writeThreads(slug, threads)
    return closed
  }

  async timeline(slug: string): Promise<{ chapter: number; event: string }[]> {
    const t = await this.books.readText(slug, 'bible', 'timeline.md')
    if (!t) return []
    const raw = parseMd(t).data.events
    return Array.isArray(raw) ? (raw as { chapter: number; event: string }[]) : []
  }

  /** Applies what the archivist found in chapter `n`. Call it only while holding the book's bible lock. */
  async apply(slug: string, n: number, u: MemoryUpdate): Promise<{ openThreads: number; warnings: string[] }> {
    const warnings: string[] = []
    for (const [group, list] of [['characters', u.characters], ['places', u.places]] as const) {
      for (const e of list) {
        if (!e.name.trim()) continue
        const res = await this.resolveEntry(slug, group, e.name, e.aliases)
        if (res.ambiguous) warnings.push(`"${e.name.trim()}" could be ${res.ambiguous.map((x) => `"${x}"`).join(' or ')}: a new entry was made (use the full name from the list)`)
        const file = res.file
        let data: Record<string, unknown> = { kind: group === 'characters' ? 'character' : 'place', name: e.name.trim(), voice: '', first_chapter: n }
        let body = `\n${e.description.trim() || '(new in this chapter)'}\n`
        try {
          const doc = parseMd(await fs.readFile(file, 'utf8'))
          data = doc.data
          body = doc.body
        } catch {
          /* a new entry */
        }
        if (e.update.trim()) body = body.replace(/\s*$/, '\n') + `\n- Ch ${n}: ${e.update.trim()}\n`
        // the name it was found under, and the update's own aliases, are other names of the entry
        const own = typeof data.name === 'string' ? data.name : e.name.trim()
        const known = Array.isArray(data.aliases) ? data.aliases.map(String) : []
        const aliasesNow = mergeAliases(own, known, res.how === 'alias' || res.how === 'subset' ? [e.name] : [], e.aliases)
        if (aliasesNow.length) data = { ...data, aliases: aliasesNow }
        await writeMd(file, data, body)
      }
    }
    const threads = await this.threads(slug)
    let next = threads.reduce((m, t) => Math.max(m, Number(/\d+/.exec(t.id)?.[0] ?? 0)), 0)
    for (const text of u.threads_opened) if (text.trim()) threads.push({ id: `t${++next}`, text: text.trim(), status: 'open', opened: n })
    for (const id of u.threads_closed) {
      const want = normThreadId(id)
      const t = threads.find((x) => x.id === want && x.status === 'open')
      if (t) {
        t.status = 'closed'
        t.closed = n
      }
    }
    await this.writeThreads(slug, threads)
    const open = threads.filter((t) => t.status === 'open').length
    if (open > MAX_OPEN_THREADS) warnings.push(`${open} open threads, more than the limit of ${MAX_OPEN_THREADS}: the next chapters should close some`)

    if (u.timeline.length) {
      const events = [...(await this.timeline(slug)).filter((e) => e.chapter !== n), ...u.timeline.map((event) => ({ chapter: n, event }))]
      await writeMd(this.books.file(slug, 'bible', 'timeline.md'), { kind: 'timeline', events }, `\n# Timeline\n\n${events.map((e) => `- Ch ${e.chapter}: ${e.event}`).join('\n')}\n`)
    }
    return { openThreads: open, warnings }
  }
}
