import { useMemo } from 'react'
import { providerColor, providerLabel, roleShort } from '../store/model'
import { useAgentList, useOffice } from '../store/hooks'
import { countByProvider, countByRole, countStates, type StateCounts } from '../store/store'

function part(c: StateCounts): string {
  return `${c.working}/${c.waiting}/${c.idle}`
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
