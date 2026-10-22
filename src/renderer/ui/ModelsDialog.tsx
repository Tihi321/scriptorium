import { useEffect, useMemo, useState } from 'react'
import { sendCommand } from '../api'
import { useOffice } from '../store/hooks'
import { officeStore } from '../store/store'
import type { ModelSummary, ProviderSummary, SettingsSummary } from '../../shared/protocol'

interface Row {
  ref: string
  id: string
  context?: number
  priceIn?: number
  priceOut?: number
  /** In the pickers now. */
  shown: boolean
  source?: 'config' | 'discovered' | 'picked'
  /** It can be ticked: known, local, or listed with a price. */
  pickable: boolean
}

const SOURCE_LABEL = { config: 'providers.md', discovered: 'found', picked: 'added' } as const

type LoadKey = 'lmstudioParallel' | 'lmstudioContext' | 'lmstudioTtlMinutes'
type LimitKey = 'concurrency' | 'rpm' | 'rpd'
/** A provider's limits as typed: empty per minute or per day means no limit. */
type Limits = Record<LimitKey, string>

function limitsOf(p: ProviderSummary): Limits {
  return { concurrency: String(p.concurrency), rpm: p.rpm ? String(p.rpm) : '', rpd: p.rpd ? String(p.rpd) : '' }
}

