import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Bible } from '../src/engine/memory/bible'
import { MemoryIndex, reindex } from '../src/engine/memory/index'
import { hashEmbed } from '../src/engine/models/mock'
import { adaptSection, normalizeSourceChapters, sourceExcerpt, uncovered, withSourceBible } from '../src/engine/pipeline/adapt'
import { BookStore } from '../src/engine/pipeline/books'
import { pickNext } from '../src/engine/pipeline/handlers'
import { dimensionsFor } from '../src/engine/pipeline/scoring'
import { writeMd } from '../src/engine/store/atomic'
import { IdeaStore } from '../src/engine/store/ideas'
import type { IdeaFile } from '../src/engine/store/ideas'
import { waitingStories } from '../src/engine/store/series'
import type { BookRef } from '../src/engine/store/series'
import { briefOf, emptyBrief } from '../src/shared/brief'
import { parseMd } from '../src/shared/md'
import type { FormatEntry } from '../src/shared/schemas'
import { makePipelineEnv, waitFor } from './helpers'
import type { TestEnv } from './helpers'

let env: TestEnv | undefined
const temps: string[] = []
afterEach(async () => {
  await env?.cleanup()
  env = undefined
  for (const d of temps.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})
const tempDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-adapt-'))
  temps.push(dir)
  return dir
}

/** The source book: a published prose book of three chapters with a pitch, blurb, outline, summaries and a bible (long or light). */
async function writeSource(dir: string, o: { stage?: string; bible?: 'long' | 'light' } = {}): Promise<void> {
  const root = path.join(dir, 'books', 'moon-lamp')
  await mkdir(path.join(root, 'summaries'), { recursive: true })
  await writeMd(path.join(root, 'book.md'), { kind: 'book', slug: 'moon-lamp', title: 'The Moon Lamp', stage: o.stage ?? 'published', format: 'short-story', genre: 'Cosy fantasy', target_words: 3000, blurb: 'BLURB-SOURCE: a lamplighter keeps the moon awake.' }, '\n')
  await writeMd(path.join(root, 'pitch.md'), { kind: 'pitch' }, '\nPITCH-SOURCE: Mara the lamplighter finds the moon asleep in a barn. The ending is a bright night.\n')
  await writeMd(
    path.join(root, 'outline.md'),
    {
      kind: 'outline',
      chapters: [
        { n: 1, title: 'The Dark Street', summary: 'OUTLINE-ONE Mara lights the lamps.' },
        { n: 2, title: 'The Barn', summary: 'OUTLINE-TWO Mara finds the moon.' },
        { n: 3, title: 'The Bright Night', summary: 'OUTLINE-THREE The moon wakes.' }
      ],
      acts: [{ n: 1, title: 'Act I', chapters: [1, 2, 3] }]
    },
    '\n'
  )
  await writeMd(path.join(root, 'summaries', 'act-1.md'), { kind: 'summary', act: 1 }, '\nACT-SUMMARY: Mara finds and wakes the moon.\n')
  await writeMd(path.join(root, 'summaries', 'ch-02.md'), { kind: 'summary', n: 2 }, '\nCHAPTER-TWO-SUMMARY: the barn.\n')
  for (const [n, text] of [[1, 'SOURCE-TEXT-ONE Mara walked the dark street with her pole.'], [2, 'SOURCE-TEXT-TWO Mara opened the barn door and saw the sleeping moon.'], [3, 'SOURCE-TEXT-THREE The moon woke and the night was bright.']] as const) {
    await writeMd(path.join(root, 'chapters', `ch-0${n}.md`), { kind: 'chapter', n, title: `Source ${n}`, round: 0 }, `\n${text}\n`)
  }
  if ((o.bible ?? 'light') === 'long') {
    await mkdir(path.join(root, 'bible', 'characters'), { recursive: true })
    await mkdir(path.join(root, 'bible', 'places'), { recursive: true })
    await writeMd(path.join(root, 'bible', 'characters', 'mara.md'), { kind: 'character', name: 'Mara', voice: 'dry, quick', aliases: ['Lampy'] }, '\nLOOKS-MARA: thirty, small, red scarf, grey eyes.\n\n- Ch 3: wakes the moon.\n')
    await writeMd(path.join(root, 'bible', 'places', 'the-barn.md'), { kind: 'place', name: 'The Barn' }, '\nLOOKS-BARN: a leaning red barn with a round window.\n')
  } else {
    await mkdir(path.join(root, 'bible'), { recursive: true })
    await writeMd(path.join(root, 'bible', 'bible.md'), { kind: 'bible' }, '\n# Story bible (light)\n\n## Setting\nA village.\n\n## Characters\n- **Mara**: LOOKS-MARA thirty, red scarf. Aliases: Lampy.\n- **Old Tom**: LOOKS-TOM bent and kind.\n\n## Places\n- **The Barn**: LOOKS-BARN a leaning red barn.\n\n## Style\nGentle.\n')
  }
}

