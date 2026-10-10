import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Budget } from '../src/engine/budget/spend'
import { AnthropicClient } from '../src/engine/models/anthropic'
import { GeminiClient } from '../src/engine/models/gemini'
import { deleteStoredKey, getStoredKey, setStoredKey } from '../src/engine/models/keys'
import { MockProvider } from '../src/engine/models/mock'
import { OpenAiCompatClient } from '../src/engine/models/openaiCompat'
import { ModelRegistry, computeCost, isPaidModel } from '../src/engine/models/registry'
import { ModelRouter } from '../src/engine/models/router'
import { BudgetError, collect, ProviderError } from '../src/engine/models/types'
import type { ChatEvent } from '../src/engine/models/types'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { seedDir, writeTestConfig } from './helpers'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-models-'))
  await initDataFolder(dir, seedDir)
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function registryWith(o: Parameters<typeof writeTestConfig>[1], mock = new MockProvider()) {
  await writeTestConfig(dir, o)
  const registry = new ModelRegistry(dir, { mock })
  await registry.load()
  return { registry, mock }
}

describe('seed configs', () => {
  it('providers.md and roles.md load, and every role model exists', async () => {
    const registry = new ModelRegistry(dir, { keys: () => undefined })
    await registry.load()
    expect(registry.providers.get('deepseek')?.available).toBe(false)
    expect(registry.providers.get('deepseek')?.unavailableReason).toMatch(/no key/)
    expect(registry.providers.get('lmstudio')?.available).toBe(true)
    expect(registry.providers.get('ollama')?.available).toBe(false)
    expect(registry.providers.get('strata')).toMatchObject({ available: true, local: true, jsonSchema: false })
    expect(isPaidModel(registry.getModel('strata/qwen3.8-flash-next')!)).toBe(false)
    expect(new ModelRouter(registry, undefined).candidates('line-editor')[0]?.ref).toBe('strata/qwen3.8-flash-next')
    const flash = registry.getModel('deepseek/deepseek-v4-flash')!
    expect(flash).toMatchObject({ priceIn: 0.14, priceOut: 0.28, priceCachedIn: 0.0028, family: 'deepseek' })
    expect(isPaidModel(flash)).toBe(true)
    expect(isPaidModel(registry.getModel('lmstudio/nvidia/nemotron-3-nano-4b')!)).toBe(false)
    for (const refs of Object.values(registry.roles.roles)) for (const ref of refs.models) expect(registry.getModel(ref), ref).toBeTruthy()
    expect(Object.keys(registry.roles.roles)).toHaveLength(16)
    expect(registry.embeddingModel()?.embedding).toBe(true)
  })

  it('a key from the resolver makes a provider available', async () => {
    const registry = new ModelRegistry(dir, { keys: (n) => (n === 'DEEPSEEK_API_KEY' ? 'k' : undefined) })
    await registry.load()
    expect(registry.providers.get('deepseek')?.available).toBe(true)
  })
})

describe('price math', () => {
  it('bills cached input at its own price', () => {
    const m = { priceIn: 0.14, priceOut: 0.28, priceCachedIn: 0.0028 }
    // 800k uncached, 200k cached, 100k output
    const cost = computeCost(m, { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000 })
    expect(cost).toBeCloseTo(0.8 * 0.14 + 0.2 * 0.0028 + 0.1 * 0.28, 9)
  })
})

