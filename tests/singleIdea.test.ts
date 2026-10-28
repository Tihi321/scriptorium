import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyBrief } from '../src/shared/brief'
import { parseMd } from '../src/shared/md'
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

describe('single-idea run: the global gates', () => {
  it('a queued start job of another idea does not hold the chosen idea back', async () => {
    const { e, mine, other } = await setup()
    env = e
    await e.engine.setOnly(mine)
    await e.engine.jobs.enqueue({ id: 'eic--start--other--r0', task: 'start_book', role: 'editor-in-chief', idea: other, requested_by: 'engine' })
    await e.engine.pipeline.tick()
    const all = [...(await jobsIn(e, 'queued')), ...(await jobsIn(e, 'running')), ...(await jobsIn(e, 'done')), ...(await jobsIn(e, 'failed'))]
    expect(all.filter((n) => n.startsWith('eic--start--') && n !== 'eic--start--other--r0').length).toBe(1)
  })

  it('open books of other ideas do not count toward max_books_in_progress', async () => {
    const { e, mine } = await setup()
    env = e
    for (const n of ['a', 'b', 'c', 'd']) await e.engine.books.create(`busy-${n}`, { title: n, stage: 'drafting', format: 'short-story', target_words: 1000, idea: 'someone-else' })
    expect((await e.engine.pipeline.countInProgress())).toBeGreaterThanOrEqual(4)
    await e.engine.setOnly(mine)
    await e.engine.pipeline.tick()
    const all = [...(await jobsIn(e, 'queued')), ...(await jobsIn(e, 'running')), ...(await jobsIn(e, 'done')), ...(await jobsIn(e, 'failed'))]
    expect(all.some((n) => n.startsWith('eic--start--'))).toBe(true)
  })

  it('setOnly persists to config/factory.md and is read back; null clears it', async () => {
    const { e, mine } = await setup()
    env = e
    await e.engine.setOnly(mine)
    expect(parseMd(await readFile(path.join(e.dir, 'config', 'factory.md'), 'utf8')).data.only).toBe(mine)
    e.engine.factory = { ...e.engine.factory, only: undefined }
    await e.engine.loadFactory()
    expect(e.engine.factory.only).toBe(mine)
    await e.engine.setOnly(null)
    await e.engine.loadFactory()
    expect(e.engine.factory.only).toBeUndefined()
    expect(parseMd(await readFile(path.join(e.dir, 'config', 'factory.md'), 'utf8')).data.only).toBeUndefined()
  })

  it('checkOnly warns when the idea does not exist', async () => {
    const { e } = await setup()
    env = e
    expect(await e.engine.checkOnly()).toBe(true)
    await e.engine.setOnly('no-such-idea')
    expect(await e.engine.checkOnly()).toBe(false)
    expect(e.events.some((ev) => ev.type === 'engine.warning' && ev.message.includes('no-such-idea'))).toBe(true)
  })
})
