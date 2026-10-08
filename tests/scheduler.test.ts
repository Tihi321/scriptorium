import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseMd } from '../src/shared/md'
import type { EngineEvent } from '../src/shared/protocol'
import { watchDataFolder } from '../src/engine/store/watcher'
import { makeEnv, sleep, waitFor } from './helpers'
import type { TestEnv } from './helpers'

let env: TestEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const jobsIn = (e: TestEnv, state: string) => readdir(path.join(e.dir, 'jobs', state)).then((f) => f.filter((n) => n.endsWith('.md')))

/** The standard test handler: one model call, result is the reply. */
function registerChat(e: TestEnv, task = 't', hooks: { before?: () => void; after?: () => void } = {}) {
  e.engine.scheduler.register(task, async (ctx) => {
    hooks.before?.()
    try {
      const r = await ctx.chat({ messages: [{ role: 'user', content: `do ${ctx.job.id}` }] })
      return { result: r.text }
    } finally {
      hooks.after?.()
    }
  })
}

const reviewers = (n: number) => Array.from({ length: n }, (_, i) => ({ role: 'line-editor', name: `Rev ${i + 1}` }))

describe('scheduler', () => {
  it('runs a job end to end: files, events, log, handover', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'Ann' }] })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'b1--t--u1--r0', task: 't', role: 'writer', book: 'b1', unit: 'u1', requested_by: 'architect-ada' }, 'Please write unit one.')
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'job done')
    const done = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'b1--t--u1--r0.md'), 'utf8'))
    expect(done.data).toMatchObject({ id: 'b1--t--u1--r0', agent: 'writer-ann', model: 'loc/m1', paid: false, requested_by: 'architect-ada', attempts: 0 })
    expect(done.data.prompt_version).toMatch(/^[0-9a-f]{8}$/)
    expect(done.body).toContain('Please write unit one.')
    expect(done.body).toContain('do b1--t--u1--r0')
    expect(done.body).toContain('## Result')

    const types = env.events.map((e) => e.type)
    expect(types).toContain('job.started')
    expect(types).toContain('job.token')
    expect(types).toContain('spend')
    const handovers = env.events.filter((e): e is Extract<EngineEvent, { type: 'handover' }> => e.type === 'handover')
    expect(handovers.map((h) => [h.from, h.to, !!h.done])).toEqual([['architect-ada', 'writer-ann', false], ['architect-ada', 'writer-ann', true]])
    const states = env.events.filter((e) => e.type === 'agent.state').map((e) => (e as { state: string }).state)
    expect(states).toEqual(['idle', 'working', 'idle'])

    await env.engine.logs.flush()
    const agentLog = await readFile(path.join(env.dir, 'logs', 'agents', 'writer-ann.md'), 'utf8')
    expect(agentLog).toContain('requested by: architect-ada')
    expect(agentLog).toContain('Mock reply for writer')
    expect(existsSync(path.join(env.dir, 'books', 'b1', 'log.md'))).toBe(true)
    // the spend row for a local model: cost 0
    const spend = await readdir(path.join(env.dir, 'logs', 'spend'))
    expect(spend).toHaveLength(1)
  })

  it('3 books x parallel reviews respect provider concurrency and all finish', async () => {
    env = await makeEnv({ providers: [{ id: 'loc', local: true, concurrency: 2 }], roles: { 'line-editor': ['loc/m1'] }, agents: reviewers(6) })
    env.mock.onAny({ text: 'review notes '.repeat(4), chunkDelayMs: 25, chunks: 4 })
    let active = 0
    let max = 0
    registerChat(env, 't', { before: () => (max = Math.max(max, ++active)), after: () => active-- })
    for (const book of ['b1', 'b2', 'b3']) for (const r of ['continuity', 'line', 'copy']) {
      await env.engine.jobs.enqueue({ id: `${book}--review--${r}--r0`, task: 't', role: 'line-editor', book })
    }
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 9, 15000, '9 jobs done')
    expect(max).toBe(2)
    expect(await jobsIn(env, 'queued')).toEqual([])
    expect(await jobsIn(env, 'running')).toEqual([])
  })

  it('respects depends_on, waiting_on and locks', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }, { role: 'writer', name: 'B' }] })
    const order: string[] = []
    env.engine.scheduler.register('t', async (ctx) => {
      order.push(`start:${ctx.job.id}`)
      await sleep(80)
      order.push(`end:${ctx.job.id}`)
      return { result: 'ok' }
    })
    const j = env.engine.jobs
    await j.enqueue({ id: 'first', task: 't', role: 'writer' })
    await j.enqueue({ id: 'second', task: 't', role: 'writer', depends_on: ['first'] })
    await j.enqueue({ id: 'lock1', task: 't', role: 'writer', locks: ['bible:b1'] })
    await j.enqueue({ id: 'lock2', task: 't', role: 'writer', locks: ['bible:b1'] })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 4, 8000, 'all done')
    expect(order.indexOf('start:second')).toBeGreaterThan(order.indexOf('end:first'))
    const a = order.indexOf('end:lock1')
    const b = order.indexOf('end:lock2')
    const first = Math.min(a, b)
    const secondStart = order.indexOf(a < b ? 'start:lock2' : 'start:lock1')
    expect(secondStart).toBeGreaterThan(first) // the two locked jobs never overlap
  })

  it('pause all stops new claims and is saved in config/factory.md; resume continues', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }] })
    registerChat(env)
    await env.engine.handleCommand({ type: 'pauseAll' })
    expect(parseMd(await readFile(path.join(env.dir, 'config', 'factory.md'), 'utf8')).data.paused).toBe(true)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await sleep(400)
    expect(await jobsIn(env, 'queued')).toEqual(['j1.md'])
    await env.engine.handleCommand({ type: 'resumeAll' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done after resume')
    expect(parseMd(await readFile(path.join(env.dir, 'config', 'factory.md'), 'utf8')).data.paused).toBe(false)
  })

  it('starts paused when factory.md says so (survives a restart)', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }], paused: true })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await sleep(300)
    expect(await jobsIn(env, 'done')).toEqual([])
    expect(env.engine.factory.paused).toBe(true)
  })

  it('stop now aborts the stream, puts the job back in queued/ and pauses', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }] })
    env.mock.onAny({ text: 'slow '.repeat(40), chunkDelayMs: 50, chunks: 40 })
    let aborted = false
    env.engine.scheduler.register('t', async (ctx) => {
      try {
        await ctx.chat({ messages: [{ role: 'user', content: 'x' }] })
      } catch (e) {
        aborted = (e as Error).name === 'AbortError'
        throw e
      }
      return { result: 'x' }
    })
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(() => env!.events.some((e) => e.type === 'job.token'), 5000, 'streaming')
    await env.engine.handleCommand({ type: 'stopNow' })
    await waitFor(async () => (await jobsIn(env!, 'queued')).length === 1, 3000, 'job back in queued')
    expect(aborted).toBe(true)
    expect(await jobsIn(env, 'running')).toEqual([])
    expect(await jobsIn(env, 'done')).toEqual([])
    expect(env.engine.factory.paused).toBe(true)
    expect(parseMd(await readFile(path.join(env.dir, 'jobs', 'queued', 'j1.md'), 'utf8')).data.attempts).toBe(0)
  })

  it('stop (one agent) requeues its job without counting an attempt, and the job runs again', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }] })
    let runs = 0
    env.mock.onAny(() => (++runs === 1 ? { text: 'slow '.repeat(40), chunkDelayMs: 40, chunks: 40 } : 'quick'))
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(() => env!.events.some((e) => e.type === 'job.token'), 5000, 'streaming')
    await env.engine.handleCommand({ type: 'stop', agent: 'writer-a' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 8000, 'done on second run')
    expect(parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'j1.md'), 'utf8')).data.attempts).toBe(0)
  })

  it('the budget cap blocks paid jobs while local jobs continue', async () => {
    env = await makeEnv({
      providers: [{ id: 'paid', price: 1000, models: ['p'] }, { id: 'loc', local: true, concurrency: 2 }],
      roles: { writer: ['paid/p'], 'line-editor': ['loc/m1'] },
      caps: { daily: 0.5 },
      agents: [{ role: 'writer', name: 'W' }, { role: 'line-editor', name: 'L' }]
    })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'paid-job', task: 't', role: 'writer' })
    await env.engine.jobs.enqueue({ id: 'local-job', task: 't', role: 'line-editor' })
    await waitFor(async () => (await jobsIn(env!, 'done')).includes('local-job.md'), 5000, 'local job done')
    await sleep(300)
    // The paid request would cost about 4 USD (4096 max tokens at 1000 USD per 1M), more than the 0.5 cap.
    expect(await jobsIn(env, 'done')).toEqual(['local-job.md'])
    expect(await jobsIn(env, 'queued')).toEqual(['paid-job.md'])
    expect(env.engine.budget.spentToday()).toBe(0)
  })

  it('once a cap is reached, a paid-first role falls through to its local model', async () => {
    env = await makeEnv({
      providers: [{ id: 'paid', price: 1, models: ['p'] }, { id: 'loc', local: true }],
      roles: { writer: ['paid/p', 'loc/m1'] },
      caps: { daily: 1 },
      agents: [{ role: 'writer', name: 'W' }]
    })
    registerChat(env)
    await env.engine.budget.record({ time: new Date(), agent: 'x', book: '', role: 'writer', provider: 'paid', model: 'p', tokensIn: 1, tokensCached: 0, tokensOut: 1, costUsd: 1, ms: 1 })
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done')
    const done = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'j1.md'), 'utf8'))
    expect(done.data).toMatchObject({ model: 'loc/m1', paid: false })
  })

  it('falls back through the role list on provider errors and records the model used', async () => {
    env = await makeEnv({
      providers: [{ id: 'a', local: true, models: ['x'] }, { id: 'b', local: true, models: ['y'] }],
      roles: { writer: ['a/x', 'b/y'] },
      agents: [{ role: 'writer', name: 'W' }]
    })
    env.mock.onAny((req) => {
      if (req.model === 'x') throw Object.assign(new Error('down'), { name: 'ProviderError' })
      return 'from y'
    })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done')
    expect(parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'j1.md'), 'utf8')).data.model).toBe('b/y')
  })

  it('a failing handler is retried, then moved to failed/ with the reason', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'W' }] })
    env.engine.scheduler.register('boom', async () => {
      throw new Error('kaboom')
    })
    await env.engine.jobs.enqueue({ id: 'once', task: 'boom', role: 'writer', max_attempts: 1 })
    await env.engine.jobs.enqueue({ id: 'twice', task: 'boom', role: 'writer', max_attempts: 3 })
    await waitFor(async () => (await jobsIn(env!, 'failed')).includes('once.md'), 5000, 'failed')
    const failed = parseMd(await readFile(path.join(env.dir, 'jobs', 'failed', 'once.md'), 'utf8'))
    expect(failed.data).toMatchObject({ attempts: 1, failure: 'kaboom' })
    const retry = await waitFor(async () => {
      const j = await env!.engine.jobs.read('queued', 'twice')
      return j && j.data.attempts === 1 ? j : null
    }, 5000, 'retry queued')
    expect(retry.data.not_before).toBeTruthy()
    expect(env.events.some((e) => e.type === 'agent.state' && e.state === 'error')).toBe(true)
  })

  it('enqueue is idempotent by id, in any state', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'W' }] })
    registerChat(env)
    expect(await env.engine.jobs.enqueue({ id: 'same', task: 't', role: 'writer' })).toBe(true)
    expect(await env.engine.jobs.enqueue({ id: 'same', task: 't', role: 'writer' })).toBe(false)
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done')
    expect(await env.engine.jobs.enqueue({ id: 'same', task: 't', role: 'writer' })).toBe(false)
  })

  it('suspends on waiting_on: the job leaves the agent and resumes when the other job is done', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'W' }] })
    let first = true
    env.engine.scheduler.register('ask', async () => {
      if (first) {
        first = false
        await env!.engine.jobs.enqueue({ id: 'research-1', task: 'quick', role: 'writer' })
        return { suspendOn: 'research-1' }
      }
      return { result: 'resumed' }
    })
    env.engine.scheduler.register('quick', async () => ({ result: 'fact' }))
    await env.engine.jobs.enqueue({ id: 'scene', task: 'ask', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 2, 6000, 'both done')
    const scene = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'scene.md'), 'utf8'))
    expect(scene.body).toContain('resumed')
  })
})

