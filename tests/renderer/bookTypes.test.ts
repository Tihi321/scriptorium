import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { filterBooks, hasChoices, typeBadge, typeCounts, typeGroupOf } from '../../src/renderer/store/bookTypes'
import type { BookSummary } from '../../src/shared/protocol'

describe('book types', () => {
  it('maps every seed format', () => {
    const text = readFileSync(path.join(__dirname, '../../seed/config/formats.md'), 'utf8')
    const blocks = text.split(/^ {2}- id: /m).slice(1)
    expect(blocks.length).toBeGreaterThan(20)
    for (const block of blocks) {
      const id = block.split(/\r?\n/)[0]!.trim()
      expect(typeGroupOf(id), id).not.toBe('other')
      expect(hasChoices(id), id).toBe(/^ {4}choices: true/m.test(block))
    }
    expect(typeBadge('short-story')).toBeNull()
    expect(typeBadge('choice-visual-novel')).toEqual({ text: 'Choice VN', group: 'vn', choices: true })
  })

  it('filters and counts', () => {
    const b = (slug: string, title: string, format: string, o = {}) => ({ slug, title, format, author: null, stage: 'published', medium: 'book', ...o }) as BookSummary
    const books = [
      b('a', 'Lantern', 'short-story'),
      b('b', 'Maze', 'gamebook'),
      b('c', 'Echoes', 'visual-novel'),
      b('d', 'Echoes Choices', 'choice-visual-novel', { sourceBook: { slug: 'a', title: 'Lantern' } }),
      b('e', 'Moon', 'bedtime-story')
    ]
    const f = { group: 'all', choices: false, query: '' } as const
    expect(filterBooks(books, { ...f, group: 'vn' }).map((x) => x.slug)).toEqual(['c', 'd'])
    expect(filterBooks(books, { ...f, group: 'vn', choices: true }).map((x) => x.slug)).toEqual(['d'])
    expect(filterBooks(books, { ...f, query: 'lantern' }).map((x) => x.slug)).toEqual(['a', 'd']) // a title or a source title
    expect(filterBooks(books, { ...f, query: 'echoes lantern' }).map((x) => x.slug)).toEqual(['d']) // every word
    // group chips ignore the group itself, the choices count ignores the toggle
    expect(typeCounts(books, { ...f, group: 'vn' })).toMatchObject({ all: 5, stories: 2, vn: 2, picture: 1, choices: 1 })
    expect(typeCounts(books, { ...f, choices: true })).toMatchObject({ all: 2, stories: 1, vn: 1, picture: 0, choices: 2 })
  })
})
