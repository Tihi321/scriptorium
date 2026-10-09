import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWrite, readMd, writeMd } from '../src/engine/store/atomic'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-atomic-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('atomicWrite', () => {
  it('writes the content and leaves no tmp files', async () => {
    const file = path.join(dir, 'sub', 'a.md')
    await atomicWrite(file, 'hello')
    await atomicWrite(file, 'hello again')
    expect(await readFile(file, 'utf8')).toBe('hello again')
    expect(await readdir(path.join(dir, 'sub'))).toEqual(['a.md'])
  })

  it('survives many concurrent writes without leftovers', async () => {
    const file = path.join(dir, 'b.md')
    await Promise.all(Array.from({ length: 20 }, (_, i) => atomicWrite(file, `v${i}`, { retries: 12 })))
    expect(await readdir(dir)).toEqual(['b.md'])
    expect(await readFile(file, 'utf8')).toMatch(/^v\d+$/)
  })

  it('cleans up the tmp file when the rename fails', async () => {
    // Renaming a file onto a non-empty directory fails.
    const target = path.join(dir, 'taken')
    await atomicWrite(path.join(target, 'inner.md'), 'x')
    await expect(atomicWrite(target, 'data', { retries: 1, backoffMs: 1 })).rejects.toBeTruthy()
    expect((await readdir(dir)).filter((f) => f.includes('.tmp-'))).toEqual([])
  })

  it('writeMd and readMd round trip', async () => {
    const file = path.join(dir, 'c.md')
    await writeMd(file, { kind: 'x', n: 1 }, '\nbody\n')
    expect(await readMd(file)).toEqual({ data: { kind: 'x', n: 1 }, body: '\nbody\n' })
  })
})