/** Today's requests against the daily limit, and when it starts again (midnight UTC, in local time). */
function todayText(p: ProviderSummary): string {
  const at = new Date(p.dayResetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (p.dayFull) return `Used up today (${p.requestsToday}${p.rpd ? ` of ${p.rpd}` : ''} requests): jobs use their next model until ${at}`
  return `Today: ${p.requestsToday}${p.rpd ? ` of ${p.rpd}` : ''} requests. The day starts again at ${at} (midnight UTC).`
}

/** The name of a kind on screen: `paid` is every API model, any other kind is its provider's id. */
function kindLabel(kind: string): string {
  return kind === 'paid' ? 'API' : kind
}

/** The kind a fallback row has: the one its model summary says, else from its provider (`paid` for an API provider or an unknown one). */
function rowKind(ref: string, models: ModelSummary[], providers: ProviderSummary[]): string {
  const m = models.find((x) => x.ref === ref)
  if (m) return m.kind
  const p = providers.find((x) => x.id === ref.split('/')[0])
  return p?.local ? p.id : 'paid'
}

/** A short word for why a provider can't be used: its key is missing, or it is switched off. */
function shortReason(reason?: string): string {
  if (reason?.startsWith('no key')) return 'no key'
  if (reason?.startsWith('disabled')) return 'off'
  return 'not available'
}

function formatContext(n?: number): string {
  if (!n) return ''
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`
}

function formatPrice(r: Row, local: boolean, client = false): string {
  if (client) return 'free (Claude Code)'
  if (local) return 'local'
  if (r.priceIn === undefined || r.priceOut === undefined) return 'no price'
  if (r.priceIn === 0 && r.priceOut === 0) return 'free'
  const f = (x: number) => `$${+x.toPrecision(3)}`
  return `${f(r.priceIn)} / ${f(r.priceOut)}`
}

/** Saves one or more of the model settings, keeping the rest as they are. */
function saveModelSettings(settings: SettingsSummary, change: Partial<SettingsSummary>) {
  sendCommand({ type: 'saveSettings', ...settings, ...change })
}

/**
 * The Models panel (top bar → Models): the default models behind the aliases, every model a provider has, which ones the model
 * pickers offer (config/models.md), adding a model by its id, and how LM Studio loads its models.
 */
export function ModelsDialog() {
  const open = useOffice((s) => s.modelsOpen)
  const providers = useOffice((s) => s.providers)
  const models = useOffice((s) => s.models)
  const catalogs = useOffice((s) => s.catalogs)
  const settings = useOffice((s) => s.settings)
  const [provider, setProvider] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [freeOnly, setFreeOnly] = useState(false)
  const [shownOnly, setShownOnly] = useState(false)
  const [add, setAdd] = useState({ id: '', priceIn: '', priceOut: '', context: '' })
  const [load, setLoad] = useState<Pick<SettingsSummary, LoadKey> | null>(null)
  const [limits, setLimits] = useState<{ provider: string; values: Limits } | null>(null)

  // the LM Studio fields are filled once per opening, so a snapshot that arrives while you type doesn't undo it
  useEffect(() => {
    if (!open) setLoad(null)
    else if (settings && !load) setLoad({ lmstudioParallel: settings.lmstudioParallel, lmstudioContext: settings.lmstudioContext, lmstudioTtlMinutes: settings.lmstudioTtlMinutes })
  }, [open, settings, load])

  const current = providers.find((p) => p.id === provider) ?? providers.find((p) => p.available) ?? providers[0]
  const catalog = current ? catalogs[current.id] : undefined
  const local = !!current?.local
  // kind client: an MCP client (Claude Code) answers the requests, so it is local and free, never paid or down
  const client = current?.kind === 'client'

  // today's request counts are fresh when the panel opens
  useEffect(() => {
    if (open) sendCommand({ type: 'snapshot' })
  }, [open])
  // a provider's limit fields are filled when it is opened, so a snapshot that arrives while you type doesn't undo it
  useEffect(() => {
    if (!open || !current) setLimits(null)
    else if (limits?.provider !== current.id) setLimits({ provider: current.id, values: limitsOf(current) })
  }, [open, current, limits])

  const rows = useMemo<Row[]>(() => {
    if (!current) return []
    const out = new Map<string, Row>()
    for (const m of models) {
      if (m.provider !== current.id) continue
      out.set(m.ref, { ref: m.ref, id: m.model, context: m.context, priceIn: m.priceIn, priceOut: m.priceOut, shown: m.shown !== false, source: m.source, pickable: true })
    }
    for (const c of catalog?.models ?? []) {
      const known = out.get(c.ref)
      if (known) out.set(c.ref, { ...known, context: known.context ?? c.context })
      else out.set(c.ref, { ref: c.ref, id: c.id, context: c.context, priceIn: c.priceIn, priceOut: c.priceOut, shown: false, pickable: c.pickable })
    }
    return [...out.values()].sort((a, b) => a.id.localeCompare(b.id))
  }, [current, models, catalog])

  if (!open) return null
  const saveLoad = () => {
    if (!settings || !load) return
    const changed = (Object.keys(load) as LoadKey[]).some((k) => load[k] !== settings[k])
    if (changed) saveModelSettings(settings, load)
  }
  const close = () => {
    saveLoad()
    saveLimits()
    officeStore.getState().setModelsOpen(false)
  }
  const detect = (id: string) => {
    officeStore.getState().markCatalogLoading(id)
    sendCommand({ type: 'detectModels', provider: id })
  }
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const visible = rows.filter(
    (r) => words.every((w) => r.id.toLowerCase().includes(w)) && (!freeOnly || local || (r.priceIn === 0 && r.priceOut === 0)) && (!shownOnly || r.shown)
  )
  const toShow = visible.filter((r) => !r.shown && r.pickable).map((r) => r.ref)
  const toHide = visible.filter((r) => r.shown).map((r) => r.ref)

  const num = (v: string) => (v.trim() === '' ? undefined : Number(v))
  const addPriceOk = local || (num(add.priceIn) !== undefined && num(add.priceIn)! >= 0 && num(add.priceOut) !== undefined && num(add.priceOut)! >= 0)
  const canAdd = !!current && add.id.trim() !== '' && addPriceOk
  const addModel = () => {
    if (!current || !canAdd) return
    sendCommand({ type: 'addModel', provider: current.id, id: add.id.trim(), priceIn: num(add.priceIn), priceOut: num(add.priceOut), context: num(add.context) })
    setAdd({ id: '', priceIn: '', priceOut: '', context: '' })
  }

  // the fallback list: one row per model, kind chosen first; `fallback_shared` makes it the order every role tries
  const shared = settings?.fallbackShared ?? false
  const fallbacks = settings?.fallbacks ?? []
  const save = (next: string[]) => settings && saveModelSettings(settings, { fallbacks: next })
  const move = (i: number, by: number) => {
    const next = [...fallbacks]
    ;[next[i], next[i + by]] = [next[i + by]!, next[i]!]
    save(next)
  }
  const ticked = models.filter((m) => m.shown !== false && m.enabled)
  /** The kinds a row may have: API, local providers, then client providers; only those with a ticked model (and the row's own). */
  const kindsFor = (own: string): string[] => {
    const kinds = ['paid', ...providers.filter((p) => p.local && p.kind !== 'client').map((p) => p.id), ...providers.filter((p) => p.kind === 'client').map((p) => p.id)]
    return kinds.filter((k) => k === own || ticked.some((m) => m.kind === k))
  }
  const kindsOfRows = fallbacks.map((r) => rowKind(r, models, providers))
  const seenKinds = new Map<string, number>()
  /** One fallback row: its place (when shared), the alias it answers to, its kind, its model (a ticked one of that kind), moving and removing. */
  const fallbackRow = (ref: string, i: number) => {
    const kind = kindsOfRows[i]!
    const n = (seenKinds.get(kind) ?? 0) + 1
    seenKinds.set(kind, n)
    const alias = n === 1 ? kind : `${kind}-${n}`
    const refs = ticked.filter((m) => m.kind === kind).map((m) => m.ref)
    if (!refs.includes(ref)) refs.unshift(ref)
    return (
      <div key={i} className="row" style={{ gap: 6 }} data-testid={`fallback-row-${i}`}>
        <span className="dim" style={{ width: 16 }}>{shared ? `${i + 1}.` : ''}</span>
        <span className="dim" style={{ width: 70 }} title={`The name roles.md uses for this row: ${alias}`} data-testid={`fallback-alias-${i}`}>
          {alias}
        </span>
        <select
          value={kind}
          onChange={(e) => {
            const first = ticked.find((m) => m.kind === e.target.value)
            if (first) save(fallbacks.map((r, j) => (j === i ? first.ref : r)))
          }}
          style={{ width: 90 }}
          data-testid={`fallback-kind-${i}`}
        >
          {kindsFor(kind).map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <select value={ref} onChange={(e) => save(fallbacks.map((r, j) => (j === i ? e.target.value : r)))} style={{ flex: 1, minWidth: 0 }} data-testid={`fallback-model-${i}`}>
          {refs.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button disabled={i === 0} onClick={() => move(i, -1)} title="Try this row earlier" data-testid={`fallback-up-${i}`}>
          ↑
        </button>
        <button disabled={i === fallbacks.length - 1} onClick={() => move(i, 1)} title="Try this row later" data-testid={`fallback-down-${i}`}>
          ↓
        </button>
        <button disabled={fallbacks.length <= 1} onClick={() => save(fallbacks.filter((_, j) => j !== i))} title="Remove this row" data-testid={`fallback-remove-${i}`}>
          ×
        </button>
      </div>
    )
  }
  const addRow = () => {
    const first = ticked.find((m) => m.kind === 'paid') ?? ticked[0]
    if (first) save([...fallbacks, first.ref])
  }
  /** Sends the limits that changed: an empty per minute or per day field means no limit (0). */
  const saveLimits = () => {
    if (!current || !limits || limits.provider !== current.id) return
    const was = limitsOf(current)
    const change: { concurrency?: number; rpm?: number; rpd?: number } = {}
    const n = (v: string) => (v.trim() === '' ? 0 : Math.max(0, Math.round(Number(v))))
    if (limits.values.concurrency !== was.concurrency && n(limits.values.concurrency) >= 1) change.concurrency = n(limits.values.concurrency)
    if (limits.values.rpm !== was.rpm && Number.isFinite(n(limits.values.rpm))) change.rpm = n(limits.values.rpm)
    if (limits.values.rpd !== was.rpd && Number.isFinite(n(limits.values.rpd))) change.rpd = n(limits.values.rpd)
    if (Object.keys(change).length) sendCommand({ type: 'setProviderLimits', provider: current.id, ...change })
  }
  const limitField = (label: string, key: LimitKey, title: string) => (
    <div style={{ flex: 1 }} title={title}>
      <label>{label}</label>
      <input
        type="number"
        min={key === 'concurrency' ? 1 : 0}
        value={limits?.values[key] ?? ''}
        placeholder="no limit"
        disabled={key === 'concurrency' && current?.concurrencyAuto}
        onChange={(e) => limits && setLimits({ ...limits, values: { ...limits.values, [key]: e.target.value } })}
        onBlur={saveLimits}
        onKeyDown={(e) => e.key === 'Enter' && saveLimits()}
        data-testid={`limit-${key}`}
      />
    </div>
  )
  const loadField = (label: string, key: LoadKey) => (
    <div style={{ flex: 1 }}>
      <label>{label}</label>
      <input
        type="number"
        value={load?.[key] ?? ''}
        onChange={(e) => load && setLoad({ ...load, [key]: Number(e.target.value) })}
        onBlur={saveLoad}
        data-testid={`set-${key}`}
      />
    </div>
  )

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog models" onClick={(e) => e.stopPropagation()} data-testid="models-dialog">
        <div className="panel-title">Models</div>
        <div className="dim">Fallback models: each row is a kind (API, Strata, LM Studio ...) and its model. roles.md names a kind for its first row (paid, strata, lmstudio ...) and kind-2, kind-3 for the next ones.</div>
        <label className="inline">
          <input type="checkbox" checked={shared} onChange={(e) => settings && saveModelSettings(settings, { fallbackShared: e.target.checked })} data-testid="order-shared" />
          One fallback order for every role
        </label>
        <div className="stack" style={{ gap: 4 }}>
          {fallbacks.map((r, i) => fallbackRow(r, i))}
        </div>
        <div className="row">
          <button onClick={addRow} disabled={ticked.length === 0} data-testid="fallback-add">
            Add a fallback
          </button>
        </div>
        <div className="dim">
          {shared
            ? "Every role tries these top to bottom: the first is the primary, the rest are fallbacks. A role's own model of the same kind (Strata's -low for the checks) takes that row's place. An agent's own model still goes first. Running jobs switch at once."
            : 'Each role keeps the order of its list in roles.md. The rows set what paid, paid-2, strata, lmstudio ... stand for.'}
        </div>
        <hr />
        <div className="dim">Tick the models the pickers offer. Saved in config/models.md.</div>
        <div className="models-body">
          <div className="models-providers">
            {providers.map((p) => (
              <button
                key={p.id}
                className={p.id === current?.id ? 'primary' : ''}
                onClick={() => setProvider(p.id)}
                data-testid={`models-provider-${p.id}`}
                title={p.available ? undefined : p.reason}
              >
                <span>{p.id}</span>
                <span className="dim">{p.available ? `${models.filter((m) => m.provider === p.id && m.shown !== false).length} ticked` : shortReason(p.reason)}</span>
              </button>
            ))}
          </div>
          {current ? (
            <div className="models-pane">
              {!local && (
                <>
                  <div className="row" style={{ gap: 8 }} data-testid="provider-limits">
                    {limitField('Requests at once', 'concurrency', 'How many requests to this provider run at the same time, across every agent')}
                    {limitField('Per minute', 'rpm', 'Requests per minute: more wait for the next minute. Empty: no limit')}
                    {limitField('Per day', 'rpd', "Requests per day, from midnight UTC: after that, jobs use their next model. OpenRouter's free models: 50, or 1000 after buying 10 credits. Empty: no limit")}
                  </div>
                  <div className={current.dayFull ? 'warn' : 'dim'} data-testid="provider-today">
                    {todayText(current)}
                  </div>
                </>
              )}
              <div className="row">
                <input value={filter} placeholder="Filter, e.g. qwen" onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }} data-testid="models-filter" />
                <button
                  disabled={!current.available || !current.canList || catalog?.loading}
                  onClick={() => detect(current.id)}
                  title={current.canList ? `Ask ${current.id} for every model it has` : client ? `${current.id} has the models listed in providers.md` : `${current.id} can't list its models: add them by id below`}
                  data-testid="models-detect"
                >
                  {catalog?.loading ? 'Detecting...' : 'Detect models'}
                </button>
              </div>
              <div className="row" style={{ gap: 12 }}>
                {!local && (
                  <label className="inline">
                    <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} data-testid="models-free" />
                    free only
                  </label>
                )}
                <label className="inline">
                  <input type="checkbox" checked={shownOnly} onChange={(e) => setShownOnly(e.target.checked)} />
                  ticked only
                </label>
                <span className="dim" style={{ marginLeft: 'auto' }} data-testid="models-status">
                  {!current.available
                    ? current.reason?.startsWith('no key')
                      ? 'No key: store it in Settings, under Provider API key'
                      : (current.reason ?? 'not available')
                    : client
                      ? 'Answered by Claude Code over MCP: free. Its models are listed in providers.md'
                      : !current.canList
                      ? "Can't list its models: add them by id below"
                      : catalog?.error
                        ? `Could not list: ${catalog.error}`
                        : catalog?.at
                          ? `${catalog.models.length} listed, ${rows.filter((r) => r.shown).length} ticked`
                          : 'Detect models lists everything it has'}
                </span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button disabled={!toShow.length} onClick={() => sendCommand({ type: 'showModels', refs: toShow, shown: true })} data-testid="models-tick-all">
                  Tick all {toShow.length || ''}
                </button>
                <button disabled={!toHide.length} onClick={() => sendCommand({ type: 'showModels', refs: toHide, shown: false })} data-testid="models-untick-all">
                  Untick all {toHide.length || ''}
                </button>
                <span className="dim">of the ones listed below</span>
              </div>
              <div className="models-list" data-testid="models-list">
                {visible.map((r) => (
                  <label
                    key={r.ref}
                    className={`model-row${r.pickable ? '' : ' disabled'}`}
                    title={r.pickable ? r.ref : 'No listed price, so the budget could not count it: add it by id below with its price'}
                    data-testid={`model-row-${r.ref}`}
                  >
                    <input type="checkbox" checked={r.shown} disabled={!r.pickable} onChange={(e) => sendCommand({ type: 'showModels', refs: [r.ref], shown: e.target.checked })} />
                    <span className="model-id">{r.id}</span>
                    <span className="dim">{formatContext(r.context)}</span>
                    <span className={r.priceIn === 0 && r.priceOut === 0 && !local ? 'free' : 'dim'}>{formatPrice(r, local, client)}</span>
                    <span className="dim">{r.source ? SOURCE_LABEL[r.source] : ''}</span>
                  </label>
                ))}
                {!visible.length && <div className="dim">{catalog?.loading ? 'Asking the provider...' : 'No models here.'}</div>}
              </div>
              <div className="dim">Add a model by its id{local ? '' : ', with its price in USD per 1M tokens (0 and 0 for a free one)'}:</div>
              <div className="row" style={{ gap: 6 }}>
                <input
                  value={add.id}
                  placeholder={current.id === 'openrouter' ? 'e.g. qwen/qwen3-235b-a22b:free' : 'model id'}
                  onChange={(e) => setAdd({ ...add, id: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addModel()}
                  style={{ flex: 3 }}
                  data-testid="models-add-id"
                />
                {!local && (
                  <>
                    <input type="number" min={0} step="any" value={add.priceIn} placeholder="$ in" onChange={(e) => setAdd({ ...add, priceIn: e.target.value })} style={{ flex: 1 }} data-testid="models-add-in" />
                    <input type="number" min={0} step="any" value={add.priceOut} placeholder="$ out" onChange={(e) => setAdd({ ...add, priceOut: e.target.value })} style={{ flex: 1 }} data-testid="models-add-out" />
                  </>
                )}
                <input type="number" min={0} value={add.context} placeholder="context" onChange={(e) => setAdd({ ...add, context: e.target.value })} style={{ flex: 1 }} data-testid="models-add-context" />
                <button disabled={!canAdd} onClick={addModel} data-testid="models-add">
                  Add
                </button>
              </div>
              {current.id === 'lmstudio' && (
                <>
                  <div className="dim" style={{ marginTop: 4 }}>Loading LM Studio models (a model LM Studio has loaded already keeps its own settings)</div>
                  <div className="row" style={{ gap: 8 }}>
                    {loadField('Requests at once', 'lmstudioParallel')}
                    {loadField('Context window', 'lmstudioContext')}
                    {loadField('Unload after idle min', 'lmstudioTtlMinutes')}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="dim">No model providers in providers.md.</div>
          )}
        </div>
        <div className="row spread" style={{ marginTop: 10 }}>
          <span className="dim">Prices are USD per 1M tokens in / out. A model added here is saved with its price, and the budget counts it.</span>
          <button onClick={close} data-testid="models-close">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
