// Requester API — mediamaster-server client

import api from './api'
import { FINISHED_STATUSES } from '../types/requester'
import type {
  UserInfo,
  AnimeSearchResult,
  MovieSearchResult,
  MusicSearchResult,
  MediaInfo,
  DownloadRequest,
  ScheduleEntry,
  NewScheduleEntry,
} from '../types/requester'

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}

function base(serverUrl: string) {
  return serverUrl.replace(/\/$/, '')
}

// The JWT expires server-side (~24h). When any authenticated call comes back
// 401, notify the store so it can silently re-login instead of leaving the UI
// in a "connected but everything fails" state.
/** Re-authenticates and resolves with the new token, or null when that failed. */
let onUnauthorized: (() => Promise<string | null>) | null = null
export function setUnauthorizedHandler(handler: () => Promise<string | null>) {
  onUnauthorized = handler
}

async function request(options: Parameters<typeof api.request>[0]) {
  const res = await api.request(options)
  if (res.status !== 401 || !onUnauthorized) return res
  // Expired token: silently re-login, then retry this call once with the new
  // token — the request that hit the 401 used to fail with "Request failed".
  const newToken = await onUnauthorized()
  if (!newToken) return res
  return api.request({
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${newToken}` },
  })
}

// ── Errors ──────────────────────────────────────────────────────────────────

/** A failed call, carrying the server's FastAPI `detail` when there is one. */
export class RequesterError extends Error {
  status: number
  /** Raw FastAPI `detail` (string, validation list, or an object such as the 409 duplicate info) */
  detail: unknown
  /** Seconds from a 429's Retry-After header, when sent */
  retryAfter?: number
  constructor(message: string, status: number, detail?: unknown, retryAfter?: number) {
    super(message)
    this.name = 'RequesterError'
    this.status = status
    this.detail = detail
    this.retryAfter = retryAfter
  }
}

/** 409 from anime/series downloads: these seasons are already on their way. */
export function duplicateSeasons(e: unknown): number[] | null {
  if (!(e instanceof RequesterError) || e.status !== 409) return null
  const seasons = (e.detail as any)?.seasons
  return Array.isArray(seasons) ? seasons.filter((n: unknown) => typeof n === 'number') : []
}

type ApiResult = Awaited<ReturnType<typeof api.request>>

function describeFailure(res: ApiResult): string {
  const detail = (res.data as any)?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  // Structured detail, e.g. the 409 duplicate: { message, seasons }
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && typeof detail.message === 'string') {
    return detail.message
  }
  // 422 validation errors: [{ loc, msg, type }, …]
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d: any) => d?.msg).filter(Boolean).join('; ') || `HTTP ${res.status}`
  }
  if (res.status === 0 || !res.status) return res.error || 'Server not reachable'
  return res.error || `HTTP ${res.status}`
}

function unwrap<T>(res: ApiResult): T {
  if (!res.success) {
    const headers = (res as any).headers as Record<string, string> | undefined
    const ra = headers && (headers['retry-after'] ?? headers['Retry-After'])
    const retryAfter = ra != null && !Number.isNaN(Number(ra)) ? Number(ra) : undefined
    throw new RequesterError(describeFailure(res), res.status, (res.data as any)?.detail, retryAfter)
  }
  return res.data as T
}

/** User-facing message for anything a requester call threw. */
export function requesterErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof RequesterError) return e.message
  if (e instanceof Error && e.message) return e.message
  return fallback
}

// ── Duplicate detection ─────────────────────────────────────────────────────
// The server accepts the same request twice; the client checks the loaded
// history (plus anything submitted this session) before posting.

const TERMINAL_STATUSES: ReadonlySet<string> = FINISHED_STATUSES
let knownRequests: DownloadRequest[] = []

/** Called whenever the history is (re)loaded. */
export function setKnownRequests(entries: DownloadRequest[]) {
  knownRequests = entries
}

/** Fired on window after a request was submitted (the history reloads). */
export const REQUEST_SUBMITTED_EVENT = 'requester:submitted'

function rememberRequest(req: DownloadRequest | null | undefined) {
  if (req && typeof req === 'object') knownRequests = [req, ...knownRequests.filter(r => r.id !== req.id)]
  window.dispatchEvent(new Event(REQUEST_SUBMITTED_EVENT))
}

/** Record a request created outside this module (upcoming, detail pages). */
export function rememberSubmittedRequest(req: DownloadRequest | null | undefined) {
  rememberRequest(req)
}

/** A still-active (queued/approved/downloading/…) request for the same item. */
export function findActiveRequest(key: string | null | undefined): DownloadRequest | null {
  const k = key?.trim().toLowerCase()
  if (!k) return null
  return knownRequests.find(r =>
    !TERMINAL_STATUSES.has(r.status) &&
    (r.slug?.toLowerCase() === k || r.url?.trim().toLowerCase() === k)
  ) ?? null
}

// ── Admin approval ───────────────────────────────────────────────────────────

/** All requests waiting for approval (admin only). */
export async function getPendingRequests(serverUrl: string, token: string): Promise<DownloadRequest[]> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/admin/requests`,
    headers: authHeader(token),
  })
  return res.success && Array.isArray(res.data) ? res.data : []
}