const stores = (dir: string) => {
  const books = new BookStore(dir)
  return { books, bible: new Bible(books), contextTokens: (_role: string): number | undefined => undefined }
}

/** The adaptation: a book folder with source_book and an outline that maps its chapters. */
async function writeScript(dir: string, mapping: (number[] | undefined)[] = [[1], [2], [3]]): Promise<void> {
  const root = path.join(dir, 'books', 'moon-lamp-vn')
  await mkdir(root, { recursive: true })
  await writeMd(path.join(root, 'book.md'), { kind: 'book', slug: 'moon-lamp-vn', title: 'The Moon Lamp', stage: 'drafting', format: 'visual-novel', target_words: 3000, source_book: 'moon-lamp' }, '\n')
  await writeMd(
    path.join(root, 'outline.md'),
    { kind: 'outline', chapters: mapping.map((m, i) => ({ n: i + 1, title: `Scene ${i + 1}`, summary: `Script chapter ${i + 1}.`, ...(m ? { source_chapters: m } : {}) })) },
    '\n'
  )
}

const idea = (slug: string, data: Record<string, unknown> = {}): IdeaFile => ({
  slug,
  file: `${slug}.md`,
  title: slug,
  body: '',
  createdMs: 0,
  data: { kind: 'idea', topic: null, status: 'open', source: 'user', format: null, book: null, ...data } as IdeaFile['data']
})
const ref = (slug: string, stage: string): BookRef => ({ slug, title: slug, stage, score: null })
const formats = [{ id: 'visual-novel', name: 'Visual novel', enabled: true, script: true, kinds: ['visual-novel'], words: [1, 2], chapters: [1, 2], guidance: '' }] as unknown as FormatEntry[]

describe('the wait for the source', () => {
  it('holds an adaptation back until its source is published', () => {
    const story = idea('vn', { source_book: 'moon-lamp' })
    const other = idea('other')
    expect(waitingStories([story, other], [ref('moon-lamp', 'drafting')])).toEqual(new Set(['vn']))
    expect(waitingStories([story], [ref('moon-lamp', 'rejected')]).has('vn')).toBe(true)
    expect(waitingStories([story], []).has('vn')).toBe(true) // a source that is gone never is published
    expect(waitingStories([story], [ref('moon-lamp', 'published')]).size).toBe(0)
    expect(waitingStories([idea('used', { source_book: 'moon-lamp', status: 'used' })], []).size).toBe(0)
    expect(pickNext([story, other], [], formats, [ref('moon-lamp', 'editing')])?.idea?.slug).toBe('other')
    expect(pickNext([story], [], formats, [ref('moon-lamp', 'editing')])).toBeNull()
    expect(pickNext([story], [], formats, [ref('moon-lamp', 'published')])?.idea?.slug).toBe('vn')
  })
})

