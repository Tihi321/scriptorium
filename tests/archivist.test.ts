import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Bible } from '../src/engine/memory/bible'
import type { MemoryUpdate } from '../src/engine/memory/bible'
import { BookStore } from '../src/engine/pipeline/books'
import { parseMd } from '../src/shared/md'
import { makePipelineEnv, waitFor } from './helpers'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

async function bibleWith(characters: { name: string; description: string }[], places: { name: string; description: string }[] = []) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-archivist-'))
  dirs.push(dir)
  await mkdir(path.join(dir, 'books', 'b'), { recursive: true })
  const books = new BookStore(dir)
  await books.create('b', { title: 'B', format: 'novel', target_words: 5000 }, '')
  const bible = new Bible(books)
  await bible.writeInitial('b', { characters, places })
  return { dir, bible }
}

const update = (u: Partial<MemoryUpdate>): MemoryUpdate => ({ summary: 'Something happened in the chapter.', characters: [], places: [], threads_opened: [], threads_closed: [], timeline: [], ...u })
const person = (name: string, upd = 'was there', aliases: string[] = []) => ({ name, update: upd, description: '', aliases })
const files = async (dir: string, group = 'characters') => (await readdir(path.join(dir, 'books', 'b', 'bible', group))).sort()

describe('the archivist files a name under the right entry', () => {
  it('"Dec" after "Dec Hartley" is the same entry, and the alias is kept', async () => {
    const { dir, bible } = await bibleWith([{ name: 'Dec Hartley', description: 'A locksmith.' }])
    const r = await bible.apply('b', 1, update({ characters: [person('Dec', 'found a key')] }))
    expect(r.warnings).toEqual([])
    expect(await files(dir)).toEqual(['dec-hartley.md'])
    const doc = parseMd(await readFile(path.join(dir, 'books', 'b', 'bible', 'characters', 'dec-hartley.md'), 'utf8'))
    expect(doc.data.aliases).toEqual(['Dec'])
    expect(doc.body).toContain('Ch 1: found a key')
    // the next chapter finds the entry by its alias, with no new alias
    await bible.apply('b', 2, update({ characters: [person('Dec', 'opened the door')] }))
    expect(await files(dir)).toEqual(['dec-hartley.md'])
    expect((await bible.entries('b'))[0]).toMatchObject({ name: 'Dec Hartley', aliases: ['Dec'] })
    expect(await bible.digest('b')).toContain('Dec Hartley (also: Dec)')
  })

  it('"Hartley" with both a Dec and a Mara Hartley is no match: a new entry and a warning', async () => {
    const { dir, bible } = await bibleWith([
      { name: 'Dec Hartley', description: 'A locksmith.' },
      { name: 'Mara Hartley', description: 'His sister.' }
    ])
    const r = await bible.apply('b', 1, update({ characters: [person('Hartley')] }))
    expect(await files(dir)).toEqual(['dec-hartley.md', 'hartley.md', 'mara-hartley.md'])
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/"Hartley" could be "Dec Hartley" or "Mara Hartley": a new entry was made/)
  })

  it('"The twins" and "Novak twins" are one entry', async () => {
    const { dir, bible } = await bibleWith([{ name: 'Novak twins', description: 'Two sisters.' }])
    await bible.apply('b', 1, update({ characters: [person('The twins', 'argued')] }))
    expect(await files(dir)).toEqual(['novak-twins.md'])
    expect((await bible.entries('b'))[0]!.aliases).toEqual(['The twins'])
  })

  it('an alias from the update is stored and used the next time, for characters and places', async () => {
    const { dir, bible } = await bibleWith([{ name: 'Declan Hartley', description: 'A locksmith.' }], [{ name: 'The Clockmaker Street Shop', description: 'Tiny.' }])
    await bible.apply('b', 1, update({ characters: [{ ...person('Declan Hartley'), aliases: ['the Irishman', 'Declan Hartley'] }], places: [{ ...person('The Clockmaker Street Shop'), aliases: ['the shop'] }] }))
    expect((await bible.entries('b')).find((e) => e.group === 'characters')!.aliases).toEqual(['the Irishman'])
    expect((await bible.entries('b')).find((e) => e.group === 'places')!.aliases).toEqual(['the shop'])
    // "the Irishman" has no word in common with the name: only the alias finds the entry
    await bible.apply('b', 2, update({ characters: [person('the Irishman', 'slept')], places: [person('the shop', 'was shut')] }))
    expect(await files(dir)).toEqual(['declan-hartley.md'])
    expect(await files(dir, 'places')).toEqual(['clockmaker-street-shop.md'])
    // the update's own alias also finds an entry under a name nothing else matches
    await bible.apply('b', 3, update({ characters: [{ ...person('Mr H'), aliases: ['the Irishman'] }] }))
    expect(await files(dir)).toEqual(['declan-hartley.md'])
  })
})

describe('the archivist of a long book (pipeline)', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env | undefined
  afterAll(async () => {
    await env?.cleanup()
  })

  it('corrects a weekday it got wrong next to a date, files "Foxy" under Fox, and knows the aliases in the next prompt', async () => {
    env = await makePipelineEnv({ activate: ['fic-fantasy-epic'], format: 'novel', smallNovel: true, storyYear: 2026 })
    const e = env
    const known: string[] = []
    e.mock.on({ task: 'memory_update' }, (req) => {
      const text = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
      const n = Number(/Chapter (\d+):/.exec(text)?.[1] ?? 0)
      known.push(text)
      return JSON.stringify({
        summary: `In chapter ${n} the fox leaves the barn on Sunday 24 October and learns something kind.`,
        characters: [{ name: n === 1 ? 'Fox' : 'Foxy', update: `Learned a lesson in chapter ${n}.`, description: '', aliases: n === 1 ? ['Foxy'] : [] }],
        places: [],
        threads_opened: [],
        threads_closed: n >= 5 && /^t1: /m.test(text) ? ['t1'] : [],
        timeline: [`Sunday 24 October: the fox of chapter ${n} leaves`]
      })
    })
    const slug = (await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 120000, 'the novel to be published'))!
    const summary = parseMd(await readFile(path.join(e.dir, 'books', slug, 'summaries', 'ch-01.md'), 'utf8'))
    expect(summary.body).toContain('on Saturday 24 October')
    expect(summary.body).not.toContain('Sunday 24 October')
    const timeline = parseMd(await readFile(path.join(e.dir, 'books', slug, 'bible', 'timeline.md'), 'utf8')).data.events as { event: string }[]
    expect(timeline[0]!.event).toBe('Saturday 24 October: the fox of chapter 1 leaves')
    // one Fox entry, with the alias
    expect(await readdir(path.join(e.dir, 'books', slug, 'bible', 'characters'))).toEqual(['fox.md'])
    expect(parseMd(await readFile(path.join(e.dir, 'books', slug, 'bible', 'characters', 'fox.md'), 'utf8')).data.aliases).toEqual(['Foxy'])
    // the later prompts list the alias and carry the calendar
    expect(known[1]).toContain('- Fox (character; also: Foxy)')
    expect(known[0]).toContain('The story is set in 2026')
    await e.engine.logs.flush()
    expect(await readFile(path.join(e.dir, 'books', slug, 'log.md'), 'utf8')).toContain('is a Saturday: corrected')
  }, 180000)
})