/** Approve or reject a pending request. Returns an error message on failure. */
export async function decideRequest(
  serverUrl: string,
  token: string,
  id: number,
  decision: 'approve' | 'reject',
): Promise<string | null> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/${id}/${decision}`,
    headers: authHeader(token),
  })
  if (res.success) return null
  const detail = (res.data as any)?.detail
  return typeof detail === 'string' ? detail : (res.error || `HTTP ${res.status}`)
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function login(
  serverUrl: string,
  username: string,
  password: string
): Promise<{ token: string; userInfo: UserInfo } | null> {
  const res = await api.request({
    method: 'POST',
    url: `${base(serverUrl)}/api/auth/login`,
    headers: { 'Content-Type': 'application/json' },
    data: { username, password },
  })
  if (!res.success) {
    // Show why: wrong password, blocked account ("This account is blocked"),
    // or the 10-failures-in-5-min lock (429 + Retry-After)
    try { unwrap<unknown>(res) } catch (e) {
      if (e instanceof RequesterError && e.status === 429) {
        const mins = e.retryAfter ? Math.max(1, Math.ceil(e.retryAfter / 60)) : null
        throw new RequesterError(
          `Too many failed logins${mins ? ` — try again in ${mins} min` : ' — try again later'}`,
          429, e.detail, e.retryAfter)
      }
      if (e instanceof RequesterError && e.status === 401 && !(typeof e.detail === 'string' && e.detail.trim())) {
        throw new RequesterError('Wrong username or password', 401)
      }
      throw e
    }
  }
  if (!res.data?.access_token) return null
  const token: string = res.data.access_token

  const meRes = await api.request({
    method: 'GET',
    url: `${base(serverUrl)}/api/auth/me`,
    headers: authHeader(token),
  })
  if (!meRes.success) return null
  return { token, userInfo: meRes.data as UserInfo }
}

/** Invalidates the token server-side. Best effort: never throws. */
export async function logoutRemote(serverUrl: string, token: string): Promise<void> {
  try {
    await api.request({
      method: 'POST',
      url: `${base(serverUrl)}/api/auth/logout`,
      headers: authHeader(token),
    })
  } catch { /* offline: the token simply expires on its own */ }
}

// Validates a stored token. Distinguishes "token rejected" (needs re-login)
// from "server unreachable" (keep the session, we may just be offline).
export async function getMe(
  serverUrl: string,
  token: string
): Promise<{ userInfo: UserInfo | null; unauthorized: boolean }> {
  try {
    const res = await api.request({
      method: 'GET',
      url: `${base(serverUrl)}/api/auth/me`,
      headers: authHeader(token),
    })
    if (res.success) return { userInfo: res.data as UserInfo, unauthorized: false }
    return { userInfo: null, unauthorized: res.status === 401 || res.status === 403 }
  } catch {
    return { userInfo: null, unauthorized: false }
  }
}

export async function checkHealth(serverUrl: string): Promise<boolean> {
  try {
    const res = await api.request({ method: 'GET', url: `${base(serverUrl)}/api/health` })
    return res.success
  } catch { return false }
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchAnime(serverUrl: string, token: string, q: string): Promise<AnimeSearchResult[]> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/search/anime?q=${encodeURIComponent(q)}`,
    headers: authHeader(token),
  })
  const data = unwrap<unknown>(res)
  return Array.isArray(data) ? data : []
}

export async function searchSeries(serverUrl: string, token: string, q: string): Promise<AnimeSearchResult[]> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/search/series?q=${encodeURIComponent(q)}`,
    headers: authHeader(token),
  })
  const data = unwrap<unknown>(res)
  return Array.isArray(data) ? data : []
}

export async function searchMovies(serverUrl: string, token: string, q: string): Promise<MovieSearchResult[]> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/search/movie?q=${encodeURIComponent(q)}`,
    headers: authHeader(token),
  })
  const data = unwrap<unknown>(res)
  return Array.isArray(data) ? data : []
}

