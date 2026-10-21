import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import { atomicWrite, readMd, writeMd } from './atomic'
import { SEED_HISTORY, seedHash } from './seedHistory'

export interface MigrationResult {
  /** One line per change made, for the log. */
  changes: string[]
}

/** The humanizer's model chain for a data folder that has none: DeepSeek Flash, then the paid default (SCP-14, as in the seed). */
const HUMANIZER_MODELS = ['deepseek/deepseek-flash', 'paid']

/**
 * The humanizer arrived after data folders existed, and the seed only fills in files that are missing (the starter staff only
 * a data folder without agents/). So at every start: a `humanizer` entry in config/roles.md (DeepSeek Flash, then the paid default) when
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
      roles.humanizer = { models: [...HUMANIZER_MODELS] }
      await writeMd(rolesFile, { ...doc.data, roles }, doc.body)
      changes.push(`config/roles.md: added the humanizer role (${roles.humanizer.models!.join(', ')})`)
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

/** The id of the client search provider (not `client`: that is the model provider of providers.md). */
export const CLIENT_SEARCH_ID = 'client-search'

const CLIENT_SEARCH_BLOCK = [
  '  # Web search done by Claude Code (or any MCP client): each query is a `searcher` task in the client queue (see docs/mcp.md). It costs nothing',
  '  # and waits for a client: a task nobody takes within wait_minutes gives no results, and the next provider is tried.',
  `  - id: ${CLIENT_SEARCH_ID}`,
  '    kind: search',
  '    engine: client',
  '    enabled: true',
  '    wait_minutes: 10',
  '    price_per_request: 0',
  '    concurrency: 2'
]

/**
 * The client web search arrived after data folders existed. At every start, when config/providers.md has no `engine: client` search
 * entry (and no entry with the id `client-search`): the entry is added at the end of the providers, and `client-search` goes into
 * `search_order` after `tavily` (first when there is none) and before `wikipedia`. Everything else in the file stays as it is, including
 * the line endings. Running it again changes nothing. A search_order that is not written as `[a, b, c]` is left alone (the provider
 * is tried after the listed ones then). A folder without the file is not touched.
 */
