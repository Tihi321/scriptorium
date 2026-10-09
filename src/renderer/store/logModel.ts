/** Job log blocks for the terminal: parsed from the markdown log files (history) and built from live events. */

export interface ContextItem {
  name: string
  tokens: number
}

export interface JobLog {
  jobId: string
  agent: string
  book?: string
  /** The task label, for example `draft ch-03`. The job type is its first word. */
  task: string
  requestedBy?: string
  model?: string
  startedAt: number
  finishedAt?: number
  ok?: boolean
  context: ContextItem[]
  output: string
  result?: string
  destination?: string
  error?: string
  calls?: number
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  seconds?: number
  /** True when the block came from a log file and was not seen live. */
  fromHistory?: boolean
}

export const MAX_OUTPUT_CHARS = 120_000
export const MAX_JOBS_PER_KEY = 150

export function jobType(task: string): string {
  return task.split(/\s+/)[0] ?? task
}

export function emptyJob(jobId: string, agent: string, startedAt: number): JobLog {
  return { jobId, agent, task: '', startedAt, context: [], output: '' }
}

export function appendOutput(current: string, text: string): string {
  const next = current + text
  if (next.length <= MAX_OUTPUT_CHARS) return next
  return '[...earlier output trimmed...]\n' + next.slice(next.length - MAX_OUTPUT_CHARS + 40)
}

const BLOCK = /^## (\S+) job `([^`]+)`\s*$/m
const NUMBERS = /(\d+) call\(s\), (\d+) in \((\d+) cached\) \/ (\d+) out tokens, ([\d.]+) USD, ([\d.]+) s/

/** Parses the text of a log file (made by the scheduler's `logAll` calls) into job blocks. */
export function parseLog(markdown: string, fallbackAgent = ''): JobLog[] {
  const jobs: JobLog[] = []
  const parts = markdown.split(/^(?=## \S+ job `)/m)
  for (const part of parts) {
    const head = BLOCK.exec(part)
    if (!head || head.index !== 0) continue
    const [, iso, jobId] = head
    const time = Date.parse(iso ?? '')
    const job = emptyJob(jobId ?? '', fallbackAgent, Number.isNaN(time) ? 0 : time)
    job.fromHistory = true
    const requester = /^- requested by: (.+)$/m.exec(part)
    if (requester) job.requestedBy = requester[1]!.trim()
    const task = /^- task: (\S+)(?: \(role [^)]*\))?(?:, book (\S+?))?(?:, unit (\S+?))?(?:, round \d+)?\s*$/m.exec(part)
    if (task) {
      job.task = task[3] ? `${task[1]} ${task[3]}` : task[1]!
      if (task[2]) job.book = task[2]
    }
    const agent = /^- agent: ([^,]+), first model: ([^,]+),/m.exec(part)
    if (agent) {
      job.agent = agent[1]!.trim()
      job.model = agent[2]!.trim()
    }
    const ctx = /### Context\n([\s\S]*?)(?=\n### |\n*$)/.exec(part)
    if (ctx) {
      for (const line of ctx[1]!.split('\n')) {
        const m = /^- (.+) \((\d+) tokens\)\s*$/.exec(line)
        if (m) job.context.push({ name: m[1]!, tokens: Number(m[2]) })
      }
    }
    const out = /### Output\n([\s\S]*?)(?=\n### Result|$)/.exec(part)
    if (out) job.output = out[1]!.replace(/^\n+/, '').trimEnd()
    const res = /### Result\n([\s\S]*)$/.exec(part)
    if (res) {
      const text = res[1]!.trim()
      job.result = text
      job.finishedAt = job.startedAt
      const nums = NUMBERS.exec(text)
      if (nums) {
        job.calls = Number(nums[1])
        job.tokensIn = Number(nums[2])
        job.tokensOut = Number(nums[4])
        job.costUsd = Number(nums[5])
        job.seconds = Number(nums[6])
      }
      const written = /Written to (\S+?)\.?(?:\s|$)/.exec(text)
      if (written) job.destination = written[1]
      const failed = /^(Failed|Stopped|Blocked)/.test(text)
      job.ok = !failed
      if (failed) job.error = text.split('\n')[0]
    }
    jobs.push(job)
  }
  return jobs
}

/** Live data wins; history fills the gaps (context, requester, numbers) for the same job id. */
export function mergeJobs(history: JobLog[], live: JobLog[]): JobLog[] {
  const byId = new Map<string, JobLog>()
  for (const h of history) byId.set(h.jobId, h)
  for (const l of live) {
    const h = byId.get(l.jobId)
    byId.set(l.jobId, h ? { ...h, ...definedOnly(l), context: l.context.length ? l.context : h.context, output: l.output.length >= h.output.length ? l.output : h.output, fromHistory: false } : l)
  }
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt)
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>
}

/** One job as plain text, for the terminal's copy button and for search. */
export function jobToText(j: JobLog): string {
  const lines = [
    `## ${j.jobId}  ${j.task}`,
    `requested by ${j.requestedBy ?? '?'}${j.book ? ` | book ${j.book}` : ''}${j.model ? ` | ${j.model}` : ''}`
  ]
  if (j.context.length) lines.push('context:', ...j.context.map((c) => `  - ${c.name} (${c.tokens} tokens)`))
  if (j.output) lines.push('output:', j.output)
  if (j.error) lines.push(`error: ${j.error}`)
  else if (j.result) lines.push(`result: ${j.result}`)
  if (j.tokensIn !== undefined || j.costUsd !== undefined) {
    lines.push(`numbers: ${j.tokensIn ?? 0} in / ${j.tokensOut ?? 0} out tokens, ${(j.costUsd ?? 0).toFixed(4)} USD${j.seconds !== undefined ? `, ${j.seconds}s` : ''}`)
  }
  return lines.join('\n')
}
