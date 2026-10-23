import { mkdir, readdir, readFile, utimes } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pickNext } from '../src/engine/pipeline/handlers'
import { writeMd } from '../src/engine/store/atomic'
import { parseMd } from '../src/shared/md'
import { jobSchema } from '../src/shared/schemas'
import type { FormatEntry } from '../src/shared/schemas'
import { makePipelineEnv, waitFor } from './helpers'
import type { TestEnv } from './helpers'
import type { IdeaFile } from '../src/engine/store/ideas'

let env: TestEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const idea = (slug: string): IdeaFile =>
  ({ slug, file: `${slug}.md`, title: slug, body: 'A story.', createdMs: 1, data: { kind: 'idea', topic: null, status: 'open', source: 'user', format: null, book: null } }) as unknown as IdeaFile
const format = { id: 'f', name: 'F', enabled: true, kinds: [], words: [100, 200], chapters: [1, 1] } as unknown as FormatEntry

describe('SCP-27: a story whose start fails does not block the others', () => {
  it('pickNext leaves the skipped stories out', () => {
    const a = idea('a')
    const b = idea('b')
    expect(pickNext([a, b], [], [format])?.idea?.slug).toBe('a')
    expect(pickNext([a, b], [], [format], [], undefined, undefined, new Set(['a']))?.idea?.slug).toBe('b')
    expect(pickNext([a], [], [format], [], undefined, undefined, new Set(['a']))).toBeNull()
  })

  /** Two open stories of the owner, and `failed` start jobs for `failedFor`. */
  async function setup(stories: string[], failedFor: string, failed = 3) {
    return makePipelineEnv({
      format: 'bedtime-toddler',
      beforeStart: async (dir) => {
        await mkdir(path.join(dir, 'ideas'), { recursive: true })
        await mkdir(path.join(dir, 'jobs', 'failed'), { recursive: true })
        const old = new Date(Date.now() - 60_000)
        for (const slug of stories) {
          const file = path.join(dir, 'ideas', `${slug}.md`)
          await writeMd(file, { kind: 'idea', title: slug, source: 'user', status: 'open', format: 'bedtime-toddler', created: new Date(Date.now() - 120_000).toISOString() }, `\nA fox story called ${slug}.\n`)
          await utimes(file, old, old) // edited a minute ago: the failures below are newer
        }
        for (let n = 1; n <= failed; n++) {
          const id = `eic--start--n${n}--r0`
          await writeMd(path.join(dir, 'jobs', 'failed', `${id}.md`), jobSchema.parse({ id, task: 'start_book', role: 'editor-in-chief', idea: failedFor, requested_by: 'you' }), '')
        }
      }
    })
  }
  const startedFrom = async (e: TestEnv) => {
    const slug = await waitFor(async () => (await readdir(path.join(e.dir, 'books')).catch(() => []))[0], 30000, 'a book')
    // the engine makes the book folder (book.md) first and the brief.md copy a moment later, so wait for the file
    const brief = await waitFor(async () => (await readFile(path.join(e.dir, 'books', slug, 'brief.md'), 'utf8').catch(() => null)), 30000, 'the brief of the book')
    return parseMd(brief!).data.idea
  }

  it('story A failed 3 times: story B still gets its start, and A is named in a warning', async () => {
    const e = await setup(['story-a', 'story-b'], 'story-a')
    env = e
    expect(await startedFrom(e)).toBe('story-b')
    expect(e.logs.some((l) => l.includes('story-a') && l.includes('failed 3 times'))).toBe(true)
    // no start job was ever made for A again
    expect(e.counters.calls.start_book).toBe(1)
  }, 60000)

  it('two failures are not enough to skip a story', async () => {
    const e = await setup(['story-a'], 'story-a', 2)
    env = e
    expect(await startedFrom(e)).toBe('story-a')
  }, 60000)

  it('editing the story after its failures makes it eligible again', async () => {
    const e = await makePipelineEnv({
      format: 'bedtime-toddler',
      beforeStart: async (dir) => {
        await mkdir(path.join(dir, 'ideas'), { recursive: true })
        await mkdir(path.join(dir, 'jobs', 'failed'), { recursive: true })
        const past = new Date(Date.now() - 120_000)
        for (let n = 1; n <= 3; n++) {
          const id = `eic--start--n${n}--r0`
          const file = path.join(dir, 'jobs', 'failed', `${id}.md`)
          await writeMd(file, jobSchema.parse({ id, task: 'start_book', role: 'editor-in-chief', idea: 'story-a', requested_by: 'you' }), '')
          await utimes(file, past, past)
        }
        await writeMd(path.join(dir, 'ideas', 'story-a.md'), { kind: 'idea', title: 'story-a', source: 'user', status: 'open', format: 'bedtime-toddler', created: past.toISOString() }, '\nEdited after the failures.\n')
      }
    })
    env = e
    expect(await startedFrom(e)).toBe('story-a')
  }, 60000)
})
