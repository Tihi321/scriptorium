import path from 'node:path'
import { parseMdWith } from '../../shared/md'
import { providersSchema, rolesSchema } from '../../shared/schemas'
import type { ProviderEntry, RolesConfig } from '../../shared/schemas'
import { promises as fs } from 'node:fs'
import { AnthropicClient } from './anthropic'
import { GeminiClient } from './gemini'
import { resolveKey } from './keys'
import type { KeyResolver } from './keys'
import { MockProvider } from './mock'
import { OpenAiCompatClient } from './openaiCompat'
import type { ProviderClient } from './types'

export interface ProviderInfo {
  id: string
  kind: ProviderEntry['kind']
  enabled: boolean
  local: boolean
  baseUrl?: string
  apiKeyEnv?: string
  concurrency: number
  rpm?: number
  discover: boolean
  /** `kind: search`: the service (tavily, wikipedia ...) and the price of one request. */
  searchEngine?: string
  pricePerRequest: number
  /** Enabled and (local, mock or has a key). */
  available: boolean
  unavailableReason?: string
  client?: ProviderClient
}

export interface ModelInfo {
  /** `provider/model`. */
  ref: string
  provider: ProviderInfo
  id: string
  family: string
  context?: number
  maxOutput?: number
  /** USD per 1M tokens. */
  priceIn: number
  priceOut: number
  priceCachedIn: number
  embedding: boolean
  extraBody: Record<string, unknown> | null
  discovered: boolean
}

export interface RegistryOptions {
  keys?: KeyResolver
  fetchImpl?: typeof fetch
  /** Reuse a mock provider so tests can script it. */
  mock?: MockProvider
}

/** A model that costs money: not local and with a price. */
export function isPaidModel(m: ModelInfo): boolean {
  return !m.provider.local && (m.priceIn > 0 || m.priceOut > 0 || m.priceCachedIn > 0)
}

/** Cost in USD for a usage on a model. Cached input is billed at its own price. */
export function computeCost(m: Pick<ModelInfo, 'priceIn' | 'priceOut' | 'priceCachedIn'>, u: { inputTokens: number; cachedInputTokens: number; outputTokens: number }): number {
  const uncached = Math.max(0, u.inputTokens - u.cachedInputTokens)
  return (uncached * m.priceIn + u.cachedInputTokens * m.priceCachedIn + u.outputTokens * m.priceOut) / 1_000_000
}

export class ModelRegistry {
  providers = new Map<string, ProviderInfo>()
  models = new Map<string, ModelInfo>()
  roles: RolesConfig = { kind: 'roles', roles: {} }
  /** `search_order` of providers.md: the ids of the search providers, in the order the researcher tries them. */
  searchOrder: string[] = []
  readonly mock: MockProvider

  constructor(
    private readonly dataDir: string,
    private readonly opts: RegistryOptions = {}
  ) {
    this.mock = opts.mock ?? new MockProvider('mock')
  }

  /** (Re)reads config/providers.md and config/roles.md. Keeps the previous state if a file is invalid. */
  async load(): Promise<void> {
    const provFile = path.join(this.dataDir, 'config', 'providers.md')
    const rolesFile = path.join(this.dataDir, 'config', 'roles.md')
    const prov = parseMdWith(await fs.readFile(provFile, 'utf8'), providersSchema, provFile)
    const roles = parseMdWith(await fs.readFile(rolesFile, 'utf8'), rolesSchema, rolesFile)
    const keys = this.opts.keys ?? resolveKey
    const discoveredBefore = [...this.models.values()].filter((m) => m.discovered)

    const providers = new Map<string, ProviderInfo>()
    const models = new Map<string, ModelInfo>()
    for (const p of prov.data.providers) {
      const info: ProviderInfo = {
        id: p.id,
        kind: p.kind,
        enabled: p.enabled,
        local: p.local,
        baseUrl: p.base_url,
        apiKeyEnv: p.api_key_env,
        concurrency: p.concurrency,
        rpm: p.rpm,
        discover: p.discover,
        searchEngine: p.engine ?? p.id,
        pricePerRequest: p.price_per_request,
        available: false
      }
      this.setupClient(info, keys)
      providers.set(p.id, info)
      for (const m of p.models) {
        const ref = `${p.id}/${m.id}`
        models.set(ref, {
          ref,
          provider: info,
          id: m.id,
          family: m.family,
          context: m.context,
          maxOutput: m.max_output,
          priceIn: m.price_in,
          priceOut: m.price_out,
          priceCachedIn: m.price_cached_in ?? m.price_in,
          embedding: m.embedding,
          extraBody: m.extra_body ?? null,
          discovered: false
        })
      }
    }
    this.providers = providers
    this.models = models
    this.roles = roles.data
    this.searchOrder = prov.data.search_order
    // Keep what discovery found earlier, so a config reload does not forget it.
    for (const d of discoveredBefore) {
      const prov = this.providers.get(d.provider.id)
      if (prov && !this.models.has(d.ref)) this.models.set(d.ref, { ...d, provider: prov })
    }
  }

