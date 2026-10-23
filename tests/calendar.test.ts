import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { calendarSection, datesIn, storyYear, weekdayMismatches, weekdayOf } from '../src/engine/pipeline/calendar'
import { STORY_YEAR_RULE, ensureStoryYearRule } from '../src/engine/pipeline/handlers'
import { dimensionsFor } from '../src/engine/pipeline/scoring'
import { parseMd } from '../src/shared/md'
import { makePipelineEnv, waitFor } from './helpers'

describe('the calendar', () => {
  it('knows the weekday of a date', () => {
    expect(weekdayOf(2026, 10, 24)).toBe('Saturday')
    expect(weekdayOf(2000, 2, 29)).toBe('Tuesday')
  })

  it('finds the dates a text names, in both orders, with and without weekday and year', () => {
    const found = datesIn('On Saturday 24 October he left. By Oct 26, 2026 she knew. Sun, 25 Oct was quiet. The 3rd of March came. Nothing on 12 Decide.')
    expect(found.map((d) => [d.day, d.month, d.year, d.weekday])).toEqual([
      [24, 9, undefined, 6],
      [25, 9, undefined, 0],
      [3, 2, undefined, undefined],
      [26, 9, 2026, undefined]
    ])
  })

  it('finds a wrong weekday: "Sunday 24 October" in 2026 is a Saturday', () => {
    expect(weekdayMismatches('He left on Sunday 24 October, at dawn. Saturday 24 October was right.', 2026)).toEqual([{ said: 'Sunday 24 October', date: '24 October 2026', actual: 'Saturday' }])
    // a year in the text wins over the story's year
    expect(weekdayMismatches('Monday, October 24, 2022 was a long day.', 2026)).toEqual([])
    expect(weekdayMismatches('No dates here.', 2026)).toEqual([])
  })

  it('picks the story year from the book, else from the most frequent year of its texts, else none', () => {
    expect(storyYear({ story_year: 1888 }, ['set in 2026'])).toBe(1888)
    expect(storyYear({}, ['The setting is Paris in 2026.', 'Pitch: autumn 2026, after the 2024 fire.', ''])).toBe(2026)
    expect(storyYear({}, ['Once upon a time, 99 days ago.'])).toBeNull()
  })

  it('does not guess a year when the outline said the story has none (story_year: null), even if a text names one', () => {
    expect(storyYear({ story_year: null }, ['A tram ticket dated 3 March 1989.', 'Setting: 1989.'])).toBeNull()
  })

  it('words a year taken from the texts as a guess, and a stated year as a fact', () => {
    const guessed = calendarSection(1989, 'On 3 March it rained.', true)
    expect(guessed).toContain('not stated')
    expect(guessed).toContain('only a guess')
    expect(guessed).not.toContain("from the book's own files")
    expect(calendarSection(1989, 'On 3 March it rained.')).toContain("The story is set in 1989 (from the book's own files)")
  })

  it('writes the calendar block: the year, the weekdays, the slips and the canon rule; without a year, the no-year text', () => {
    const text = 'On Saturday 24 October and on 25 October. Then Sunday 24 October again.'
    const section = calendarSection(2026, text)
    expect(section).toContain("## The story's calendar")
    expect(section).toContain('The story is set in 2026 (from the book\'s own files). Do not assume the current year.')
    expect(section).toContain('24 October = Saturday, 25 October = Sunday')
    expect(section).toContain('The engine found these weekday slips in the text: "Sunday 24 October" (24 October 2026 is a Saturday)')
    expect(section).toContain('A note about a weekday, a date or a count of years must agree with this calendar.')
    expect(section).toContain('are canon: never report them as contradictions')
    const none = calendarSection(null, text)
    expect(none).toContain("The story's year is not stated: do not report a weekday or a count of years as an error unless the text contradicts itself.")
    expect(none).not.toContain('The story is set in')
    expect(none).toContain('are canon')
  })
})

describe('the reviewers and the writer get the calendar', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  it('a book with a story year: the review prompt has the year and the weekdays, the rewrite prompt says the notes are open to judgement, and the year is kept in book.md', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', storyYear: 2026 })
    const e = env
    const reviews: string[] = []
    const rewrites: string[] = []
    const body = 'On Sunday 24 October the little fox curled up in the warm hay and yawned. '.repeat(14)
    e.mock.on({ task: 'draft_chapter' }, body)
    e.mock.on({ task: 'rewrite_chapter' }, (req) => {
      rewrites.push(req.messages.map((m) => m.content).join('\n'))
      return body
    })
    e.mock.on({ task: 'review' }, (req) => {
      reviews.push(req.messages.map((m) => m.content).join('\n'))
      const role = req.meta!.role!
      const revise = role === 'line-editor' && /review round 0/.test(req.messages[req.messages.length - 1]!.content)
      return JSON.stringify({
        verdict: revise ? 'revise' : 'pass',
        scores: Object.fromEntries(dimensionsFor(role).map((d) => [d, revise ? 5 : 8])),
        notes: revise ? 'The weekday in the first line does not match the story calendar of the book.' : `Looks good (${role}).`,
        chapters: [],
        problems: [],
        research_questions: []
      })
    })
    const slug = (await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 90000, 'the book to be published'))!
    expect(parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data.story_year).toBe(2026)
    expect(reviews.length).toBeGreaterThan(0)
    expect(reviews[0]).toContain('The story is set in 2026')
    expect(reviews[0]).toContain('24 October = Saturday')
    expect(reviews[0]).toContain('"Sunday 24 October" (24 October 2026 is a Saturday)')
    expect(rewrites.length).toBeGreaterThan(0)
    expect(rewrites[0]).toContain('open to judgement')
    expect(rewrites[0]).toContain('The story is set in 2026')
  }, 120000)
})

