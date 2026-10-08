import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chunkText, MemoryIndex, reindex } from '../src/engine/memory/index'
import type { Embedder } from '../src/engine/memory/index'
import { hashEmbed } from '../src/engine/models/mock'
import { analyzeRepetition } from '../src/engine/memory/repetition'

const embed: Embedder = async (texts) => texts.map((t) => hashEmbed(t, 64))
let dir: string

async function put(rel: string, text: string) {
  const file = path.join(dir, ...rel.split('/'))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, text)
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-memory-'))
  await put('books/silver-inn/book.md', '---\nkind: book\nslug: silver-inn\ntitle: The Silver Inn\nblurb: A quiet inn by the sea hides a lantern that never goes out.\n---\n')
  await put('books/silver-inn/pitch.md', '---\nkind: pitch\n---\n\nMara arrives at the Silver Inn on a stormy night and finds the innkeeper guarding a lantern.\n')
  await put('books/silver-inn/chapters/ch-01.md', '---\nkind: chapter\nn: 1\n---\n\nThe road to the Silver Inn was long. Mara carried a green coat and a letter from her aunt Tilda.\n\nThe innkeeper, Bram, did not smile. He pointed to a room under the stairs.\n')
  await put('books/silver-inn/chapters/ch-02.md', '---\nkind: chapter\nn: 2\n---\n\nAt dawn the harbour bells rang. Mara followed the smell of salt bread to the kitchen, where Bram kneaded dough.\n')
  await put('books/silver-inn/summaries/ch-01.md', '---\nkind: summary\n---\n\nMara reaches the Silver Inn, meets the silent innkeeper Bram, and is given a room.\n')
  await put('books/dragon-tea/book.md', '---\nkind: book\nslug: dragon-tea\ntitle: Dragon Tea\n---\n')
  await put('books/dragon-tea/chapters/ch-01.md', '---\nkind: chapter\nn: 1\n---\n\nA small dragon learned to brew tea from mountain herbs and shared it with the village bakers.\n')
  await mkdir(path.join(dir, 'index'), { recursive: true })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

describe('memory index', () => {
  it('indexes the library and finds exact names and related passages with hybrid search', async () => {
    const index = MemoryIndex.open(dir, embed)
    try {
      const r = await reindex(dir, index)
      expect(r.indexed).toBe(6)
      expect(index.stats()).toMatchObject({ dim: 64 })
      const exact = await index.search('Bram', { book: 'silver-inn' })
      expect(exact[0]!.text).toContain('Bram')
      expect(exact.every((h) => h.book === 'silver-inn')).toBe(true)
      const related = await index.search('who keeps the lantern at the inn', { kinds: ['pitch', 'blurb'] })
      expect(related[0]!.book).toBe('silver-inn')
      const other = await index.search('tea from mountain herbs', { notBook: 'silver-inn' })
      expect(other[0]!.book).toBe('dragon-tea')
      // nothing changed: nothing is embedded again
      expect(await reindex(dir, index)).toMatchObject({ indexed: 0, removed: 0 })
    } finally {
      index.close()
    }
  })

  it('deleting index/ and reindexing gives the same search results', async () => {
    const queries = ['Bram dough kitchen', 'letter from aunt', 'tea mountain herbs village', 'lantern never goes out']
    const run = async () => {
      const index = MemoryIndex.open(dir, embed)
      try {
        await reindex(dir, index)
        const out: unknown[] = []
        for (const q of queries) out.push((await index.search(q, { k: 5 })).map((h) => [h.file, h.idx, h.score]))
        return out
      } finally {
        index.close()
      }
    }
    const before = await run()
    await rm(path.join(dir, 'index'), { recursive: true, force: true })
    const after = await run()
    expect(after).toEqual(before)
    expect((before[0] as unknown[]).length).toBeGreaterThan(0)
  })

  it('removes files that are gone and reindexes changed ones', async () => {
    const index = MemoryIndex.open(dir, embed)
    try {
      await reindex(dir, index)
      await rm(path.join(dir, 'books', 'dragon-tea'), { recursive: true })
      await put('books/silver-inn/chapters/ch-02.md', '---\nkind: chapter\nn: 2\n---\n\nThe harbour was silent. Mara found a brass key under the loaf.\n')
      const r = await reindex(dir, index)
      expect(r.removed).toBeGreaterThanOrEqual(1)
      expect(r.indexed).toBe(1)
      expect((await index.search('brass key loaf'))[0]!.text).toContain('brass key')
      expect((await index.search('dragon tea herbs', { book: 'dragon-tea' })).length).toBe(0)
    } finally {
      index.close()
    }
  })

  it('finds the nearest pitch of another book (library-wide similarity)', async () => {
    const index = MemoryIndex.open(dir, embed)
    try {
      await reindex(dir, index)
      const near = await index.nearest('Mara arrives at the Silver Inn on a stormy night and finds the innkeeper guarding a lantern.', { notBook: 'dragon-tea', kinds: ['pitch'] })
      expect(near).toMatchObject({ book: 'silver-inn' })
      expect(near!.similarity).toBeGreaterThan(0.95)
      expect(await index.nearest('Mara arrives at the Silver Inn', { notBook: 'silver-inn', kinds: ['pitch'] })).toBeNull()
    } finally {
      index.close()
    }
  })

  it('chunks long text at paragraph borders', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ` + 'word '.repeat(60)).join('\n\n')
    const chunks = chunkText(text, 700)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.join('\n\n').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim())
  })
})

describe('repetition counter', () => {
  it('flags repeated phrases, sentence openers and gesture tics, and says nothing about varied text', () => {
    const tic = 'She let out a breath she did not know she was holding. '
    const text = Array.from({ length: 12 }, (_, i) => `${tic}Then the wind turned over field ${i}. She nodded slowly. She shrugged.`).join(' ')
    const report = analyzeRepetition([{ n: 1, text }, { n: 2, text }])
    expect(report.flagged).toBeGreaterThan(0)
    expect(report.phrases[0]!.text).toContain('breath')
    expect(report.gestures.some((g) => g.text === 'nodded' || g.text === 'let out a breath')).toBe(true)
    expect(report.openers[0]!.text.startsWith('she')).toBe(true)
    expect(report.markdown).toContain('Repeated phrases')

    const varied = analyzeRepetition([{ n: 1, text: 'A bell rang over the hills. Nobody answered. The river moved on. Sam counted the boats and found seven. Rain began at noon.' }])
    expect(varied.flagged).toBe(0)
  })
})
