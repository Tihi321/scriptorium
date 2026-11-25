import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countWords } from '../src/engine/pipeline/books'
import { assembleFableBack, fableBackProblems, FABLE_DISCLAIMER, fableCard, joinFable, splitFable, startsWithFableBack, storyPart } from '../src/engine/pipeline/fable'
import { formatsForKind, variant } from '../src/engine/pipeline/handlers'
import { loadPrompt } from '../src/engine/pipeline/prompts'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { IDEA_FABLE_FORMAT_IDS, migrateIdeaFables } from '../src/engine/store/migrations'
import { formatsSchema } from '../src/shared/schemas'
import { emptyBrief } from '../src/shared/brief'
import { parseMd } from '../src/shared/md'
import { makePipelineEnv, seedDir, waitFor } from './helpers'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

const seedFormats = async () => formatsSchema.parse(parseMd(await readFile(path.join(seedDir, 'config', 'formats.md'), 'utf8')).data).formats

const SECTIONS = [
  { heading: 'Concept card', text: 'Idea: Sleep pressure\nDefinition: the urge to sleep grows the longer you are awake.' },
  { heading: 'Key facts', text: '1. Sleep pressure builds while you are awake.\n2. A steady wake time anchors the body clock.\n3. Late naps lower sleep pressure.\n4. Light in the morning helps the clock.' },
  { heading: 'Sources', text: '1. A sleep textbook, chapter 2\n2. A sleep textbook, chapter 3\n3. A sleep textbook, chapter 2\n4. A sleep textbook, chapter 4' },
  { heading: 'Go deeper', text: '*Why We Sleep*, Matthew Walker (Scribner)\n*The Promise of Sleep*, William Dement (Delacorte)' }
]
const CARD = fableCard({ ...emptyBrief(), sections: SECTIONS })

const quiz = (q: number) => Array.from({ length: q }, (_, i) => `**${i + 1}. Question ${i + 1}?**\nA) one\nB) two\nC) three\nD) four`).join('\n\n')
const backWith = (over: { quiz?: string; ref?: string; answers?: string } = {}) =>
  [
    '## What just happened',
    `**The idea.** Sleep pressure builds while you are awake ${over.ref ?? '[1]'}.`,
    '**Where it showed up.** Nora skipped her late nap and slept well.',
    '**How to use it tomorrow.** Keep one wake time all week.',
    '## Quiz',
    over.quiz ?? quiz(3),
    ...(over.answers === '' ? [] : [over.answers ?? '### Answers\n\n1. B. It builds while awake.\n\n2. A. A steady wake time.\n\n3. C. Late naps lower it.'])
  ].join('\n\n')
const STORY = 'Nora was tired every afternoon and slept badly every night. '.repeat(6).trim()