export async function searchMusic(
  serverUrl: string,
  token: string,
  q: string,
  type: 'artist' | 'album',
  limit = 10
): Promise<MusicSearchResult[]> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/search/music?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`,
    headers: authHeader(token),
  })
  const data = unwrap<unknown>(res)
  return Array.isArray(data) ? data : []
}

// Anime/series search results have no posters (the site's search endpoint
// doesn't include covers) — the server exposes this lazy per-slug lookup instead.
export async function fetchPosterUrl(
  serverUrl: string,
  token: string,
  slug: string,
  type: 'anime' | 'serie'
): Promise<string | null> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/search/poster?slug=${encodeURIComponent(slug)}&type=${type}`,
    headers: authHeader(token),
  })
  return res.success ? (res.data?.poster_url ?? null) : null
}

// ── Info / Metadata ──────────────────────────────────────────────────────────

export async function getMediaInfo(
  serverUrl: string,
  token: string,
  slug: string,
  type: 'anime' | 'serie'
): Promise<MediaInfo | null> {
  const endpoint = type === 'anime' ? 'anime' : 'series'
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/info/${endpoint}?slug=${encodeURIComponent(slug)}`,
    headers: authHeader(token),
  })
  return res.success ? (res.data as MediaInfo) : null
}

// ── Downloads ─────────────────────────────────────────────────────────────────

export async function downloadAnime(
  serverUrl: string,
  token: string,
  body: {
    slug: string
    lang_key?: number
    multilang?: boolean
    seasons?: number[] | null
    exclude_episodes?: Record<string, number[]> | null
    poster_url?: string | null
    /** Request even if it duplicates an active request (answers a 409) */
    force?: boolean
  }
): Promise<DownloadRequest> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/anime`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data: body,
  })
  const req = unwrap<DownloadRequest>(res)
  rememberRequest(req)
  return req
}

export async function downloadSeries(
  serverUrl: string,
  token: string,
  body: {
    slug: string
    lang_key?: number
    seasons?: number[] | null
    exclude_episodes?: Record<string, number[]> | null
    poster_url?: string | null
    /** Request even if it duplicates an active request (answers a 409) */
    force?: boolean
  }
): Promise<DownloadRequest> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/series`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data: body,
  })
  const req = unwrap<DownloadRequest>(res)
  rememberRequest(req)
  return req
}

export async function downloadMovie(
  serverUrl: string,
  token: string,
  ids: { imdb_id?: string | null; tmdb_id?: number | null },
  poster_url?: string | null,
  /** Answer a 409 "already requested and still on its way" */
  force = false,
): Promise<DownloadRequest> {
  // Send both IDs when known (TMDB-only movies have no IMDb ID)
  const data: Record<string, unknown> = { poster_url: poster_url ?? null, force }
  if (ids.imdb_id) data.imdb_id = ids.imdb_id
  if (ids.tmdb_id != null) data.tmdb_id = ids.tmdb_id
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/movie`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data,
  })
  const req = unwrap<DownloadRequest>(res)
  rememberRequest(req)
  return req
}

export async function downloadYouTube(
  serverUrl: string,
  token: string,
  url: string,
  content_type: 'individual' | 'playlist' | 'channel'
): Promise<DownloadRequest> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/youtube`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data: { url, content_type },
  })
  const req = unwrap<DownloadRequest>(res)
  rememberRequest(req)
  return req
}

export async function downloadMusic(
  serverUrl: string,
  token: string,
  url: string,
  title?: string
): Promise<DownloadRequest> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/music`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data: { url, title: title ?? undefined },
  })
  const req = unwrap<DownloadRequest>(res)
  rememberRequest(req)
  return req
}

// ── History ───────────────────────────────────────────────────────────────────

export async function getHistory(
  serverUrl: string,
  token: string,
  limit = 50,
  offset = 0
): Promise<DownloadRequest[]> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/download/history?limit=${limit}&offset=${offset}`,
    headers: authHeader(token),
  })
  const data = unwrap<unknown>(res)
  return Array.isArray(data) ? data : []
}

/** Throws RequesterError (400 = still active, 403 = not yours). */
export async function deleteHistoryEntry(serverUrl: string, token: string, id: number): Promise<void> {
  const res = await request({
    method: 'DELETE',
    url: `${base(serverUrl)}/api/download/${id}`,
    headers: authHeader(token),
  })
  unwrap<unknown>(res)
}

// ── Admin request actions ────────────────────────────────────────────────────

/** Cancel an approved/queued/downloading/retrying/upcoming request (admin). */
export async function cancelRequest(serverUrl: string, token: string, id: number, episode?: string): Promise<void> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/${id}/cancel${episode ? `?episode=${encodeURIComponent(episode)}` : ''}`,
    headers: authHeader(token),
  })
  unwrap<unknown>(res)
}

