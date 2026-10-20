import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import { atomicWrite, readMd, writeMd } from './atomic'

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

/** The format entries (the text of each `  - id: <id>` block) of a formats.md, in file order. Only the frontmatter is looked at. */
function formatBlocks(text: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end < 0) end = lines.length
  let id: string | null = null
  let block: string[] = []
  const flush = () => {
    if (id) out.set(id, block.join('\n').replace(/\s+$/, ''))
  }
  for (const line of lines.slice(1, end)) {
    const m = /^ {2}- id:\s*(\S+)\s*$/.exec(line)
    if (m) {
      flush()
      id = m[1]!
      block = [line]
    } else if (id) block.push(line)
  }
  flush()
  return out
}

/** The newspaper formats of the seed, in this order. */
export const ARTICLE_FORMAT_IDS = ['article', 'feature-article']

/** The id of the first row of the newspaper section of topics.md: a data folder that has it (or a `## Newspaper` heading) has the section. */
const NEWSPAPER_ROW = 'news-world'

/**
 * The newspaper arrived after data folders existed. At every start: the formats `article` and `feature-article` are appended to
 * config/formats.md when their ids are missing (the text of the seed's entries, so your own formats and comments stay as they are),
 * and the seed's `## Newspaper` section (a table of inactive topics) is appended to topics.md when it has no such section and no row
 * `news-world`. Running it again changes nothing. A folder without these files, or a seed without the entries, is not touched.
 */
export async function migrateNewspaper(dataDir: string, seedDir: string | undefined): Promise<MigrationResult> {
  const changes: string[] = []
  if (!seedDir) return { changes }
  const formatsFile = path.join(dataDir, 'config', 'formats.md')
  const seedFormats = path.join(seedDir, 'config', 'formats.md')
  if (existsSync(formatsFile) && existsSync(seedFormats)) {
    const text = await fs.readFile(formatsFile, 'utf8')
    const have = formatBlocks(text)
    const seed = formatBlocks(await fs.readFile(seedFormats, 'utf8'))
    const add = ARTICLE_FORMAT_IDS.filter((id) => !have.has(id) && seed.has(id))
    if (add.length > 0) {
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      const lines = text.split(/\r?\n/)
      const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
      if (lines[0]?.trim() === '---' && end > 0) {
        // the entries go after the last line of the frontmatter's list, before the closing ---
        let at = end
        while (at > 1 && !lines[at - 1]!.trim()) at--
        const blocks = add.flatMap((id) => seed.get(id)!.split('\n'))
        lines.splice(at, 0, ...blocks)
        await atomicWrite(formatsFile, lines.join(eol))
        changes.push(`config/formats.md: added the newspaper formats (${add.join(', ')})`)
      }
    }
  }
  const topicsFile = path.join(dataDir, 'topics.md')
  const seedTopics = path.join(seedDir, 'topics.md')
  if (existsSync(topicsFile) && existsSync(seedTopics)) {
    const text = await fs.readFile(topicsFile, 'utf8')
    const hasSection = /^#{2,6}\s+Newspaper\s*$/im.test(text) || new RegExp(`^\\|\\s*${NEWSPAPER_ROW}\\s*\\|`, 'm').test(text)
    const seedText = (await fs.readFile(seedTopics, 'utf8')).replace(/\r\n/g, '\n')
    const from = seedText.search(/^## Newspaper\s*$/m)
    if (!hasSection && from >= 0) {
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      const section = seedText.slice(from).replace(/\s+$/, '').split('\n').join(eol)
      await atomicWrite(topicsFile, `${text.replace(/\s+$/, '')}${eol}${eol}${section}${eol}`)
      changes.push('topics.md: added the Newspaper section (8 topics of kind article, all switched off)')
    }
  }
  return { changes }
}
