import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrateHumanizer } from './migrations'

/** Folders created inside the data folder (see "Shared files" in docs/design.md). */
export const DATA_LAYOUT = [
  'config',
  'agents',
  'ideas',
  'series',
  'research',
  'templates',
  'prompts',
  'books',
  'jobs/queued',
  'jobs/running',
  'jobs/done',
  'jobs/failed',
  'logs/agents',
  'logs/spend',
  'index'
] as const

export interface ResolveOptions {
  argv?: readonly string[]
  env?: NodeJS.ProcessEnv
  homedir?: string
}

/** Reads `--data <dir>` or `--data=<dir>` from an argument list. */
export function argValue(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === `--${name}`) return argv[i + 1]
    if (a?.startsWith(`--${name}=`)) return a.slice(name.length + 3)
  }
  return undefined
}

/** `--data` argument, then the SCRIPTORIUM_DATA env var, then `~/Scriptorium`. */
export function resolveDataDir(opts: ResolveOptions = {}): string {
  const argv = opts.argv ?? process.argv.slice(2)
  const env = opts.env ?? process.env
  const chosen = argValue(argv, 'data') || env.SCRIPTORIUM_DATA || path.join(opts.homedir ?? os.homedir(), 'Scriptorium')
  return path.resolve(chosen)
}

/** Finds the repo's `seed/` folder: SCRIPTORIUM_SEED, else walk up from this file. */
export function findSeedDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.SCRIPTORIUM_SEED) return path.resolve(env.SCRIPTORIUM_SEED)
  let dir = __dirname
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'seed')
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

export interface InitResult {
  dataDir: string
  createdDirs: number
  copied: string[]
  skipped: string[]
  /** Changes made to files that already existed (see `migrations.ts`), one line each. */
  migrated: string[]
}

async function copyTree(src: string, dest: string, root: string, result: InitResult, skipDirs: Set<string> = new Set()): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      const rel = path.relative(root, to).split(path.sep).join('/')
      if (skipDirs.has(rel)) {
        result.skipped.push(`${rel}/`)
        continue
      }
      await copyTree(from, to, root, result, skipDirs)
    } else if (entry.isFile()) {
      const rel = path.relative(root, to).split(path.sep).join('/')
      try {
        // COPYFILE_EXCL: never overwrite a file that already exists.
        await fs.copyFile(from, to, 1)
        result.copied.push(rel)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') result.skipped.push(rel)
        else throw err
      }
    }
  }
}

/**
 * Creates the data folder layout and copies `seed/` into it. Existing files are never overwritten.
 * The starter staff (`agents/`) is copied only while the data folder has no `agents/` folder: after that the staff is
 * yours to hire and fire, and a fired starter agent doesn't come back at the next start.
 */
export async function initDataFolder(dataDir: string, seedDir: string | undefined = findSeedDir()): Promise<InitResult> {
  const result: InitResult = { dataDir, createdDirs: 0, copied: [], skipped: [], migrated: [] }
  await fs.mkdir(dataDir, { recursive: true })
  const skipDirs = new Set(existsSync(path.join(dataDir, 'agents')) ? ['agents'] : [])
  if (seedDir && existsSync(seedDir)) await copyTree(seedDir, dataDir, dataDir, result, skipDirs)
  // files the seed never replaces: what a data folder from before a feature needs to have
  result.migrated.push(...(await migrateHumanizer(dataDir, seedDir && existsSync(seedDir) ? seedDir : undefined)).changes)
  for (const rel of DATA_LAYOUT) {
    const dir = path.join(dataDir, ...rel.split('/'))
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true })
      result.createdDirs++
    }
  }
  return result
}

export interface EngineLock {
  file: string
  release(): Promise<void>
}

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM' // alive, but not ours to signal
  }
}

/**
 * Takes `index/engine.lock` (pid and start time): one engine per data folder. Throws when a lock names another live process.
 * A lock of a dead process is replaced. The index folder only holds files that can be rebuilt, so the lock is no hidden state.
 */
export async function acquireEngineLock(dataDir: string, pid = process.pid): Promise<EngineLock> {
  const file = path.join(dataDir, 'index', 'engine.lock')
  await fs.mkdir(path.dirname(file), { recursive: true })
  try {
    const old = JSON.parse(await fs.readFile(file, 'utf8')) as { pid?: unknown; started?: unknown }
    // a lock from before the last boot is stale even when its pid is alive: Windows hands old pids to other processes
    const started = typeof old.started === 'string' ? Date.parse(old.started) : NaN
    const beforeBoot = Number.isFinite(started) && started < Date.now() - os.uptime() * 1000
    if (typeof old.pid === 'number' && old.pid !== pid && !beforeBoot && pidAlive(old.pid)) {
      throw new Error(`another Scriptorium engine (pid ${old.pid}, started ${String(old.started ?? 'at an unknown time')}) already runs on ${dataDir}. Stop it first, or use another --data folder.`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('another Scriptorium engine')) throw err
    /* no lock, or an unreadable one: replaced */
  }
  await fs.writeFile(file, JSON.stringify({ pid, started: new Date().toISOString() }) + '\n')
  return {
    file,
    release: async () => {
      // only our own lock is removed
      try {
        const cur = JSON.parse(await fs.readFile(file, 'utf8')) as { pid?: unknown }
        if (cur.pid === pid) await fs.rm(file, { force: true })
      } catch {
        /* gone already */
      }
    }
  }
}
