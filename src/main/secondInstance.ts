import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The data folder a start would use: `--data <dir>` or `--data=<dir>`, then SCRIPTORIUM_DATA, then `~/Scriptorium` (as the engine resolves it). */
export function dataDirOf(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  let chosen: string | undefined
  for (let i = 0; i < argv.length && !chosen; i++) {
    if (argv[i] === '--data') chosen = argv[i + 1]
    else if (argv[i]?.startsWith('--data=')) chosen = argv[i]!.slice('--data='.length)
  }
  return path.resolve(chosen || env.SCRIPTORIUM_DATA || path.join(home, 'Scriptorium'))
}

/** Whether this start asked for MCP (`--mcp` or `--headless`) and did not turn it off (`--no-mcp`). */
export function asksForMcp(argv: readonly string[]): boolean {
  return !argv.includes('--no-mcp') && (argv.includes('--mcp') || argv.includes('--headless'))
}

/** The pid and start time in `index/engine.lock`, when the data folder has one. */
export function readEngineLock(dataDir: string): { pid: number; started?: string } | null {
  try {
    const lock = JSON.parse(readFileSync(path.join(dataDir, 'index', 'engine.lock'), 'utf8')) as { pid?: unknown; started?: unknown }
    return typeof lock.pid === 'number' ? { pid: lock.pid, ...(typeof lock.started === 'string' ? { started: lock.started } : {}) } : null
  } catch {
    return null
  }
}

/**
 * What a start says when another Scriptorium already holds the single-instance lock. Without this the start quits and nothing shows why.
 * `enginePid` is the engine's pid from `index/engine.lock` (the app's engine runs in a child process of the one that is running), when known.
 */
export function secondInstanceMessage(o: { dataDir: string; enginePid?: number | null; asksForMcp: boolean }): string {
  const pid = o.enginePid ? `engine pid ${o.enginePid}, ` : ''
  const mcp = o.asksForMcp ? ' This start asked for MCP (--mcp or --headless): the running Scriptorium must have MCP on, or be closed first and started again with --mcp.' : ''
  return `another Scriptorium is running (${pid}data folder ${o.dataDir}); this start was not needed and quits.${mcp}`
}

/** Writes the message to stderr and to `logs/app.log` of the data folder (when the folder exists), and returns it. */
export function reportSecondInstance(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): string {
  const dataDir = dataDirOf(argv, env)
  const message = secondInstanceMessage({ dataDir, enginePid: readEngineLock(dataDir)?.pid ?? null, asksForMcp: asksForMcp(argv) })
  process.stderr.write(`[scriptorium] ${message}\n`)
  try {
    const logs = path.join(dataDir, 'logs')
    if (existsSync(logs)) appendFileSync(path.join(logs, 'app.log'), `${new Date().toISOString()} ${message}\n`)
  } catch {
    /* the log is a courtesy */
  }
  return message
}
