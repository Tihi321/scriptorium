import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyBrief } from '../src/shared/brief'
import { makeEnv, sleep, waitFor } from './helpers'
import type { TestEnv } from './helpers'

let env: TestEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const jobsIn = (e: TestEnv, state: string) => readdir(path.join(e.dir, 'jobs', state)).then((f) => f.filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)).sort())

async function setup() {
  const e = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'W' }] })
  e.engine.scheduler.register('t', async (ctx) => ({ result: (await ctx.chat({ messages: [{ role: 'user', content: ctx.job.id }] })).text }))
  const mine = await e.engine.addStory({ ...emptyBrief(), title: 'Mine', premise: 'One.' })
  const other = await e.engine.addStory({ ...emptyBrief(), title: 'Other', premise: 'Two.' })
  // published books are left alone by the pipeline, so only the scheduler is tested
  await e.engine.books.create('mine-book', { title: 'm', stage: 'published', format: 'short-story', target_words: 1000, idea: mine.slug })
  await e.engine.books.create('other-book', { title: 'o', stage: 'published', format: 'short-story', target_words: 1000, idea: other.slug })
  return { e, mine: mine.slug, other: other.slug }
}

async function enqueueAll(e: TestEnv, mine: string, other: string) {
  const q = (id: string, extra: object) => e.engine.jobs.enqueue({ id, task: 't', role: 'writer', ...extra })
  await q('j-mine-idea', { idea: mine })
  await q('j-mine-book', { book: 'mine-book' })
  await q('j-other-idea', { idea: other })
  await q('j-other-book', { book: 'other-book' })
  await q('j-none', {})
}

describe('single-idea run (only)', () => {
  it('runs every job when only is not set', async () => {
    const { e, mine, other } = await setup()
    env = e
    await enqueueAll(e, mine, other)
    await waitFor(async () => (await jobsIn(e, 'done')).length === 5, 8000, 'all done')
  })

  it('picks only the jobs of the idea and of its book', async () => {
    const { e, mine, other } = await setup()
    env = e
    await e.engine.setOnly(mine)
    await enqueueAll(e, mine, other)
    await waitFor(async () => (await jobsIn(e, 'done')).length === 2, 8000, 'mine done')
    await sleep(400)
    expect(await jobsIn(e, 'done')).toEqual(['j-mine-book', 'j-mine-idea'])
    expect((await jobsIn(e, 'queued')).filter((n) => !n.startsWith('eic--start--'))).toEqual(['j-none', 'j-other-book', 'j-other-idea'])
    // clearing it releases the rest
    await e.engine.setOnly(null)
    await waitFor(async () => (await jobsIn(e, 'done')).length === 5, 8000, 'rest done')
  })

  it('the --only override wins over factory.md and is never written', async () => {
    const { e, mine, other } = await setup()
    env = e
    e.engine.onlyOverride = other
    await enqueueAll(e, mine, other)
    await waitFor(async () => (await jobsIn(e, 'done')).length === 2, 8000, 'other done')
    await sleep(300)
    expect(await jobsIn(e, 'done')).toEqual(['j-other-book', 'j-other-idea'])
    expect(e.engine.factory.only).toBeUndefined()
  })

  it('the pipeline starts only the chosen idea', async () => {
    const { e, mine, other } = await setup()
    env = e
    await e.engine.setOnly(mine)
    const names: string[] = []
    e.engine.scheduler.register('start_book', async (ctx) => {
      names.push(ctx.job.idea ?? '')
      return { result: 'ok' }
    })
    await e.engine.pipeline.tick()
    await sleep(300)
    const queued = [...(await jobsIn(e, 'queued')), ...(await jobsIn(e, 'done')), ...(await jobsIn(e, 'running'))]
    const starts = queued.filter((n) => n.startsWith('eic--start--'))
    expect(starts.length).toBeLessThanOrEqual(1)
    expect(names.every((n) => n === mine)).toBe(true)
    expect(queued.some((n) => n.startsWith('ideas--generate--'))).toBe(false)
    expect(names).not.toContain(other)
  })
})
