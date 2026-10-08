import { useEffect, useMemo, useState } from 'react'
import { useStore } from 'zustand'
import { hoverStore, type HoverState } from '../office/hover'
import type { AgentView } from './model'
import { officeStore, type OfficeStore } from './store'

export function useOffice<T>(selector: (s: OfficeStore) => T): T {
  return useStore(officeStore, selector)
}

export function useHover<T>(selector: (s: HoverState) => T): T {
  return useStore(hoverStore, selector)
}

/** Re-renders every `ms` milliseconds and returns the current time. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** All agents in office order. */
export function useAgentList(): AgentView[] {
  const agents = useOffice((s) => s.agents)
  const order = useOffice((s) => s.agentOrder)
  return useMemo(() => order.map((id) => agents[id]).filter((a): a is AgentView => !!a), [agents, order])
}
