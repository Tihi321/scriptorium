import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { calendarSection, datesIn, storyYear, weekdayMismatches, weekdayOf } from '../src/engine/pipeline/calendar'
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