describe('source_book in stories', () => {
  it('is kept by the brief, the story file and an edit', async () => {
    const dir = await tempDir()
    const ideas = new IdeaStore(dir)
    const made = await ideas.createStory({ ...emptyBrief(), title: 'The Moon Lamp', premise: 'x', format: 'visual-novel', sourceBook: 'moon-lamp' })
    expect(made.data.source_book).toBe('moon-lamp')
    const raw = parseMd(await readFile(made.file, 'utf8'))
    expect(raw.data.source_book).toBe('moon-lamp')
    expect(briefOf(raw.data, raw.body).sourceBook).toBe('moon-lamp')
    const edited = await ideas.updateStory(made.slug, { ...briefOf(raw.data, raw.body), premise: 'y' })
    expect(edited.data.source_book).toBe('moon-lamp')
    expect(briefOf({}, 'x').sourceBook).toBeUndefined()
  })
})

describe('the adapt section', () => {
  it('gives the pitch and the outline the source: pitch, blurb, outline, summaries and the cast, long bible or light', async () => {
    for (const bible of ['long', 'light'] as const) {
      const dir = await tempDir()
      await writeSource(dir, { bible })
      await writeScript(dir)
      const d = stores(dir)
      for (const task of ['pitch', 'outline'] as const) {
        const text = await adaptSection(d, 'moon-lamp-vn', task, { formatName: 'Visual novel' })
        for (const s of ['authorised adaptation', 'The Moon Lamp', 'PITCH-SOURCE', 'BLURB-SOURCE', 'OUTLINE-TWO', 'ACT-SUMMARY', 'CHAPTER-TWO-SUMMARY', 'LOOKS-MARA', 'LOOKS-BARN', 'Cosy fantasy']) expect(text, `${bible} ${task}: ${s}`).toContain(s)
      }
      expect(await adaptSection(d, 'moon-lamp-vn', 'outline')).toContain('source_chapters')
      expect(await adaptSection(d, 'moon-lamp', 'outline')).toBe('') // the source itself adapts nothing
    }
  })

  it('stays bounded for a huge source, and the review gets the authorised line and the mapping', async () => {
    const dir = await tempDir()
    await writeSource(dir)
    await writeScript(dir, [[1, 2], [3], [3]])
    const huge = 'word '.repeat(30000)
    await writeMd(path.join(dir, 'books', 'moon-lamp', 'summaries', 'ch-01.md'), { kind: 'summary', n: 1 }, '\n' + huge)
    await writeMd(path.join(dir, 'books', 'moon-lamp', 'pitch.md'), { kind: 'pitch' }, '\n' + huge)
    await writeMd(path.join(dir, 'books', 'moon-lamp', 'bible', 'bible.md'), { kind: 'bible' }, '\n## Characters\n' + Array.from({ length: 80 }, (_, i) => `- **Person ${i}**: ${huge}`).join('\n'))
    const d = stores(dir)
    expect((await adaptSection(d, 'moon-lamp-vn', 'outline')).length).toBeLessThan(60000)
    const review = await adaptSection(d, 'moon-lamp-vn', 'review')
    expect(review).toContain('authorised adaptation of the owner\'s own book "The Moon Lamp"')
    expect(review).toContain('do not report likeness')
    expect(review).toContain('Chapter 1 (Scene 1) is made from source chapter(s) 1, 2')
    expect(review.length).toBeLessThan(2000)
  })
})

