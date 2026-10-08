import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JobStore } from '../src/engine/queue/jobs'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { parseMd } from '../src/shared/md'
import { seedDir, sleep, waitFor, writeTestConfig } from './helpers'

const childFile = path.resolve(__dirname, 'fixtures/engine-child.ts')
const repo = path.resolve(__dirname, '..')
const children: ChildProcess[] = []
let dir = ''

afterEach(async () => {
  for (const c of children) c.kill('SIGKILL')
  children.length = 0
  await sleep(100)
  if (dir) await rm(dir, { recursive: true, force: true })
})

function startChild(dataDir: string): ChildProcess {
  const c = spawn(process.execPath, ['--import', 'tsx', childFile, dataDir], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
  c.stderr?.on('data', (d: Buffer) => process.stderr.write(`[child err] ${d}`))
  c.stdout?.resume()
  children.push(c)
  return c
}

const list = (state: string) => readdir(path.join(dir, 'jobs', state)).then((f) => f.filter((n) => n.endsWith('.md')).sort())

describe('restart recovery', () => {
  it('kill the engine mid-job, restart it: running jobs are requeued and every job finishes exactly once', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-recovery-'))
    await initDataFolder(dir, seedDir)
    await rm(path.join(dir, 'agents'), { recursive: true, force: true })
    await mkdir(path.join(dir, 'agents'), { recursive: true })
    await writeTestConfig(dir, {
      providers: [{ id: 'loc', local: true, concurrency: 2 }],
      roles: { writer: ['loc/m1'] },
      agents: [{ role: 'writer', name: 'A' }, { role: 'writer', name: 'B' }]
    })
    const jobs = new JobStore(dir)
    const ids = ['j1', 'j2', 'j3', 'j4']
    for (const id of ids) await jobs.enqueue({ id, task: 'slow', role: 'writer', book: 'b1' })

    const first = startChild(dir)
    await waitFor(async () => (await list('running')).length === 2, 30000, 'two jobs running in the first engine')
    const running = await list('running')
    first.kill('SIGKILL') // hard kill: no cleanup
    await new Promise((r) => first.once('exit', r))
    expect(await list('running')).toEqual(running) // left behind, as after a crash
    expect(await list('done')).toEqual([])

    startChild(dir)
    await waitFor(async () => (await list('done')).length === 4, 40000, 'all four jobs done after restart')

    expect(await list('done')).toEqual(ids.map((i) => `${i}.md`))
    expect(await list('queued')).toEqual([])
    expect(await list('running')).toEqual([])
    expect(await list('failed')).toEqual([])
    // the interrupted jobs counted one attempt, the others none
    for (const id of ids) {
      const done = parseMd(await readFile(path.join(dir, 'jobs', 'done', `${id}.md`), 'utf8'))
      expect(done.data.attempts, id).toBe(running.includes(`${id}.md`) ? 1 : 0)
    }
    // each job completed once (an interrupted job started twice but ended once)
    const runs = (await readFile(path.join(dir, 'runs.log'), 'utf8')).trim().split('\n')
    for (const id of ids) {
      expect(runs.filter((l) => l.endsWith(` end ${id}`)), id).toHaveLength(1)
      const starts = runs.filter((l) => l.endsWith(` start ${id}`)).length
      // an interrupted job started again after the restart (it may have been killed just after the claim, before its first start)
      if (running.includes(`${id}.md`)) expect(starts, id).toBeGreaterThanOrEqual(1)
      else expect(starts, id).toBe(1)
    }
    // no leftovers anywhere in jobs/
    for (const s of ['queued', 'running', 'done', 'failed']) {
      expect((await readdir(path.join(dir, 'jobs', s))).filter((n) => !n.endsWith('.md')), s).toEqual([])
    }
  }, 90000)
})
