import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyBrief, parseBrief } from '../src/shared/brief'
import type { StoryBrief } from '../src/shared/brief'
import { parseMd } from '../src/shared/md'
import { makeEnv, makePipelineEnv, waitFor } from './helpers'
import type { TestEnv } from './helpers'

type Env = Awaited<ReturnType<typeof makePipelineEnv>>
let env: TestEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const story: StoryBrief = {
  title: "The Lighthouse Keeper's Daughter",
  premise: 'A girl keeps a lighthouse after her father is lost at sea.',
  plot: 'She finds a map in the lamp room and follows it to a sunken bell.',
  characters: [
    { name: 'Mara Quill', role: 'the hero, 12 years old', description: 'Freckled, ink on her fingers.' },
    { name: 'Old Bram', role: 'the fisherman who knew her father', description: 'Rolls his own cigarettes.' },
    { name: 'FOX', role: 'a stray the architect already has', description: 'Orange.' }
  ],
  setting: 'A rocky coast in the 1890s.',
  style: 'Warm, a little salty.',
  sections: [{ heading: 'Themes', text: 'Loss and courage.' }],
  format: 'chapter-book',
  genre: 'Sea adventure'
}

/** Registers replies for the tasks up to the first draft that keep what each prompt said. The engine picks the story up by itself. */
function capture(e: Env, outlineChapters: number) {
  const prompts: Record<string, string[]> = {}
  const grab = (task: string, req: { messages: { content: string }[] }) => (prompts[task] ??= []).push(req.messages.map((m) => m.content).join('\n\n----\n\n'))
  e.mock.on({ task: 'start_book' }, (req) => {
    grab('start_book', req)
    return JSON.stringify({ format: 'bedtime-toddler', title: 'The Sleepy Fox', genre: 'Bedtime story', target_words: 600, notes: '' })
  })
  e.mock.on({ task: 'pitch' }, (req) => (grab('pitch', req), 'A girl, a map and a bell under the sea. The ending is a quiet sunrise. '.repeat(3)))
  e.mock.on({ task: 'outline' }, (req) => {
    grab('outline', req)
    return JSON.stringify({
      chapters: Array.from({ length: outlineChapters }, (_, i) => ({ title: `Part ${i + 1}`, summary: `Mara does thing number ${i + 1}.` })),
      characters: [{ name: 'Fox', description: 'soft-spoken and sleepy', voice: 'whispers' }],
      places: [{ name: 'Hay Barn', description: 'warm and dim' }],
      threads: ['Who left the lantern?'],
      setting: 'a barn',
      style: 'gentle'
    })
  })
  e.mock.on({ task: 'review_outline' }, (req) => (grab('review_outline', req), JSON.stringify({ verdict: 'pass', scores: { structure: 8 }, notes: 'Fine.', chapters: [] })))
  e.mock.on({ task: 'draft_chapter' }, (req) => (grab('draft_chapter', req), 'The little fox yawned and curled up in the warm hay. '.repeat(40)))
  return prompts
}

const bookOf = (e: TestEnv) => waitFor(async () => (await e.engine.books.slugs())[0], 30000, 'a book')

