import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProviderError } from '../src/engine/models/types'
import { writeMd } from '../src/engine/store/atomic'
import { parseMd } from '../src/shared/md'
import { makePipelineEnv, waitFor } from './helpers'

type Env = Awaited<ReturnType<typeof makePipelineEnv>>
let env: Env | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const jobsIn = (e: Env, state: string) => readdir(path.join(e.dir, 'jobs', state)).then((f) => f.filter((n) => n.endsWith('.md')))
// files are replaced by a rename; a read in that instant can find no file (Windows), so it tries again a few times
const readText = async (file: string) => {
  for (let i = 0; ; i++) {
    try {
      return await readFile(file, 'utf8')
    } catch (err) {
      if (i >= 4 || (err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      await new Promise((r) => setTimeout(r, 25))
    }
  }
}

describe('a story with models: the start job uses them', () => {
  it('add_story {models: {editor-in-chief: client}} makes the start_book job a client task, and the book starts with the models', async () => {
    env = await makePipelineEnv({
      activate: ['jfic-bedtime-and-dreams'],
      format: 'bedtime-toddler',
      beforeStart: async (dir) => {
        const file = path.join(dir, 'config', 'providers.md')
        const doc = parseMd(await readFile(file, 'utf8'))
        const providers = [...(doc.data.providers as unknown[]), { id: 'client', kind: 'client', models: [{ id: 'claude-code', family: 'claude' }] }]
        await writeMd(file, { ...doc.data, providers }, doc.body)
        const { IdeaStore } = await import('../src/engine/store/ideas')
        await new IdeaStore(dir).createStory({ title: 'The Bell Fox', premise: 'A fox rings a bell.', plot: '', characters: [], setting: '', style: '', sections: [], models: { 'editor-in-chief': 'client/claude-code' } })
      }
    })
    const e = env
    const task = await waitFor(() => e.engine.clientQueue.list().find((t) => t.role === 'editor-in-chief' && t.task === 'start_book' && t.state === 'waiting') ?? null, 30000, 'a waiting start_book client task')
    expect(task.job).toMatch(/^eic--start--/)
    // no book yet, and the factory did not start one on its own model
    expect(await readdir(path.join(e.dir, 'books'))).toEqual([])
    const leased = e.engine.clientQueue.lease({ role: 'editor-in-chief' })!
    expect(e.engine.clientQueue.submit(leased.id, JSON.stringify({ format: 'bedtime-toddler', title: 'The Bell Fox', genre: 'Bedtime', notes: '' }))).toEqual({ accepted: true })
    const slug = await waitFor(async () => (await readdir(path.join(e.dir, 'books')))[0] ?? null, 30000, 'the book')
    const data = await waitFor(async () => {
      const d = parseMd(await readText(path.join(e.dir, 'books', slug, 'book.md')).catch(() => '')).data
      return d.title ? d : null
    }, 30000, 'book.md')
    expect(data.role_models).toEqual({ 'editor-in-chief': 'client/claude-code' })
    expect(data.title).toBe('The Bell Fox')
  }, 90000)
})

describe('the embeddings server is down', () => {
  it('a long book is still drafted, the index job waits (no failure, no attempt), and the chapter is indexed once the server is back', async () => {
    env = await makePipelineEnv({ activate: ['fic-fantasy-epic'], format: 'novel', smallNovel: true })
    const e = env
    let down = true
    const real = e.mock.embed.bind(e.mock)
    e.mock.embed = async (model, inputs) => {
      if (down) throw new ProviderError('network error: connect ECONNREFUSED 127.0.0.1:1234 (ECONNREFUSED)', undefined, true, undefined, true)
      return real(model, inputs)
    }
    const slug = (await waitFor(async () => (await readdir(path.join(e.dir, 'books')))[0] ?? null, 30000, 'the book'))!
    const indexJob = `${slug}--index--ch01--r0`
    // chapter 1 is drafted without the search, and its index job waits with no attempt spent
    await waitFor(async () => (await jobsIn(e, 'done')).includes(`${slug}--draft--ch01--r0.md`), 60000, 'chapter 1 drafted')
    const queued = await waitFor(async () => {
      if (!(await jobsIn(e, 'queued')).includes(`${indexJob}.md`)) return null
      // the job is claimed and put back again while it waits: it can leave queued/ between the listing and the read
      const text = await readFile(path.join(e.dir, 'jobs', 'queued', `${indexJob}.md`), 'utf8').catch(() => null)
      if (text === null) return null
      const d = parseMd(text).data
      return d.not_before ? d : null
    }, 60000, 'the index job waiting for the server')
    expect(queued.attempts).toBe(0)
    expect(await jobsIn(e, 'failed')).toEqual([])
    expect((await parseMd(await readText(path.join(e.dir, 'books', slug, 'book.md'))).data).stage).not.toBe('failed')
    expect(e.logs.some((l) => /embeddings server .* is not running/.test(l) || /search skipped/.test(l))).toBe(true)
    expect(parseMd(await readText(path.join(e.dir, 'books', slug, 'summaries', 'ch-01.md'))).data.indexed).not.toBe(true)

    // the server answers again: the job goes on at once (its wait is cleared here, instead of waiting 30 seconds)
    down = false
    await e.engine.jobs.update('queued', indexJob, { not_before: null })
    e.engine.scheduler.kick()
    await waitFor(async () => parseMd(await readText(path.join(e.dir, 'books', slug, 'summaries', 'ch-01.md'))).data.indexed === true, 60000, 'chapter 1 indexed')
    expect(await jobsIn(e, 'failed')).toEqual([])
  }, 180000)
})
