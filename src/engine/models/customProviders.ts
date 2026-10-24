import { promises as fs } from 'node:fs'
import { isMap, isSeq, parseDocument } from 'yaml'
import type { YAMLMap, YAMLSeq } from 'yaml'
import { splitFrontmatter } from '../../shared/md'
import { providersSchema } from '../../shared/schemas'
import { slugify } from '../../shared/slug'
import { atomicWrite } from '../store/atomic'

/** The settings of a custom provider the Models dialog form sends (SCP-44). */
export interface CustomProviderInput {
  /** Set to edit that entry; missing creates a new one. */
  id?: string
  name: string
  baseUrl: string
  /** Free (local): no key needed, never counted as paid. */
  free: boolean
  jsonSchema: boolean
  concurrency: number | 'auto'
  enabled: boolean
  /** A key is given: the entry gets `api_key_env: CUSTOM_<ID>_API_KEY` when it has none. */
  withKey?: boolean
}

/** Ids a custom provider may never take: the aliases of the fallback list. */
const RESERVED_IDS = new Set(['paid', 'mock', 'search'])

/** The key name of a custom provider: `CUSTOM_<ID>_API_KEY`. */
export function customKeyName(id: string): string {
  return `CUSTOM_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** The id a name gives, or '' when the name has no letters or digits. */
export function customProviderSlug(name: string): string {
  return slugify(name, { max: 32, maxWords: 6, fallback: '' })
}

/** Throws with a message for the form when the address is not an http(s) URL. */
export function checkBaseUrl(raw: string): string {
  const text = raw.trim()
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('the base URL is not a valid address')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('the base URL must start with http:// or https://')
  return text.replace(/\/+$/, '')
}

interface Parsed {
  doc: ReturnType<typeof parseDocument>
  body: string
  crlf: boolean
  list: YAMLSeq
}

async function readProviders(file: string): Promise<Parsed> {
  const text = await fs.readFile(file, 'utf8')
  const { frontmatter, body } = splitFrontmatter(text)
  if (frontmatter === null) throw new Error('providers.md has no frontmatter')
  const doc = parseDocument(frontmatter)
  const list = doc.get('providers')
  if (!isSeq(list)) throw new Error('providers.md has no providers list')
  return { doc, body, crlf: text.includes('\r\n'), list }
}

function entryOf(list: YAMLSeq, id: string): YAMLMap | undefined {
  for (const item of list.items) if (isMap(item) && item.get('id') === id) return item
  return undefined
}

async function writeProviders(file: string, p: Parsed): Promise<void> {
  const check = providersSchema.safeParse(p.doc.toJS())
  if (!check.success) throw new Error(`providers.md would be invalid: ${check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  let next = `---\n${p.doc.toString({ lineWidth: 0 })}---\n${p.body}`
  if (p.crlf) next = next.replace(/\r?\n/g, '\r\n')
  await atomicWrite(file, next)
}

/**
 * Adds a custom entry (`custom: true`) to providers.md, or edits the one named by `input.id`. Only that entry changes: the file's comments
 * and hand edits stay (a `yaml` document round trip). Returns the id and the key name of the entry.
 */
export async function saveCustomEntry(file: string, input: CustomProviderInput): Promise<{ id: string; apiKeyEnv: string; created: boolean }> {
  const name = input.name.trim()
  if (!name) throw new Error('the provider needs a name')
  const baseUrl = checkBaseUrl(input.baseUrl)
  if (input.concurrency !== 'auto' && (!Number.isInteger(input.concurrency) || input.concurrency < 1)) throw new Error('parallel must be a whole number of at least 1, or auto')
  const p = await readProviders(file)
  if (input.id) {
    const entry = entryOf(p.list, input.id)
    if (!entry) throw new Error(`no provider "${input.id}"`)
    if (entry.get('custom') !== true) throw new Error(`"${input.id}" is not a custom provider: edit it in config/providers.md`)
    const apiKeyEnv = (entry.get('api_key_env') as string | undefined) ?? customKeyName(input.id)
    entry.set('name', name)
    entry.set('enabled', input.enabled)
    entry.set('base_url', baseUrl)
    entry.set('local', input.free)
    entry.set('json_schema', input.jsonSchema)
    entry.set('concurrency', input.concurrency)
    if (input.withKey && !entry.get('api_key_env')) entry.set('api_key_env', apiKeyEnv)
    await writeProviders(file, p)
    return { id: input.id, apiKeyEnv, created: false }
  }
  const id = customProviderSlug(name)
  if (!id) throw new Error('the name needs letters or digits')
  const taken = new Set<string>()
  for (const item of p.list.items) if (isMap(item)) taken.add(String(item.get('id')))
  if (RESERVED_IDS.has(id) || taken.has(id)) throw new Error(`a provider "${id}" exists already: choose another name`)
  // "acp-2" would be read as the second row of the kind "acp" in roles.md
  const alias = /^(.+)-\d+$/.exec(id)
  if (alias && taken.has(alias[1]!)) throw new Error(`"${id}" would clash with an alias of "${alias[1]}": choose another name`)
  const apiKeyEnv = customKeyName(id)
  const node = p.doc.createNode({
    id,
    name,
    custom: true,
    kind: 'openai-compat',
    enabled: input.enabled,
    base_url: baseUrl,
    ...(input.withKey ? { api_key_env: apiKeyEnv } : {}),
    local: input.free,
    json_schema: input.jsonSchema,
    concurrency: input.concurrency,
    discover: true,
    models: []
  })
  p.list.add(node)
  await writeProviders(file, p)
  return { id, apiKeyEnv, created: true }
}

/** Removes a custom entry from providers.md. Returns its key name, or throws when it isn't a custom provider. */
export async function removeCustomEntry(file: string, id: string): Promise<{ apiKeyEnv: string }> {
  const p = await readProviders(file)
  const entry = entryOf(p.list, id)
  if (!entry) throw new Error(`no provider "${id}"`)
  if (entry.get('custom') !== true) throw new Error(`"${id}" is not a custom provider: remove it in config/providers.md`)
  const apiKeyEnv = (entry.get('api_key_env') as string | undefined) ?? customKeyName(id)
  p.list.items = p.list.items.filter((i) => i !== entry)
  await writeProviders(file, p)
  return { apiKeyEnv }
}
