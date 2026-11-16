/**
 * SCP-62 (4b): the ACP proxy (api-acp-proxy) says in `GET /healthz` which of its providers it found used up
 * (`providers.<id>.exhausted_until`, present only while exhausted). Scriptorium reads it to set those models aside before a request fails.
 */

/**
 * GET <origin of baseUrl>/healthz with a 2 s timeout. Returns provider id -> exhausted_until (ISO) for the providers that have one,
 * {} for a proxy with none exhausted, or null when the answer is not the proxy's shape (no `providers` object) or the call fails.
 */
export async function readProxyExhausted(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<Record<string, string> | null> {
  let url: string
  try {
    url = new URL('/healthz', baseUrl).toString()
  } catch {
    return null
  }
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return null
    const body = (await res.json()) as { providers?: unknown }
    const providers = body?.providers
    if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return null
    const out: Record<string, string> = {}
    for (const [id, p] of Object.entries(providers as Record<string, unknown>)) {
      const until = (p as { exhausted_until?: unknown } | null)?.exhausted_until
      if (typeof until === 'string' && !Number.isNaN(Date.parse(until))) out[id] = until
    }
    return out
  } catch {
    return null
  }
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