describe('a story brief in the pipeline', () => {
  it('keeps the owner title and format, copies brief.md, and puts the brief in the pitch, outline and draft prompts', async () => {
    const e = await makePipelineEnv({ format: 'bedtime-toddler' })
    env = e
    const prompts = capture(e, 6)
    const idea = await e.engine.addStory(story)
    expect(idea.data).toMatchObject({ title_fixed: true, source: 'user', status: 'open', format: 'chapter-book', genre: 'Sea adventure' })
    const slug = await bookOf(e)
    await waitFor(() => prompts.draft_chapter?.length, 30000, 'the first draft')

    const book = parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data
    expect(book).toMatchObject({ title: story.title, format: 'chapter-book', genre: 'Sea adventure', idea: idea.slug })
    expect(slug).toBe('the-lighthouse-keeper-s-daughter')

    // the idea is used, and the book has its own copy of the brief
    const used = (await e.engine.ideas.list()).find((i) => i.slug === idea.slug)!
    expect(used.data).toMatchObject({ status: 'used', book: slug })
    const copy = parseMd(await readFile(path.join(e.dir, 'books', slug, 'brief.md'), 'utf8'))
    expect(copy.data).toMatchObject({ kind: 'brief', title: story.title, title_fixed: true, format: 'chapter-book' })
    expect(parseBrief(copy.body)).toMatchObject({ premise: story.premise, plot: story.plot, setting: story.setting, characters: story.characters })
    expect(await e.engine.books.brief(slug)).toMatchObject({ title: story.title, format: 'chapter-book', genre: 'Sea adventure' })

    // the editor-in-chief got the whole brief and was told what is fixed
    const start = prompts.start_book![0]!
    for (const s of ['Mara Quill', 'Old Bram', 'sunken bell', 'Loss and courage.', 'fixed the title', 'fixed the format: use "chapter-book"']) expect(start).toContain(s)
    for (const task of ['pitch', 'outline', 'draft_chapter']) {
      const p = prompts[task]![0]!
      if (task !== 'pitch') expect(p, task).toContain("The owner's story brief") // the pitch gets the brief as its idea
      for (const s of ['Mara Quill', 'the hero, 12 years old', 'sunken bell', 'Loss and courage.', 'A rocky coast']) expect(p, `${task}: ${s}`).toContain(s)
    }
    expect(prompts.outline![0]).toContain("the owner's notes win")

    // the architect left Mara and Bram out of the bible: they are added (FOX is Fox, already there)
    const bible = await readFile(path.join(e.dir, 'books', slug, 'bible', 'bible.md'), 'utf8')
    expect(bible).toContain('- **Mara Quill**: the hero, 12 years old. Freckled, ink on her fingers.')
    expect(bible).toContain('- **Old Bram**')
    expect(bible.match(/\*\*Fox\*\*/g)).toHaveLength(1)
    expect(bible).not.toContain('**FOX**')
    expect(e.events.some((ev) => ev.type === 'ideas.updated' && ev.ideas.some((i) => i.slug === idea.slug && i.status === 'used'))).toBe(true)
  }, 60000)

  it('merges missing characters into the structured bible of a long book, and the outline review sees the brief', async () => {
    const e = await makePipelineEnv({ format: 'novel', smallNovel: true })
    env = e
    const prompts = capture(e, 6)
    await e.engine.addStory({ ...story, title: '', format: 'novel' })
    const slug = await bookOf(e)
    await waitFor(() => prompts.draft_chapter?.length, 30000, 'the first draft')
    const dir = path.join(e.dir, 'books', slug, 'bible', 'characters')
    expect(existsSync(path.join(dir, 'mara-quill.md'))).toBe(true)
    expect(existsSync(path.join(dir, 'old-bram.md'))).toBe(true)
    expect(existsSync(path.join(dir, 'fox.md'))).toBe(true)
    expect(existsSync(path.join(dir, 'fox-2.md'))).toBe(false)
    expect(await readFile(path.join(dir, 'mara-quill.md'), 'utf8')).toContain('the hero, 12 years old')
    expect(prompts.review_outline![0]).toContain('Mara Quill')
    // no title given: the editor picks it
    const book = parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data
    expect(book.title).toBe('The Sleepy Fox')
    expect(prompts.start_book![0]).not.toContain('fixed the title')
  }, 60000)

  it('ignores a format that is not allowed and says so in the log', async () => {
    const e = await makePipelineEnv({ format: 'bedtime-toddler' })
    env = e
    const prompts = capture(e, 1)
    await e.engine.addStory({ ...emptyBrief(), title: 'No Such Format', premise: 'A tale.', format: 'no-such-format' })
    const slug = await bookOf(e)
    await waitFor(() => prompts.pitch?.length, 30000, 'the pitch')
    expect(parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data.format).toBe('bedtime-toddler')
    expect(prompts.start_book![0]).not.toContain('fixed the format')
    expect(e.logs.some((l) => l.includes('asks for the format "no-such-format"'))).toBe(true)
  }, 60000)
})

describe('editing a story', () => {
  it('changes an open story and keeps its other frontmatter', async () => {
    env = await makeEnv({ paused: true })
    const idea = await env.engine.addStory({ ...emptyBrief(), premise: 'A first line that becomes the label.\nMore text.' })
    expect(idea.title).toBe('A first line that becomes the label.')
    expect(idea.data.title_fixed).toBeUndefined()
    expect(idea.body).toContain('More text.')
    const changed = await env.engine.updateStory(idea.slug, { ...story, title: 'Fixed Title' })
    expect(changed.slug).toBe(idea.slug)
    const file = parseMd(await readFile(idea.file, 'utf8'))
    expect(file.data).toMatchObject({ kind: 'idea', title: 'Fixed Title', title_fixed: true, status: 'open', source: 'user', created: idea.data.created, format: 'chapter-book', genre: 'Sea adventure' })
    expect(parseBrief(file.body).characters).toHaveLength(3)
    // the listing in the snapshot has the whole brief
    const snap = await env.engine.snapshot()
    expect(snap.ideas).toHaveLength(1)
    expect(snap.ideas[0]).toMatchObject({ slug: idea.slug, title: 'Fixed Title', titleFixed: true, characters: 3, brief: { premise: story.premise, genre: 'Sea adventure' } })
    expect(snap.formats.map((f) => f.id)).toContain('chapter-book')
    expect(env.events.filter((ev) => ev.type === 'ideas.updated')).toHaveLength(2)
  })

  it('refuses a used story, an unknown story and an empty brief', async () => {
    env = await makeEnv({ paused: true })
    const idea = await env.engine.addStory(story)
    await env.engine.ideas.markUsed(idea, 'some-book')
    await expect(env.engine.updateStory(idea.slug, { ...story, title: 'Other' })).rejects.toThrow(/already used/)
    await expect(env.engine.updateStory('nope', story)).rejects.toThrow(/no story/)
    await expect(env.engine.addStory(emptyBrief())).rejects.toThrow(/needs a title/)
    expect(parseMd(await readFile(idea.file, 'utf8')).data.title).toBe(story.title)
    // the commands only log a bad request
    await env.engine.handleCommand({ type: 'updateStory', idea: idea.slug, brief: story })
    expect(env.logs.some((l) => l.startsWith('updateStory:'))).toBe(true)
    // the summary lists a used story with its book
    expect((await env.engine.listIdeaSummaries())[0]).toMatchObject({ slug: idea.slug, status: 'used', book: 'some-book' })
  })

  it('gives every story its own file name', async () => {
    env = await makeEnv({ paused: true })
    const a = await env.engine.addStory({ ...emptyBrief(), title: 'Same Name' })
    const b = await env.engine.addStory({ ...emptyBrief(), title: 'Same Name' })
    expect([a.slug, b.slug]).toEqual(['same-name', 'same-name-2'])
  })
})
