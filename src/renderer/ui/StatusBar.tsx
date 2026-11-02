import { useMemo } from 'react'
import { sendCommand } from '../api'
import { providerColor, providerLabel } from '../store/model'
import { useAgentList, useOffice } from '../store/hooks'
import { TeamPopover } from './TeamPopover'
import { countByProvider, countByRole, countStates, officeStore, type StateCounts } from '../store/store'

function part(c: StateCounts): string {
  return `${c.working}/${c.waiting}/${c.idle}`
}

/** Strata and LM Studio: on (with how many requests at once) or off, and a button to check again right after starting one. */
function Servers() {
  const servers = useOffice((s) => s.servers)
  const checking = useOffice((s) => s.checkingServers)
  if (servers.length === 0) return null
  const anyDown = servers.some((s) => s.down)
  const check = () => {
    officeStore.getState().setCheckingServers(true)
    sendCommand({ type: 'checkServers' })
  }
  return (
    <>
      {servers.map((s) => (
        <span
          key={s.id}
          className={s.down ? 'pill server off' : 'pill server'}
          data-testid={`server-${s.id}`}
          data-down={s.down}
          title={s.down ? `${providerLabel(s.id)} is not running: its jobs go to the next model in their role` : `${providerLabel(s.id)} runs ${s.slots} request(s) at once`}
        >
          <span className="dot" style={{ background: s.down ? 'var(--rubric)' : providerColor(s.id) }} />
          {providerLabel(s.id)} {s.down ? 'off' : `on ×${s.slots}`}
        </span>
      ))}
      {anyDown && (
        <button className="small" onClick={check} disabled={checking} title="Started Strata or LM Studio? Check now instead of waiting for the next check (every 10 s)" data-testid="servers-check">
          {checking ? 'Checking…' : 'Check now'}
        </button>
      )}
    </>
  )
}

/** The MCP server is listening: shows its port. */
function McpPill() {
  const mcp = useOffice((s) => s.mcp)
  if (!mcp) return null
  const port = new URL(mcp.url).port
  return (
    <span className="pill" data-testid="mcp-status" title={`MCP server: ${mcp.url}`}>
      <span className="dot" style={{ background: 'var(--lapis)' }} />
      MCP :{port}
    </span>
  )
}

export function StatusBar() {
  const agents = useAgentList()
  const connected = useOffice((s) => s.connected)
  const counts = useMemo(() => countStates(agents), [agents])
  const byRole = useMemo(() => countByRole(agents), [agents])
  const byProvider = useMemo(() => countByProvider(agents), [agents])
  return (
    <div className="status-line" data-testid="statusbar">
      <span className="pill" title={connected ? 'engine connected' : 'waiting for the engine'}>
        <span className="dot" style={{ background: connected ? 'var(--verdigris)' : 'var(--rubric)' }} />
        {connected ? 'engine' : 'offline'}
      </span>
      <Servers />
      <McpPill />
      <span className="pill" data-testid="count-working">
        <span className="dot" style={{ background: 'var(--verdigris)' }} />
        working <b>{counts.working}</b>
      </span>
      <span className="pill" data-testid="count-waiting">
        <span className="dot" style={{ background: 'var(--ochre)' }} />
        waiting <b>{counts.waiting}</b>
      </span>
      <span className="pill" data-testid="count-idle">
        <span className="dot" style={{ background: 'var(--vellum-dim)' }} />
        idle <b>{counts.idle}</b>
      </span>
      <span className="breakdown provider-breakdown" title="working / waiting / idle">
        {Object.entries(byProvider).map(([p, c]) => (
          <span key={p} style={{ color: providerColor(p) }}>
            {providerLabel(p)} {part(c)}
          </span>
        ))}
      </span>
      <TeamPopover byRole={byRole} />
    </div>
  )
}
