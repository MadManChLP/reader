import { api } from './api'

export type ServerStatus = 'online' | 'offline' | 'checking' | 'unknown'

interface CheckOptions {
  timeout?: number      // ms per attempt, default 5000
  retries?: number      // attempts before giving up, default 3
  retryDelay?: number   // ms between retries, default 2000
}

/**
 * Check a single URL for reachability using a race between the request and a timeout.
 * Any HTTP response (including 401/403/redirect) means the server is UP.
 * Only network errors or timeout mean the server is DOWN.
 */
async function checkOnce(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<boolean> {
  // api.request() never rejects — network errors are caught internally and returned as
  // { success: false, status: 0, error: '...' }. So we race with a timeout and then
  // check status > 0 (any real HTTP response has a non-zero status code).
  const requestPromise = api.request({ method: 'GET', url, headers })
  const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs))

  const result = await Promise.race([requestPromise, timeoutPromise])
  // null = timeout, status 0 = network/connection error, status > 0 = server responded
  return result !== null && result.status > 0
}

/**
 * Check server reachability with retry + exponential backoff.
 * Returns true if any attempt succeeds within the configured limits.
 */
export async function checkServer(
  url: string,
  headers: Record<string, string> = {},
  options: CheckOptions = {},
): Promise<boolean> {
  const { timeout = 5000, retries = 3, retryDelay = 2000 } = options
  for (let i = 0; i < retries; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, retryDelay))
    if (await checkOnce(url, headers, timeout)) return true
  }
  return false
}

/**
 * Check the Calibre Sync API server.
 * Hits /health — unauthenticated, no upstream Calibre-Web call, so it's a light
 * liveness probe for the server the client actually talks to. Any HTTP response
 * means the server is running. authHeader is accepted but unused (health is public).
 */
export async function checkCalibreServer(
  apiUrl: string,
  authHeader: Record<string, string> = {},
  options: CheckOptions = {},
): Promise<boolean> {
  if (!apiUrl || !apiUrl.startsWith('http')) return false
  const url = `${apiUrl.replace(/\/$/, '')}/health`
  return checkServer(url, authHeader, options)
}

/**
 * Check a Jellyfin server via its public /System/Info/Public endpoint (no auth needed).
 */
export async function checkJellyfinServer(
  serverUrl: string,
  options: CheckOptions = {},
): Promise<boolean> {
  if (!serverUrl || !serverUrl.startsWith('http')) return false
  const url = `${serverUrl.replace(/\/$/, '')}/System/Info/Public`
  return checkServer(url, {}, options)
}

/**
 * Quick startup check with reduced timeout and fewer retries.
 * Used on app start to quickly determine offline state without hanging the UI.
 */
export async function quickCheck(
  url: string,
  headers: Record<string, string> = {},
): Promise<boolean> {
  return checkServer(url, headers, { timeout: 3000, retries: 2, retryDelay: 1000 })
}
