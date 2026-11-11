import { z } from 'zod'
import type { ZodType } from 'zod'
import { ModelSwitchedError } from '../models/types'
import type { ChatMessage } from '../models/types'
import type { ChatOptions, ChatResult, JobContext } from '../queue/scheduler'

/** Removes reasoning blocks some models put in their answer. */
export function stripThinking(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const close = t.toLowerCase().lastIndexOf('</think>')
  if (close !== -1) t = t.slice(close + 8)
  return t.replace(/^\s+/, '')
}

/** Prose from a model: no reasoning blocks, no code fences around the whole text, trimmed. */
export function cleanProse(text: string): string {
  let t = stripThinking(text).trim()
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(t)
  if (fence) t = fence[1]!.trim()
  return unwrapJsonProse(t)
}

/**
 * Some models answer a plain-text request with a JSON object such as {"chapter": 1, "content": "..."}.
 * When the whole reply is one such object with a long text field, the prose is that field.
 */
export function unwrapJsonProse(t: string): string {
  if (!t.startsWith('{') || !t.endsWith('}')) return t
  try {
    const o: unknown = JSON.parse(t)
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      for (const key of ['content', 'text', 'body', 'chapter_text', 'prose']) {
        const v = (o as Record<string, unknown>)[key]
        if (typeof v === 'string' && v.trim().length >= 200) return v.trim()
      }
    }
  } catch {
    /* not JSON: it is prose that happens to start with a brace */
  }
  return t
}

/** Pulls the first JSON object out of a reply, tolerating fences and chatter around it. */
export function extractJson(text: string): unknown {
  let t = stripThinking(text).trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)
  if (fence) t = fence[1]!.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object in the reply')
  return JSON.parse(t.slice(start, end + 1))
}

export function jsonSchemaOf(schema: ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema) as Record<string, unknown>
  delete js.$schema
  return js
}

export interface JsonResult<T> {
  value: T
  chat: ChatResult
  cost: number
}

/** How often the JSON request may start again from its first message because the model changed during a repair round. */
const MAX_RESTARTS = 2

/**
 * Asks for JSON. Passes the schema to providers that support it. If the reply doesn't parse or validate,
 * asks once more with the error (a repair retry) on the same model, with the schema when the first ask had it.
 * If the model changes during the repair (a model change or a fallback), the request starts again from the original
 * messages on the new model: the new model never gets the old model's reply.
 */
export async function chatJson<T>(
  ctx: JobContext,
  messages: ChatMessage[],
  schema: ZodType<T>,
  opts: { maxTokens?: number; temperature?: number; /** Reshapes the parsed JSON before the schema checks it (see `normalizeReviewJson`). */ normalize?: (raw: unknown) => unknown } = {}
): Promise<JsonResult<T>> {
  const { normalize, ...chatOpts } = opts
  let cost = 0
  const jsonSchema = jsonSchemaOf(schema)
  const ask = async (msgs: ChatMessage[], withSchema: boolean, extra: Pick<ChatOptions, 'sameModel' | 'fromModel'> = {}): Promise<ChatResult> => {
    const r = await ctx.chat({ messages: msgs, schema: withSchema ? jsonSchema : undefined, ...chatOpts, ...extra })
    cost += r.costUsd
    return r
  }
  const tryParse = (text: string): { ok: true; value: T } | { ok: false; error: string } => {
    try {
      const json = extractJson(text)
      const parsed = schema.safeParse(normalize ? normalize(json) : json)
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  let fromModel: string | undefined
  for (let restart = 0; restart <= MAX_RESTARTS; restart++) {
    let reply: ChatResult
    let withSchema = true
    try {
      reply = await ask(messages, true, { fromModel })
    } catch (err) {
      if (ctx.signal.aborted || (err as Error).name === 'AbortError' || (err as Error).name === 'BudgetError' || /token limit/i.test((err as Error).message)) throw err
      withSchema = false
      reply = await ask(messages, false, { fromModel })
    }
    let parsed = tryParse(reply.text)
    if (parsed.ok) return { value: parsed.value, chat: reply, cost }
    const repair: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: stripThinking(reply.text).slice(0, 32_000) },
      {
        role: 'user',
        content: `Your reply could not be used: ${parsed.error}.\nReply again with only one valid JSON object that matches the requested format. Keep everything your first reply said (every finding, quote and fix); change only the format. No explanations, no code fences.`
      }
    ]
    try {
      const second = await ask(repair, withSchema, { sameModel: reply.model.ref })
      parsed = tryParse(second.text)
      if (parsed.ok) return { value: parsed.value, chat: second, cost }
      throw new Error(`the model did not return valid JSON twice: ${parsed.error}`)
    } catch (err) {
      if (!(err instanceof ModelSwitchedError)) throw err
      fromModel = err.model
    }
  }
  throw new Error(`the model did not return valid JSON: the repair round needed another model ${MAX_RESTARTS + 1} times`)
}