describe('agent controls and hot reload', () => {
  it('hire writes an agent file that works at once; pause and resume persist', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] } })
    registerChat(env)
    await env.engine.handleCommand({ type: 'hire', role: 'writer', name: 'New Hire' })
    const file = path.join(env.dir, 'agents', 'writer-new-hire.md')
    expect(parseMd(await readFile(file, 'utf8')).data).toMatchObject({ kind: 'agent', role: 'writer', name: 'New Hire', paused: false, max_parallel: 1 })
    await env.engine.handleCommand({ type: 'pause', agent: 'writer-new-hire' })
    expect(parseMd(await readFile(file, 'utf8')).data.paused).toBe(true)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await sleep(300)
    expect(await jobsIn(env, 'queued')).toEqual(['j1.md'])
    expect(env.events.some((e) => e.type === 'agent.state' && e.agent === 'writer-new-hire' && e.state === 'paused')).toBe(true)
    await env.engine.handleCommand({ type: 'resume', agent: 'writer-new-hire' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'done')
  })

  it('fire gracefully finishes the job first, fire now aborts and requeues it', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }, { role: 'writer', name: 'B' }] })
    env.mock.onAny({ text: 'text '.repeat(10), chunkDelayMs: 60, chunks: 10 })
    registerChat(env)
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    const runner = await waitFor(() => env!.engine.scheduler.runningJobs()[0], 3000, 'job running')
    const fileOf = (id: string) => path.join(env!.dir, 'agents', `${id}.md`)
    await env.engine.handleCommand({ type: 'fire', agent: runner.agent })
    expect(existsSync(fileOf(runner.agent))).toBe(true) // still working
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'finished')
    await waitFor(() => !existsSync(fileOf(runner.agent)), 3000, 'file removed')

    const other = env.engine.agents.list()[0]!.id
    env.mock.onAny({ text: 'text '.repeat(40), chunkDelayMs: 60, chunks: 40 })
    await env.engine.jobs.enqueue({ id: 'j2', task: 't', role: 'writer' })
    await waitFor(() => env!.engine.scheduler.runningJobs().length === 1, 3000, 'j2 running')
    await env.engine.handleCommand({ type: 'fire', agent: other, now: true })
    await waitFor(async () => (await jobsIn(env!, 'queued')).includes('j2.md'), 3000, 'j2 requeued')
    expect(existsSync(fileOf(other))).toBe(false)
    expect(await jobsIn(env, 'running')).toEqual([])
  })

  it('setModel with an agent writes that agent file; with a role writes config/roles.md; both apply from the next job', async () => {
    env = await makeEnv({
      providers: [{ id: 'a', local: true, models: ['x'] }, { id: 'b', local: true, models: ['y'] }, { id: 'c', local: true, models: ['z'] }],
      roles: { writer: ['a/x'] },
      agents: [{ role: 'writer', name: 'W' }]
    })
    registerChat(env)
    const modelOf = async (id: string) => parseMd(await readFile(path.join(env!.dir, 'jobs', 'done', `${id}.md`), 'utf8')).data.model
    await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'j1')
    expect(await modelOf('j1')).toBe('a/x')

    await env.engine.handleCommand({ type: 'setModel', role: 'writer', model: 'b/y' })
    const roles = parseMd(await readFile(path.join(env.dir, 'config', 'roles.md'), 'utf8'))
    expect((roles.data.roles as Record<string, { models: string[] }>).writer!.models).toEqual(['b/y', 'a/x'])
    expect(roles.body).toBe('test roles\n') // body kept
    await env.engine.jobs.enqueue({ id: 'j2', task: 't', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 2, 5000, 'j2')
    expect(await modelOf('j2')).toBe('b/y')

    await env.engine.handleCommand({ type: 'setModel', agent: 'writer-w', model: 'c/z' })
    expect(parseMd(await readFile(path.join(env.dir, 'agents', 'writer-w.md'), 'utf8')).data.model).toBe('c/z')
    await env.engine.jobs.enqueue({ id: 'j3', task: 't', role: 'writer' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 3, 5000, 'j3')
    expect(await modelOf('j3')).toBe('c/z')

    await env.engine.handleCommand({ type: 'setModel', agent: 'writer-w', model: 'nope/none' })
    expect(env.logs.some((l) => l.includes('unknown model'))).toBe(true)
  })

  it('edits to agent and config files apply without a restart (watcher)', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [] })
    registerChat(env)
    const w = watchDataFolder(env.dir, (e) => void env!.engine.handleWatch(e), { debounceMs: 30 })
    await w.ready
    try {
      const { writeMd } = await import('../src/engine/store/atomic')
      await env.engine.jobs.enqueue({ id: 'j1', task: 't', role: 'writer' })
      await sleep(250)
      expect(await jobsIn(env, 'done')).toEqual([]) // nobody to do it
      await writeMd(path.join(env.dir, 'agents', 'writer-late.md'), { kind: 'agent', role: 'writer', name: 'Late', model: null, focus: [], pin: null, max_parallel: 1, paused: false }, 'persona\n')
      await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 6000, 'new agent picks the job up')

      // pause all through the file, without the command
      await writeMd(path.join(env.dir, 'config', 'factory.md'), { kind: 'factory', paused: true, max_attempts: 3 }, '')
      await waitFor(() => env!.engine.factory.paused, 3000, 'factory reloaded')
      await env.engine.jobs.enqueue({ id: 'j2', task: 't', role: 'writer' })
      await sleep(300)
      expect(await jobsIn(env, 'queued')).toEqual(['j2.md'])

      // an invalid edit keeps the previous version and logs it
      await writeMd(path.join(env.dir, 'agents', 'writer-late.md'), { kind: 'agent', role: 'writer', name: 'Late', max_parallel: 'many' }, '')
      await waitFor(() => env!.logs.some((l) => l.includes('could not reload agents/writer-late.md')), 3000, 'error logged')
      expect(env.engine.agents.get('writer-late')?.data.max_parallel).toBe(1)
    } finally {
      await w.close()
    }
  })

  it('snapshot lists agents, states and spend', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'A' }] })
    await sleep(150)
    await env.engine.handleCommand({ type: 'snapshot' })
    const snap = env.events.find((e) => e.type === 'snapshot')
    expect(snap).toMatchObject({ paused: false, agents: [{ id: 'writer-a', role: 'writer', state: 'idle' }], spend: { dailyCap: 5, monthlyCap: 40 } })
    await env.engine.handleCommand({ type: 'ping', id: 'p1' })
    expect(env.events.some((e) => e.type === 'pong' && e.id === 'p1')).toBe(true)
  })
})
