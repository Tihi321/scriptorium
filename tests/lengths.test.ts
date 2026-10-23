import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { advance, runtimeNote } from '../src/engine/pipeline/advance'
import type { BookState } from '../src/engine/pipeline/advance'
import { chapterSeconds, noteWantsLength, perChapterTarget, TRIM_ABOVE } from '../src/engine/pipeline/handlers'
import { writeMd } from '../src/engine/store/atomic'
import { parseMd } from '../src/shared/md'
import { formatEntrySchema, qualitySchema } from '../src/shared/schemas'
import { makePipelineEnv, quietResearchState, waitFor } from './helpers'

describe('perChapterTarget', () => {
  it('is the book target over the planned chapters, not over the chapters written so far', () => {
    expect(perChapterTarget({ target_words: 6000 }, { chapters: new Array(6) }, 3)).toBe(1000)
    expect(perChapterTarget({ target_words: 45000 }, { chapters: new Array(11) }, 11)).toBe(4091)
    expect(perChapterTarget({ target_words: 900 }, null, 3)).toBe(300)
    expect(perChapterTarget({ target_words: 900 }, null, 0)).toBe(900)
    expect(TRIM_ABOVE).toBe(1.2)
  })
})

const short = formatEntrySchema.parse({ id: 'vn', name: 'VN', enabled: true, script: true, words: [8000, 25000], chapters: [4, 4] })
const long = formatEntrySchema.parse({ id: 'novella', name: 'Novella', enabled: true, long: true, max_rounds: 1, words: [20000, 50000], chapters: [10, 10] })

const base = (format: typeof short, over: Partial<BookState> = {}): BookState => ({
  slug: 'b',
  stage: 'drafting',
  round: 0,
  rewriteChapters: [],
  writerFamily: 'wfam',
  writerAgent: 'writer-x',
  format,
  quality: qualitySchema.parse({ kind: 'quality', max_rounds: 2 }),
  hasPitch: true,
  outlineChapters: format.chapters[0],
  outlineRound: 0,
  acts: [],
  chapters: new Map(Array.from({ length: format.chapters[0] }, (_, i) => [i + 1, 0])),
  fixes: new Map(),
  totalWords: 0,
  lengthGate: null,
  reviews: new Map(),
  actReviewFiles: new Set(),
  outlineReview: { verdict: 'pass', chapters: [] },
  chapterChecks: new Map(),
  settled: new Set(),
  actSummaries: new Set(),
  actReviews: new Set(),
  repetitionReport: false,
  failedJobs: [],
  ...quietResearchState(),
  ...over
})

describe('the length gate of a short book', () => {
  it('a draft inside the range but 23% over the target gets the gate, with chapters told their share of the target', () => {
    const plan = advance(base(short, { totalWords: 27000 / 1.0, targetWords: 22000 }))
    expect(plan.patch).toMatchObject({ stage: 'length-fix', length_gate: { status: 'rewriting', words: 27000 } })
    // 27,000 is over the 25,000 ceiling by 8%: the old rule alone would let it pass; 27,000 against 22,000 does not
    expect(advance(base(short, { totalWords: 24000, targetWords: 22000 })).patch).toMatchObject({ length_gate: { status: 'ok' } })
    const over = advance(base(short, { totalWords: 26800, targetWords: 22000 }))
    expect(over.jobs).toHaveLength(4)
    expect(over.jobs[0]!.body).toContain('this book should have about 22000')
    expect(over.jobs[0]!.body).toContain('Rewrite this chapter to about 5500 words')
    expect(over.jobs[0]!.body).toContain('It is too long')
  })

  it('without a target the old rule holds, and a draft 25% under the target gets the gate too', () => {
    expect(advance(base(short, { totalWords: 24000 })).patch).toMatchObject({ length_gate: { status: 'ok' } })
    expect(advance(base(short, { totalWords: 6000 })).patch).toMatchObject({ length_gate: { status: 'rewriting' } })
    const under = advance(base(short, { totalWords: 15000, targetWords: 20000 }))
    expect(under.patch).toMatchObject({ length_gate: { status: 'rewriting' } })
    expect(under.jobs[0]!.body).toContain('Rewrite this chapter to about 5000 words')
    expect(under.jobs[0]!.body).toContain('It is too short')
  })

  it('a per-chapter share stays inside the format range (a target outside it is clamped)', () => {
    // a target of 40,000 over four chapters is 10,000 each, but the format allows 25,000 in all: 6,250 each at most
    const plan = advance(base(short, { totalWords: 8500, targetWords: 40000 }))
    expect(plan.jobs[0]!.body).toContain('Rewrite this chapter to about 6250 words')
  })
})

