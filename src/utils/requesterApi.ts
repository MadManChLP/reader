// Requester API — mediamaster-server client

import api from './api'
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
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

async function request(options: Parameters<typeof api.request>[0]) {
  const res = await api.request(options)
  if (res.status === 401) onUnauthorized?.()
  return res
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
  if (!res.success || !res.data?.access_token) return null
  const token: string = res.data.access_token

  const meRes = await api.request({
    method: 'GET',
    url: `${base(serverUrl)}/api/auth/me`,
    headers: authHeader(token),
  })
  if (!meRes.success) return null
  return { token, userInfo: meRes.data as UserInfo }
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
  return res.success && Array.isArray(res.data) ? res.data : []
}

export async function searchSeries(serverUrl: string, token: string, q: string): Promise<AnimeSearchResult[]> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/search/series?q=${encodeURIComponent(q)}`,
    headers: authHeader(token),
  })
  return res.success && Array.isArray(res.data) ? res.data : []
}

export async function searchMovies(serverUrl: string, token: string, q: string): Promise<MovieSearchResult[]> {
  const res = await request({
    method: 'GET',
    url: `${base(serverUrl)}/api/search/movie?q=${encodeURIComponent(q)}`,
    headers: authHeader(token),
  })
  return res.success && Array.isArray(res.data) ? res.data : []
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
  return res.success && Array.isArray(res.data) ? res.data : []
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
  }
): Promise<DownloadRequest | null> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/anime`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data: body,
  })
  return res.success ? (res.data as DownloadRequest) : null
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
  }
): Promise<DownloadRequest | null> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/series`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data: body,
  })
  return res.success ? (res.data as DownloadRequest) : null
}

export async function downloadMovie(
  serverUrl: string,
  token: string,
  imdb_id: string,
  poster_url?: string | null
): Promise<DownloadRequest | null> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/movie`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data: { imdb_id, poster_url: poster_url ?? null },
  })
  return res.success ? (res.data as DownloadRequest) : null
}

export async function downloadYouTube(
  serverUrl: string,
  token: string,
  url: string,
  content_type: 'individual' | 'playlist' | 'channel'
): Promise<DownloadRequest | null> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/youtube`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data: { url, content_type },
  })
  return res.success ? (res.data as DownloadRequest) : null
}

export async function downloadMusic(
  serverUrl: string,
  token: string,
  url: string,
  title?: string
): Promise<DownloadRequest | null> {
  const res = await request({
    method: 'POST',
    url: `${base(serverUrl)}/api/download/music`,
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    data: { url, title: title ?? undefined },
  })
  return res.success ? (res.data as DownloadRequest) : null
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
  return res.success && Array.isArray(res.data) ? res.data : []
}

export async function deleteHistoryEntry(serverUrl: string, token: string, id: number): Promise<boolean> {
  const res = await request({
    method: 'DELETE',
    url: `${base(serverUrl)}/api/download/${id}`,
    headers: authHeader(token),
  })
  return res.success
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

export function buildWebSocketUrl(serverUrl: string, token: string): string {
  const wsBase = serverUrl.replace(/^http/, 'ws').replace(/\/$/, '')
  return `${wsBase}/ws/downloads?token=${encodeURIComponent(token)}`
}
