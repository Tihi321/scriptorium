import { useState } from 'react'
import { sendCommand } from '../api'
import { useAgentList, useNow, useOffice } from '../store/hooks'
import { formatDuration, modelNameOf, providerColor, providerLabel, providerOf, roleShort } from '../store/model'
import { officeStore } from '../store/store'
import { KNOWN_ROLES, modelOptions } from './roles'

export function AgentPanel() {
  const id = useOffice((s) => s.selectedAgent)
  const agent = useOffice((s) => (s.selectedAgent ? s.agents[s.selectedAgent] : undefined))
  const book = useOffice((s) => (agent?.book ? s.books[agent.book] : undefined))
  const known = useOffice((s) => s.models)
  const defaults = useOffice((s) => s.roleDefaults)
  const now = useNow(1000)
  if (!id || !agent) return null
  const paused = agent.paused || agent.state === 'paused'
  const provider = providerOf(agent.model)
  const options = modelOptions(known, agent.override)
  const roleDefault = defaults[agent.role]
  return (
    <div className="card" data-testid="agent-panel">
      <h3>
        Agent
        <button onClick={() => officeStore.getState().selectAgent(null)} title="Close" data-testid="agent-close">
          x
        </button>
      </h3>
      <div className="stack">
        <div className="panel-title" data-testid="agent-name">
          {agent.name}
        </div>
        <div className="kv">
          <span>Role</span>
          <span>{roleShort(agent.role)}</span>
          <span>State</span>
          <span data-testid="agent-state">{agent.state}</span>
          <span>Task</span>
          <span>{agent.task ?? 'none'}</span>
          <span>Book</span>
          <span>
            {book ? (
              <>
                <span style={{ color: book.color }}>■</span> {book.title}
              </>
            ) : (
              (agent.book ?? 'none')
            )}
          </span>
          <span>On it</span>
          <span>{formatDuration(now - agent.since)}</span>
          <span>Model</span>
          <span style={{ color: providerColor(provider) }}>
            {providerLabel(provider)} · {modelNameOf(agent.model)}
          </span>
        </div>
        <div className="row">
          <button
            data-testid="agent-pause"
            onClick={() => {
              sendCommand({ type: paused ? 'resume' : 'pause', agent: agent.id })
            }}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button data-testid="agent-stop" onClick={() => sendCommand({ type: 'stop', agent: agent.id })} disabled={!agent.jobId && agent.state === 'idle'}>
            Stop job
          </button>
          <button
            data-testid="agent-fire"
            onClick={() => {
              sendCommand({ type: 'fire', agent: agent.id })
            }}
            title="Finishes the current job, then leaves"
          >
            Fire
          </button>
          <button
            className="danger"
            data-testid="agent-fire-now"
            onClick={() => {
              sendCommand({ type: 'fire', agent: agent.id, now: true })
            }}
            title="Leaves now. Its job goes back to the queue"
          >
            Fire now
          </button>
        </div>
        <label className="stack">
          <span className="dim">Model for this agent (from the next job)</span>
          <select
            data-testid="agent-model"
            value={agent.override ?? ''}
            onChange={(e) => sendCommand({ type: 'setModel', model: e.target.value || null, agent: agent.id })}
          >
            <option value="">{roleDefault ? `Role default (${roleDefault})` : 'Role default'}</option>
            {options.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => officeStore.getState().setTerminal(true, 'agent')}>Open terminal</button>
      </div>
    </div>
  )
}

/** Default model per role: sends `setModel` with `role`. */
export function RoleDefaults() {
  const agents = useAgentList()
  const known = useOffice((s) => s.models)
  const defaults = useOffice((s) => s.roleDefaults)
  const roles = [...new Set([...agents.map((a) => a.role)])]
  const [role, setRole] = useState('')
  const current = role || roles[0] || ''
  const options = modelOptions(known, defaults[current])
  return (
    <details className="card" data-testid="role-defaults">
      <summary className="dim">Role defaults</summary>
      <div className="stack" style={{ marginTop: 6 }}>
        <select value={current} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleShort(r)}
            </option>
          ))}
        </select>
        <select
          data-testid="role-model"
          value={defaults[current] ?? ''}
          onChange={(e) => {
            if (e.target.value && current) sendCommand({ type: 'setModel', model: e.target.value, role: current })
          }}
        >
          {!defaults[current] && (
            <option value="" disabled>
              (pick a model)
            </option>
          )}
          {options.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="dim">Applies from the next job. The engine writes config/roles.md.</span>
      </div>
    </details>
  )
}

export function HireDialog({ onClose }: { onClose(): void }) {
  const agents = useAgentList()
  const known = useOffice((s) => s.models)
  const roles = [...new Set([...KNOWN_ROLES, ...agents.map((a) => a.role)])]
  const [role, setRole] = useState('writer')
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const options = modelOptions(known, null)
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} data-testid="hire-dialog">
        <div className="panel-title">Hire an agent</div>
        <label>Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value)} data-testid="hire-role">
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label>Name (optional)</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="the engine picks one" data-testid="hire-name" />
        <label>Model (optional)</label>
        <select value={model} onChange={(e) => setModel(e.target.value)} data-testid="hire-model">
          <option value="">Role default</option>
          {options.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div className="row spread" style={{ marginTop: 12 }}>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            data-testid="hire-submit"
            onClick={() => {
              sendCommand({ type: 'hire', role, ...(name.trim() ? { name: name.trim() } : {}), ...(model ? { model } : {}) })
              onClose()
            }}
          >
            Hire
          </button>
        </div>
      </div>
    </div>
  )
}