describe('the length gate of a long book', () => {
  const words = [4500, 4500, 7000, 4500, 3900, 4500, 8000, 4500, 4500, 4500]
  const state = (over: Partial<BookState> = {}) =>
    base(long, {
      targetWords: 45000,
      totalWords: words.reduce((a, b) => a + b, 0),
      chapterWords: new Map(words.map((w, i) => [i + 1, w])),
      acts: [{ n: 1, chapters: words.map((_, i) => i + 1) }],
      chapterChecks: new Map(words.map((_, i) => [i + 1, { verdict: 'pass' as const, chapters: [] }])),
      settled: new Set(words.map((_, i) => i + 1)),
      actSummaries: new Set([1]),
      actReviews: new Set([1]),
      ...over
    })

  it('a book over the format ceiling gets length rewrites for the chapters far from their share only', () => {
    const plan = advance(state())
    expect(plan.patch).toMatchObject({ stage: 'length-fix', length_gate: { status: 'rewriting', words: 50400, min: 20000, max: 50000 } })
    expect(plan.jobs.map((j) => j.id)).toEqual(['b--rewrite--ch03--len', 'b--rewrite--ch05--len', 'b--rewrite--ch07--len'])
    expect(plan.jobs[0]!.body).toContain('Rewrite this chapter to about 4500 words')
    expect(plan.jobs[0]!.body).toContain('It is too long')
    expect(plan.jobs[1]!.body).toContain('It is too short')
  })

  it('goes on with the chapters not yet done, then reviews', () => {
    const rewriting = state({ stage: 'length-fix', lengthGate: { status: 'rewriting', words: 50400 }, fixes: new Map([[3, ['len']]]) })
    expect(advance(rewriting).jobs.map((j) => j.id)).toEqual(['b--rewrite--ch05--len', 'b--rewrite--ch07--len'])
    const done = advance(state({ stage: 'length-fix', lengthGate: { status: 'rewriting', words: 50400 }, fixes: new Map([[3, ['len']], [5, ['len']], [7, ['len']]]) }))
    expect(done.patch).toMatchObject({ stage: 'drafting', length_gate: { status: 'done', words_before: 50400 } })
    // once done the gate does not run again: the reviews start
    const after = advance(state({ stage: 'drafting', lengthGate: { status: 'done' }, repetitionReport: false }))
    expect(after.jobs.map((j) => j.task)).toEqual(['repetition_report'])
  })

  it('a book inside the range and near its target passes the gate, and a book already in review is left alone', () => {
    const fine = [4400, 4600, 4500, 4500, 4500, 4400, 4600, 4500, 4500, 4500]
    expect(advance(state({ totalWords: 45000, chapterWords: new Map(fine.map((w, i) => [i + 1, w])) })).patch).toMatchObject({ length_gate: { status: 'ok' } })
    expect(advance(state({ stage: 'reviewing' })).patch).not.toHaveProperty('length_gate')
    // over the target by 15% or more: the gate runs even inside the format's range (47,000 against 40,000, every chapter 700 over its share)
    const big = advance(state({ targetWords: 40000, totalWords: 47000, chapterWords: new Map(words.map((_, i) => [i + 1, 4700])) }))
    expect(big.patch).toMatchObject({ stage: 'length-fix', length_gate: { status: 'rewriting', words: 47000 } })
    expect(big.jobs).toHaveLength(10)
    expect(big.jobs[0]!.body).toContain('Rewrite this chapter to about 4000 words')
  })
})

describe('a chapter far over its target is cut once (pipeline)', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  it('a draft 50% over gets one tighten request and the chapter is kept near the target', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', draftRatio: 1.5 })
    const e = env
    const slug = (await waitFor(async () => (await readdir(path.join(e.dir, 'books')))[0] ?? null, 30000, 'a book'))!
    await waitFor(async () => parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8').catch(() => '')).data.stage === 'published', 90000, 'published')
    const book = parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data
    const target = Number(book.target_words)
    const ch = parseMd(await readFile(path.join(e.dir, 'books', slug, 'chapters', 'ch-01.md'), 'utf8'))
    expect(e.counters.calls.draft_chapter).toBe(2) // the draft and the tighten request
    expect(Number(ch.data.words)).toBeGreaterThanOrEqual(target * 0.8)
    expect(Number(ch.data.words)).toBeLessThanOrEqual(target * 1.2)
    const job = parseMd(await readFile(path.join(e.dir, 'jobs', 'done', `${slug}--draft--ch01--r0.md`), 'utf8'))
    expect(job.body).toMatch(/trimmed from \d+/)
    expect(job.body).toContain('Cut it to about')
    // the book summary shows the gate result
    expect((await e.engine.snapshot()).books.find((b) => b.slug === slug)?.lengthGate).toMatchObject({ status: 'ok' })
  }, 120000)
})

