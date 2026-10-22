import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isNewsQuestion, missingFigures } from '../src/engine/pipeline/researchHandlers'
import { formatNote, ResearchStore } from '../src/engine/research/notes'
import { researchJobId } from '../src/engine/research/notes'
import { parseMd } from '../src/shared/md'
import { makePipelineEnv, waitFor } from './helpers'

type Env = Awaited<ReturnType<typeof makePipelineEnv>>
let env: Env | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const PAGE = {
  url: 'https://example.test/signal',
  title: 'The time signal',
  inline: true,
  content: 'The long-wave time signal reaches most of the country. The signal suffered outages in 2023, after a transmitter fault. A decision on the signal is expected by the end of 2027. '.repeat(3)
}
const QUESTION = 'What outages hit the time signal, and what was decided about the signal?'

async function ask(e: Env): Promise<{ id: string }> {
  await e.engine.handleCommand({ type: 'askResearcher', question: QUESTION })
  const id = researchJobId(null, QUESTION)
  await waitFor(() => existsSync(path.join(e.dir, 'jobs', 'done', `${id}.md`)), 20000, 'the research job')
  return { id }
}

const noteBody = async (e: Env) => parseMd(await readFile(path.join(e.dir, 'research', (await readdir(path.join(e.dir, 'research'))).find((f) => f.endsWith('.md'))!), 'utf8')).body

describe('missingFigures', () => {
  const pages = [{ n: 1, text: PAGE.content }]
  it('finds the years and numbers of the pages that no fact has, near a word of the question', () => {
    const found = missingFigures(pages, ['The signal reaches most of the country.'], QUESTION)
    expect(found.map((m) => [m.page, m.figure])).toEqual([[1, '2023'], [1, '2027']])
    expect(found[0]!.sentence).toContain('outages in 2023')
    expect(missingFigures(pages, ['The outages came in 2023.', 'The decision is due by the end of 2027.'], QUESTION)).toEqual([])
    // a number the facts write with a thousands separator is the same number
    expect(missingFigures([{ n: 1, text: 'The signal served 12,500 homes.' }], ['The signal served 12500 homes.'], 'signal homes')).toEqual([])
    // a sentence about something else does not count
    expect(missingFigures([{ n: 1, text: 'Gardening in 1999 was fun. Soil and rain.' }], [], QUESTION)).toEqual([])
  })
})

