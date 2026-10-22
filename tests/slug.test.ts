import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BookStore, slugify as bookSlug } from '../src/engine/pipeline/books'
import { IdeaStore, storySlug } from '../src/engine/store/ideas'
import { emptyBrief } from '../src/shared/brief'
import { slugify } from '../src/shared/slug'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})
const tmp = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'scrip-slug-'))
  dirs.push(d)
  return d
}

describe('slugify', () => {
  it('cuts at a word, drops the possessive and a trailing "the", and keeps within 40 characters', () => {
    const s = slugify("France's atomic clock on air: the ALS162 signal turns 60")
    expect(s).toBe('frances-atomic-clock-on-air-the-als162')
    expect(s.length).toBeLessThanOrEqual(40)
    // the old rule cut the same title in the middle of a word
    expect(slugify('France’s atomic clock on air the ALS162 signal turns sixty', { max: 48 })).toBe('frances-atomic-clock-on-air-the-als162-signal')
  })

  it('takes at most the given number of words, and never ends on a stopword', () => {
    expect(slugify('A fox who could not sleep until the moon came down over the barn at night', { maxWords: 6 })).toBe('a-fox-who-could-not-sleep')
    expect(slugify('Ships of the sea and of the', { maxWords: 8 })).toBe('ships-of-the-sea')
    expect(slugify('The', { fallback: 'idea' })).toBe('idea')
  })

  it('removes accents, gives the fallback for an empty text, and cuts a first word that is too long', () => {
    expect(slugify('Crème brûlée à la mode')).toBe('creme-brulee-a-la-mode')
    expect(slugify('   ***   ')).toBe('untitled')
    expect(slugify('', { fallback: 'idea' })).toBe('idea')
    expect(slugify('Supercalifragilisticexpialidocious-and-more', { max: 10 })).toBe('supercalif')
  })
})

describe('the slugs of stories and books', () => {
  it('a story gets at most 6 words and 40 characters, a book at most 8 words', () => {
    expect(storySlug('One two three four five six seven eight nine ten')).toBe('one-two-three-four-five-six')
    expect(bookSlug('One two three four five six seven eight nine ten')).toBe('one-two-three-four-five-six-seven-eight')
    expect(storySlug('A lighthouse keeper writes one letter to every ship that passes in the night').length).toBeLessThanOrEqual(40)
    expect(storySlug('')).toBe('idea')
    expect(bookSlug('')).toBe('untitled')
  })

  it('a clash gets -2, for books and for stories; existing slugs are never touched', async () => {
    const dir = await tmp()
    const books = new BookStore(dir)
    const title = "France's atomic clock on air: the ALS162 signal turns 60"
    const first = await books.freeSlug(title)
    expect(first).toBe('frances-atomic-clock-on-air-the-als162')
    await books.create(first, { title, format: 'article', target_words: 900 }, '')
    expect(await books.freeSlug(title)).toBe(`${first}-2`)

    const ideas = new IdeaStore(dir)
    const a = await ideas.createStory({ ...emptyBrief(), title: 'The Bell That Rang Under the Sea at Midnight Again' })
    const b = await ideas.createStory({ ...emptyBrief(), title: 'The Bell That Rang Under the Sea at Midnight Again' })
    expect(a.slug).toBe('the-bell-that-rang-under')
    expect(b.slug).toBe('the-bell-that-rang-under-2')
    // a story with no title takes its label from the premise, cut at a word
    const c = await ideas.createStory({ ...emptyBrief(), premise: 'An old clockmaker discovers that every clock in the city has stopped at the same minute.' })
    expect(c.slug).toBe('an-old-clockmaker-discovers-that-every')
  })
})