describe('a script chapter far over its target is cut once, and the cue lines stay (pipeline)', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  it('the tighten request of a visual novel names the picture and sound lines', async () => {
    env = await makePipelineEnv({
      activate: ['vn-mystery'],
      format: 'visual-novel',
      draftRatio: 1.5,
      beforeStart: async (dir) => {
        const file = path.join(dir, 'config', 'formats.md')
        const doc = parseMd(await readFile(file, 'utf8'))
        const formats = (doc.data.formats as { id: string }[]).map((f) => (f.id === 'visual-novel' ? { ...f, words: [1200, 4000], chapters: [4, 4] } : f))
        await writeMd(file, { ...doc.data, formats }, doc.body)
      }
    })
    const e = env
    const slug = (await waitFor(async () => (await readdir(path.join(e.dir, 'books')))[0] ?? null, 30000, 'a book'))!
    await waitFor(async () => parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8').catch(() => '')).data.stage === 'published', 120000, 'published')
    const job = parseMd(await readFile(path.join(e.dir, 'jobs', 'done', `${slug}--draft--ch01--r0.md`), 'utf8'))
    expect(job.body).toContain('Cut it to about')
    expect(job.body).toContain('keep every SCENE, ON SCREEN, CG, INSERT, SFX and AMBIENCE line')
  }, 180000)
})

describe('the rewrite of a long book asks for the chapter\'s own share (pipeline)', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  it('the continuity fix of chapter 2, with 2 of 6 chapters written, is asked for the share of 6 chapters, not of 2', async () => {
    env = await makePipelineEnv({ activate: ['fic-fantasy-epic'], format: 'novel', smallNovel: true, checkRevise: [2] })
    const e = env
    const slug = (await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 120000, 'the novel to be published'))!
    const target = Number(parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data.target_words)
    const fix = parseMd(await readFile(path.join(e.dir, 'jobs', 'done', `${slug}--rewrite--ch02--chk.md`), 'utf8')).body
    const asked = Number(/Keep the chapter at about (\d+) words/.exec(fix)?.[1])
    const share = Math.round(target / 6)
    expect(asked).toBeGreaterThanOrEqual(Math.round(0.85 * share))
    expect(asked).toBeLessThanOrEqual(Math.round(1.15 * share))
    expect(asked).not.toBe(Math.round(target / 2))
  }, 180000)
})

const film = formatEntrySchema.parse({ id: 'short-film', name: 'Short film', enabled: true, script: true, screenplay: true, words: [400, 2000], chapters: [2, 2], runtime: [60, 180] })
/** A screenplay chapter: `shots` shots of `sec` seconds, each with a long cue line (many words, few seconds). */
const reel = (shots: number, sec: number) =>
  Array.from({ length: shots }, (_, i) => ['SHOT (wide, static, ' + sec + 's): ' + 'A very long description of what the camera sees in this one take, '.repeat(3), 'NARRATOR: Line ' + i + '.'].join(String.fromCharCode(10))).join(String.fromCharCode(10))

describe('the length of a screenplay is its runtime (SCP-29)', () => {
  it('chapterSeconds sums the shot lengths, not the words', () => {
    expect(chapterSeconds(reel(5, 6))).toBe(30)
    expect(reel(5, 6).split(/\s+/).length).toBeGreaterThan(200)
  })

  it('a film inside its runtime range but far over its word target gets no length rewrite', () => {
    const plan = advance(base(film, { totalWords: 4200, targetWords: 1000, totalSeconds: 120 }))
    expect(plan.jobs.filter((j) => j.task === 'rewrite_chapter')).toEqual([])
    expect(plan.patch).toMatchObject({ length_gate: { status: 'ok', seconds: 120 } })
  })

  it('a film over its runtime gets a cut request in seconds and shots, not words', () => {
    const plan = advance(base(film, { totalWords: 900, targetWords: 900, totalSeconds: 260 }))
    expect(plan.patch).toMatchObject({ stage: 'length-fix', length_gate: { status: 'rewriting', seconds: 260 } })
    const note = plan.jobs[0]!.body as string
    expect(note).toContain('260 seconds')
    expect(note).toContain('about 81 seconds')
    expect(note).toContain('cut shots')
    expect(note).not.toMatch(/words/)
  })

  it('a film under its runtime is asked to add shots, and the gate closes once every chapter is fixed', () => {
    expect(runtimeNote(20, 60, 180, 2)).toContain('add shots')
    const fixes = new Map([[1, ['len']], [2, ['len']]])
    const plan = advance(base(film, { totalWords: 900, totalSeconds: 100, fixes, lengthGate: { status: 'rewriting', words: 900, seconds: 260 } }))
    expect(plan.patch).toMatchObject({ stage: 'drafting', length_gate: { status: 'done', seconds_before: 260, seconds: 100 } })
  })
})

