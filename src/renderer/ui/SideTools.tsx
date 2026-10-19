import { useState } from 'react'
import { budgetLevel, budgetPct } from '../store/model'
import { useOffice } from '../store/hooks'
import { RoleDefaults } from './AgentPanel'
import { AskResearcher } from './AskResearcher'
import { Budget } from './Budget'
import { StoryForm } from './StoryForm'

type Tool = 'budget' | 'ask' | 'idea' | 'roles'

const KEY = 'scriptorium.sideTool'

function remembered(): Tool | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'budget' || v === 'ask' || v === 'idea' || v === 'roles' ? v : null
  } catch {
    return null
  }
}

/** Budget, Ask researcher, Idea bucket and Role defaults as tabs at the bottom of the sidebar, closed until one is clicked. */
export function SideTools() {
  const [open, setOpen] = useState<Tool | null>(remembered)
  const spend = useOffice((s) => s.spend)
  const toggle = (t: Tool) => {
    const next = open === t ? null : t
    setOpen(next)
    try {
      if (next) localStorage.setItem(KEY, next)
      else localStorage.removeItem(KEY)
    } catch {
      /* no storage: the tab just isn't remembered */
    }
  }
  const pct = spend.dailyCap > 0 ? Math.round(budgetPct(spend.today, spend.dailyCap)) : null
  const tabs: { id: Tool; label: string }[] = [
    { id: 'budget', label: pct === null ? 'Budget' : `Budget ${pct}%` },
    { id: 'ask', label: 'Ask researcher' },
    { id: 'idea', label: 'Ideas' },
    { id: 'roles', label: 'Role defaults' }
  ]
  return (
    <div className="side-tools" data-testid="side-tools">
      {open === 'budget' && <Budget />}
      {open === 'ask' && <AskResearcher />}
      {open === 'idea' && <StoryForm />}
      {open === 'roles' && <RoleDefaults />}
      <div className="side-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={[open === t.id ? 'on' : '', t.id === 'budget' && pct !== null && budgetLevel(pct) !== 'ok' ? budgetLevel(pct) : ''].join(' ').trim()}
            onClick={() => toggle(t.id)}
            data-testid={`tool-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}
