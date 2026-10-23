import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LogWriter } from '../src/engine/logs/logs'

let dir: string | undefined
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('the log writer', () => {
  it('keeps each parallel call in one piece in the book log, though their chunks interleave and flushes fall between them', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-logs-'))
    const logs = new LogWriter(dir, 5)
    const a = logs.session('reviewer-a', 'demo')
    const b = logs.session('reviewer-b', 'demo')
    const c = logs.session('reviewer-c', 'demo')
    const chunks = (tag: string) => [`## ${tag} start\n`, `${tag}-1 `, `${tag}-2 `, `${tag}-3\n`, `## ${tag} end\n`]
    const run = async (s: ReturnType<LogWriter['session']>, tag: string) => {
      for (const chunk of chunks(tag)) {
        s.write(chunk)
        await sleep(3)
      }
      s.end()
    }
    await Promise.all([run(a, 'A'), run(b, 'B'), run(c, 'C')])
    await logs.close()
    const book = await readFile(path.join(dir, 'books', 'demo', 'log.md'), 'utf8')
    // every call's text is contiguous
    for (const tag of ['A', 'B', 'C']) expect(book, tag).toContain(chunks(tag).join(''))
    expect(book.length).toBe(['A', 'B', 'C'].reduce((n, t) => n + chunks(t).join('').length, 0))
    // each agent's own log has just its call
    expect(await readFile(path.join(dir, 'logs', 'agents', 'reviewer-b.md'), 'utf8')).toBe(chunks('B').join(''))
  })

  it('hands the file over when a call that waits ends first, and writes the text of waiting calls at close', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-logs-'))
    const logs = new LogWriter(dir, 5)
    const a = logs.session('x', 'demo')
    const b = logs.session('y', 'demo')
    const c = logs.session('z', 'demo')
    a.write('A1 ')
    b.write('B1 ')
    b.end() // ended while A writes: its text waits for its turn
    c.write('C1 ')
    a.write('A2\n')
    a.end()
    c.write('C2\n')
    c.end()
    await logs.close()
    expect(await readFile(path.join(dir, 'books', 'demo', 'log.md'), 'utf8')).toBe('A1 A2\nB1 C1 C2\n')

    // a call that never ended is still written at close
    const d = logs.session('x', 'other')
    const e = logs.session('y', 'other')
    d.write('D\n')
    e.write('E\n')
    await logs.close()
    expect(await readFile(path.join(dir, 'books', 'other', 'log.md'), 'utf8')).toBe('D\nE\n')
  })
})
