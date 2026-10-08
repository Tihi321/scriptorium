import { Budget } from './budget/spend'
import { ModelRouter } from './models/router'
import { ModelRegistry, computeCost, isPaidModel } from './models/registry'
import { resolveKey, setStoredKey } from './models/keys'
import { initDataFolder, argValue, resolveDataDir } from './store/dataFolder'
import { emptyUsage } from './models/types'
import { BookStore } from './pipeline/books'
import { MemoryService } from './memory/service'
import type { Usage } from './models/types'

const out = (s: string) => process.stdout.write(s + '\n')

/** `engine probe [--model provider/model]`: one short streamed reply, one embedding, a spend row. */
export async function probe(argv: string[]): Promise<number> {
  const dataDir = resolveDataDir({ argv })
  await initDataFolder(dataDir, argValue(argv, 'seed'))
  const registry = new ModelRegistry(dataDir)
  await registry.load()
  const discovered = await registry.discover()
  for (const d of discovered) out(`discovery ${d.provider}: ${d.error ? 'failed (' + d.error + ')' : d.found + ' model(s)'}`)
  const budget = new Budget(dataDir)
  await budget.load()
  const router = new ModelRouter(registry, budget, { retries: 0 })

  let code = 0
  const refs = argValue(argv, 'model') ? [argValue(argv, 'model')!] : ['lmstudio/nvidia/nemotron-3-nano-4b', 'deepseek/deepseek-v4-flash']
  for (const ref of refs) {
    const model = registry.getModel(ref)
    if (!model) {
      out(`\n[${ref}] unknown model (not in config/providers.md and not discovered)`)
      code = 1
      continue
    }
    if (!model.provider.available) {
      out(`\n[${ref}] skipped: ${model.provider.unavailableReason}`)
      if (argValue(argv, 'model')) code = 1
      continue
    }
    out(`\n[${ref}] streaming a short reply...`)
    let usage: Usage = emptyUsage()
    let text = ''
    try {
      for await (const ev of router.chat([model], {
        messages: [{ role: 'user', content: 'Reply with one short sentence about libraries.' }],
        maxTokens: 300,
        meta: { role: 'probe', task: 'probe', agent: 'cli' }
      })) {
        if (ev.type === 'delta') {
          text += ev.text
          process.stdout.write(ev.text)
        } else if (ev.type === 'done') usage = ev.usage
      }
      out(`\n  tokens in/cached/out: ${usage.inputTokens}/${usage.cachedInputTokens}/${usage.outputTokens}, cost ${isPaidModel(model) ? computeCost(model, usage).toFixed(6) : '0 (local)'} USD, ${text.length} chars`)
    } catch (err) {
      out(`\n  failed: ${(err as Error).message}`)
      code = 1
    }
  }

  const emb = registry.embeddingModel()
  if (emb && emb.provider.available) {
    try {
      const v = await registry.embed(['A short test sentence.'], 'query')
      out(`\n[${emb.ref}] embedding dimension: ${v[0]?.length}`)
    } catch (err) {
      out(`\n[${emb.ref}] embedding failed: ${(err as Error).message}`)
      code = 1
    }
  } else {
    out('\nembedding model not available')
  }
  await budget.flush()
  out(`\nspend rows go to ${dataDir}\\logs\\spend\\`)
  return code
}

/** `engine reindex`: deletes nothing, rebuilds index/library.sqlite from the markdown files (new and changed files only). */
export async function reindexLibrary(argv: string[]): Promise<number> {
  const dataDir = resolveDataDir({ argv })
  const registry = new ModelRegistry(dataDir)
  await registry.load()
  const memory = new MemoryService(dataDir, registry)
  if (!memory.available()) {
    out('no embedding model is available (see "embeddings" in config/roles.md and the provider in config/providers.md)')
    return 1
  }
  const r = await memory.reindexAll()
  out(`index/library.sqlite: ${r.indexed} file(s) indexed, ${r.unchanged} unchanged, ${r.removed} removed. ${JSON.stringify(memory.getIndex().stats())}`)
  memory.close()
  return 0
}

/** `engine rebuild-reader`: writes books/<slug>/out/reader/ for every published book. */
export async function rebuildReader(argv: string[]): Promise<number> {
  const dataDir = resolveDataDir({ argv })
  const books = new BookStore(dataDir)
  let n = 0
  for (const slug of await books.slugs()) {
    const b = await books.read(slug)
    if (!b || b.data.stage !== 'published') continue
    const dir = await books.buildReader(slug)
    out(`reader for ${slug}: ${dir}`)
    n++
  }
  out(`${n} reader folder(s) written`)
  return 0
}

/** `engine key-set <ENV_NAME>`: asks for the key without echo and stores it in the Windows credential store. */
export async function keySet(argv: string[]): Promise<number> {
  const name = argv.find((a) => !a.startsWith('-'))
  if (!name || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
    out('Usage: npm run key:set <ENV_NAME>   for example: npm run key:set DEEPSEEK_API_KEY')
    return 2
  }
  if (resolveKey(name) && process.env[name]) out(`Note: ${name} is also set in the environment, which takes priority.`)
  const value = await promptHidden(`Key for ${name} (input is hidden): `)
  if (!value) {
    out('No key entered, nothing stored.')
    return 1
  }
  setStoredKey(name, value)
  out(`Stored ${name} in the Windows credential store (service "scriptorium").`)
  return 0
}

function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    process.stdout.write(prompt)
    if (!stdin.isTTY) {
      let data = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (c) => (data += c))
      stdin.on('end', () => resolve(data.trim()))
      return
    }
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.removeListener('data', onData)
          process.stdout.write('\n')
          return resolve(value.trim())
        }
        if (ch === '\u0003') process.exit(130)
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on('data', onData)
  })
}
