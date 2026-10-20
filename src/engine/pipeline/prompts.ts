import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import type { ChatMessage } from '../models/types'
import type { JobContext } from '../queue/scheduler'

/** Replaces `{{name}}` with the value. A name without a value becomes an empty string. */
export function render(template: string, vars: Record<string, string | number | undefined | null>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, k: string) => {
    const v = vars[k]
    return v === undefined || v === null ? '' : String(v)
  })
}

export interface LoadedPrompt {
  /** The file as it is on disk (hashed into prompt_version). */
  raw: string
  /** The user message template: the file's text after the frontmatter. */
  body: string
}

export async function loadPrompt(dataDir: string, role: string, task: string): Promise<LoadedPrompt> {
  const file = path.join(dataDir, 'prompts', role, `${task}.md`)
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    // a non-fiction or visual novel variant (`<task>_nf`, `<task>_vn`) that a role does not have uses the plain template
    if (/_(nf|vn)$/.test(task)) return loadPrompt(dataDir, role, task.slice(0, -3))
    if (task.endsWith('_article')) return loadPrompt(dataDir, role, task.slice(0, -8))
    throw new Error(`prompt template missing: prompts/${role}/${task}.md`)
  }
  return { raw, body: parseMd(raw, file).body.trim() }
}

export async function loadRules(dataDir: string): Promise<LoadedPrompt> {
  const file = path.join(dataDir, 'prompts', '_rules.md')
  try {
    const raw = await fs.readFile(file, 'utf8')
    return { raw, body: parseMd(raw, file).body.trim() }
  } catch {
    return { raw: '', body: 'Write in English only. Do not imitate living authors or use existing characters or worlds.' }
  }
}

/**
 * One section (`## outline`, `## draft`, `## rewrite`, `## review`) of `prompts/_choices.md`, rendered with `vars`:
 * the extra instructions for a story with choices. Empty when the file or the section is missing.
 */
export async function loadChoicesSection(dataDir: string, section: string, vars: Record<string, string | number | undefined | null> = {}): Promise<string> {
  let body: string
  try {
    const file = path.join(dataDir, 'prompts', '_choices.md')
    body = parseMd(await fs.readFile(file, 'utf8'), file).body
  } catch {
    return ''
  }
  const parts = body.replace(/\r\n/g, '\n').split(/^## +/m)
  const part = parts.find((p) => p.split('\n', 1)[0]!.trim().toLowerCase() === section)
  return part ? render(part.slice(part.indexOf('\n') + 1).trim(), vars) : ''
}

/** Adds a block of extra instructions to the end of the user message. */
export function appendToPrompt(messages: ChatMessage[], text: string): void {
  const last = messages[messages.length - 1]
  if (text && last) last.content += `\n\n${text}`
}

/**
 * Builds the two messages for a task: the system message is the shared rules plus the agent's persona,
 * the user message is the rendered template. Tells the scheduler which template text was used.
 */
export async function buildMessages(
  dataDir: string,
  ctx: JobContext,
  role: string,
  task: string,
  vars: Record<string, string | number | undefined | null>
): Promise<{ messages: ChatMessage[]; version: string }> {
  const [prompt, rules] = await Promise.all([loadPrompt(dataDir, role, task), loadRules(dataDir)])
  const version = ctx.usedTemplate(rules.raw + '\n' + prompt.raw)
  const system = `${rules.body}\n\n## Your persona\n${ctx.agent.persona.trim()}`
  return {
    version,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: render(prompt.body, vars) }
    ]
  }
}