/** Re-run a failed/partial/cancelled/rejected/not_found request (admin). */
export async function retryRequest(serverUrl: string, token: string, id: number): Promise<DownloadRequest> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/${id}/retry`,
    headers: authHeader(token),
  })
  return unwrap<DownloadRequest>(res)
}

export interface RequestErrorDetail {
  request_id: number
  status: string
  message: string | null
  stage: string | null
  traceback: string | null
  retry_count: number
  next_retry_at: string | null
  episode_errors?: Record<string, string>
  season_errors?: Record<string, string>
}

/** Full failure detail (admin only — users get a generic message). */
export async function getRequestError(serverUrl: string, token: string, id: number): Promise<RequestErrorDetail> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/download/${id}/error`,
    headers: authHeader(token),
  })
  return unwrap<RequestErrorDetail>(res)
}

export async function clearHistory(serverUrl: string, token: string): Promise<boolean> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/history/clear`,
    headers: authHeader(token),
  })
  return res.success
}

// ── Admin — Schedule ──────────────────────────────────────────────────────────

export async function getSchedule(serverUrl: string, token: string): Promise<ScheduleEntry[]> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/admin/schedule`,
    headers: authHeader(token),
  })
  return res.success && Array.isArray(res.data) ? res.data : []
}

export async function addScheduleEntry(
  serverUrl: string,
  token: string,
  entry: NewScheduleEntry
): Promise<ScheduleEntry | null> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/admin/schedule`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data: entry,
  })
  return res.success ? (res.data as ScheduleEntry) : null
}

export async function updateScheduleEntry(
  serverUrl: string,
  token: string,
  id: number,
  entry: Partial<NewScheduleEntry>
): Promise<ScheduleEntry | null> {
  const res = await request({
    method: 'PUT',
    url: `${base(serverUrl)}/api/admin/schedule/${id}`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data: entry,
  })
  return res.success ? (res.data as ScheduleEntry) : null
}

export async function deleteScheduleEntry(serverUrl: string, token: string, id: number): Promise<boolean> {
  const res = await request({
    method: 'DELETE',
    url: `${base(serverUrl)}/api/admin/schedule/${id}`,
    headers: authHeader(token),
  })
  return res.success
}

export async function enrichSchedule(
  serverUrl: string,
  token: string
): Promise<{ enriched: number; failed: number } | null> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/admin/schedule/enrich`,
    headers: authHeader(token),
  })
  return res.success ? res.data : null
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function parseYouTubeUrl(url: string): {
  isValid: boolean
  suggestedType?: 'individual' | 'playlist' | 'channel'
} {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('youtube.com') && u.hostname !== 'youtu.be') return { isValid: false }
    if (u.pathname === '/playlist' || u.searchParams.has('list')) return { isValid: true, suggestedType: 'playlist' }
    if (u.pathname.startsWith('/channel/') || u.pathname.startsWith('/c/') || u.pathname.startsWith('/@'))
      return { isValid: true, suggestedType: 'channel' }
    return { isValid: true, suggestedType: 'individual' }
  } catch { return { isValid: false } }
}

/**
 * WebSocket URL — WITHOUT the token: proxies and uvicorn log URLs. API clients
 * authenticate with `wsAuthMessage(token)` as the first message (10 s limit).
 */
export function buildWebSocketUrl(serverUrl: string): string {
  const wsBase = serverUrl.replace(/^http/, 'ws').replace(/\/$/, '')
  return `${wsBase}/ws/downloads`
}

export function wsAuthMessage(token: string): string {
  return JSON.stringify({ type: 'auth', token })
}

/** Close code for an invalid/expired/revoked token. */
export const WS_UNAUTHORIZED = 4001

// ── Generic helpers (used by requesterDiscoverApi / requesterAdminApi) ──────

/** GET a JSON endpoint under the server; throws RequesterError on failure. */
export async function apiGet<T>(serverUrl: string, token: string, path: string): Promise<T> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}${path}`,
    headers: authHeader(token),
  })
  return unwrap<T>(res)
}

/** POST/PUT/PATCH/DELETE with an optional JSON body; throws RequesterError on failure. */
export async function apiSend<T>(
  serverUrl: string,
  token: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await request({
    method,
    url: `${base(serverUrl)}${path}`,
    headers: body === undefined ? authHeader(token) : { ...authHeader(token), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { data: body }),
  })
  return unwrap<T>(res)
}

/** Absolute URL for a server-relative path (e.g. the proxied Jellyfin poster). */
export function serverAbsoluteUrl(serverUrl: string, path: string | null | undefined): string | null {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  return `${base(serverUrl)}${path.startsWith('/') ? '' : '/'}${path}`
}
