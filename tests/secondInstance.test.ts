import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { asksForMcp, dataDirOf, readEngineLock, secondInstanceMessage } from '../src/main/secondInstance'

let dir: string | undefined
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('a second instance says why it quits', () => {
  it('names the data folder and the pid, and says the running one must have MCP on when this start asked for it', () => {
    const plain = secondInstanceMessage({ dataDir: 'D:/Scriptorium', enginePid: 4242, asksForMcp: false })
    expect(plain).toContain('another Scriptorium is running (engine pid 4242, data folder D:/Scriptorium)')
    expect(plain).toContain('this start was not needed')
    expect(plain).not.toContain('MCP')
    const mcp = secondInstanceMessage({ dataDir: 'D:/Scriptorium', asksForMcp: true })
    expect(mcp).not.toContain('pid')
    expect(mcp).toContain('the running Scriptorium must have MCP on')
  })

  it('finds the data folder and the MCP request in the arguments', () => {
    expect(dataDirOf(['x.exe', '--data', 'D:/Books'], {}, 'C:/home')).toBe(path.resolve('D:/Books'))
    expect(dataDirOf(['--data=rel'], {}, 'C:/home')).toBe(path.resolve('rel'))
    expect(dataDirOf([], { SCRIPTORIUM_DATA: 'E:/Env' }, 'C:/home')).toBe(path.resolve('E:/Env'))
    expect(dataDirOf([], {}, 'C:/home')).toBe(path.resolve('C:/home', 'Scriptorium'))
    expect(asksForMcp(['--mcp'])).toBe(true)
    expect(asksForMcp(['--headless'])).toBe(true)
    expect(asksForMcp(['--headless', '--no-mcp'])).toBe(false)
    expect(asksForMcp(['--hidden'])).toBe(false)
  })

  it('reads the pid from index/engine.lock, and nothing when there is none', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-second-'))
    expect(readEngineLock(dir)).toBeNull()
    await mkdir(path.join(dir, 'index'))
    await writeFile(path.join(dir, 'index', 'engine.lock'), JSON.stringify({ pid: 77, started: '2026-10-23T08:00:00.000Z' }) + '\n')
    expect(readEngineLock(dir)).toEqual({ pid: 77, started: '2026-10-23T08:00:00.000Z' })
    await writeFile(path.join(dir, 'index', 'engine.lock'), 'not json')
    expect(readEngineLock(dir)).toBeNull()
  })
})
