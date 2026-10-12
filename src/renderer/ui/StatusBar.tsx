import { useMemo } from 'react'
import { sendCommand } from '../api'
import { providerColor, providerLabel, roleShort } from '../store/model'
import { useAgentList, useOffice } from '../store/hooks'
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
          <span className="dot" style={{ background: s.down ? '#e5484d' : providerColor(s.id) }} />
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

export function StatusBar() {
  const agents = useAgentList()
  const connected = useOffice((s) => s.connected)
  const counts = useMemo(() => countStates(agents), [agents])
  const byRole = useMemo(() => countByRole(agents), [agents])
  const byProvider = useMemo(() => countByProvider(agents), [agents])
  return (
    <div className="statusbar" data-testid="statusbar">
      <span className="pill" title={connected ? 'engine connected' : 'waiting for the engine'}>
        <span className="dot" style={{ background: connected ? '#3fb27f' : '#e5484d' }} />
        {connected ? 'engine' : 'offline'}
      </span>
      <Servers />
      <span className="pill" data-testid="count-working">
        <span className="dot" style={{ background: '#6fe39a' }} />
        working <b>{counts.working}</b>
      </span>
      <span className="pill" data-testid="count-waiting">
        <span className="dot" style={{ background: '#f2c14e' }} />
        waiting <b>{counts.waiting}</b>
      </span>
      <span className="pill" data-testid="count-idle">
        <span className="dot" style={{ background: '#8d9bb3' }} />
        idle <b>{counts.idle}</b>
      </span>
      <span className="breakdown" title="working / waiting / idle">
        {Object.entries(byProvider).map(([p, c]) => (
          <span key={p} style={{ color: providerColor(p) }}>
            {providerLabel(p)} {part(c)}
          </span>
        ))}
      </span>
      <span className="breakdown roles" title="working / waiting / idle">
        {Object.entries(byRole).map(([r, c]) => (
          <span key={r}>
            {roleShort(r)} {part(c)}
          </span>
        ))}
      </span>
    </div>
  )
}
