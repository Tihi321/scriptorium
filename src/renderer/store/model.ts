/** Pure types and helpers for the renderer state. No DOM, no React, no Phaser, so tests can run in plain Node. */
import type { AgentState, BookSummary } from '../../shared/protocol'

export const AGENT_STATES: readonly AgentState[] = [
  'working',
  'reviewing',
  'waiting-provider',
  'waiting-research',
  'idle',
  'error',
  'paused'
]

export function asAgentState(value: string | undefined): AgentState {
  return (AGENT_STATES as readonly string[]).includes(value ?? '') ? (value as AgentState) : 'idle'
}

export interface AgentView {
  id: string
  name: string
  role: string
  /** What the agent uses now (`provider/model`): the override, else the role default. Updated by job starts and spend events. */
  model: string | null
  /** The agent's own override, or null when the role default applies. */
  override: string | null
  state: AgentState
  paused: boolean
  task?: string
  book?: string
  jobId?: string
  /** When the state or task last changed (ms since epoch), used for "time on task". */
  since: number
}

export interface BookView {
  slug: string
  title: string
  stage: string
  color: string
  updatedAt: number
  /** The full summary from the engine, when it has sent one. */
  summary?: BookSummary
}

export interface HandoverView {
  key: string
  from: string
  to: string
  label: string
  jobId?: string
  startedAt: number
  doneAt?: number
}

export interface SpendView {
  today: number
  month: number
  dailyCap: number
  monthlyCap: number
}

/** The three groups the status bar shows. */
export type StateGroup = 'working' | 'waiting' | 'idle'

export function groupOf(state: AgentState): StateGroup {
  switch (state) {
    case 'working':
    case 'reviewing':
      return 'working'
    case 'waiting-provider':
    case 'waiting-research':
      return 'waiting'
    default:
      return 'idle'
  }
}

export const HANDOVER_FADE_MS = 2500
/** A handover that never gets its `done` event is dropped after this long. */
export const HANDOVER_MAX_MS = 120_000

/** 1 while the handover is active, then fading to 0 over HANDOVER_FADE_MS after it is done. */
export function handoverAlpha(h: HandoverView, now: number): number {
  if (h.doneAt === undefined) return now - h.startedAt > HANDOVER_MAX_MS ? 0 : 1
  return Math.max(0, 1 - (now - h.doneAt) / HANDOVER_FADE_MS)
}

export function budgetPct(spent: number, cap: number): number {
  if (!(cap > 0)) return 0
  return Math.max(0, (spent / cap) * 100)
}

export const BUDGET_WARN_PCT = 80
export function budgetLevel(pct: number): 'ok' | 'warn' | 'over' {
  return pct >= 100 ? 'over' : pct >= BUDGET_WARN_PCT ? 'warn' : 'ok'
}

export function providerOf(model: string | null | undefined): string {
  if (!model) return 'default'
  const i = model.indexOf('/')
  return i > 0 ? model.slice(0, i) : 'default'
}

export function modelNameOf(model: string | null | undefined): string {
  if (!model) return 'role default'
  const i = model.indexOf('/')
  return i > 0 ? model.slice(i + 1) : model
}

const PROVIDER_LABELS: Record<string, string> = { deepseek: 'DeepSeek', lmstudio: 'LM Studio', anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', mock: 'Mock' }
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? (provider === 'default' ? 'default' : provider)
}

/** Colours per provider, as CSS hex strings. */
export const PROVIDER_COLORS: Record<string, string> = {
  deepseek: '#4d7cff',
  lmstudio: '#3fb27f',
  anthropic: '#e8803a',
  openai: '#10a37f',
  gemini: '#a070e8',
  mock: '#9aa0a6',
  default: '#8b93a0'
}
export function providerColor(provider: string): string {
  return PROVIDER_COLORS[provider] ?? '#c0a040'
}

export function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** A stable colour per book slug. */
export function bookColor(slug: string): string {
  return hslToHex(hash(slug) % 360, 0.65, 0.58)
}

export const STAGE_COLUMNS = ['idea', 'outline', 'drafting', 'editing', 'published', 'rejected'] as const
export type StageColumn = (typeof STAGE_COLUMNS)[number] | 'other'

/** Maps whatever stage name the engine uses onto a whiteboard column. */
export function stageColumn(stage: string): StageColumn {
  const s = stage.toLowerCase()
  if (s === 'rejected') return 'rejected'
  if (s.startsWith('publish') || s === 'done' || s === 'complete') return 'published'
  if (s === 'new' || s.startsWith('idea')) return 'idea'
  if (s.startsWith('outline') || s.startsWith('plan') || s.startsWith('bible') || s.startsWith('architect')) return 'outline'
  if (s.startsWith('draft') || s.startsWith('writ')) return 'drafting'
  if (s.startsWith('edit') || s.startsWith('review') || s.startsWith('revis') || s.startsWith('polish') || s.startsWith('rewrite')) return 'editing'
  return 'other'
}

export function titleFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

/** Short role names for the labels under the characters. */
const ROLE_SHORT: Record<string, string> = {
  'editor-in-chief': 'editor in chief',
  'idea-generator': 'ideas',
  'developmental-editor': 'dev editor',
  'line-editor': 'line editor',
  'copy-editor': 'copy editor',
  'beta-reader': 'beta reader',
  'child-safety-reviewer': 'child safety',
  'read-aloud-reviewer': 'read-aloud',
  'continuity-checker': 'continuity',
  'originality-checker': 'originality',
  'fact-checker': 'fact checker'
}
export function roleShort(role: string): string {
  return ROLE_SHORT[role] ?? role.replace(/-/g, ' ')
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function formatUsd(n: number): string {
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`
}