describe('noteWantsLength', () => {
  it('knows a note that asks for more length', () => {
    for (const note of ['Make this chapter longer.', 'Expand the ending', 'lengthen the market scene', 'More detail about the lamp, please', 'Add another scene at the harbour', 'add a paragraph about the storm', 'Flesh out the quarrel']) expect(noteWantsLength(note), note).toBe(true)
  })

  it('does not take other notes for a request for length', () => {
    for (const note of ['Mara should not say that.', 'Make the ending calmer.', 'Cut the dream.', 'Too much detail about the lamp', 'Shorter, please']) expect(noteWantsLength(note), note).toBe(false)
  })
})

describe('a rewrite from an owner note is tightened too (pipeline)', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  it('a note rewrite far over its share gets the tighten request; a note that asks for more length does not', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler' })
    const e = env
    const prose = (n: number) => Array.from({ length: n }, (_, i) => ['The', 'little', 'fox', 'yawned', 'and', 'curled', 'up', 'in', 'the', 'warm', 'hay.'][i % 11]).join(' ')
    const slug = (await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 90000, 'the book to be published'))!
    // from here on every rewrite comes back at 1.6 times its share, and the tighten request is answered at the share
    e.mock.on({ task: 'rewrite_chapter' }, (req) => {
      const last = req.messages[req.messages.length - 1]!.content
      const share = Number(/(?:Cut it to about|Keep the chapter at about) (\d+) words/.exec(last)?.[1] ?? /about (\d+) words/.exec(req.messages.map((m) => m.content).join('\n'))?.[1] ?? 100)
      return prose(/Cut it to about/.test(last) ? share : Math.round(share * 1.6))
    })
    const doneNote = async (text: string, known: Set<string>) => {
      await e.engine.handleCommand({ type: 'addBookNote', book: slug, text, chapter: 1, rewrite: true })
      const file = (await waitFor(async () => (await readdir(path.join(e.dir, 'jobs', 'done'))).find((f) => f.startsWith(`${slug}--rewrite--ch01--note`) && !known.has(f)), 30000, `the rewrite for "${text}"`))!
      known.add(file)
      return readFile(path.join(e.dir, 'jobs', 'done', file), 'utf8')
    }
    const known = new Set<string>()
    const plain = await doneNote('The fox should whisper, not shout.', known)
    expect(plain).toContain('Cut it to about')
    const longer = await doneNote('Make this chapter longer, with a second dream.', known)
    expect(longer).not.toContain('Cut it to about')
    await e.engine.logs.flush()
    expect(await readFile(path.join(e.dir, 'books', slug, 'log.md'), 'utf8')).toContain('the note asks for more length')
  }, 180000)
})

describe('length_over at publish (pipeline)', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })
  const prose = (n: number) => Array.from({ length: n }, (_, i) => ['The', 'little', 'fox', 'yawned', 'and', 'curled', 'up', 'in', 'the', 'warm', 'hay.'][i % 11]).join(' ')
  const publishedBook = async (e: Env) => {
    const slug = (await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 90000, 'the book to be published'))!
    return { slug, book: parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data, summary: (await e.engine.snapshot()).books.find((b) => b.slug === slug)! }
  }

  it('a book over the format ceiling is published with length_over in book.md and lengthOver in its summary', async () => {
    // bedtime-toddler allows 800 words at most: the draft and every rewrite (also the length rewrite) come back with 1,300
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler' })
    env.mock.on({ task: 'draft_chapter' }, () => prose(1300))
    env.mock.on({ task: 'rewrite_chapter' }, () => prose(1300))
    const { slug, book, summary } = await publishedBook(env)
    const ceiling = 800
    const ch = parseMd(await readFile(path.join(env.dir, 'books', slug, 'chapters', 'ch-01.md'), 'utf8'))
    expect(Number(ch.data.words)).toBeGreaterThan(ceiling)
    expect(book.stage).toBe('published')
    expect(book.length_over).toBe(true)
    expect(summary.lengthOver).toBe(true)
    await env.engine.logs.flush()
    expect(await readFile(path.join(env.dir, 'books', slug, 'log.md'), 'utf8')).toContain("over the format's ceiling of 800")
  }, 150000)

  it('a book inside the range has neither', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler' })
    const { book, summary } = await publishedBook(env)
    expect(book.stage).toBe('published')
    expect(book).not.toHaveProperty('length_over')
    expect(summary.lengthOver).toBeUndefined()
  }, 150000)
})