describe('router', () => {
  it('orders candidates: agent override, then role list, deduplicated', async () => {
    const { registry } = await registryWith({
      providers: [{ id: 'a', models: ['x', 'y'] }, { id: 'b', local: true, models: ['z'] }],
      roles: { writer: ['a/x', 'b/z', 'a/x'] }
    })
    const r = new ModelRouter(registry, undefined)
    expect(r.candidates('writer').map((m) => m.ref)).toEqual(['a/x', 'b/z'])
    expect(r.candidates('writer', { agentModel: 'a/y' }).map((m) => m.ref)).toEqual(['a/y', 'a/x', 'b/z'])
    expect(r.candidates('unknown-role')).toEqual([])
  })

  it('avoids the writer family for reviewers', async () => {
    const { registry } = await registryWith({
      providers: [{ id: 'ds', family: 'deepseek', models: ['f'] }, { id: 'qw', family: 'qwen', models: ['q'] }],
      roles: { 'line-editor': ['ds/f', 'qw/q'] }
    })
    const r = new ModelRouter(registry, undefined)
    expect(r.candidates('line-editor', { avoidFamily: 'deepseek' }).map((m) => m.ref)).toEqual(['qw/q', 'ds/f'])
    expect(r.candidates('line-editor', { avoidFamily: 'nothing' }).map((m) => m.ref)).toEqual(['ds/f', 'qw/q'])
  })

  it('retries a retryable error, then falls back to the next model in order', async () => {
    const { registry, mock } = await registryWith({
      providers: [{ id: 'a', models: ['x'] }, { id: 'b', models: ['y'] }, { id: 'c', models: ['z'] }],
      roles: { writer: ['a/x', 'b/y', 'c/z'] }
    })
    const seen: string[] = []
    mock.onAny((req) => {
      seen.push(req.model)
      if (req.model === 'x') throw new ProviderError('rate limited', 429, true)
      if (req.model === 'y') throw new ProviderError('bad request', 400, false)
      return 'from z'
    })
    const r = new ModelRouter(registry, undefined, { retries: 1, backoffMs: 1 })
    const events: string[] = []
    let text = ''
    for await (const ev of r.chat(r.candidates('writer'), { messages: [{ role: 'user', content: 'hi' }], meta: { role: 'writer' } })) {
      events.push(ev.type === 'attempt' ? `attempt:${ev.model.ref}` : ev.type)
      if (ev.type === 'delta') text += ev.text
    }
    expect(seen).toEqual(['x', 'x', 'y', 'z']) // x twice (one retry), y once (not retryable), then z
    expect(text).toBe('from z')
    expect(events.filter((e) => e.startsWith('attempt'))).toEqual(['attempt:a/x', 'attempt:a/x', 'attempt:b/y', 'attempt:c/z'])
  })

  it('refuses paid models over the cap and falls to a local one; throws BudgetError when nothing is left', async () => {
    const { registry, mock } = await registryWith({
      providers: [{ id: 'paid', price: 1000, models: ['p'] }, { id: 'loc', local: true, models: ['l'] }],
      roles: { writer: ['paid/p', 'loc/l'], solo: ['paid/p'] },
      caps: { daily: 0.5 }
    })
    mock.onAny('ok')
    const budget = new Budget(dir)
    await budget.load()
    const r = new ModelRouter(registry, budget)
    const run = async (role: string) => {
      const used: string[] = []
      for await (const ev of r.chat(r.candidates(role), { messages: [{ role: 'user', content: 'x'.repeat(40) }], meta: { role } })) {
        if (ev.type === 'done') used.push(ev.model.ref)
      }
      return used
    }
    expect(await run('writer')).toEqual(['loc/l']) // paid estimate is about 4 USD, over the 0.5 cap
    await expect(run('solo')).rejects.toBeInstanceOf(BudgetError)
    // the local call was recorded with cost 0
    expect(budget.spentToday()).toBe(0)
  })

  it('holds a provider slot while the stream runs (concurrency)', async () => {
    const { registry, mock } = await registryWith({ providers: [{ id: 'loc', local: true, concurrency: 1, models: ['m'] }], roles: { writer: ['loc/m'] } })
    mock.onAny({ text: 'abcdefgh', chunkDelayMs: 30, chunks: 4 })
    const r = new ModelRouter(registry, undefined)
    let active = 0
    let max = 0
    const one = async () => {
      for await (const ev of r.chat(r.candidates('writer'), { messages: [{ role: 'user', content: 'x' }], meta: { role: 'writer' } })) {
        if (ev.type === 'attempt') max = Math.max(max, ++active)
        if (ev.type === 'done') active--
      }
    }
    await Promise.all([one(), one(), one()])
    expect(max).toBe(1)
  })
})

