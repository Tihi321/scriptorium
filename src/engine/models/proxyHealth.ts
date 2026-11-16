/**
 * SCP-62 (4b): the ACP proxy (api-acp-proxy) says in `GET /healthz` which of its providers it found used up
 * (`providers.<id>.exhausted_until`, present only while exhausted). Scriptorium reads it to set those models aside before a request fails.
 */

/** What `/healthz` answered: the proxy's exhausted providers, an answer that is not the proxy's shape, or no answer at all. */
export type ProxyHealth = { kind: 'ok'; exhausted: Record<string, string> } | { kind: 'not-proxy' } | { kind: 'unreachable' }

/**
 * GET <origin of baseUrl>/healthz with a 2 s timeout. `ok` carries provider id -> exhausted_until (ISO) for the providers that have one
 * ({} for a proxy with none exhausted). `not-proxy`: something answered, but not in the proxy's shape (HTML, JSON without a `providers` object,
 * a 4xx). `unreachable`: the call failed (refused, timed out, a 5xx), so the proxy may still be starting or restarting.
 */
export async function readProxyExhausted(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<ProxyHealth> {
  let url: string
  try {
    url = new URL('/healthz', baseUrl).toString()
  } catch {
    return { kind: 'not-proxy' }
  }
  let res: Response
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(2000) })
  } catch {
    return { kind: 'unreachable' }
  }
  if (res.status >= 500) return { kind: 'unreachable' }
  if (!res.ok) return { kind: 'not-proxy' }
  let body: { providers?: unknown }
  try {
    body = (await res.json()) as { providers?: unknown }
  } catch {
    return { kind: 'not-proxy' }
  }
  const providers = body?.providers
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return { kind: 'not-proxy' }
  const exhausted: Record<string, string> = {}
  for (const [id, p] of Object.entries(providers as Record<string, unknown>)) {
    const until = (p as { exhausted_until?: unknown } | null)?.exhausted_until
    if (typeof until === 'string' && !Number.isNaN(Date.parse(until))) exhausted[id] = until
  }
  return { kind: 'ok', exhausted }
}

/** A loopback address: the only place the proxy is looked for. */
export function isLoopbackUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    const h = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '')
    return h === '127.0.0.1' || h === 'localhost' || h === '::1'
  } catch {
    return false
  }
}