describe('the source chapters', () => {
  it('feeds the draft the full text of the mapped chapters only, and cuts them to the window', async () => {
    const dir = await tempDir()
    await writeSource(dir)
    await writeScript(dir, [[1, 2], [3], undefined])
    const d = stores(dir)
    const one = await sourceExcerpt(d, 'moon-lamp-vn', 1)
    expect(one).toContain('SOURCE-TEXT-ONE')
    expect(one).toContain('SOURCE-TEXT-TWO')
    expect(one).not.toContain('SOURCE-TEXT-THREE')
    expect(await sourceExcerpt(d, 'moon-lamp-vn', 2)).toContain('SOURCE-TEXT-THREE')
    expect(await sourceExcerpt(d, 'moon-lamp-vn', 3)).toBe('') // nothing mapped
    // a long source chapter is cut from the middle to fit 30% of a small window
    await writeMd(path.join(dir, 'books', 'moon-lamp', 'chapters', 'ch-03.md'), { kind: 'chapter', n: 3, title: 'Source 3', round: 0 }, '\nSTART-MARK ' + 'filler '.repeat(20000) + ' END-MARK\n')
    const logs: string[] = []
    const cut = await sourceExcerpt({ ...d, contextTokens: () => 4000 }, 'moon-lamp-vn', 2, 'writer', (m) => logs.push(m))
    expect(cut.length).toBeLessThan(4000 * 0.3 * 4 + 400)
    expect(cut).toContain('START-MARK')
    expect(cut).toContain('END-MARK')
    expect(cut).toContain('left out to fit the window')
    expect(logs[0]).toContain('cut to fit')
  })

  it('normalises the mapping: out-of-range numbers go, a chapter with none gets an even share, gaps are found', () => {
    expect(normalizeSourceChapters([[1, 9, 1], [2.4], undefined, []], 4)).toEqual({ mapped: [[1], [2], [3], [4]], filled: 2 })
    const { mapped } = normalizeSourceChapters([[1], [1]], 3)
    expect(uncovered(mapped, 3)).toEqual([2, 3])
    expect(normalizeSourceChapters([undefined, undefined], 5).mapped).toEqual([[1, 2], [3, 4, 5]])
    expect(normalizeSourceChapters([undefined], 0).mapped).toEqual([[]])
  })
})

describe('the bible of an adaptation', () => {
  it('is seeded from the source cast and places, looks kept, long or light', async () => {
    for (const bible of ['long', 'light'] as const) {
      const dir = await tempDir()
      await writeSource(dir, { bible })
      await writeScript(dir)
      const d = stores(dir)
      const logs: string[] = []
      // the architect has Mara already under her own words, and not the barn
      const out = await withSourceBible(d, 'moon-lamp-vn', [{ name: 'Mara', description: 'a lamplighter', voice: 'dry' }], [], (m) => logs.push(m))
      expect(out.characters[0]!.description).toContain('a lamplighter')
      expect(out.characters[0]!.description).toContain('From the source book "The Moon Lamp"')
      expect(out.characters[0]!.description).toContain('LOOKS-MARA')
      // the source's other names come along, and are not copied into the description as a sentence
      expect(out.characters[0]!.aliases).toEqual(['Lampy'])
      expect(out.characters[0]!.description).not.toContain('Aliases:')
      expect(out.places.map((p) => p.name)).toEqual(['The Barn'])
      expect(out.places[0]!.description).toContain('LOOKS-BARN')
      if (bible === 'light') expect(out.characters.map((c) => c.name)).toEqual(['Mara', 'Old Tom'])
      expect(logs[0]).toContain('The Moon Lamp')
      // a book that adapts nothing is left alone
      expect(await withSourceBible(d, 'moon-lamp', [], [], () => undefined)).toEqual({ characters: [], places: [] })
    }
  })
})

describe('the pitch similarity check', () => {
  it('can leave out several books, so the source and its adaptations do not count', async () => {
    const dir = await tempDir()
    await writeSource(dir)
    await mkdir(path.join(dir, 'index'), { recursive: true })
    const index = MemoryIndex.open(dir, async (texts) => texts.map((t) => hashEmbed(t, 64)))
    try {
      await reindex(dir, index)
      const pitch = 'PITCH-SOURCE: Mara the lamplighter finds the moon asleep in a barn. The ending is a bright night.'
      expect((await index.nearest(pitch, { notBook: 'moon-lamp-vn', kinds: ['pitch'] }))?.book).toBe('moon-lamp')
      expect(await index.nearest(pitch, { notBook: ['moon-lamp-vn', 'moon-lamp'], kinds: ['pitch'] })).toBeNull()
    } finally {
      index.close()
    }
  })
})

// ---- the script writer through the engine ----

