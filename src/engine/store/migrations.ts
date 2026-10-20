import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import { readMd, writeMd } from './atomic'

export interface MigrationResult {
  /** One line per change made, for the log. */
  changes: string[]
}

/**
 * The humanizer arrived after data folders existed, and the seed only fills in files that are missing (the starter staff only
 * a data folder without agents/). So at every start: a `humanizer` entry in config/roles.md (the line editor's model list) when
 * there is none, and the seed's humanizer agent when no agent of that role exists. Running it again changes nothing once both are
 * there. (A humanizer that was fired comes back at the next start, because the pass needs one; to go without the pass, set
 * `humanize: false` on the formats or on a book.) A folder without config/roles.md or without agents/ is not a data folder yet
 * and is not touched.
 */
export async function migrateHumanizer(dataDir: string, seedDir: string | undefined): Promise<MigrationResult> {
  const changes: string[] = []
  const rolesFile = path.join(dataDir, 'config', 'roles.md')
  if (existsSync(rolesFile)) {
    const doc = await readMd(rolesFile)
    const roles = { ...((doc.data.roles as Record<string, { models?: string[] }> | undefined) ?? {}) }
    if (!roles.humanizer) {
      const chain = roles['line-editor']?.models
      roles.humanizer = { models: chain && chain.length ? [...chain] : ['strata', 'lmstudio', 'paid'] }
      await writeMd(rolesFile, { ...doc.data, roles }, doc.body)
      changes.push(`config/roles.md: added the humanizer role with the line editor's models (${roles.humanizer.models!.join(', ')})`)
    }
  }
  const agentsDir = path.join(dataDir, 'agents')
  if (existsSync(agentsDir) && seedDir) {
    const hired = (await fs.readdir(agentsDir)).filter((f) => f.endsWith('.md'))
    let has = false
    for (const f of hired) {
      try {
        if (parseMd(await fs.readFile(path.join(agentsDir, f), 'utf8')).data.role === 'humanizer') has = true
      } catch {
        /* an unreadable agent file is reported when the agents load */
      }
      if (has) break
    }
    const seedAgents = path.join(seedDir, 'agents')
    if (!has && existsSync(seedAgents)) {
      for (const f of (await fs.readdir(seedAgents)).filter((x) => x.startsWith('humanizer-') && x.endsWith('.md'))) {
        const to = path.join(agentsDir, f)
        if (existsSync(to)) continue
        await fs.copyFile(path.join(seedAgents, f), to)
        changes.push(`agents/${f}: hired the starter humanizer`)
        break
      }
    }
  }
  return { changes }
}
