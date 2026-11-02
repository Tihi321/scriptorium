import { useEffect, useRef, useState } from 'react'
import { roleShort } from '../store/model'
import type { StateCounts } from '../store/store'

/** The role counters (working/waiting/idle) behind a "Team" button: roles with work first, idle roles dimmed. */
export function TeamPopover({ byRole }: { byRole: Record<string, StateCounts> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const roles = Object.entries(byRole)
  const active = roles.filter(([, c]) => c.working > 0 || c.waiting > 0).sort((a, b) => b[1].working - a[1].working || b[1].waiting - a[1].waiting)
  const quiet = roles.filter(([, c]) => c.working === 0 && c.waiting === 0)
  const working = roles.filter(([, c]) => c.working > 0).length
  const row = ([r, c]: [string, StateCounts], dim: boolean) => (
    <li key={r} className={dim ? 'team-role dim' : 'team-role'} data-testid={`team-role-${r}`}>
      <span>{roleShort(r)}</span>
      <span className="team-counts">
        {c.working}/{c.waiting}/{c.idle}
      </span>
    </li>
  )
  return (
    <span className="team" ref={ref}>
      <button className="ghost team-open" data-testid="team-open" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)} title="Roles: working / waiting / idle">
        Team {working} ▾
      </button>
      {open && (
        <div className="team-popover" data-testid="team-popover" role="dialog" aria-label="Team">
          <ul>
            {active.map((e) => row(e, false))}
            {quiet.map((e) => row(e, true))}
          </ul>
        </div>
      )}
    </span>
  )
}