export async function migrateClientSearch(dataDir: string): Promise<MigrationResult> {
  const changes: string[] = []
  const file = path.join(dataDir, 'config', 'providers.md')
  if (!existsSync(file)) return { changes }
  const text = await fs.readFile(file, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (lines[0]?.trim() !== '---' || end < 0) return { changes }
  const front = lines.slice(1, end).join('\n')
  if (new RegExp(String.raw`^\s*-\s*id:\s*${CLIENT_SEARCH_ID}\b`, 'm').test(front) || /^\s+engine:\s*client\b/m.test(front)) return { changes }
  const orderAt = lines.findIndex((l, i) => i > 0 && i < end && /^search_order:/.test(l))
  // the providers end where search_order starts (or where the frontmatter ends)
  const insertAt = orderAt >= 0 ? orderAt : end
  lines.splice(insertAt, 0, ...CLIENT_SEARCH_BLOCK)
  let ordered = false
  const at = orderAt >= 0 ? orderAt + CLIENT_SEARCH_BLOCK.length : -1
  const m = at >= 0 ? /^search_order:\s*\[([^\]]*)\]\s*(#.*)?$/.exec(lines[at]!) : null
  if (m) {
    const ids = m[1]!.split(',').map((x) => x.trim()).filter(Boolean)
    if (!ids.includes(CLIENT_SEARCH_ID)) {
      const tavily = ids.indexOf('tavily')
      const wiki = ids.indexOf('wikipedia')
      let pos = tavily >= 0 ? tavily + 1 : 0
      if (wiki >= 0 && wiki < pos) pos = wiki
      ids.splice(pos, 0, CLIENT_SEARCH_ID)
      lines[at] = `search_order: [${ids.join(', ')}]${m[2] ? ' ' + m[2] : ''}`
      ordered = true
    }
  }
  await atomicWrite(file, lines.join(eol))
  changes.push(`config/providers.md: added the client web search provider (${CLIENT_SEARCH_ID}, wait_minutes 10)${ordered ? ' and put it into search_order after tavily' : ''}`)
  return { changes }
}

/** The model of the client provider and the window that sizes the memory context and source excerpts (Claude's). */
const CLIENT_MODEL_ID = 'claude-code'
const CLIENT_CONTEXT = 200000

/** The client provider as the seed has it, for a data folder whose seed can't be read. */
const CLIENT_PROVIDER_BLOCK = [
  '  # Claude Code (or any MCP client) does the model work: a request waits in the engine until the client answers it (see docs/mcp.md).',
  '  # Switched off here so a new install never routes to it: set `enabled: true`, then point one agent or role at client/claude-code.',
  '  - id: client',
  '    kind: client',
  '    enabled: false',
  '    local: true                   # free, never paid, never budget-checked, no key',
  '    concurrency: 8                # requests that may wait for the client at once',
  '    models:',
  `      - id: ${CLIENT_MODEL_ID}`,
  '        family: claude',
  `        context: ${CLIENT_CONTEXT}`,
  '        vision: true'
]

/** The line range [from, to) of the first provider `  - id: <id>` in the frontmatter lines (end = index of the closing ---) whose text matches, with the `  #` comment lines right above it. */
function providerRange(lines: string[], end: number, match: (block: string) => boolean): { from: number; to: number } | null {
  const starts: number[] = []
  for (let i = 1; i < end; i++) if (/^ {2}- id:\s*\S+/.test(lines[i]!)) starts.push(i)
  for (let k = 0; k < starts.length; k++) {
    let to = k + 1 < starts.length ? starts[k + 1]! : end
    // the block stops at the first line that is not indented (search_order:), and the comments of the next provider are not its own
    for (let i = starts[k]! + 1; i < to; i++) {
      if (/^\S/.test(lines[i]!)) {
        to = i
        break
      }
    }
    while (to > starts[k]! + 1 && /^ {2}#/.test(lines[to - 1]!)) to--
    if (!match(lines.slice(starts[k]!, to).join('\n'))) continue
    let from = starts[k]!
    while (from - 1 > 0 && /^ {2}#/.test(lines[from - 1]!)) from--
    return { from, to }
  }
  return null
}

/**
 * The client model provider (`client/claude-code`) arrived after data folders existed, and the seed only fills in files that are
 * missing. At every start, in config/providers.md: a data folder with no `kind: client` provider (and no `id: client`) gets the seed's
 * block (switched off, with its comments), put before the first search provider; and a client provider whose `claude-code` model has
 * no `context` gets `context: 200000` (the memory context and the source excerpts are sized from the window). A provider the user
 * has is never switched on. Everything else stays as it is, including comments and line endings. Running it again changes nothing.
 * A folder without the file is not touched.
 */
export async function migrateClientProvider(dataDir: string, seedDir: string | undefined): Promise<MigrationResult> {
  const changes: string[] = []
  const file = path.join(dataDir, 'config', 'providers.md')
  if (!existsSync(file)) return { changes }
  const text = await fs.readFile(file, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (lines[0]?.trim() !== '---' || end < 0) return { changes }
  const isClient = (block: string) => /^ {4}kind:\s*client\b/m.test(block) || /^ {2}- id:\s*client\s*$/.test(block.split('\n')[0]!)
  const have = providerRange(lines, end, isClient)
  if (!have) {
    let block = CLIENT_PROVIDER_BLOCK
    const seedFile = seedDir ? path.join(seedDir, 'config', 'providers.md') : ''
    if (seedFile && existsSync(seedFile)) {
      const seedLines = (await fs.readFile(seedFile, 'utf8')).split(/\r?\n/)
      const seedEnd = seedLines.findIndex((l, i) => i > 0 && l.trim() === '---')
      const r = seedEnd > 0 ? providerRange(seedLines, seedEnd, isClient) : null
      if (r) block = seedLines.slice(r.from, r.to)
    }
    const search = providerRange(lines, end, (b) => /^ {4}kind:\s*search\b/m.test(b))
    const orderAt = lines.findIndex((l, i) => i > 0 && i < end && /^search_order:/.test(l))
    lines.splice(search ? search.from : orderAt >= 0 ? orderAt : end, 0, ...block)
    await atomicWrite(file, lines.join(eol))
    changes.push(`config/providers.md: added the client provider (client/${CLIENT_MODEL_ID}, switched off, context ${CLIENT_CONTEXT})`)
    return { changes }
  }
  // a client provider whose model has no context
  for (let i = have.from; i < have.to; i++) {
    const m = new RegExp(String.raw`^(\s+)- id:\s*${CLIENT_MODEL_ID}\s*$`).exec(lines[i]!)
    if (!m) continue
    const indent = m[1]!.length
    let to = i + 1
    while (to < have.to && (!lines[to]!.trim() || /^\s*/.exec(lines[to]!)![0].length > indent)) to++
    const block = lines.slice(i, to)
    if (block.some((l) => /^\s+context:/.test(l))) break
    let after = block.findIndex((l) => /^\s+family:/.test(l))
    if (after < 0) after = 0
    lines.splice(i + after + 1, 0, `${' '.repeat(indent + 2)}context: ${CLIENT_CONTEXT}`)
    await atomicWrite(file, lines.join(eol))
    changes.push(`config/providers.md: client/${CLIENT_MODEL_ID} got context ${CLIENT_CONTEXT} (the window of Claude)`)
    break
  }
  return { changes }
}

/**
 * Seed prompts and templates are only copied when missing, so an improved seed prompt never reached a data folder that had the old
 * one. At every start, for each file the history knows: when the data file is not the current seed file, but is an earlier seed
 * version (line endings aside), it was never edited and is replaced with the current one, in the file's own line endings. A file
 * that matches no seed version is the owner's and stays. `history` is generated by `yarn seed:hashes` (see seedHistory.ts).
 */
export async function migrateSeedPrompts(dataDir: string, seedDir: string | undefined, history: Record<string, string[]> = SEED_HISTORY): Promise<MigrationResult> {
  const changes: string[] = []
  if (!seedDir) return { changes }
  for (const rel of Object.keys(history).sort()) {
    const dataFile = path.join(dataDir, ...rel.split('/'))
    const seedFile = path.join(seedDir, ...rel.split('/'))
    if (!existsSync(dataFile) || !existsSync(seedFile)) continue
    const data = await fs.readFile(dataFile, 'utf8')
    const seed = await fs.readFile(seedFile, 'utf8')
    const h = seedHash(data)
    if (h === seedHash(seed) || !history[rel]!.includes(h)) continue
    const eol = data.includes('\r\n') ? '\r\n' : '\n'
    await atomicWrite(dataFile, seed.replace(/\r\n/g, '\n').split('\n').join(eol))
    changes.push(`${rel}: upgraded to the current seed version (it was an unedited earlier version)`)
  }
  return { changes }
}