const prose = (n: number) => Array.from({ length: n }, (_, i) => ['Mara', 'lit', 'the', 'lamp', 'and', 'smiled.'][i % 6]).join(' ')
const lastUser = (req: { messages: { role: string; content: string }[] }) => req.messages.filter((m) => m.role === 'user').pop()!.content

async function adaptEnv(extra: { maxBooks?: number } = {}) {
  return makePipelineEnv({
    format: 'visual-novel',
    maxBooks: extra.maxBooks,
    beforeStart: async (dir) => {
      await writeSource(dir)
      const file = path.join(dir, 'config', 'formats.md')
      const doc = parseMd(await readFile(file, 'utf8'))
      const fmts = (doc.data.formats as { id: string }[]).map((f) => (f.id === 'visual-novel' ? { ...f, words: [1200, 4000], chapters: [4, 4] } : f.id === 'choice-visual-novel' ? { ...f, words: [1200, 4000], chapters: [4, 4] } : f))
      await writeMd(file, { ...doc.data, formats: fmts }, doc.body)
    }
  })
}

describe('adaptBook (the engine behind adapt_book and the panel)', () => {
  it('refuses an unknown or unpublished source, a format that is not a script, and a second open adaptation', async () => {
    const e = await makePipelineEnv({
      factory: { paused: true },
      beforeStart: async (dir) => {
        await writeSource(dir)
        await writeMd(path.join(dir, 'books', 'half', 'book.md'), { kind: 'book', slug: 'half', title: 'Half', stage: 'drafting', format: 'short-story', target_words: 1000 }, '\n')
      }
    })
    env = e
    const a = e.engine
    await expect(a.adaptBook({ book: 'nope', format: 'visual-novel' })).rejects.toThrow(/no book "nope"/)
    await expect(a.adaptBook({ book: 'half', format: 'visual-novel' })).rejects.toThrow(/not published yet/)
    await expect(a.adaptBook({ book: 'moon-lamp', format: 'novel' })).rejects.toThrow(/not a script format.*Visual novel formats: visual-novel, choice-visual-novel.*Screenplay formats: short-film, cartoon, kids-cartoon/)
    await expect(a.adaptBook({ book: 'moon-lamp', format: 'no-such-format' })).rejects.toThrow(/not a script format/)
    // a screenplay format is a script format: it is adapted like a visual novel, and the premise names the medium
    const film = await a.adaptBook({ book: 'moon-lamp', format: 'short-film' })
    expect(film.data).toMatchObject({ source_book: 'moon-lamp', format: 'short-film', status: 'open' })
    expect(film.body).toContain('short film screenplay adapted from the owner')
    await expect(a.adaptBook({ book: 'moon-lamp', format: 'short-film' })).rejects.toThrow(/already waiting/)
    const story = await a.adaptBook({ book: 'moon-lamp', format: 'choice-visual-novel', notes: 'Keep the lamp.' })
    expect(story.data).toMatchObject({ source_book: 'moon-lamp', format: 'choice-visual-novel', genre: 'Cosy fantasy', title: 'The Moon Lamp', title_fixed: true, source: 'user', status: 'open' })
    expect(story.data.topic).toBeNull()
    expect(story.body).toContain('## Notes for the adapter')
    expect(story.body).toContain('Keep the lamp.')
    await expect(a.adaptBook({ book: 'moon-lamp', format: 'choice-visual-novel' })).rejects.toThrow(/already waiting/)
    // the other kind is a different adaptation, and a title is kept
    const linear = await a.adaptBook({ book: 'moon-lamp', format: 'visual-novel', title: 'Lamp, the Script' })
    expect(linear.title).toBe('Lamp, the Script')
    expect(env.events.some((ev) => ev.type === 'ideas.updated' && ev.ideas.some((i) => i.sourceBook === 'moon-lamp'))).toBe(true)
    // the command reports a mistake as a warning, and does not throw
    await a.handleCommand({ type: 'adaptBook', book: 'half', format: 'visual-novel' })
    expect(env.events.some((ev) => ev.type === 'engine.warning' && /adaptBook: .*not published/.test(ev.message))).toBe(true)
    await a.handleCommand({ type: 'adaptBook', book: 'moon-lamp', format: 'visual-novel', title: 'From the panel' })
    expect(env.events.some((ev) => ev.type === 'engine.warning' && /already waiting/.test(ev.message))).toBe(true)
  })
})

