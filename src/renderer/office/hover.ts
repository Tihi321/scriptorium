import { createStore } from 'zustand/vanilla'

export interface HoverState {
  /** Agent under the pointer, with the pointer position inside the office view (CSS px). */
  hover: { id: string; x: number; y: number } | null
  setHover(h: HoverState['hover']): void
}

export const hoverStore = createStore<HoverState>()((set) => ({
  hover: null,
  setHover: (hover) => set({ hover })
}))
