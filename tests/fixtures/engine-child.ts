// Runs the engine in its own process with the mock provider, for the restart-recovery test.
// Usage: node --import tsx tests/fixtures/engine-child.ts <dataDir>
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { Engine } from '../../src/engine/engine'
import { MockProvider } from '../../src/engine/models/mock'

const dataDir = process.argv[2]!
const delay = Number(process.env.CHILD_CHUNK_DELAY_MS ?? 300)
const mock = new MockProvider('mock', { chunkDelayMs: delay, chunks: 5 })
const engine = new Engine({
  dataDir,
  emit: () => undefined,
  log: (m) => process.stdout.write(`[child] ${m}\n`),
  registry: { mock },
  pollMs: 50,
  discover: false
})
engine.scheduler.register('slow', async (ctx) => {
  appendFileSync(path.join(dataDir, 'runs.log'), `${process.pid} start ${ctx.job.id}\n`)
  const r = await ctx.chat({ messages: [{ role: 'user', content: `work on ${ctx.job.id}` }] })
  appendFileSync(path.join(dataDir, 'runs.log'), `${process.pid} end ${ctx.job.id}\n`)
  return { result: r.text }
})
void engine.start().then(() => process.stdout.write('[child] ready\n'))
const stop = async () => {
  await engine.stop()
  process.exit(0)
}
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
setInterval(() => undefined, 1000)
