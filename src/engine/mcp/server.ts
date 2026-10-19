import { promises as fs } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { parseMdWith } from '../../shared/md'
import { mcpSchema } from '../../shared/schemas'
import type { Engine } from '../engine'
import { resolveKey } from '../models/keys'
import { argValue } from '../store/dataFolder'
import { registerTools } from './tools'

export interface McpConfig {
  enabled: boolean
  host: string
  port: number
  tokenEnv: string
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost'])

/** config/mcp.md, then the flags `--mcp`, `--no-mcp` and `--mcp-port <n>` over it. */
export async function loadMcpConfig(dataDir: string, argv: readonly string[], log: (m: string) => void): Promise<McpConfig> {
  let c = mcpSchema.parse({ kind: 'mcp' })
  const file = path.join(dataDir, 'config', 'mcp.md')
  try {
    c = parseMdWith(await fs.readFile(file, 'utf8'), mcpSchema, file).data
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`config/mcp.md: ${(err as Error).message} (using the defaults)`)
  }
  const flagPort = argValue(argv, 'mcp-port')
  const port = flagPort !== undefined ? Number(flagPort) : c.port
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    log(`mcp: bad port "${flagPort}", using ${c.port}`)
  }
  return {
    enabled: argv.includes('--no-mcp') ? false : argv.includes('--mcp') ? true : c.enabled,
    host: c.host,
    port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : c.port,
    tokenEnv: c.token_env
  }
}

export interface McpHandle {
  /** `http://127.0.0.1:<port>/mcp` */
  url: string
  port: number
  close(): Promise<void>
}

export interface McpStartOptions {
  engine: Engine
  config: McpConfig
  log: (m: string) => void
  /** Tests: the bearer token, instead of looking up the secret named in the config. */
  token?: string
}

const json = (res: http.ServerResponse, status: number, message: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

/**
 * Starts the MCP server (Streamable HTTP, no sessions, at /mcp) on a loopback address.
 * Returns null when it could not listen (the port is taken): the factory goes on without it.
 */
export async function startMcpServer(o: McpStartOptions): Promise<McpHandle | null> {
  const { engine, log } = o
  let host = o.config.host
  if (!LOOPBACK.has(host)) {
    log(`mcp: host "${host}" is not a loopback address, using 127.0.0.1 instead (the factory is never offered to the network)`)
    host = '127.0.0.1'
  }
  const token = o.token ?? resolveKey(o.config.tokenEnv)
  let port = o.config.port

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  const allowedOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`])

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err: Error) => {
      log(`mcp: request failed: ${err.message}`)
      if (!res.headersSent) json(res, 500, 'internal error')
      else res.end()
    })
  })

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    // DNS-rebinding protection: only our own address as Host, and no foreign Origin
    if (!allowedHosts().has(String(req.headers.host ?? '').toLowerCase())) return json(res, 403, 'forbidden host')
    const origin = req.headers.origin
    if (origin !== undefined && !allowedOrigins().has(origin.toLowerCase())) return json(res, 403, 'forbidden origin')
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/mcp') return json(res, 404, 'not found')
    if (token && req.headers.authorization !== `Bearer ${token}`) return json(res, 401, 'a bearer token is needed', { 'www-authenticate': 'Bearer' })
    if (req.method !== 'POST') return json(res, 405, 'use POST', { allow: 'POST' })
    // stateless: a fresh MCP server and transport for every request
    const mcp = new McpServer({ name: 'scriptorium', version: '1.0.0' })
    registerTools(mcp, engine)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res)
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.off('error', reject)
        resolve()
      })
    })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const message = code === 'EADDRINUSE' ? `the MCP port ${port} is already in use: the factory runs without MCP (change the port in config/mcp.md or with --mcp-port)` : `the MCP server could not start: ${(err as Error).message}`
    engine.warn(message)
    return null
  }
  port = (server.address() as AddressInfo).port
  const url = `http://${host}:${port}/mcp`
  log(`mcp: listening on ${url}${token ? ' (bearer token needed)' : ' (no token set)'}`)
  return {
    url,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  }
}
