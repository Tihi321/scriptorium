import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookUrlToPath, readFileInside, resolveInside, tailFileInside } from '../../src/main/files'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'scriptorium-files-'))
  await mkdir(path.join(dir, 'logs', 'agents'), { recursive: true })
  await writeFile(path.join(dir, 'logs', 'agents', 'a.md'), 'line one\nline two\nline three\n')
  await writeFile(path.join(os.tmpdir(), 'scriptorium-outside.txt'), 'secret')
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(path.join(os.tmpdir(), 'scriptorium-outside.txt'), { force: true })
})

describe('resolveInside', () => {
  it('accepts paths inside the data folder', () => {
    expect(resolveInside(dir, 'logs/agents/a.md')).toBe(path.join(dir, 'logs', 'agents', 'a.md'))
    expect(resolveInside(dir, 'logs\\agents\\a.md')).toBe(path.join(dir, 'logs', 'agents', 'a.md'))
  })

  it('rejects dot-dot, absolute paths, drive letters, UNC paths and junk', () => {
    const bad = ['../x', 'logs/../../x', '..\\x', 'logs/..', '/etc/passwd', 'C:\\Windows\\win.ini', 'c:win.ini', '\\\\server\\share\\x', '', '.', 'a\0b', 42, null, undefined]
    for (const rel of bad) expect(resolveInside(dir, rel), String(rel)).toBeNull()
    expect(resolveInside(dir, path.join(os.tmpdir(), 'scriptorium-outside.txt'))).toBeNull()
  })
})

describe('reading', () => {
  it('reads a file, and refuses outside or missing ones', async () => {
    expect(await readFileInside(dir, 'logs/agents/a.md')).toContain('line two')
    expect(await readFileInside(dir, 'logs/agents/missing.md')).toBeNull()
    expect(await readFileInside(dir, '../scriptorium-outside.txt')).toBeNull()
    expect(await readFileInside(dir, 'logs')).toBeNull()
  })

  it('tails from an offset or from the end', async () => {
    const all = await tailFileInside(dir, 'logs/agents/a.md', 0)
    expect(all?.text).toBe('line one\nline two\nline three\n')
    expect(all?.size).toBe(29)
    const last = await tailFileInside(dir, 'logs/agents/a.md', -12)
    expect(last?.text).toBe('line three\n')
    expect(await tailFileInside(dir, '../scriptorium-outside.txt', 0)).toBeNull()
  })
})

describe('book protocol', () => {
  it('serves only books/<slug>/out files of known types', () => {
    expect(bookUrlToPath(dir, 'scriptorium-book://data/books/fox/out/cover.png')?.type).toBe('image/png')
    expect(bookUrlToPath(dir, 'scriptorium-book://data/books/fox/out/reader/index.html')?.type).toContain('text/html')
    expect(bookUrlToPath(dir, 'scriptorium-book://data/books/fox/book.md')).toBeNull()
    expect(bookUrlToPath(dir, 'scriptorium-book://data/config/providers.md')).toBeNull()
    expect(bookUrlToPath(dir, 'scriptorium-book://data/books/fox/out/../book.md')).toBeNull()
    expect(bookUrlToPath(dir, 'scriptorium-book://data/books/fox/out/%2e%2e/book.md')).toBeNull()
    expect(bookUrlToPath(dir, 'scriptorium-book://data/books/fox/out/book.epub')).toBeNull()
    expect(bookUrlToPath(dir, 'https://example.com/books/fox/out/cover.png')).toBeNull()
  })
})