describe('an adaptation in the pipeline', () => {
  it('runs from the source to a published script: no research, the source in every prompt, the mapping saved and fed to the drafts', async () => {
    const e = await adaptEnv()
    env = e
    const prompts: Record<string, string[]> = {}
    const grab = (task: string, text: string) => (prompts[task] ??= []).push(text)
    const sourcePitch = 'PITCH-SOURCE: Mara the lamplighter finds the moon asleep in a barn. The ending is a bright night.'
    e.mock.on({ task: 'pitch' }, (req) => (grab('pitch', lastUser(req)), sourcePitch)) // as close to the source as it can be
    e.mock.on({ task: 'outline' }, (req) => {
      grab('outline', lastUser(req))
      return JSON.stringify({
        chapters: [
          { title: 'Dark Street', summary: 'Mara lights the lamps.', source_chapters: [1] },
          { title: 'The Barn', summary: 'Mara opens the barn.', source_chapters: [2] },
          { title: 'The Waking', summary: 'The moon wakes.', source_chapters: [3] },
          { title: 'Bright Night', summary: 'The village celebrates.', source_chapters: [3, 99] }
        ],
        characters: [{ name: 'Mara', description: 'a lamplighter', voice: 'dry', aliases: ['the lamplighter', 'Mara', 'Old Tom', 'Dr. Vey'] }],
        places: [],
        threads: ['Will the moon wake?'],
        setting: 'a village',
        style: 'gentle'
      })
    })
    e.mock.on({ task: 'draft_chapter' }, (req) => {
      const t = lastUser(req)
      const n = Number(/Now write chapter (\d+):/.exec(req.messages[1]?.content ?? '')?.[1] ?? 0)
      grab(`draft${n}`, t)
      return prose(Number(/chapter should be about (\d+) words/.exec(t)?.[1] ?? 100))
    })
    e.mock.on({ task: 'rewrite_chapter' }, (req) => {
      const t = lastUser(req)
      grab('rewrite', t)
      return prose(Number(/Rewrite this chapter to about (\d+) words/.exec(t)?.[1] ?? 100))
    })
    e.mock.on({ task: 'review' }, (req) => {
      const role = req.meta!.role!
      const round = Number(/review round (\d+)/.exec(lastUser(req))?.[1] ?? 0)
      grab(`review:${role}`, lastUser(req))
      const revise = role === 'line-editor' && round === 0
      return JSON.stringify({ verdict: revise ? 'revise' : 'pass', scores: Object.fromEntries(dimensionsFor(role).map((x) => [x, revise ? 5 : 8])), notes: revise ? 'Tighten chapter 2.' : 'Fine.', chapters: revise ? [2] : [], research_questions: [] })
    })

    // the library index knows the source's pitch, as it does for any finished book
    await reindex(e.dir, e.engine.memory.getIndex())
    const story = await e.engine.adaptBook({ book: 'moon-lamp', format: 'visual-novel', notes: 'Keep the lamp and the red scarf.' })
    const slug = await waitFor(async () => {
      for (const s of await e.engine.books.slugs()) if (s !== 'moon-lamp' && (await e.engine.books.read(s))?.data.stage === 'published') return s
      return null
    }, 150000, 'the published script')

    const book = parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data
    expect(book).toMatchObject({ format: 'visual-novel', source_book: 'moon-lamp', genre: 'Cosy fantasy', script: true }) // the publisher sets the final title
    expect(parseMd(await readFile(path.join(e.dir, 'books', slug, 'brief.md'), 'utf8')).data).toMatchObject({ source_book: 'moon-lamp', kind: 'brief' })
    expect((await e.engine.ideas.list()).find((i) => i.slug === story.slug)!.data).toMatchObject({ status: 'used', book: slug })
    expect((await e.engine.books.brief(slug))!.sections.map((s) => s.heading)).toContain('Notes for the adapter')

    // no research of its own: no plan, no prep
    expect(e.counters.calls.research_plan).toBeUndefined()
    expect(e.counters.calls.research_prep).toBeUndefined()
    // the pitch is as close to the source as can be, and was written once: the similarity check leaves the source out
    expect(e.counters.calls.pitch).toBeUndefined() // (the counter belongs to the default handler)
    // (and the check would have fired: the source's pitch is in the index, as close as can be)
    const near = await e.engine.memory.getIndex().nearest(sourcePitch, { notBook: slug, kinds: ['pitch'] })
    expect(near).toMatchObject({ book: 'moon-lamp' })
    expect(near!.similarity).toBeGreaterThan(0.9)
    expect(prompts.pitch).toHaveLength(1)
    expect(e.logs.some((l) => /pitch too similar/.test(l))).toBe(false)
    for (const s of ['authorised adaptation', 'PITCH-SOURCE', 'BLURB-SOURCE', 'Keep the lamp and the red scarf']) expect(prompts.pitch![0], `pitch: ${s}`).toContain(s)
    for (const s of ['authorised adaptation', 'OUTLINE-TWO', 'LOOKS-MARA', 'LOOKS-BARN', 'ACT-SUMMARY', 'source_chapters']) expect(prompts.outline![0], `outline: ${s}`).toContain(s)
    // the mapping is saved (99 is not a source chapter), and the bible has the source's cast
    const outline = await e.engine.books.outline(slug)
    expect(outline!.chapters.map((c) => c.source_chapters)).toEqual([[1], [2], [3], [3]])
    expect(parseMd(await readFile(path.join(e.dir, 'books', slug, 'outline.md'), 'utf8')).data.chapters).toMatchObject([{ source_chapters: [1] }, { source_chapters: [2] }, { source_chapters: [3] }, { source_chapters: [3] }])
    const bible = await readFile(path.join(e.dir, 'books', slug, 'bible', 'bible.md'), 'utf8')
    expect(bible).toContain('LOOKS-MARA')
    expect(bible).toContain('Old Tom')
    expect(bible).toContain('LOOKS-BARN')
    // the aliases are one sentence before the voice: the own name and another character's name are dropped, the full stop of Dr. too, the source's alias is added
    expect(bible).toMatch(/- \*\*Mara\*\*: a lamplighter From the source book "The Moon Lamp": .*LOOKS-MARA.* Aliases: the lamplighter, Dr Vey, Lampy\. Voice: dry\n/)
    expect(bible).toContain('- **Old Tom**: ')
    // the outline asks for aliases, the draft for the picture and sound lines, and every script prompt of the book names them
    expect(prompts.outline![0]).toContain('aliases')
    expect(prompts.draft1![0]).toContain('CG')
    expect(prompts.draft1![0]).toContain('INSERT')
    expect(prompts.rewrite![0]).toContain('Keep the CG, INSERT, SFX and AMBIENCE lines')
    for (const role of ['originality-checker', 'line-editor', 'developmental-editor']) expect(prompts[`review:${role}`]![0], role).toContain('picture and sound cues for the visual novel app')
    // each draft got the full text of its source chapters and not of the others
    expect(prompts.draft1![0]).toContain('SOURCE-TEXT-ONE')
    expect(prompts.draft1![0]).not.toContain('SOURCE-TEXT-TWO')
    expect(prompts.draft2![0]).toContain('SOURCE-TEXT-TWO')
    expect(prompts.draft3![0]).toContain('SOURCE-TEXT-THREE')
    expect(prompts.draft4![0]).toContain('SOURCE-TEXT-THREE')
    expect(prompts.draft1![0]).toContain('authorised adaptation')
    // the rewrite of chapter 2 got its source text, every reviewer the authorised line
    expect(prompts.rewrite).toHaveLength(1)
    expect(prompts.rewrite![0]).toContain('SOURCE-TEXT-TWO')
    expect(prompts.rewrite![0]).not.toContain('SOURCE-TEXT-ONE')
    for (const role of ['originality-checker', 'line-editor', 'developmental-editor']) {
      expect(prompts[`review:${role}`]![0], role).toContain('authorised adaptation of the owner\'s own book "The Moon Lamp"')
      expect(prompts[`review:${role}`]![0], role).toContain('Chapter 2 (The Barn) is made from source chapter(s) 2')
    }
    // the book summary says what it adapts
    const snap = await e.engine.snapshot()
    expect(snap.books.find((b) => b.slug === slug)!.sourceBook).toEqual({ slug: 'moon-lamp', title: 'The Moon Lamp' })
    expect(snap.books.find((b) => b.slug === 'moon-lamp')!.sourceBook ?? null).toBeNull()
  }, 200000)

  it('waits for an unpublished source, then starts', async () => {
    const e = await makePipelineEnv({
      format: 'visual-novel',
      beforeStart: async (dir) => {
        await writeSource(dir, { stage: 'rejected' }) // a stage the pipeline leaves alone
        const file = path.join(dir, 'config', 'formats.md')
        const doc = parseMd(await readFile(file, 'utf8'))
        await writeMd(file, { ...doc.data, formats: (doc.data.formats as { id: string }[]).map((f) => (f.id === 'visual-novel' ? { ...f, words: [1200, 4000], chapters: [4, 4] } : f)) }, doc.body)
      }
    })
    env = e
    // written straight to the data folder: adaptBook would refuse a source that is not published
    await e.engine.ideas.createStory({ ...emptyBrief(), title: 'Early Script', premise: 'x', format: 'visual-novel', sourceBook: 'moon-lamp' })
    e.engine.pipeline.kick()
    await new Promise((r) => setTimeout(r, 1200))
    expect(await e.engine.books.slugs()).toEqual(['moon-lamp'])
    await e.engine.books.update('moon-lamp', () => ({ stage: 'published' }))
    e.engine.pipeline.kick()
    await waitFor(async () => (await e.engine.books.slugs()).length === 2, 30000, 'the script book to start')
  }, 60000)

  it('a story with choices keeps the source ending as the canon path', async () => {
    const e = await adaptEnv()
    env = e
    const outlines: string[] = []
    e.mock.on({ task: 'outline' }, (req) => {
      outlines.push(lastUser(req))
      const n = 4
      const choices = (k: number) => [2 * k, 2 * k + 1].filter((to) => to <= n).map((to) => ({ text: `Go to ${to}`, to }))
      return JSON.stringify({
        chapters: Array.from({ length: n }, (_, i) => ({ title: `P${i + 1}`, summary: `Part ${i + 1} happens.`, source_chapters: [Math.min(3, i + 1)], choices: choices(i + 1), ending: choices(i + 1).length ? '' : i === 2 ? 'canon: the moon wakes' : 'sad: the lamp goes out' })),
        characters: [],
        places: [],
        threads: [],
        setting: 's',
        style: 'x'
      })
    })
    await e.engine.adaptBook({ book: 'moon-lamp', format: 'choice-visual-novel' })
    await waitFor(() => outlines.length > 0, 60000, 'the outline prompt')
    expect(outlines[0]).toContain('This book is a story with choices')
    expect(outlines[0]).toContain('canon path')
    expect(outlines[0]).toContain('source_chapters')
    const slug = (await e.engine.books.slugs()).find((s) => s !== 'moon-lamp')!
    await waitFor(async () => (await e.engine.books.outline(slug))?.chapters.length, 30000, 'the outline file')
    expect((await e.engine.books.outline(slug))!.chapters.map((c) => c.source_chapters)).toEqual([[1], [2], [3], [3]])
  }, 90000)
})