describe('mock provider', () => {
  it('streams in chunks, reports usage, matches rules by role and task, and honours abort', async () => {
    const mock = new MockProvider('mock', { chunkDelayMs: 2 })
    mock.on({ role: 'writer', task: 'draft' }, 'scripted draft')
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hello' }] }
    const a = await collect(mock.chat({ ...req, meta: { role: 'writer', task: 'draft' } }))
    expect(a.text).toBe('scripted draft')
    expect(a.usage.outputTokens).toBeGreaterThan(0)
    const b = await collect(mock.chat({ ...req, meta: { role: 'writer', task: 'other' } }))
    expect(b.text).toMatch(/^Mock reply for writer \/ other/)

    const ac = new AbortController()
    mock.onAny({ text: 'x'.repeat(100), chunkDelayMs: 20, chunks: 10 })
    const seen: ChatEvent[] = []
    const p = (async () => {
      for await (const ev of mock.chat({ ...req, signal: ac.signal })) seen.push(ev)
    })()
    setTimeout(() => ac.abort(), 50)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen.length).toBeLessThan(10)
  })
})

describe('HTTP clients against fake servers', () => {
  let server: Server
  let base: string
  let lastBody: Record<string, unknown> = {}
  let lastHeaders: Record<string, unknown> = {}
  let handler: (url: string, res: import('node:http').ServerResponse) => void = () => undefined

  beforeEach(async () => {
    server = createServer((req, res) => {
      let data = ''
      req.on('data', (c) => (data += c))
      req.on('end', () => {
        lastBody = data ? (JSON.parse(data) as Record<string, unknown>) : {}
        lastHeaders = req.headers
        handler(req.url ?? '', res)
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterEach(async () => {
    await new Promise((r) => server.close(r))
  })

  const sse = (res: import('node:http').ServerResponse, lines: string[]) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const l of lines) res.write(l)
    res.end()
  }

  it('OpenAI-compatible: streams text, asks for usage, reads cached tokens, sends extra_body and the key', async () => {
    handler = (_u, res) =>
      sse(res, [
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":7,"prompt_cache_hit_tokens":60}}\n\n',
        'data: [DONE]\n\n'
      ])
    const c = new OpenAiCompatClient({ id: 'x', baseUrl: base + '/v1', apiKey: 'sk-test' })
    const r = await collect(c.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], extraBody: { thinking: false }, maxTokens: 50 }))
    expect(r.text).toBe('Hello')
    expect(r.usage).toEqual({ inputTokens: 100, cachedInputTokens: 60, outputTokens: 7 })
    expect(lastBody).toMatchObject({ model: 'm', stream: true, stream_options: { include_usage: true }, thinking: false, max_tokens: 50 })
    expect(lastHeaders.authorization).toBe('Bearer sk-test')
  })

  it('OpenAI-compatible: sends the JSON schema as response_format unless jsonSchema is false; reasoning_content is not text', async () => {
    handler = (_u, res) =>
      sse(res, [
        'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"{}"}}]}\n\n',
        'data: [DONE]\n\n'
      ])
    const schema = { type: 'object' }
    const messages = [{ role: 'user' as const, content: 'hi' }]
    const on = new OpenAiCompatClient({ id: 'x', baseUrl: base + '/v1' })
    await collect(on.chat({ model: 'm', messages, schema }))
    expect(lastBody.response_format).toMatchObject({ type: 'json_schema', json_schema: { schema } })
    const off = new OpenAiCompatClient({ id: 'x', baseUrl: base + '/v1', jsonSchema: false })
    const r = await collect(off.chat({ model: 'm', messages, schema }))
    expect(lastBody).not.toHaveProperty('response_format')
    expect(r.text).toBe('{}')
  })

  it('OpenAI-compatible: 429 becomes a retryable error, 400 does not; embeddings and model list work', async () => {
    const c = new OpenAiCompatClient({ id: 'x', baseUrl: base + '/v1' })
    handler = (_u, res) => {
      res.writeHead(429, { 'retry-after': '2' })
      res.end('slow down')
    }
    await expect(collect(c.chat({ model: 'm', messages: [] }))).rejects.toMatchObject({ status: 429, retryable: true, retryAfterMs: 2000 })
    handler = (_u, res) => {
      res.writeHead(400)
      res.end('bad')
    }
    await expect(collect(c.chat({ model: 'm', messages: [] }))).rejects.toMatchObject({ status: 400, retryable: false })
    handler = (u, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(u.endsWith('/models') ? '{"data":[{"id":"a"},{"id":"b"}]}' : '{"data":[{"index":1,"embedding":[3,4]},{"index":0,"embedding":[1,2]}]}')
    }
    expect(await c.listModels()).toEqual(['a', 'b'])
    expect(await c.embed('e', ['x', 'y'])).toEqual([[1, 2], [3, 4]])
  })

  it('OpenAI-compatible: stopping at the token limit without any text is a clear error; reads LM Studio loaded context', async () => {
    handler = (_u, res) =>
      sse(res, [
        'data: {"choices":[{"delta":{"reasoning_content":"thinking..."},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":6560,"completion_tokens":1631}}\n\n',
        'data: [DONE]\n\n'
      ])
    const c = new OpenAiCompatClient({ id: 'x', baseUrl: base + '/v1' })
    await expect(collect(c.chat({ model: 'm', messages: [] }))).rejects.toThrow(/stopped at its token limit without an answer \(6560 tokens in, 1631 out\).*context window/)
    handler = (_u, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"data":[{"id":"a","loaded_context_length":32768},{"id":"b","state":"not-loaded"}]}')
    }
    expect([...(await c.contextLengths()).entries()]).toEqual([['a', 32768]])
  })

  it('OpenAI-compatible: nomic prefixes', async () => {
    handler = (_u, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"data":[{"index":0,"embedding":[1]}]}')
    }
    const c = new OpenAiCompatClient({ id: 'x', baseUrl: base, embedPrefixes: { document: 'search_document: ', query: 'search_query: ' } })
    await c.embedWithPrefix('nomic', ['hello'], 'query')
    expect(lastBody.input).toEqual(['search_query: hello'])
  })

  it('Anthropic: reads text deltas and usage including cache reads', async () => {
    handler = (_u, res) =>
      sse(res, [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":90,"output_tokens":1}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":12}}\n\n'
      ])
    const c = new AnthropicClient({ id: 'a', baseUrl: base, apiKey: 'k' })
    const r = await collect(c.chat({ model: 'claude', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }] }))
    expect(r.text).toBe('Hi there')
    expect(r.usage).toEqual({ inputTokens: 100, cachedInputTokens: 90, outputTokens: 12 })
    expect(lastBody).toMatchObject({ system: 'sys', stream: true, messages: [{ role: 'user', content: 'hi' }] })
    expect(lastHeaders['x-api-key']).toBe('k')
  })

  it('Gemini: reads parts and usage metadata (thinking counts as output)', async () => {
    handler = (u, res) => {
      expect(u).toContain('/v1beta/models/gem:streamGenerateContent?alt=sse')
      sse(res, [
        'data: {"candidates":[{"content":{"parts":[{"text":"One "}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"two"}]}}],"usageMetadata":{"promptTokenCount":50,"candidatesTokenCount":5,"thoughtsTokenCount":20,"cachedContentTokenCount":10}}\n\n'
      ])
    }
    const c = new GeminiClient({ id: 'g', baseUrl: base, apiKey: 'k' })
    const r = await collect(c.chat({ model: 'gem', messages: [{ role: 'user', content: 'hi' }] }))
    expect(r.text).toBe('One two')
    expect(r.usage).toEqual({ inputTokens: 50, cachedInputTokens: 10, outputTokens: 25 })
    expect(lastHeaders['x-goog-api-key']).toBe('k')
  })
})

describe('credential store', () => {
  it('stores, reads and deletes a key (throwaway account)', async () => {
    const account = `SCRIPTORIUM_TEST_${process.pid}_${Date.now()}`
    const service = 'scriptorium-test'
    try {
      expect(getStoredKey(account, service)).toBeUndefined()
      setStoredKey(account, 'secret-value-123', service)
      expect(getStoredKey(account, service)).toBe('secret-value-123')
      expect(deleteStoredKey(account, service)).toBe(true)
      // Windows can show a deleted credential for a moment (its own cache): wait up to two seconds for it to disappear
      for (let i = 0; i < 40 && getStoredKey(account, service) !== undefined; i++) await new Promise((r) => setTimeout(r, 50))
      expect(getStoredKey(account, service)).toBeUndefined()
    } finally {
      deleteStoredKey(account, service)
    }
  })
})
