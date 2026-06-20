/**
 * Simplified HTTP fetch wrapper for Teamflow Agent.
 *
 * This is a placeholder for the full proxy-fetch implementation.
 * The full version from Kun uses `proxy-agent` for HTTP proxy support
 * and provides advanced retry logic.
 *
 * For the initial Teamflow Agent migration, we use native fetch which
 * works in Node.js 18+, Electron, and Tauri. Proxy support will be
 * added in a later phase using Tauri IPC.
 */

export type FetchLike = typeof fetch

export type ProxiedFetchOptions = {
  baseUrl?: string
  fetchImpl?: FetchLike
  proxyUrl?: string
}

export function createProxiedFetch(options: ProxiedFetchOptions = {}): FetchLike {
  const fetchImpl = options.fetchImpl ?? fetch
  // Proxy support is delegated to Tauri in the production build.
  // For local CLI use, environment variables (HTTP_PROXY, HTTPS_PROXY)
  // are picked up by the native fetch implementation.
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchImpl(input, init)
  }
}

export function resolveProxyUrl(): string | undefined {
  if (typeof process === 'undefined') return undefined
  const candidates = [
    process.env.HTTPS_PROXY,
    process.env.HTTP_PROXY,
    process.env.https_proxy,
    process.env.http_proxy
  ]
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) return candidate.trim()
  }
  return undefined
}