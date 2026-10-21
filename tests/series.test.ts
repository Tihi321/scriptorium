import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Bible } from '../src/engine/memory/bible'
import { buildDraftContext } from '../src/engine/memory/context'
import type { MemoryIndex } from '../src/engine/memory/index'
import { BookStore } from '../src/engine/pipeline/books'
import { pickNext } from '../src/engine/pipeline/handlers'
import { seriesSection, withSeriesBible } from '../src/engine/pipeline/series'
import { writeMd } from '../src/engine/store/atomic'
import { initDataFolder } from '../src/engine/store/dataFolder'
import type { IdeaFile } from '../src/engine/store/ideas'
import { nextSeriesIndex, SeriesStore, waitingStories } from '../src/engine/store/series'
import type { BookRef } from '../src/engine/store/series'
import { emptyBrief, parseBrief } from '../src/shared/brief'
import type { StoryBrief } from '../src/shared/brief'
import { parseMd } from '../src/shared/md'
import type { FormatEntry } from '../src/shared/schemas'
import { makePipelineEnv, seedDir, waitFor } from './helpers'
import type { TestEnv } from './helpers'

let env: TestEnv | undefined
const temps: string[] = []
afterEach(async () => {
  await env?.cleanup()
  env = undefined
  for (const d of temps.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

const seriesBrief: StoryBrief = {
  ...emptyBrief(),
  title: 'The Ninth Hour',
  genre: 'Comic mystery',
  premise: 'A fraternity of clock worshippers hides behind Paris.',
  characters: [
    { name: 'Declan "Dec" Hartley', role: 'Irish locksmith', description: 'Talks too much.' },
    { name: 'Ines Varga', role: 'paintings restorer', description: 'Dry and exact.' }
  ],
  setting: 'Present-day Europe, Clockmaker Street in Paris and the catacombs.',
  style: 'Comic adventure. Jokes come from the characters.'
}

const tempDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-series-'))
  temps.push(dir)
  return dir
}

describe('the series store', () => {
  it('writes a series file that reads back, and keeps the books when it is changed', async () => {
    const dir = await tempDir()
    const store = new SeriesStore(dir)
    expect(await store.list()).toEqual([]) // no series/ folder yet
    const s = await store.create(seriesBrief)
    expect(s.slug).toBe('the-ninth-hour')
    const raw = parseMd(await readFile(path.join(dir, 'series', 'the-ninth-hour.md'), 'utf8'))
    expect(raw.data).toMatchObject({ kind: 'series', title: 'The Ninth Hour', genre: 'Comic mystery', books: [] })
    expect(typeof raw.data.created).toBe('string')
    expect(parseBrief(raw.body)).toMatchObject({ premise: seriesBrief.premise, setting: seriesBrief.setting, characters: seriesBrief.characters })
    expect(s.brief).toMatchObject({ title: 'The Ninth Hour', genre: 'Comic mystery', characters: seriesBrief.characters })

    await store.addBook('the-ninth-hour', 'case-one')
    await store.addBook('the-ninth-hour', 'case-one') // once
    await store.addBook('the-ninth-hour', 'case-two')
    const updated = await store.update('the-ninth-hour', { ...seriesBrief, premise: 'New arc.' })
    expect(updated.data.books).toEqual(['case-one', 'case-two'])
    expect(updated.brief.premise).toBe('New arc.')
    expect((await store.get('the-ninth-hour'))!.data.created).toBe(raw.data.created)

    expect((await store.create(seriesBrief)).slug).toBe('the-ninth-hour-2')
    await expect(store.create({ ...seriesBrief, title: ' ' })).rejects.toThrow(/needs a title/)
    await expect(store.update('nope', seriesBrief)).rejects.toThrow(/no series/)
    expect(await store.get('../x')).toBeNull()
  })

  it('is part of the data folder layout, also for a folder that exists without it', async () => {
    const dir = await tempDir()
    await initDataFolder(dir, seedDir)
    expect(existsSync(path.join(dir, 'series'))).toBe(true)
    await rm(path.join(dir, 'series'), { recursive: true })
    await initDataFolder(dir, seedDir)
    expect(existsSync(path.join(dir, 'series'))).toBe(true)
  })
})

// ---- the order gate ----

const idea = (slug: string, data: Record<string, unknown> = {}): IdeaFile => ({
  slug,
  file: `${slug}.md`,
  title: slug,
  body: '',
  createdMs: 0,
  data: { kind: 'idea', topic: null, status: 'open', source: 'user', format: null, book: null, ...data } as IdeaFile['data']
})
const book = (slug: string, stage: string, series: string, index: number): BookRef => ({ slug, title: slug, series, index, stage, score: null })
const formats = [{ id: 'novel', name: 'Novel', enabled: true, kinds: ['fiction'], words: [1, 2], chapters: [1, 2], guidance: '' }] as unknown as FormatEntry[]

describe('the series order gate', () => {
  it('holds book N back until the books before it are published', () => {
    const two = idea('two', { series: 's', series_index: 2 })
    const other = idea('other')
    // book 1 is being written: book 2 waits, an unrelated story goes first
    const refs = [book('one', 'drafting', 's', 1)]
    expect(waitingStories([two, other], refs)).toEqual(new Set(['two']))
    expect(pickNext([two, other], [], formats, refs)?.idea?.slug).toBe('other')
    expect(pickNext([two], [], formats, refs)).toBeNull()
    // rejected or failed is not published: it still waits
    expect(pickNext([two], [], formats, [book('one', 'rejected', 's', 1)])).toBeNull()
    // published: book 2 is next
    expect(pickNext([two], [], formats, [book('one', 'published', 's', 1)])?.idea?.slug).toBe('two')
    // book 1 itself is never held back, and a book of another series does not count
    expect(pickNext([idea('one', { series: 's', series_index: 1 })], [], formats, [])?.idea?.slug).toBe('one')
    expect(pickNext([two], [], formats, [book('x', 'drafting', 'other-series', 1)])?.idea?.slug).toBe('two')
  })

  it('also holds back a story while an earlier story of the series is still open', () => {
    const one = idea('one', { series: 's', series_index: 1 })
    const two = idea('two', { series: 's', series_index: 2 })
    const three = idea('three', { series: 's', series_index: 3 })
    expect(waitingStories([one, two, three], [])).toEqual(new Set(['two', 'three']))
    // book 1 was started (its idea is used) and is published: book 2 may go, book 3 waits for 2
    const used = idea('one', { series: 's', series_index: 1, status: 'used', book: 'b1' })
    expect(waitingStories([used, two, three], [book('b1', 'published', 's', 1)])).toEqual(new Set(['three']))
  })

  it('numbers the next book after the highest of its books and open stories', () => {
    expect(nextSeriesIndex('s', [], [])).toBe(1)
    expect(nextSeriesIndex('s', [book('b1', 'published', 's', 1), book('b2', 'drafting', 's', 2)], [idea('three', { series: 's', series_index: 3 }), idea('x', { series: 't', series_index: 9 })])).toBe(4)
  })
})

// ---- the engine: stories of a series ----

describe('stories of a series in the engine', () => {
  it('numbers the stories, refuses an unknown series, and announces the series', async () => {
    env = await makePipelineEnv({ factory: { paused: true } })
    const e = env.engine
    await expect(e.addStory({ ...emptyBrief(), title: 'Lost', series: 'no-such-series' })).rejects.toThrow(/no series "no-such-series"/)
    const s = await e.addSeries(seriesBrief)
    expect(env.events.some((ev) => ev.type === 'series.updated' && ev.series.some((x) => x.slug === s.slug))).toBe(true)
    const a = await e.addStory({ ...emptyBrief(), title: 'Case One', premise: 'x', series: s.slug })
    const b = await e.addStory({ ...emptyBrief(), title: 'Case Two', premise: 'y', series: s.slug })
    expect(a.data).toMatchObject({ series: s.slug, series_index: 1 })
    expect(b.data).toMatchObject({ series: s.slug, series_index: 2 })
    const file = parseMd(await readFile(b.file, 'utf8'))
    expect(file.data).toMatchObject({ series: s.slug, series_index: 2 })
    // an edit keeps the number; leaving the series drops it
    const kept = await e.updateStory(b.slug, { ...parseMdBrief(b), title: 'Case Two' })
    expect(kept.data.series_index).toBe(2)
    const out = await e.updateStory(b.slug, { ...parseMdBrief(kept), series: undefined })
    expect(out.data.series).toBeUndefined()
    expect(out.data.series_index).toBeUndefined()
    const snap = await e.snapshot()
    expect(snap.series).toHaveLength(1)
    expect(snap.series[0]).toMatchObject({ slug: s.slug, title: 'The Ninth Hour', books: [{ slug: a.slug, index: 1, kind: 'story', stage: 'story' }] })
    expect(snap.ideas.find((i) => i.slug === a.slug)).toMatchObject({ series: s.slug, seriesIndex: 1 })
    // the commands
    await e.handleCommand({ type: 'addSeries', brief: { ...emptyBrief(), title: 'Second Series' } })
    await e.handleCommand({ type: 'updateSeries', series: 'second-series', brief: { ...emptyBrief(), title: 'Second Series', premise: 'p' } })
    expect((await e.series.get('second-series'))!.brief.premise).toBe('p')
    await e.handleCommand({ type: 'addSeries', brief: emptyBrief() })
    expect(env.logs.some((l) => l.startsWith('addSeries:'))).toBe(true)
  })
})

const parseMdBrief = (i: IdeaFile): StoryBrief => {
  const doc = parseMd(`---\n---\n${i.body}`)
  return { ...parseBrief(doc.body), ...(i.data.series ? { series: i.data.series, seriesIndex: i.data.series_index } : {}) }
}

// ---- continuity: book 2 gets book 1 ----

/** Book 1 of the series as a published long book with summaries, a bible and open threads, written straight to the data folder. */
async function writeBookOne(dir: string, stage = 'published'): Promise<void> {
  const root = path.join(dir, 'books', 'case-one')
  await mkdir(path.join(root, 'summaries'), { recursive: true })
  await mkdir(path.join(root, 'bible', 'characters'), { recursive: true })
  await mkdir(path.join(root, 'bible', 'places'), { recursive: true })
  await writeMd(
    path.join(root, 'book.md'),
    { kind: 'book', slug: 'case-one', title: 'Case One', stage, format: 'novel', target_words: 5000, series: 'the-ninth-hour', series_index: 1, score: 8.4, blurb: 'BLURB-ONE: a locksmith opens the wrong door.', open_threads: ['t2: Who leads the inner circle?'] },
    '\n'
  )
  await writeMd(path.join(root, 'outline.md'), { kind: 'outline', chapters: [{ n: 1, title: 'The Door', summary: 's' }, { n: 2, title: 'The Bell', summary: 's' }], acts: [{ n: 1, title: 'Act I', chapters: [1, 2] }] }, '\n')
  await writeMd(path.join(root, 'summaries', 'act-1.md'), { kind: 'summary', act: 1 }, '\nACT-ONE-SUMMARY: Dec and Ines find the clock under the church.\n')
  await writeMd(path.join(root, 'summaries', 'ch-01.md'), { kind: 'summary', n: 1 }, '\nCHAPTER-ONE-SUMMARY: Dec picks a lock in Paris.\n')
  await writeMd(path.join(root, 'chapters', 'ch-01.md'), { kind: 'chapter', n: 1, title: 'The Door', round: 0 }, '\nDec picked the lock.\n')
  await writeMd(path.join(root, 'bible', 'characters', 'declan-dec-hartley.md'), { kind: 'character', name: 'Declan "Dec" Hartley', voice: 'rambling, Irish' }, '\nA locksmith.\n\n- Ch 1: Meets Ines.\n- Ch 2: END-STATE-DEC: lost his watch and his job.\n')
  await writeMd(path.join(root, 'bible', 'characters', 'brother-ambrose.md'), { kind: 'character', name: 'Brother Ambrose', voice: '' }, '\nA villain, not in the series cast.\n')
  await writeMd(path.join(root, 'bible', 'places', 'clockmaker-street.md'), { kind: 'place', name: 'Clockmaker Street' }, '\nA crooked street in Paris.\n')
  await writeMd(path.join(root, 'bible', 'threads.md'), { kind: 'threads', threads: [{ id: 't1', text: 'closed one', status: 'closed', opened: 1, closed: 2 }, { id: 't2', text: 'Who leads the inner circle?', status: 'open', opened: 1 }] }, '\n')
}

async function withBookOne(stage = 'published') {
  return makePipelineEnv({
    format: 'novel',
    smallNovel: true,
    beforeStart: async (dir) => {
      await new SeriesStore(dir).create(seriesBrief)
      await writeBookOne(dir, stage)
    }
  })
}

const stores = (dir: string) => {
  const books = new BookStore(dir)
  return { books, bible: new Bible(books), series: new SeriesStore(dir) }
}

/** Book 2 of the series, as a book folder with its series fields (nothing else is needed for the series code). */
async function writeBookTwo(dir: string, format = 'novel'): Promise<void> {
  const root = path.join(dir, 'books', 'case-two')
  await mkdir(root, { recursive: true })
  await writeMd(path.join(root, 'book.md'), { kind: 'book', slug: 'case-two', title: 'Case Two', stage: 'outlining', format, target_words: 5000, series: 'the-ninth-hour', series_index: 2 }, '\n')
}

describe('seriesSection', () => {
  it('has only the series header for book 1, and nothing for a book outside a series', async () => {
    const dir = await tempDir()
    const d = stores(dir)
    await d.series.create(seriesBrief)
    await writeBookOne(dir, 'drafting')
    const one = await seriesSection(d, 'case-one')
    expect(one).toContain('book 1 of the series "The Ninth Hour"')
    expect(one).toContain('A fraternity of clock worshippers')
    expect(one).toContain('Declan "Dec" Hartley')
    expect(one).toContain('first book of the series')
    expect(one).not.toContain('earlier books')
    await d.books.create('plain', { title: 'Plain', stage: 'new', format: 'novel', target_words: 5000 }, '')
    expect(await seriesSection(d, 'plain')).toBe('')
    expect(await seriesSection(d, 'no-such-book')).toBe('')
  })

  it('gives book 2 the title, blurb, summaries, the end state of the cast and the open threads of book 1, and stays bounded', async () => {
    const dir = await tempDir()
    const d = stores(dir)
    await d.series.create(seriesBrief)
    await writeBookOne(dir)
    await writeBookTwo(dir)
    const text = await seriesSection(d, 'case-two')
    for (const s of ['book 2 of the series', 'The earlier books of the series', 'Book 1: Case One (published)', 'BLURB-ONE', 'ACT-ONE-SUMMARY', 'CHAPTER-ONE-SUMMARY', 'END-STATE-DEC', 'lost his watch', 'Who leads the inner circle?']) expect(text, s).toContain(s)
    // closed threads and characters outside the series cast stay out
    expect(text).not.toContain('closed one')
    expect(text).not.toContain('Brother Ambrose')
    // a huge summary is cut, so the prompt does not explode
    await writeMd(path.join(dir, 'books', 'case-one', 'summaries', 'ch-01.md'), { kind: 'summary', n: 1 }, '\n' + 'word '.repeat(20000) + '\n')
    const big = await seriesSection(d, 'case-two')
    expect(big.length).toBeLessThan(14000)
    expect(big).toContain('ACT-ONE-SUMMARY')
  })

  it('carries the recurring characters and places into the bible of book 2, long or light', async () => {
    const dir = await tempDir()
    const d = stores(dir)
    await d.series.create(seriesBrief)
    await writeBookOne(dir)
    await writeBookTwo(dir)
    const logs: string[] = []
    // the architect has Ines already (under a shorter name) and not Dec
    const out = await withSeriesBible(d, 'case-two', [{ name: 'Ines', description: 'sharp', voice: 'dry' }], [{ name: 'Hay Barn', description: 'dim' }], (m) => logs.push(m))
    expect(out.characters.map((c) => c.name)).toEqual(['Ines', 'Declan "Dec" Hartley'])
    expect(out.characters[0]!.description).toBe('sharp')
    expect(out.characters[1]).toMatchObject({ voice: 'rambling, Irish' })
    expect(out.characters[1]!.description).toContain('From the earlier book "Case One"')
    expect(out.characters[1]!.description).toContain('END-STATE-DEC')
    expect(out.places.map((p) => p.name)).toEqual(['Hay Barn', 'Clockmaker Street'])
    expect(logs[0]).toContain('Declan "Dec" Hartley')
    // the structured bible takes them
    await d.bible.writeInitial('case-two', { characters: out.characters, places: out.places })
    const entry = (await d.bible.entries('case-two')).find((e) => e.name === 'Declan "Dec" Hartley')!
    expect(entry.text).toContain('END-STATE-DEC')
    // book 1 is left alone
    expect(await withSeriesBible(d, 'case-one', [{ name: 'X', description: 'y', voice: '' }], [], () => undefined)).toEqual({ characters: [{ name: 'X', description: 'y', voice: '' }], places: [] })

    // a light bible in book 1: the cast line is carried
    await rm(path.join(dir, 'books', 'case-one', 'bible'), { recursive: true })
    await writeMd(path.join(dir, 'books', 'case-one', 'bible', 'bible.md'), { kind: 'bible' }, '\n# Story bible (light)\n\n## Characters\n- **Dec Hartley**: LIGHT-DEC a locksmith.\n- **Nobody**: not in the cast.\n')
    const light = await withSeriesBible(d, 'case-two', [], [], () => undefined)
    expect(light.characters).toHaveLength(1)
    expect(light.characters[0]).toMatchObject({ name: 'Dec Hartley' })
    expect(light.characters[0]!.description).toContain('LIGHT-DEC')
    expect(await seriesSection(d, 'case-two')).toContain('LIGHT-DEC')
  })
})

describe('the long-book draft context', () => {
  it('searches the earlier books of the series too', async () => {
    const dir = await tempDir()
    const d = stores(dir)
    await d.series.create(seriesBrief)
    await writeBookOne(dir)
    await writeBookTwo(dir)
    await writeMd(path.join(dir, 'books', 'case-two', 'outline.md'), { kind: 'outline', chapters: [{ n: 1, title: 'The Return', summary: 'Dec returns to the bell.' }] }, '\n')
    const searches: { books?: string[]; book?: string }[] = []
    const index = {
      search: async (_q: string, opts: { books?: string[]; book?: string }) => {
        searches.push(opts)
        return opts.books ? [{ file: 'books/case-one/chapters/ch-01.md', idx: 0, book: 'case-one', kind: 'chapter', ref: 'ch-01', text: 'PASSAGE-FROM-BOOK-ONE', score: 1 }] : []
      }
    } as unknown as MemoryIndex
    const packed = await buildDraftContext({ books: d.books, bible: d.bible, index, slug: 'case-two', n: 1, budgetTokens: 20000, seriesBooks: ['case-one'] })
    expect(searches.map((s) => s.books ?? s.book)).toEqual(['case-two', ['case-one']])
    expect(packed.text).toContain('Passages from the earlier books of the series')
    expect(packed.text).toContain('PASSAGE-FROM-BOOK-ONE')
    // no earlier books: only the book's own search
    searches.length = 0
    await buildDraftContext({ books: d.books, bible: d.bible, index, slug: 'case-two', n: 1, budgetTokens: 20000 })
    expect(searches).toHaveLength(1)
  })

  it('a search that fails (the embeddings server is down) leaves the passages out, says so once, and still builds the context', async () => {
    const dir = await tempDir()
    const d = stores(dir)
    await d.series.create(seriesBrief)
    await writeBookOne(dir)
    await writeBookTwo(dir)
    await writeMd(path.join(dir, 'books', 'case-two', 'outline.md'), { kind: 'outline', chapters: [{ n: 1, title: 'The Return', summary: 'Dec returns to the bell.' }] }, '\n')
    let calls = 0
    const index = {
      search: async () => {
        calls++
        throw new Error('the embeddings server lmstudio is not running (http://localhost:1234/v1)')
      }
    } as unknown as MemoryIndex
    const logs: string[] = []
    const packed = await buildDraftContext({ books: d.books, bible: d.bible, index, slug: 'case-two', n: 1, budgetTokens: 20000, seriesBooks: ['case-one'], log: (m) => logs.push(m) })
    expect(packed.text).toContain('The Return') // the outline and the bible still come
    expect(packed.text).not.toContain('Passages from')
    expect(calls).toBe(1) // the series search is not tried after the first one failed
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/search skipped: the embeddings server lmstudio is not running.*written from the bible and the summaries/)
  })
})

describe('a series in the pipeline', () => {
  it('starts book 2 only after book 1 is published, and gives it book 1 in every prompt', async () => {
    const e = await withBookOne('rejected')
    env = e
    const prompts: Record<string, string[]> = {}
    const grab = (task: string, req: { messages: { content: string }[] }) => (prompts[task] ??= []).push(req.messages.map((m) => m.content).join('\n\n----\n\n'))
    e.mock.on({ task: 'start_book' }, (req) => (grab('start_book', req), JSON.stringify({ format: 'novel', title: 'Case Two', genre: 'Comic mystery', target_words: 3000, notes: '' })))
    e.mock.on({ task: 'pitch' }, (req) => (grab('pitch', req), 'A locksmith and a restorer meet a bell again. The ending is a quiet hour. '.repeat(3)))
    e.mock.on({ task: 'outline' }, (req) => {
      grab('outline', req)
      return JSON.stringify({
        chapters: Array.from({ length: 6 }, (_, i) => ({ title: `Part ${i + 1}`, summary: `Dec does thing number ${i + 1}.` })),
        characters: [{ name: 'Ines', description: 'sharp', voice: 'dry' }],
        places: [{ name: 'Hay Barn', description: 'warm and dim' }],
        threads: ['Who left the lantern?'],
        setting: 'a barn',
        style: 'gentle'
      })
    })
    e.mock.on({ task: 'review_outline' }, (req) => (grab('review_outline', req), JSON.stringify({ verdict: 'pass', scores: { structure: 8 }, notes: 'Fine.', chapters: [] })))
    e.mock.on({ task: 'draft_chapter' }, (req) => (grab('draft_chapter', req), 'The little fox yawned and curled up in the warm hay. '.repeat(40)))
    e.mock.on({ task: 'check_chapter' }, (req) => (grab('check_chapter', req), JSON.stringify({ verdict: 'pass', scores: { continuity: 9 }, notes: 'Consistent.', chapters: [] })))

    const two = await e.engine.addStory({ ...emptyBrief(), title: 'Case Two', premise: 'The bell tolls again.', format: 'novel', series: 'the-ninth-hour' })
    expect(two.data).toMatchObject({ series: 'the-ninth-hour', series_index: 2 }) // after book 1, which is in the books folder
    // book 1 was rejected, not published: book 2 waits
    await new Promise((r) => setTimeout(r, 1500))
    expect(await e.engine.books.slugs()).toEqual(['case-one'])
    expect((await e.engine.ideas.list())[0]!.data.status).toBe('open')
    expect(prompts.start_book).toBeUndefined()

    // book 1 gets published: book 2 starts
    await e.engine.books.update('case-one', () => ({ stage: 'published' }))
    e.engine.pipeline.kick()
    await waitFor(() => prompts.check_chapter?.length, 60000, 'the first continuity check of book 2')
    const slug = (await e.engine.books.slugs()).find((s) => s !== 'case-one')!
    const book2 = parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data
    expect(book2).toMatchObject({ title: 'Case Two', series: 'the-ninth-hour', series_index: 2 })
    // the brief copy keeps the series too
    expect(parseMd(await readFile(path.join(e.dir, 'books', slug, 'brief.md'), 'utf8')).data).toMatchObject({ series: 'the-ninth-hour', series_index: 2 })
    // the series file lists it, and the UI heard
    expect((await e.engine.series.get('the-ninth-hour'))!.data.books).toEqual([slug])
    const last = [...e.events].reverse().find((ev) => ev.type === 'series.updated')
    expect(last && last.type === 'series.updated' && last.series[0]!.books.map((b) => [b.slug, b.index, b.kind])).toEqual([['case-one', 1, 'book'], [slug, 2, 'book']])

    // pitch, outline, outline review, draft and continuity check carry the series and book 1
    for (const task of ['pitch', 'outline', 'review_outline', 'draft_chapter', 'check_chapter']) {
      const p = prompts[task]![0]!
      for (const s of ['book 2 of the series "The Ninth Hour"', 'A fraternity of clock worshippers', 'Clockmaker Street', 'Book 1: Case One', 'BLURB-ONE', 'ACT-ONE-SUMMARY', 'END-STATE-DEC', 'Who leads the inner circle?']) expect(p, `${task}: ${s}`).toContain(s)
      expect(p, task).not.toContain('Brother Ambrose')
    }
    // the bible of book 2 starts with Dec as book 1 left him, and with the street
    const dec = await readFile(path.join(e.dir, 'books', slug, 'bible', 'characters', 'declan-dec-hartley.md'), 'utf8')
    expect(dec).toContain('END-STATE-DEC')
    expect(existsSync(path.join(e.dir, 'books', slug, 'bible', 'places', 'clockmaker-street.md'))).toBe(true)
    expect(existsSync(path.join(e.dir, 'books', slug, 'bible', 'characters', 'brother-ambrose.md'))).toBe(false)
    expect(await readFile(path.join(e.dir, 'books', slug, 'bible', 'characters', 'ines.md'), 'utf8')).toContain('sharp')
  }, 120000)
})