describe('the idea-fable format', () => {
  it('is in the seed with its flags, never picked at random, and its `_fable` prompts fall back to the plain ones', async () => {
    const formats = await seedFormats()
    const fable = formats.find((f) => f.id === 'idea-fable')!
    expect(fable).toMatchObject({ fable: true, words: [1500, 2000], chapters: [1, 1], research: false, humanize: true, enabled: true })
    expect(formatsForKind(formats, null).some((f) => f.id === 'idea-fable')).toBe(false)
    expect(formatsForKind(formats, 'idea-fable').some((f) => f.id === 'idea-fable')).toBe(false)
    expect(variant(fable, 'draft_chapter')).toBe('draft_chapter_fable')
    const plain = await loadPrompt(seedDir, 'humanizer', 'humanize_chapter')
    expect((await loadPrompt(seedDir, 'humanizer', 'humanize_chapter_fable')).body).toBe(plain.body)
    for (const task of ['draft_chapter', 'rewrite_chapter']) {
      const raw = await readFile(path.join(seedDir, 'prompts', 'writer', `${task}_fable.md`), 'utf8')
      const doc = parseMd(raw)
      expect(doc.data).toMatchObject({ role: 'writer', task })
      expect(doc.body).not.toContain(FABLE_DISCLAIMER)
    }
  })

  it('counts the story only, writes the engine-owned blocks once and finds a malformed back matter', () => {
    const chapter = joinFable(STORY, backWith())
    expect(splitFable(chapter)).toEqual({ story: STORY, back: backWith() })
    expect(countWords(storyPart(chapter))).toBe(countWords(STORY))
    expect(fableBackProblems(backWith(), CARD)).toEqual([])

    const done = assembleFableBack(backWith(), CARD)
    expect(done.indexOf('**Sources**')).toBeLessThan(done.indexOf('## Quiz'))
    expect(done).toContain('**Sources**\n1. A sleep textbook, chapter 2')
    expect(done.match(/## Go deeper/g)).toHaveLength(1)
    expect(done.endsWith(`*The Promise of Sleep*, William Dement (Delacorte)\n\n${FABLE_DISCLAIMER}`)).toBe(true)
    expect(assembleFableBack(done, CARD)).toBe(done)
    // what the model wrote of its own (a closing line, a book list, a sources paragraph) is replaced, not doubled
    const own = `${backWith()}\n\n**Sources**\n1. invented\n\n## Go deeper\n\n*An Invented Book*\n\n${FABLE_DISCLAIMER}`
    expect(assembleFableBack(own, CARD)).toBe(done)
    expect(assembleFableBack(`${backWith()}\n\n**sources:**\n\n1. invented\n\n## Go Deeper\n\n*An Invented Book*`, CARD)).toBe(done)
    expect(assembleFableBack(`${backWith()}\n\n## Sources\n\n1. invented\n\n**Go deeper:**\n\n*An Invented Book*`, CARD)).toBe(done)
    expect(fableBackProblems(done, CARD)).toEqual([])
    // a paragraph that only begins with the word Sources is prose, not a Sources label; only the exact heading starts back matter
    expect(assembleFableBack(`${backWith()}\n\n**Sources** of stress pile up [2].`, CARD)).toContain('**Sources** of stress pile up [2].')
    // a one-line model-written Sources paragraph is removed too (one Sources block in the output)
    const inline = assembleFableBack(`${backWith()}\n\n**Sources:** Adams et al., Nature 2021.`, CARD)
    expect(inline.match(/\*\*Sources/g)).toHaveLength(1)
    expect(inline).not.toContain('Adams et al.')
    expect([startsWithFableBack('\n## What just happened  \nx'), startsWithFableBack('## What just happened to Ada\nx')]).toEqual([true, false])

    const bad: [string, string][] = [
      [backWith({ quiz: quiz(2) }), '2 questions'],
      [backWith({ ref: '[5]' }), '[5] is not a key fact of the card (it has 4)'],
      [backWith({ answers: '' }), 'no ### Answers section']
    ]
    for (const [text, problem] of bad) expect(fableBackProblems(text, CARD).join('|')).toContain(problem)
    expect(fableBackProblems('', CARD)).toEqual(['no back matter (## What just happened)'])
  })
})

describe('an idea fable in the factory', () => {
  it('starts from a story that fixes the format, counts the story only and shows the humanizer no back matter', async () => {
    const requests: string[] = []
    const e = await makePipelineEnv({
      humanizer: true,
      humanizeWith: (chapter, request) => {
        requests.push(request)
        return chapter.replace('little', 'tiny')
      }
    })
    try {
      const story = Array.from({ length: 1700 }, (_, i) => ['The', 'little', 'fox', 'yawned', 'and', 'curled', 'up', 'in', 'the', 'warm', 'hay.'][i % 11]).join(' ')
      e.mock.on({ task: 'draft_chapter' }, () => `${story}\n\n${backWith()}`)
      await e.engine.addStory({ ...emptyBrief(), title: 'The Long Afternoon', premise: 'A tired woman learns why she cannot sleep.', format: 'idea-fable', sections: SECTIONS })
      const file = await waitFor(async () => {
        for (const s of await e.engine.books.slugs()) {
          try {
            const text = await readFile(path.join(e.dir, 'books', s, 'chapters', 'ch-01.md'), 'utf8')
            if (parseMd(text).data.humanizer_result) return { slug: s, text }
          } catch {
            /* not written yet */
          }
        }
        return null
      }, 45000, 'the humanized fable chapter')
      const book = parseMd(await readFile(path.join(e.dir, 'books', file.slug, 'book.md'), 'utf8')).data
      expect(book).toMatchObject({ format: 'idea-fable' })
      const doc = parseMd(file.text)
      const { story: written, back } = splitFable(doc.body)
      expect(doc.data.words).toBe(countWords(written))
      expect(doc.data.words).toBe(1700)
      expect(written).toContain('tiny')
      expect(back).toBe(assembleFableBack(backWith(), CARD))
      expect(doc.body.trim().endsWith(FABLE_DISCLAIMER)).toBe(true)
      expect(requests.length).toBeGreaterThan(0)
      expect(requests.every((r) => !r.includes('## What just happened'))).toBe(true)
    } finally {
      await e.cleanup()
    }
  }, 90000)

  it('splits a chapter for its word count only when it carries the engine closing line', async () => {
    const e = await makePipelineEnv({})
    try {
      const plain = '## What just happened\n\nOne two three four five.'
      await e.engine.books.writeChapter('x-book', { n: 1, title: 'A', round: 0, body: plain })
      await e.engine.books.writeChapter('x-book', { n: 2, title: 'B', round: 0, body: joinFable(STORY, assembleFableBack(backWith(), CARD)) })
      const words = async (n: number) => Number(parseMd(await readFile(path.join(e.dir, 'books', 'x-book', 'chapters', `ch-0${n}.md`), 'utf8')).data.words)
      expect(await words(1)).toBe(countWords(plain))
      expect(await words(2)).toBe(countWords(STORY))
    } finally {
      await e.cleanup()
    }
  }, 30000)

  it('asks once for a back matter with two quiz questions and takes the repaired one, heading kept', async () => {
    const e = await makePipelineEnv({})
    try {
      let asked = 0
      e.mock.on({ task: 'draft_chapter' }, (req) => {
        const repair = /back matter after the story has these problems/.test(req.messages[req.messages.length - 1]?.content ?? '')
        if (repair) asked++
        return repair ? backWith() : `${STORY}\n\n${backWith({ quiz: quiz(2) })}`
      })
      await e.engine.addStory({ ...emptyBrief(), title: 'The Long Afternoon', premise: 'A tired woman learns why she cannot sleep.', format: 'idea-fable', sections: SECTIONS })
      const text = await waitFor(async () => {
        for (const s of await e.engine.books.slugs()) {
          try {
            return await readFile(path.join(e.dir, 'books', s, 'chapters', 'ch-01.md'), 'utf8')
          } catch {
            /* not written yet */
          }
        }
        return null
      }, 45000, 'the repaired fable chapter')
      const { story, back } = splitFable(parseMd(text).body)
      expect(asked).toBe(1)
      expect(story).toBe(STORY)
      expect(back).toBe(assembleFableBack(backWith(), CARD))
      expect(fableBackProblems(back, CARD)).toEqual([])
      expect(back.match(/^\*\*\d\. Question/gm)).toHaveLength(3)
    } finally {
      await e.cleanup()
    }
  }, 90000)
})

describe('migrateIdeaFables', () => {
  it('appends the seed entry once and keeps CRLF line endings', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-fable-'))
    dirs.push(dir)
    await initDataFolder(dir, seedDir)
    const file = path.join(dir, 'config', 'formats.md')
    const text = await readFile(file, 'utf8')
    const from = text.indexOf('  - id: idea-fable\n')
    const to = text.indexOf('---\n# Formats')
    expect(from).toBeGreaterThan(0)
    expect(to).toBeGreaterThan(from)
    await writeFile(file, (text.slice(0, from) + text.slice(to)).replace(/\n/g, '\r\n'))
    expect(formatsSchema.parse(parseMd(await readFile(file, 'utf8')).data).formats.some((f) => f.fable)).toBe(false)
    expect((await migrateIdeaFables(dir, seedDir)).changes).toEqual(['config/formats.md: added the idea-fable format (idea-fable)'])
    const after = await readFile(file, 'utf8')
    expect(after.replace(/\r\n/g, '')).not.toContain('\n')
    expect(formatsSchema.parse(parseMd(after).data).formats.find((f) => f.id === 'idea-fable')).toMatchObject({ fable: true, words: [1500, 2000] })
    expect((await migrateIdeaFables(dir, seedDir)).changes).toEqual([])
    expect(await readFile(file, 'utf8')).toBe(after)
    expect(IDEA_FABLE_FORMAT_IDS).toEqual(['idea-fable'])
  })
})
