import { formatDuration, modelNameOf, providerLabel, providerOf, roleShort } from '../store/model'
import { useHover, useNow, useOffice } from '../store/hooks'

export function Tooltip() {
  const hover = useHover((s) => s.hover)
  const agent = useOffice((s) => (hover ? s.agents[hover.id] : undefined))
  const book = useOffice((s) => (agent?.book ? s.books[agent.book] : undefined))
  const now = useNow(1000)
  if (!hover || !agent) return null
  return (
    <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} data-testid="tooltip">
      <b>{agent.name}</b> <span className="dim">{roleShort(agent.role)}</span>
      <div>
        {providerLabel(providerOf(agent.model))} · {modelNameOf(agent.model)}
      </div>
      <div>State: {agent.state}</div>
      <div>Book: {book ? book.title : agent.book ?? 'none'}</div>
      <div>Task: {agent.task ?? 'none'}</div>
      <div>On it for {formatDuration(now - agent.since)}</div>
    </div>
  )
}