  private setupClient(info: ProviderInfo, keys: KeyResolver): void {
    if (!info.enabled) {
      info.unavailableReason = 'disabled in config/providers.md'
      return
    }
    if (info.kind === 'mock') {
      info.client = this.mock
      info.available = true
      return
    }
    if (info.kind === 'search') {
      // used by the researcher, never for chat: there is no client, and the provider has no models
      if (info.apiKeyEnv && !keys(info.apiKeyEnv)) {
        info.unavailableReason = `no key (set ${info.apiKeyEnv} or run: npm run key:set ${info.apiKeyEnv})`
        return
      }
      info.available = true
      return
    }
    let apiKey: string | undefined
    if (info.apiKeyEnv) {
      apiKey = keys(info.apiKeyEnv)
      if (!apiKey && !info.local) {
        info.unavailableReason = `no key (set ${info.apiKeyEnv} or run: npm run key:set ${info.apiKeyEnv})`
        return
      }
    }
    const fetchImpl = this.opts.fetchImpl
    if (info.kind === 'openai-compat') {
      if (!info.baseUrl) {
        info.unavailableReason = 'no base_url'
        return
      }
      info.client = new OpenAiCompatClient({
        id: info.id,
        baseUrl: info.baseUrl,
        apiKey,
        fetchImpl,
        embedPrefixes: info.local ? { document: 'search_document: ', query: 'search_query: ' } : undefined
      })
    } else if (info.kind === 'anthropic') {
      info.client = new AnthropicClient({ id: info.id, baseUrl: info.baseUrl, apiKey: apiKey ?? '', fetchImpl })
    } else if (info.kind === 'gemini') {
      info.client = new GeminiClient({ id: info.id, baseUrl: info.baseUrl, apiKey: apiKey ?? '', fetchImpl })
    }
    info.available = true
  }

  /** `GET /models` on every provider with `discover: true`. Adds unknown models, family guessed from the id. */
  async discover(signal?: AbortSignal): Promise<{ provider: string; found: number; error?: string }[]> {
    const out: { provider: string; found: number; error?: string }[] = []
    for (const p of this.providers.values()) {
      if (!p.discover || !p.available || !(p.client instanceof OpenAiCompatClient)) continue
      try {
        const ids = await p.client.listModels(signal)
        const ctxLen = await p.client.contextLengths(signal)
        for (const id of ids) {
          const ref = `${p.id}/${id}`
          if (this.models.has(ref)) continue
          this.models.set(ref, {
            ref,
            provider: p,
            id,
            family: guessFamily(id),
            priceIn: 0,
            priceOut: 0,
            priceCachedIn: 0,
            embedding: /embed/i.test(id),
            extraBody: null,
            discovered: true
          })
        }
        // the context the model is loaded with, unless providers.md says otherwise
        for (const [id, len] of ctxLen) {
          const m = this.models.get(`${p.id}/${id}`)
          if (m && m.context === undefined) m.context = len
        }
        out.push({ provider: p.id, found: ids.length })
      } catch (err) {
        out.push({ provider: p.id, found: 0, error: (err as Error).message })
      }
    }
    return out
  }

  getModel(ref: string): ModelInfo | undefined {
    return this.models.get(ref)
  }

  /** Model refs in the roles file for a role, in order. */
  roleModelRefs(role: string): string[] {
    return this.roles.roles[role]?.models ?? []
  }

  embeddingModel(): ModelInfo | undefined {
    return this.roles.embeddings ? this.models.get(this.roles.embeddings) : undefined
  }

  /** Embeds texts with the configured embedding model. Adds the nomic prefixes for local models. */
  async embed(texts: string[], kind: 'document' | 'query', signal?: AbortSignal): Promise<number[][]> {
    const m = this.embeddingModel()
    if (!m) throw new Error('no embedding model in config/roles.md')
    const client = m.provider.client
    if (!client) throw new Error(`provider ${m.provider.id} is not available: ${m.provider.unavailableReason}`)
    if (client instanceof OpenAiCompatClient && /nomic/i.test(m.id)) return client.embedWithPrefix(m.id, texts, kind, signal)
    if (!client.embed) throw new Error(`provider ${m.provider.id} cannot embed`)
    return client.embed(m.id, texts, signal)
  }
}

export function guessFamily(id: string): string {
  const s = id.toLowerCase()
  for (const f of ['qwen', 'nemotron', 'poolside', 'laguna', 'deepseek', 'llama', 'mistral', 'gemma', 'nomic', 'glm', 'kimi']) {
    if (s.includes(f)) return f === 'laguna' ? 'poolside' : f
  }
  return 'unknown'
}