describe('a story without a year', () => {
  let env: Awaited<ReturnType<typeof makePipelineEnv>> | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  it('records story_year null from the outline, and the prompts do not state a year found in the text', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler' })
    const e = env
    const prompts: string[] = []
    const body = 'The little fox found a tram ticket dated 3 March 1989 and curled up in the warm hay. '.repeat(14)
    e.mock.on({ task: 'draft_chapter' }, body)
    e.mock.on({ task: 'rewrite_chapter' }, body)
    e.mock.on({ task: 'review' }, (req) => {
      prompts.push(req.messages.map((m) => m.content).join('\n'))
      const role = req.meta!.role!
      return JSON.stringify({ verdict: 'pass', scores: Object.fromEntries(dimensionsFor(role).map((d) => [d, 8])), notes: 'Fine.', chapters: [], problems: [], research_questions: [] })
    })
    const slug = (await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 90000, 'the book to be published'))!
    const data = parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data
    expect(data.story_year).toBeNull()
    expect(prompts.length).toBeGreaterThan(0)
    for (const p of prompts) {
      expect(p).toContain("The story's year is not stated")
      expect(p).not.toContain('The story is set in 1989')
    }
  }, 120000)
})

describe('the story year in every outline variant', () => {
  let env: Awaited<ReturnType<typeof makePipelineEnv>> | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  it('the seed outline prompts of every variant ask for story_year', async () => {
    for (const f of ['outline', 'outline_vn', 'outline_nf', 'outline_article']) {
      expect(await readFile(path.join(__dirname, '..', 'seed', 'prompts', 'architect', `${f}.md`), 'utf8'), f).toContain('"story_year"')
    }
  })

  it('an outline prompt without the field gets the engine rule appended; one with it is left alone', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scriptorium-year-'))
    try {
      await mkdir(path.join(dir, 'prompts', 'architect'), { recursive: true })
      await writeFile(path.join(dir, 'prompts', 'architect', 'outline.md'), '---\nkind: prompt\nrole: architect\ntask: outline\n---\nOutline {{title}}. Reply with {"chapters": []}\n')
      await writeFile(path.join(dir, 'prompts', 'architect', 'outline_nf.md'), '---\nkind: prompt\nrole: architect\ntask: outline_nf\n---\nReply with {"chapters": [], "story_year": null}\n')
      const old = [{ role: 'user' as const, content: 'Outline X.' }]
      await ensureStoryYearRule(dir, old, 'outline')
      expect(old[0]!.content).toBe(`Outline X.\n\n${STORY_YEAR_RULE}`)
      const current = [{ role: 'user' as const, content: 'Outline X.' }]
      await ensureStoryYearRule(dir, current, 'outline_nf')
      expect(current[0]!.content).toBe('Outline X.')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  const yearOf = async (dir: string, topic: string): Promise<unknown> => {
    await env!.engine.handleCommand({ type: 'setTopicActive', id: topic, active: true })
    const slug = await waitFor(async () => (await readdir(path.join(dir, 'books')))[0] ?? null, 20000, 'the book folder')
    await env!.engine.handleCommand({ type: 'setTopicActive', id: topic, active: false })
    const file = path.join(dir, 'books', slug, 'book.md')
    await waitFor(async () => existsSync(file) && parseMd(await readFile(file, 'utf8')).data.story_year !== undefined, 60000, 'story_year in book.md')
    return parseMd(await readFile(file, 'utf8')).data.story_year
  }

  it('a non-fiction outline answer with story_year sets it in book.md', async () => {
    env = await makePipelineEnv({ format: 'nonfiction-short', citations: true, activate: [], storyYear: 1888 })
    expect(await yearOf(env.dir, 'his-books-and-printing')).toBe(1888)
  }, 120000)

  it('an article outline answer with story_year sets it in book.md', async () => {
    env = await makePipelineEnv({ format: 'article', citations: true, activate: [], storyYear: 2026 })
    expect(await yearOf(env.dir, 'news-technology')).toBe(2026)
  }, 120000)
})
