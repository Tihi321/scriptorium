import { useEffect, useMemo, useState } from 'react'
import { sendCommand } from '../api'
import { useOffice } from '../store/hooks'
import { officeStore } from '../store/store'

interface Row {
  ref: string
  id: string
  context?: number
  priceIn?: number
  priceOut?: number
  /** In the pickers now. */
  shown: boolean
  /** The engine knows it (providers.md, discovery or picked); otherwise it is only in the provider's list. */
  known: boolean
  source?: 'config' | 'discovered' | 'picked'
  /** It can be ticked: known, local, or listed with a price. */
  pickable: boolean
}

const SOURCE_LABEL = { config: 'providers.md', discovered: 'found', picked: 'picked' } as const

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

function formatPrice(r: Row, local: boolean): string {
  if (local) return 'local'
  if (r.priceIn === undefined || r.priceOut === undefined) return 'no price'
  if (r.priceIn === 0 && r.priceOut === 0) return 'free'
  const f = (x: number) => `$${+x.toPrecision(3)}`
  return `${f(r.priceIn)} / ${f(r.priceOut)}`
}

/** Settings → Choose models: every model a provider has, and which ones the model pickers offer (config/models.md). */
export function ModelsDialog() {
  const open = useOffice((s) => s.modelsOpen)
  const providers = useOffice((s) => s.providers)
  const models = useOffice((s) => s.models)
  const catalogs = useOffice((s) => s.catalogs)
  const [provider, setProvider] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [freeOnly, setFreeOnly] = useState(false)
  const [shownOnly, setShownOnly] = useState(false)

  const current = providers.find((p) => p.id === provider) ?? providers.find((p) => p.available) ?? providers[0]
  const catalog = current ? catalogs[current.id] : undefined
  const detect = (id: string) => {
    officeStore.getState().markCatalogLoading(id)
    sendCommand({ type: 'detectModels', provider: id })
  }
  // a provider that can list its models lists them the first time it is opened here
  useEffect(() => {
    if (open && current?.available && current.canList && !catalogs[current.id]) detect(current.id)
  }, [open, current, catalogs])

  const rows = useMemo<Row[]>(() => {
    if (!current) return []
    const out = new Map<string, Row>()
    for (const m of models) {
      if (m.provider !== current.id) continue
      out.set(m.ref, { ref: m.ref, id: m.model, context: m.context, priceIn: m.priceIn, priceOut: m.priceOut, shown: m.shown !== false, known: true, source: m.source, pickable: true })
    }
    for (const c of catalog?.models ?? []) {
      const known = out.get(c.ref)
      if (known) out.set(c.ref, { ...known, context: known.context ?? c.context })
      else out.set(c.ref, { ref: c.ref, id: c.id, context: c.context, priceIn: c.priceIn, priceOut: c.priceOut, shown: false, known: false, pickable: c.pickable })
    }
    return [...out.values()].sort((a, b) => a.id.localeCompare(b.id))
  }, [current, models, catalog])

  if (!open) return null
  const close = () => officeStore.getState().setModelsOpen(false)
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const visible = rows.filter(
    (r) =>
      words.every((w) => r.id.toLowerCase().includes(w)) &&
      (!freeOnly || current?.local || (r.priceIn === 0 && r.priceOut === 0)) &&
      (!shownOnly || r.shown)
  )
  const toShow = visible.filter((r) => !r.shown && r.pickable).map((r) => r.ref)
  const toHide = visible.filter((r) => r.shown).map((r) => r.ref)
  const local = !!current?.local

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog models" onClick={(e) => e.stopPropagation()} data-testid="models-dialog">
        <div className="panel-title">Models in the pickers</div>
        <div className="dim">Tick the models the model pickers offer. Detect models asks the provider for everything it has. Saved in config/models.md.</div>
        <div className="models-body">
          <div className="models-providers">
            {providers.map((p) => {
              const ofP = models.filter((m) => m.provider === p.id)
              return (
                <button
                  key={p.id}
                  className={p.id === current?.id ? 'primary' : ''}
                  onClick={() => setProvider(p.id)}
                  data-testid={`models-provider-${p.id}`}
                  title={p.available ? undefined : p.reason}
                >
                  <span>{p.id}</span>
                  <span className="dim">{p.available ? `${ofP.filter((m) => m.shown !== false).length} ticked` : shortReason(p.reason)}</span>
                </button>
              )
            })}
          </div>
          {current ? (
            <div className="models-pane">
              <div className="row">
                <input value={filter} placeholder="Filter, e.g. qwen free" onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }} data-testid="models-filter" />
                <button disabled={!current.available || !current.canList || catalog?.loading} onClick={() => detect(current.id)} data-testid="models-detect">
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
                    : !current.canList
                      ? 'This provider can\'t list its models: add them to providers.md'
                      : catalog?.error
                        ? `Could not list: ${catalog.error}`
                        : catalog?.at
                          ? `${catalog.models.length} listed, ${rows.filter((r) => r.shown).length} ticked`
                          : ''}
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
                  <label key={r.ref} className={`model-row${r.pickable ? '' : ' disabled'}`} title={r.pickable ? r.ref : 'No listed price, so the budget could not count it: add it to providers.md with its price'} data-testid={`model-row-${r.ref}`}>
                    <input type="checkbox" checked={r.shown} disabled={!r.pickable} onChange={(e) => sendCommand({ type: 'showModels', refs: [r.ref], shown: e.target.checked })} />
                    <span className="model-id">{r.id}</span>
                    <span className="dim">{formatContext(r.context)}</span>
                    <span className={r.priceIn === 0 && r.priceOut === 0 && !local ? 'free' : 'dim'}>{formatPrice(r, local)}</span>
                    <span className="dim">{r.source ? SOURCE_LABEL[r.source] : ''}</span>
                  </label>
                ))}
                {!visible.length && <div className="dim">{catalog?.loading ? 'Asking the provider...' : 'No models here.'}</div>}
              </div>
              <div className="dim">Prices are USD per 1M tokens in / out, as the provider lists them. A ticked model the engine didn't know is saved with that price, and the budget counts it.</div>
            </div>
          ) : (
            <div className="dim">No model providers in providers.md.</div>
          )}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button onClick={close} data-testid="models-close">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
