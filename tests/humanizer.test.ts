import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { advance } from '../src/engine/pipeline/advance'
import type { BookState } from '../src/engine/pipeline/advance'
import { aiTells, humanizeProblem, scriptStructure, ticReport } from '../src/engine/pipeline/humanizerHandlers'
import { migrateHumanizer } from '../src/engine/store/migrations'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { writeMd } from '../src/engine/store/atomic'
import { emptyBrief } from '../src/shared/brief'
import { parseMd } from '../src/shared/md'
import { formatEntrySchema, qualitySchema, ROLES } from '../src/shared/schemas'
import { makePipelineEnv, quietResearchState, seedDir, waitFor } from './helpers'

type Env = Awaited<ReturnType<typeof makePipelineEnv>>
let env: Env | undefined
const tmp: string[] = []
afterEach(async () => {
  await env?.cleanup()
  env = undefined
  for (const d of tmp.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

const bookDir = (e: Env, slug: string, ...p: string[]) => path.join(e.dir, 'books', slug, ...p)
const readDoc = async (f: string) => parseMd(await readFile(f, 'utf8'))
const firstBook = (e: Env) => waitFor(async () => (await readdir(path.join(e.dir, 'books')))[0], 30000, 'a book')
const published = async (e: Env) => {
  const slug = (await firstBook(e))!
  await waitFor(async () => {
    try {
      return (await readDoc(bookDir(e, slug, 'book.md'))).data.stage === 'published'
    } catch {
      return false
    }
  }, 90000, 'the book to be published')
  return slug
}
const doneJob = (e: Env, id: string) => readDoc(path.join(e.dir, 'jobs', 'done', `${id}.md`))
const createdMs = async (e: Env, id: string) => Date.parse(String((await doneJob(e, id)).data.created))

describe('humanizer: the plan (advance)', () => {
  const format = formatEntrySchema.parse({ id: 'f', name: 'F', enabled: true, words: [100, 200], chapters: [2, 2] })
  const long = formatEntrySchema.parse({ id: 'n', name: 'N', enabled: true, long: true, max_rounds: 1, words: [100, 200], chapters: [4, 4] })
  const base = (over: Partial<BookState> = {}): BookState => ({
    slug: 'b',
    stage: 'drafting',
    round: 0,
    rewriteChapters: [],
    writerFamily: 'wfam',
    writerAgent: 'writer-x',
    format,
    quality: qualitySchema.parse({ kind: 'quality', max_rounds: 2 }),
    hasPitch: true,
    outlineChapters: 2,
    outlineRound: 0,
    acts: [],
    chapters: new Map([[1, 0], [2, 0]]),
    fixes: new Map(),
    totalWords: 150,
    lengthGate: { status: 'ok' },
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

  it('a short book is humanized after the length gate and before the first reviews, in a stage of its own', () => {
    const plan = advance(base({ humanize: true }))
    expect(plan.jobs.map((j) => j.id)).toEqual(['b--humanize--ch01--r0', 'b--humanize--ch02--r0'])
    expect(plan.jobs.every((j) => j.task === 'humanize_chapter' && j.role === 'humanizer' && j.round === 0)).toBe(true)
    expect(plan.patch).toEqual({ stage: 'humanizing' })
    // the chapters that are done are not asked again; when all are done the reviews start
    expect(advance(base({ humanize: true, stage: 'humanizing', humanized: new Map([[1, 0]]) })).jobs.map((j) => j.id)).toEqual(['b--humanize--ch02--r0'])
    const reviews = advance(base({ humanize: true, stage: 'humanizing', humanized: new Map([[1, 0], [2, 0]]) }))
    expect(reviews.patch).toEqual({ stage: 'reviewing' })
    expect(reviews.jobs.every((j) => j.task === 'review')).toBe(true)
    // the length gate comes first
    expect(advance(base({ humanize: true, lengthGate: null, totalWords: 20 })).jobs.map((j) => j.task)).toEqual(['rewrite_chapter', 'rewrite_chapter'])
  })

  it('the pass is skipped without the flag (no humanizer hired, format or book switched it off)', () => {
    for (const humanize of [false, undefined]) {
      const plan = advance(base({ humanize }))
      expect(plan.jobs.every((j) => j.task === 'review')).toBe(true)
      expect(plan.patch).toEqual({ stage: 'reviewing' })
    }
  })

  it('a book already in review is not sent back to the humanizer', () => {
    expect(advance(base({ humanize: true, stage: 'reviewing' })).jobs.every((j) => j.task === 'review')).toBe(true)
  })

  it('after a rewrite round the rewritten chapters are humanized again before they are reviewed again', () => {
    const rewriting = { humanize: true, stage: 'rewriting', round: 1, rewriteChapters: [2], humanized: new Map([[1, 0]]) }
    // chapter 2 is not rewritten yet
    expect(advance(base({ ...rewriting, chapters: new Map([[1, 0], [2, 0]]) })).jobs.map((j) => j.id)).toEqual(['b--rewrite--ch02--r1'])
    // rewritten (its humanized mark is gone): the humanizer, with the book's round in the job id
    const again = advance(base({ ...rewriting, chapters: new Map([[1, 0], [2, 1]]) }))
    expect(again.jobs.map((j) => j.id)).toEqual(['b--humanize--ch02--r1'])
    expect(again.jobs[0]!.round).toBe(1)
    // humanized: the reviews of round 1
    const next = advance(base({ ...rewriting, chapters: new Map([[1, 0], [2, 1]]), humanized: new Map([[1, 0], [2, 1]]) }))
    expect(next.jobs.every((j) => j.task === 'review' && j.round === 1)).toBe(true)
    // without the pass the reviews follow the rewrite at once
    expect(advance(base({ ...rewriting, humanize: false, chapters: new Map([[1, 0], [2, 1]]) })).jobs.every((j) => j.task === 'review')).toBe(true)
  })

  it('a long book is humanized per chapter after the continuity fix and before the memory update', () => {
    const b = (over: Partial<BookState> = {}) =>
      base({ format: long, outlineChapters: 4, acts: [{ n: 1, chapters: [1, 2] }, { n: 2, chapters: [3, 4] }], humanize: true, chapters: new Map([[1, 0]]), ...over })
    const pass = { verdict: 'pass' as const, chapters: [] }
    expect(advance(b()).jobs.map((j) => j.id)).toEqual(['b--check--ch01--r0'])
    // the continuity check says revise: the fix comes first
    expect(advance(b({ chapterChecks: new Map([[1, { verdict: 'revise', chapters: [1] }]]) })).jobs.map((j) => j.id)).toEqual(['b--rewrite--ch01--chk'])
    expect(advance(b({ chapterChecks: new Map([[1, { verdict: 'revise', chapters: [1] }]]), fixes: new Map([[1, ['chk']]]) })).jobs.map((j) => j.id)).toEqual(['b--humanize--ch01--r0'])
    // then the humanizer, then the memory
    const h = advance(b({ chapterChecks: new Map([[1, pass]]) }))
    expect(h.jobs.map((j) => j.id)).toEqual(['b--humanize--ch01--r0'])
    expect(h.patch).toEqual({})
    expect(advance(b({ chapterChecks: new Map([[1, pass]]), humanized: new Map([[1, 0]]) })).jobs.map((j) => j.task)).toEqual(['memory_update', 'index_chapter'])
    // a chapter that is settled already (a book started before the humanizer existed) is left alone
    expect(advance(b({ chapterChecks: new Map([[1, pass]]), settled: new Set([1]) })).jobs.map((j) => j.id)).toEqual(['b--draft--ch02--r0'])
    // switched off
    expect(advance(b({ humanize: false, chapterChecks: new Map([[1, pass]]) })).jobs.map((j) => j.task)).toEqual(['memory_update', 'index_chapter'])
  })
})

describe('humanizer: the guards and the report', () => {
  const words = (n: number, w = 'fox') => Array.from({ length: n }, () => w).join(' ')

  it('keeps the original when the length is more than 10% off, in either direction, or the answer is tiny', () => {
    const original = words(100)
    expect(humanizeProblem(original, words(100, 'owl'))).toBeNull()
    expect(humanizeProblem(original, words(110))).toBeNull()
    expect(humanizeProblem(original, words(90))).toBeNull()
    expect(humanizeProblem(original, words(111))).toMatch(/111 words against 100/)
    expect(humanizeProblem(original, words(89))).toMatch(/89 words against 100/)
    expect(humanizeProblem(original, words(10))).toMatch(/only 10 words/)
  })

  it('keeps [RESEARCH: ...] markers and, for non-fiction, the source numbers', () => {
    const original = `${words(60)} The harbour was built in [RESEARCH: when was the harbour built?] a hurry. ${words(40)}`
    expect(humanizeProblem(original, original.replace('hurry', 'rush'))).toBeNull()
    expect(humanizeProblem(original, original.replace(/\[RESEARCH:[^\]]*\]/, ''))).toMatch(/marker/)
    expect(humanizeProblem(original, original.replace('when was the harbour built?', 'who built the harbour?'))).toMatch(/marker/)
    const nf = `${words(60)} Ships took six months [1]. Crews fell ill [2]. ${words(40)}`
    expect(humanizeProblem(nf, nf.replace('fell ill', 'sickened'), { nonfiction: true })).toBeNull()
    expect(humanizeProblem(nf, nf.replace('[2]', ''), { nonfiction: true })).toMatch(/source numbers/)
  })

  it('keeps the structure of a script: scene lines, on-screen lines and speaker lines (and who speaks, in order)', () => {
    const script = [
      'SCENE: The harbour, dawn',
      'Gulls wheel over the water and a rope creaks against the pier at the very edge of morning.',
      'ON SCREEN: MARA (freckled, ink on her fingers)',
      'MARA (worried): The boat is late again and I do not like it one bit this morning at all.',
      'BRAM (gruff): It will come when the tide lets it and not a minute before that, girl.',
      'SCENE: The lamp room, night',
      'MARA (whispering): There is a map under the lens and somebody wanted it hidden from us all.'
    ].join('\n')
    expect(scriptStructure(script)).toEqual({ scenes: 2, cast: 1, speakers: ['MARA', 'BRAM', 'MARA'] })
    const livelier = script.replace('Gulls wheel over the water', 'Gulls scream over the black water').replace('girl.', 'girl, and you know it.')
    expect(humanizeProblem(script, livelier, { script: true })).toBeNull()
    // a dropped speaker line, a swapped speaker, a merged scene, a lost on-screen line
    expect(humanizeProblem(script, script.replace(/^BRAM \(gruff\): /m, ''), { script: true })).toMatch(/script lines changed/)
    expect(humanizeProblem(script, script.replace('BRAM (gruff)', 'MARA (gruff)'), { script: true })).toMatch(/script lines changed/)
    expect(humanizeProblem(script, script.replace('SCENE: The lamp room, night', 'The lamp room, night'), { script: true })).toMatch(/script lines changed/)
    expect(humanizeProblem(script, script.replace('ON SCREEN: ', ''), { script: true })).toMatch(/script lines changed/)
    // the same change is fine in prose
    expect(humanizeProblem(script, script.replace('BRAM (gruff)', 'MARA (gruff)'))).toBeNull()
  })

  it('finds the machine-prose habits of a chapter and the repeated phrases that touch it', () => {
    const text = [
      'It was cold. It was late. It was a night like any other, a testament to patience.',
      'She waited for a long moment. He did not look up. He did not say a word.',
      'Little did she know the tapestry of lies was about to tear — and soon.',
      'The weight of the silence pressed on tired, cold, and hungry people.'
    ].join(' ')
    const labels = aiTells(text).map((t) => t.label)
    expect(labels).toEqual(expect.arrayContaining(['"for a long time" / "for a long moment" / "a long moment"', 'sentences that open with "It was"', '"a testament to"', '"tapestry"', '"little did"', '"the weight of"']))
    expect(labels.some((l) => l.includes('did not look'))).toBe(true)
    expect(aiTells('The fox ran home. The hay was warm.')).toEqual([])
    const report = ticReport([{ n: 1, text: 'Plain. '.repeat(20) }, { n: 2, text }], 2)
    expect(report).toContain('a testament to')
    expect(report).toContain('It was')
    expect(ticReport([{ n: 1, text: 'The fox ran home. The hay was warm.' }], 1)).toMatch(/found nothing/)
    // a gesture tic that repeats over the book is reported for the chapters it is in
    const tic = (n: number) => ({ n, text: `${'She nodded. He shrugged. '.repeat(4)}Chapter ${n} goes on with other things for a while and that is all.` })
    expect(ticReport([1, 2, 3].map(tic), 3)).toMatch(/gesture tic "nodded"/)
  })
})

describe('humanizer: the pipeline on the mock provider', () => {
  it('a short book: every chapter is humanized after drafting, before the reviews, and the draft is kept in history', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', humanizer: true })
    const slug = await published(env)
    expect(env.counters.calls.humanize_chapter).toBe(1)
    const ch = await readDoc(bookDir(env, slug, 'chapters', 'ch-01.md'))
    expect(ch.data).toMatchObject({ round: 0, humanized: 0 })
    expect(ch.body).toContain('gave a huge yawn')
    // the draft before the pass is kept
    const history = await readdir(bookDir(env, slug, 'chapters', 'history'))
    expect(history).toEqual(['ch-01-r0.md'])
    expect(await readFile(bookDir(env, slug, 'chapters', 'history', 'ch-01-r0.md'), 'utf8')).not.toContain('gave a huge yawn')
    // order: draft, humanize, then the reviews
    const humanizeId = `${slug}--humanize--ch01--r0`
    expect(await createdMs(env, humanizeId)).toBeGreaterThanOrEqual(await createdMs(env, `${slug}--draft--ch01--r0`))
    const review = await createdMs(env, `${slug}--review--line-editor--r0`)
    expect(review).toBeGreaterThanOrEqual(Date.parse(String((await doneJob(env, humanizeId)).data.finished)) - 250)
    // it is in the book's record, with the humanizer agent and a prompt version
    const made = (await env.engine.books.readMade(slug)) as unknown as { task: string; role: string; agent: string; prompt_version: string }[]
    expect(made.find((m) => m.task === 'humanize_chapter')).toMatchObject({ role: 'humanizer', agent: 'humanizer-iris-vane' })
    expect(made.find((m) => m.task === 'humanize_chapter')!.prompt_version).toMatch(/^[0-9a-f]{8}$/)
    // what the humanizer was given: the chapter, the bible's style, the tic report, the rules
    const job = await doneJob(env, humanizeId)
    expect(job.data).toMatchObject({ task: 'humanize_chapter', role: 'humanizer', unit: 'ch01', round: 0 })
  }, 120000)

  it('a round rewrite is humanized again before the reviews of the next round', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', humanizer: true, revise: { 'line-editor': [0] } })
    const slug = await published(env)
    expect(env.counters.calls.rewrite_chapter).toBe(1)
    expect(env.counters.calls.humanize_chapter).toBe(2)
    const ch = await readDoc(bookDir(env, slug, 'chapters', 'ch-01.md'))
    // the chapter's round is the rewrite's; `humanized` says the pass of round 1 ran
    expect(ch.data).toMatchObject({ round: 1, humanized: 1 })
    const rewritten = Date.parse(String((await doneJob(env, `${slug}--rewrite--ch01--r1`)).data.finished))
    expect(await createdMs(env, `${slug}--humanize--ch01--r1`)).toBeGreaterThanOrEqual(rewritten - 250)
    const humanized = Date.parse(String((await doneJob(env, `${slug}--humanize--ch01--r1`)).data.finished))
    expect(await createdMs(env, `${slug}--review--line-editor--r1`)).toBeGreaterThanOrEqual(humanized - 250)
    // every version is kept: the draft, its humanized version (next to it), and the rewrite before its own pass
    expect((await readdir(bookDir(env, slug, 'chapters', 'history'))).sort()).toEqual(['ch-01-r0-humanized.md', 'ch-01-r0.md', 'ch-01-r1.md'])
    expect((await readDoc(bookDir(env, slug, 'book.md'))).data.round).toBe(1)
  }, 120000)

  it('several chapters: all of them are humanized, each once, before the reviews', async () => {
    env = await makePipelineEnv({ activate: ['jfic-chapter-books-everyday-adventures'], format: 'chapter-book', humanizer: true })
    const slug = await published(env)
    const chapters = (await readdir(bookDir(env, slug, 'chapters'))).filter((f) => /^ch-\d+\.md$/.test(f))
    expect(chapters.length).toBeGreaterThan(1)
    expect(env.counters.calls.humanize_chapter).toBe(chapters.length)
    for (const f of chapters) expect((await readDoc(bookDir(env, slug, 'chapters', f))).data.humanized).toBe(0)
  }, 120000)

  it('a long book: each chapter is humanized after its continuity fix and before its memory update', async () => {
    env = await makePipelineEnv({ activate: ['fic-fantasy-epic'], format: 'novel', smallNovel: true, humanizer: true, checkRevise: [2] })
    const slug = await published(env)
    expect(env.counters.calls.humanize_chapter).toBe(6)
    for (let n = 1; n <= 6; n++) {
      const unit = `ch0${n}`
      const h = await doneJob(env, `${slug}--humanize--${unit}--r0`)
      const finished = Date.parse(String(h.data.finished))
      expect(await createdMs(env, `${slug}--memory--${unit}--r0`), `memory of ${unit}`).toBeGreaterThanOrEqual(finished - 250)
      expect((await readDoc(bookDir(env, slug, 'chapters', `ch-0${n}.md`))).data.humanized, unit).toBe(0)
    }
    // chapter 2: the continuity fix, then the humanizer (the fix came first, so the 'chk' mark is kept)
    const fix = Date.parse(String((await doneJob(env, `${slug}--rewrite--ch02--chk`)).data.finished))
    expect(await createdMs(env, `${slug}--humanize--ch02--r0`)).toBeGreaterThanOrEqual(fix - 250)
    expect((await readDoc(bookDir(env, slug, 'chapters', 'ch-02.md'))).data.fixes).toEqual(['chk'])
  }, 180000)

  it('without a humanizer agent the pass is skipped, with one line in the log', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler' })
    const slug = await published(env)
    expect(env.counters.calls.humanize_chapter).toBeUndefined()
    expect((await readDoc(bookDir(env, slug, 'chapters', 'ch-01.md'))).data.humanized).toBeUndefined()
    expect(existsSync(path.join(env.dir, 'jobs', 'done', `${slug}--humanize--ch01--r0.md`))).toBe(false)
    expect(env.logs.filter((l) => l.includes('no humanizer is hired'))).toHaveLength(1)
  }, 120000)

  it('the format flag `humanize: false` skips the pass', async () => {
    env = await makePipelineEnv({
      activate: ['jfic-bedtime-and-dreams'],
      format: 'bedtime-toddler',
      humanizer: true,
      beforeStart: async (dir) => {
        const file = path.join(dir, 'config', 'formats.md')
        const doc = parseMd(await readFile(file, 'utf8'))
        const formats = (doc.data.formats as { id: string }[]).map((f) => (f.id === 'bedtime-toddler' ? { ...f, humanize: false } : f))
        await writeMd(file, { ...doc.data, formats }, doc.body)
      }
    })
    await published(env)
    expect(env.counters.calls.humanize_chapter).toBeUndefined()
    expect(env.logs.filter((l) => l.includes('no humanizer is hired'))).toHaveLength(0)
  }, 120000)

  it('the book override `humanize: false` (add_story) skips the pass, and is kept in the idea, the book and the brief', async () => {
    env = await makePipelineEnv({ format: 'bedtime-toddler', humanizer: true })
    const idea = await env.engine.addStory({ ...emptyBrief(), title: 'The Plain Fox', premise: 'A fox sleeps.', format: 'bedtime-toddler', humanize: false })
    expect(idea.data.humanize).toBe(false)
    const slug = await published(env)
    expect(env.counters.calls.humanize_chapter).toBeUndefined()
    expect((await readDoc(bookDir(env, slug, 'book.md'))).data.humanize).toBe(false)
    expect(await env.engine.books.brief(slug)).toMatchObject({ humanize: false })
    // editing the story keeps it
    const other = await env.engine.addStory({ ...emptyBrief(), title: 'Second', premise: 'x', humanize: false })
    const updated = await env.engine.updateStory(other.slug, { ...emptyBrief(), title: 'Second', premise: 'y', humanize: false })
    expect(updated.data.humanize).toBe(false)
  }, 120000)

  it('an answer more than 10% off keeps the chapter as it was, and the pass is not asked again', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', humanizer: true, humanizeWith: (chapter) => chapter.split(' ').slice(0, 30).join(' ') + ' and the fox slept in the warm hay all night long.' })
    const slug = await published(env)
    expect(env.counters.calls.humanize_chapter).toBe(1)
    const ch = await readDoc(bookDir(env, slug, 'chapters', 'ch-01.md'))
    expect(ch.data.humanized).toBe(0)
    const kept = await readFile(bookDir(env, slug, 'chapters', 'history', 'ch-01-r0.md'), 'utf8')
    expect(parseMd(kept).body.trim()).toBe(ch.body.trim())
    expect((await doneJob(env, `${slug}--humanize--ch01--r0`)).body).toMatch(/kept as it was/)
  }, 120000)

  it('a visual novel uses the script prompt, and an answer that changes the script lines is not used', async () => {
    const prompts: string[] = []
    env = await makePipelineEnv({
      activate: ['vn-mystery'],
      format: 'visual-novel',
      humanizer: true,
      humanizeWith: (chapter, request) => (prompts.push(request), `SCENE: A barn at night\n${chapter}`),
      beforeStart: async (dir) => {
        const file = path.join(dir, 'config', 'formats.md')
        const doc = parseMd(await readFile(file, 'utf8'))
        const formats = (doc.data.formats as { id: string }[]).map((f) => (f.id === 'visual-novel' ? { ...f, words: [1200, 4000], chapters: [4, 4] } : f))
        await writeMd(file, { ...doc.data, formats }, doc.body)
      }
    })
    const slug = await published(env)
    expect(prompts.length).toBe(4)
    for (const p of prompts) expect(p).toContain('a visual novel script')
    for (let n = 1; n <= 4; n++) {
      const ch = await readDoc(bookDir(env, slug, 'chapters', `ch-0${n}.md`))
      expect(ch.body).not.toContain('SCENE: A barn at night')
      expect(ch.data.humanized).toBe(0)
    }
    for (let n = 1; n <= 4; n++) expect((await doneJob(env, `${slug}--humanize--ch0${n}--r0`)).body).toMatch(/kept as it was \(the script lines changed/)
  }, 180000)
})

describe('humanizer: the role, the seed and the migration', () => {
  it('the role is known everywhere the roles are listed, and the seed has a humanizer agent and prompts', async () => {
    expect(ROLES).toContain('humanizer')
    const roles = parseMd(await readFile(path.join(seedDir, 'config', 'roles.md'), 'utf8')).data.roles as Record<string, { models: string[] }>
    expect(roles.humanizer!.models).toEqual(['deepseek/deepseek-flash', 'paid']) // SCP-14: DeepSeek Flash, then the paid default, no LM Studio step (SCP-13 had Strata first)
    const agent = parseMd(await readFile(path.join(seedDir, 'agents', 'humanizer-iris-vane.md'), 'utf8'))
    expect(agent.data).toMatchObject({ kind: 'agent', role: 'humanizer', name: 'Iris Vane' })
    for (const f of ['humanize_chapter.md', 'humanize_chapter_vn.md']) expect(existsSync(path.join(seedDir, 'prompts', 'humanizer', f))).toBe(true)
  })

  /** A data folder as it was before the humanizer: the seed without the humanizer's role entry and agent. */
  async function oldFolder(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-migrate-'))
    tmp.push(dir)
    await initDataFolder(dir, seedDir)
    const rolesFile = path.join(dir, 'config', 'roles.md')
    const doc = parseMd(await readFile(rolesFile, 'utf8'))
    const roles = { ...(doc.data.roles as Record<string, unknown>) }
    delete roles.humanizer
    // the owner's own model list for the line editor, which the humanizer copies
    roles['line-editor'] = { models: ['lmstudio', 'paid'] }
    await writeMd(rolesFile, { ...doc.data, roles }, doc.body)
    await rm(path.join(dir, 'agents', 'humanizer-iris-vane.md'))
    return dir
  }

  it('an old data folder gets the role (DeepSeek Flash, then paid) and the agent, once', async () => {
    const dir = await oldFolder()
    const first = await initDataFolder(dir, seedDir)
    expect(first.migrated).toHaveLength(2)
    expect(first.migrated[0]).toMatch(/roles\.md: added the humanizer role .*deepseek\/deepseek-flash, paid/)
    expect(first.migrated[1]).toMatch(/humanizer-iris-vane\.md: hired the starter humanizer/)
    const doc = parseMd(await readFile(path.join(dir, 'config', 'roles.md'), 'utf8'))
    expect((doc.data.roles as Record<string, { models: string[] }>).humanizer!.models).toEqual(['deepseek/deepseek-flash', 'paid'])
    expect(doc.body).toContain('# Roles') // the text below the frontmatter is kept
    expect(parseMd(await readFile(path.join(dir, 'agents', 'humanizer-iris-vane.md'), 'utf8')).data.role).toBe('humanizer')
    // the other agents are as they were, and a second start changes nothing
    const agents = (await readdir(path.join(dir, 'agents'))).sort()
    const second = await initDataFolder(dir, seedDir)
    expect(second.migrated).toEqual([])
    expect((await readdir(path.join(dir, 'agents'))).sort()).toEqual(agents)
  })

  it('an owner who hired a humanizer of their own keeps it: no second one is added', async () => {
    const dir = await oldFolder()
    await writeMd(path.join(dir, 'agents', 'humanizer-my-own.md'), { kind: 'agent', role: 'humanizer', name: 'My Own', model: null, focus: [], pin: null, max_parallel: 1, paused: false }, 'Mine.\n')
    const res = await initDataFolder(dir, seedDir)
    expect(res.migrated).toHaveLength(1) // only the role entry
    expect(existsSync(path.join(dir, 'agents', 'humanizer-iris-vane.md'))).toBe(false)
  })

  it('a folder that is not a data folder yet is not touched', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-migrate-empty-'))
    tmp.push(dir)
    await mkdir(path.join(dir, 'config'), { recursive: true })
    await writeFile(path.join(dir, 'config', 'other.md'), 'x')
    expect((await migrateHumanizer(dir, seedDir)).changes).toEqual([])
    expect(existsSync(path.join(dir, 'agents'))).toBe(false)
  })
})