describe('the researcher keeps the figures of the pages', () => {
  it('asks once more for a figure the first answer left out, and the note has both', async () => {
    env = await makePipelineEnv({ pages: [PAGE] })
    const e = env
    const questions: string[] = []
    e.mock.on({ task: 'research' }, (req) => {
      const last = req.messages[req.messages.length - 1]!.content
      if (/Decide whether the notes already answer/.test(last)) return JSON.stringify({ covered: false, missing: '' })
      if (/also give these figures/.test(last)) {
        questions.push(last)
        return JSON.stringify({ facts: [{ fact: 'The signal had outages in 2023 after a transmitter fault.', source: 1 }, { fact: 'A decision about the signal is due by the end of 2027.', source: 1 }] })
      }
      return JSON.stringify({ facts: [{ fact: 'The long-wave signal reaches most of the country, and it is run by the operator.', source: 1 }] })
    })
    await ask(e)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain('page 1, "2023"')
    expect(questions[0]).toContain('page 1, "2027"')
    const body = await noteBody(e)
    expect(body).toContain('outages in 2023')
    expect(body).toContain('end of 2027')
    expect(body).not.toContain('Source excerpts')
  })

  it('keeps the sentences word for word as source excerpts when the follow-up still leaves them out, and the writer sees them', async () => {
    env = await makePipelineEnv({ pages: [PAGE] })
    const e = env
    e.mock.on({ task: 'research' }, (req) => {
      const last = req.messages[req.messages.length - 1]!.content
      if (/Decide whether the notes already answer/.test(last)) return JSON.stringify({ covered: false, missing: '' })
      if (/also give these figures/.test(last)) return JSON.stringify({ facts: [] })
      return JSON.stringify({ facts: [{ fact: 'The long-wave signal reaches most of the country, and it is run by the operator.', source: 1 }] })
    })
    await ask(e)
    const body = await noteBody(e)
    expect(body).toContain('## Source excerpts (verbatim, for checking)')
    expect(body).toMatch(/- "The signal suffered outages in 2023, after a transmitter fault\." \(source: https:\/\/example\.test\/signal, \d{4}-\d{2}-\d{2}\)/)
    expect(body).toMatch(/- "A decision on the signal is expected by the end of 2027\." \(source: https:\/\/example\.test\/signal/)
    const note = (await new ResearchStore(e.dir).list(null))[0]!
    const shown = formatNote(note)
    expect(shown).toContain('outages in 2023')
    expect(shown).toContain('end of 2027')
  })

  it('formatNote keeps the excerpts inside its cap and cuts the facts instead', async () => {
    const facts = Array.from({ length: 16 }, (_, i) => `- Fact number ${i + 1} says something long enough to take room in the note, with words and more words, and then some more words to make it a good deal longer than before. (source: https://example.test/a, 2026-10-21)`).join('\n')
    const note = { file: 'research/x.md', book: null, slug: 'x', question: 'Q?', unverified: false, created: '2026-10-21', sources: [], body: `# Q?\n\n${facts}\n\n## Source excerpts (verbatim, for checking)\n\n- "A decision by the end of 2027." (source: https://example.test/a, 2026-10-21)\n` }
    const shown = formatNote(note)
    expect(shown.length).toBeLessThanOrEqual(2500)
    expect(shown).toContain('end of 2027')
    expect(shown).toContain('(more facts in the file)')
  })
})

describe('news only for current angles', () => {
  it('recognises the words of a recent question', () => {
    expect(isNewsQuestion('What did ANFR announce this week about ALS162?')).toBe(true)
    expect(isNewsQuestion('What is the latest on the signal?')).toBe(true)
    expect(isNewsQuestion(`Who won the ${new Date().getFullYear()} Tour de France?`)).toBe(true)
    expect(isNewsQuestion('How does the ALS162 time signal work?')).toBe(false)
    expect(isNewsQuestion('The history of long-wave broadcasting in France')).toBe(false)
  })

  async function articleEnv(plan: unknown[]): Promise<Env> {
    const e = await makePipelineEnv({ format: 'article', citations: true, activate: [], researchPlan: [] })
    e.mock.on({ task: 'research_plan' }, JSON.stringify({ needs_research: true, questions: plan }))
    await e.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: true })
    return e
  }

  it('an article asks for news only for the question about this week; background questions and objects with news false are honoured', async () => {
    env = await articleEnv([
      'How does the ALS162 time signal work?',
      'What did ANFR announce this week about ALS162?',
      { question: 'What is the history of the ALS162 transmitter?', news: false },
      { question: 'How are the old transmitters kept alive today?', news: true }
    ])
    const e = env
    const slug = await waitFor(async () => (await readdir(path.join(e.dir, 'books')))[0] ?? null, 30000, 'the article folder')
    await e.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: false })
    const planned = ['How does the ALS162 time signal work?', 'What did ANFR announce this week about ALS162?', 'What is the history of the ALS162 transmitter?', 'How are the old transmitters kept alive today?']
    await waitFor(() => planned.every((q) => e.counters.searches.includes(q)), 60000, 'the planned questions to be searched')
    const optionsOf = (q: string) => e.counters.searchOptions[e.counters.searches.indexOf(q)]
    expect(optionsOf('How does the ALS162 time signal work?')).toEqual({})
    expect(optionsOf('What did ANFR announce this week about ALS162?')).toEqual({ news: true, days: 7 })
    expect(optionsOf('What is the history of the ALS162 transmitter?')).toEqual({})
    expect(optionsOf('How are the old transmitters kept alive today?')).toEqual({ news: true, days: 7 })
    // the job records the choice
    const jobFile = path.join(e.dir, 'jobs', 'done', `${researchJobId(slug, 'What is the history of the ALS162 transmitter?')}.md`)
    await waitFor(() => existsSync(jobFile), 30000, 'the research job')
    expect(parseMd(await readFile(jobFile, 'utf8')).data.news).toBe(false)
  }, 120000)

  it('a book that is not an article never searches the news', async () => {
    env = await makePipelineEnv({ pages: [PAGE] })
    const e = env
    await e.engine.handleCommand({ type: 'askResearcher', question: 'What did the operator announce this week about the signal?' })
    await waitFor(() => e.counters.searches.length > 0, 20000, 'a search')
    expect(e.counters.searchOptions[0]).toEqual({})
  })
})
