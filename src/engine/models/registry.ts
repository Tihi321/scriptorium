import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseMdWith } from '../../shared/md'
import { providersSchema, rolesSchema, settingsSchema } from '../../shared/schemas'
import type { ProviderEntry, RolesConfig, SettingsConfig } from '../../shared/schemas'
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
  /** `concurrency: auto`: `concurrency` follows the server's own slot count (see `syncServerSlots`). */
  concurrencyAuto: boolean
  rpm?: number
  discover: boolean
  /** Send the JSON schema as `response_format` (`openai-compat`). */
  jsonSchema: boolean
  /** LM Studio: the engine loads a model that isn't loaded yet, with `lmLoad` (see `setDefaults`). */
  loadModels: boolean
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
  /** LM Studio's `lms` command line, used to load models. Default: `~/.lmstudio/bin/lms(.exe)` when it exists. `null`: use the REST API. */
  lmsPath?: string | null
}

function defaultLmsPath(): string | undefined {
  const p = path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms')
  return existsSync(p) ? p : undefined
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

/** Role aliases (`paid`, `strata`, `lmstudio`) -> `provider/model`, and how LM Studio models are loaded. From config/settings.md. */
export interface ModelDefaults {
  aliases: Record<string, string>
  lmLoad: { parallel: number; context: number; ttlMinutes: number }
}

/** The aliases and LM Studio load settings of a settings.md. */
export function modelDefaultsOf(s: SettingsConfig): ModelDefaults {
  return {
    aliases: { paid: s.default_paid_model, strata: s.default_strata_model, lmstudio: s.default_lmstudio_model },
    lmLoad: { parallel: s.lmstudio_parallel, context: s.lmstudio_context, ttlMinutes: s.lmstudio_ttl_minutes }
  }
}

export class ModelRegistry {
  providers = new Map<string, ProviderInfo>()
  models = new Map<string, ModelInfo>()
  roles: RolesConfig = { kind: 'roles', roles: {} }
  /** `search_order` of providers.md: the ids of the search providers, in the order the researcher tries them. */
  searchOrder: string[] = []
  readonly mock: MockProvider
  /** The slot counts servers reported for `concurrency: auto` providers, kept across config reloads. */
  private serverSlots = new Map<string, number>()
  /** Until settings.md is read: the defaults it has when it says nothing. */
  private defaults: ModelDefaults = modelDefaultsOf(settingsSchema.parse({ kind: 'settings' }))

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
        concurrency: p.concurrency === 'auto' ? (this.serverSlots.get(p.id) ?? 1) : p.concurrency,
        concurrencyAuto: p.concurrency === 'auto',
        rpm: p.rpm,
        discover: p.discover,
        jsonSchema: p.json_schema,
        loadModels: p.load_models,
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
          // a model the engine loads itself gets the context window it loads it with
          context: p.load_models ? Math.min(m.context ?? Infinity, this.defaults.lmLoad.context) : m.context,
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
        jsonSchema: info.jsonSchema,
        loadConfig: info.loadModels ? () => this.defaults.lmLoad : undefined,
        lmsPath: info.loadModels ? (this.opts.lmsPath === null ? undefined : (this.opts.lmsPath ?? defaultLmsPath())) : undefined,
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
        // the context the model is loaded with, unless providers.md says otherwise (a model already loaded counts as it is)
        for (const [id, len] of ctxLen) {
          const m = this.models.get(`${p.id}/${id}`)
          if (m && (m.context === undefined || p.loadModels)) m.context = len
        }
        out.push({ provider: p.id, found: ids.length })
      } catch (err) {
        out.push({ provider: p.id, found: 0, error: (err as Error).message })
      }
    }
    return out
  }

  /**
   * Asks every `concurrency: auto` provider how many requests it serves at once and sets its `concurrency`:
   * Strata reports it as `concurrency.serving` of `GET <base_url>/status`; for LM Studio it is the sum of `parallel`
   * over the loaded chat models (`GET /api/v1/models`, set with `lms load --parallel <n>`).
   * A server that can't be asked counts as 1. Returns the providers whose concurrency changed.
   */
  async syncServerSlots(signal?: AbortSignal): Promise<{ provider: ProviderInfo; from: number; to: number }[]> {
    const changed: { provider: ProviderInfo; from: number; to: number }[] = []
    for (const p of this.providers.values()) {
      if (!p.concurrencyAuto || !p.available || !p.baseUrl) continue
      const base = p.baseUrl.replace(/\/+$/, '')
      const get = async (url: string) => {
        const res = await (this.opts.fetchImpl ?? fetch)(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) })
        return res.ok ? ((await res.json()) as Record<string, unknown>) : null
      }
      let slots = 1
      try {
        const status = await get(`${base}/status`).catch(() => null)
        const n = Number((status?.concurrency as { serving?: unknown } | undefined)?.serving)
        if (Number.isInteger(n) && n >= 1) slots = Math.min(n, 16)
        else {
          // LM Studio: its native API sits next to the OpenAI-compatible /v1
          const lm = await get(`${base.replace(/\/v1$/, '')}/api/v1/models`)
          const models = (lm?.models ?? []) as { type?: string; loaded_instances?: { config?: { parallel?: unknown } }[] }[]
          let sum = 0
          for (const m of models) {
            if (m.type !== 'llm') continue
            for (const i of m.loaded_instances ?? []) {
              const par = Number(i.config?.parallel)
              sum += Number.isInteger(par) && par >= 1 ? par : 1
            }
          }
          if (sum >= 1) slots = Math.min(sum, 16)
        }
      } catch {
        /* the server is down or restarting: one at a time until it answers */
      }
      this.serverSlots.set(p.id, slots)
      if (p.concurrency !== slots) {
        changed.push({ provider: p, from: p.concurrency, to: slots })
        p.concurrency = slots
      }
    }
    return changed
  }

  getModel(ref: string): ModelInfo | undefined {
    return this.models.get(ref)
  }

  /** Sets the role aliases and the LM Studio load settings. Call `load()` after it so model context windows follow. */
  setDefaults(d: ModelDefaults): void {
    this.defaults = d
  }

  /** A `provider/model`, or an alias (`paid`, `strata`, `lmstudio`) resolved to its default. */
  resolve(ref: string): string {
    return ref.includes('/') ? ref : (this.defaults.aliases[ref] ?? ref)
  }

  /** Model refs in the roles file for a role, in order, with aliases resolved. */
  roleModelRefs(role: string): string[] {
    return (this.roles.roles[role]?.models ?? []).map((r) => this.resolve(r))
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
