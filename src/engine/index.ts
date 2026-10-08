import path from 'node:path'
import { keySet, probe, rebuildReader, reindexLibrary } from './cli'
import { Engine } from './engine'
import { argValue, initDataFolder, resolveDataDir } from './store/dataFolder'
import { watchDataFolder } from './store/watcher'
import { getParentPort, ParentPortTransport, StdoutTransport } from './transport'
import type { EngineTransport } from '../shared/protocol'

const USAGE = `Scriptorium engine

Usage:
  npm run engine -- [--data <dir>] [--seed <dir>] [--once] [--heartbeat <ms>]
  npm run engine -- probe [--model <provider/model>] [--data <dir>]
  npm run engine -- reindex [--data <dir>]
  npm run engine -- rebuild-reader [--data <dir>]
  npm run key:set <ENV_NAME>

  --data <dir>      Data folder. Default: SCRIPTORIUM_DATA, else ~/Scriptorium
  --seed <dir>      Seed folder to copy from. Default: the repo's seed/ (or SCRIPTORIUM_SEED)
  --once            Create the data folder from the seed and exit
  --heartbeat <ms>  Heartbeat interval. Default 3000
  probe             Stream one short reply from LM Studio (and DeepSeek if a key is set) and embed one string
  reindex           Rebuild index/library.sqlite (search index) from the markdown files
  rebuild-reader    Write the in-app reader folder (books/<slug>/out/reader/) for every published book
  key-set <NAME>    Store an API key in the Windows credential store (hidden prompt)
`

function log(message: string): void {
  process.stdout.write(`[engine] ${message}\n`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    return
  }
  if (argv[0] === 'probe') {
    process.exitCode = await probe(argv.slice(1))
    return
  }
  if (argv[0] === 'reindex') {
    process.exitCode = await reindexLibrary(argv.slice(1))
    return
  }
  if (argv[0] === 'rebuild-reader') {
    process.exitCode = await rebuildReader(argv.slice(1))
    return
  }
  if (argv[0] === 'key-set') {
    process.exitCode = await keySet(argv.slice(1))
    return
  }

  const once = argv.includes('--once') || argv.includes('--init-only')
  const heartbeatMs = Number(argValue(argv, 'heartbeat') ?? 3000)
  const dataDir = resolveDataDir({ argv })
  const parentPort = getParentPort()
  const transport: EngineTransport = parentPort ? new ParentPortTransport(parentPort) : new StdoutTransport()

  const seed = argValue(argv, 'seed')
  const init = await initDataFolder(dataDir, seed ? path.resolve(seed) : undefined)
  log(`data folder: ${dataDir}`)
  log(`seed: copied ${init.copied.length} file(s), kept ${init.skipped.length} existing, created ${init.createdDirs} folder(s)`)
  if (once) return

  const startedAt = Date.now()
  const engine = new Engine({ dataDir, emit: (e) => transport.send(e), log, coverRenderer: !!parentPort })
  await engine.start()
  const watcher = watchDataFolder(dataDir, (e) => {
    log(`changed: ${e.kind} ${e.change} ${e.rel}`)
    void engine.handleWatch(e)
  })
  await watcher.ready
  transport.onMessage((cmd) => {
    engine.handleCommand(cmd).catch((err) => log(`command ${cmd.type} failed: ${(err as Error).message}`))
  })

  let n = 0
  const beat = setInterval(() => {
    n++
    transport.send({ type: 'engine.heartbeat', n, at: new Date().toISOString(), uptimeMs: Date.now() - startedAt })
  }, heartbeatMs)

  let stopping = false
  const stop = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    clearInterval(beat)
    await watcher.close()
    await engine.stop()
    transport.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())

  transport.send({ type: 'engine.ready', pid: process.pid, dataDir, at: new Date().toISOString() })
  transport.send({ type: 'engine.heartbeat', n: 0, at: new Date().toISOString(), uptimeMs: 0 })
}

main().catch((err) => {
  process.stderr.write(`[engine] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
