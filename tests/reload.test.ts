import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { watchDataFolder } from '../src/engine/store/watcher'
import { makeEnv, waitFor } from './helpers'
import type { TestEnv } from './helpers'

let env: TestEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

describe('config reload', () => {
  it('providers.md edits apply without a restart (watcher)', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [] })
    const file = path.join(env.dir, 'config', 'providers.md')
    const base = await readFile(file, 'utf8')
    const client = (context: number, enabled: boolean) =>
      ['  - id: cl', '    kind: client', `    enabled: ${enabled}`, '    models:', '      - id: claude-code', '        family: claude', `        context: ${context}`].join('\n')
    // the test providers file lists its providers under `providers:` and ends the frontmatter with ---
    const withClient = (context: number, enabled = true) => base.replace(/\n---\n/, `\n${client(context, enabled)}\n---\n`)
    const w = watchDataFolder(env.dir, (e) => void env!.engine.handleWatch(e), { debounceMs: 30 })
    await w.ready
    try {
      const snapshots = () => env!.events.filter((e) => e.type === 'snapshot').length
      let seen = snapshots()
      await writeFile(file, withClient(123456))
      await waitFor(() => env!.engine.registry.getModel('cl/claude-code')?.context === 123456, 6000, 'the new client provider')
      await waitFor(() => snapshots() > seen, 3000, 'a snapshot after the first change')
      seen = snapshots()
      await writeFile(file, withClient(200000))
      await waitFor(() => env!.engine.registry.getModel('cl/claude-code')?.context === 200000, 6000, 'the new context')
      await waitFor(() => snapshots() > seen, 3000, 'a snapshot after the second change')
      seen = snapshots()
      expect(env.engine.registry.providers.get('cl')?.available).toBe(true)
      await writeFile(file, withClient(200000, false))
      await waitFor(() => env!.engine.registry.providers.get('cl')?.available === false, 6000, 'the provider switched off')
      await waitFor(() => snapshots() > seen, 3000, 'a snapshot after the third change')
    } finally {
      await w.close()
    }
  })

  it("the engine's own budget.md summary is not a config change", async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [] })
    const file = path.join(env.dir, 'config', 'budget.md')
    const ev = { kind: 'config', change: 'change', rel: 'config/budget.md', path: file } as const
    await env.engine.budget.record({ time: new Date(), agent: 'a', book: 'b', role: 'writer', provider: 'loc', model: 'm1', tokensIn: 1, tokensCached: 0, tokensOut: 1, costUsd: 0.01, ms: 5 })
    await env.engine.budget.flush()
    expect(await env.engine.isOwnWrite(ev)).toBe(true)
    const text = await readFile(file, 'utf8')
    await writeFile(file, text.replace('## Spend summary', 'My own note.\n\n## Spend summary'))
    expect(await env.engine.isOwnWrite(ev)).toBe(false)
  })
})
