// Requester — Discover, title details, genres, Upcoming, own notifications and
// admin health endpoints (mediamaster-server 2026-11, see reverence/api.md).
// Every call throws RequesterError on failure (detail message included).

import { apiGet, apiSend, rememberSubmittedRequest } from './requesterApi'
import type { DownloadRequest } from '../types/requester'
import type {
  DiscoverRowInfo, DiscoverItem, ShowDetails, MovieDetails, Genre, GenrePage, GenreSort,
  UpcomingRow, UpcomingRequest, UpcomingSettings, NotificationSettings,
  StorageInfo, SourcesInfo, ScheduleVerifyResult,
} from '../types/requesterDiscover'

const q = (v: string | number) => encodeURIComponent(String(v))

// ── Discover ─────────────────────────────────────────────────────────────

export const getDiscoverRows = (s: string, t: string) =>
  apiGet<DiscoverRowInfo[]>(s, t, '/api/discover/rows')

export const getDiscoverRow = (s: string, t: string, rowId: string) =>
  apiGet<DiscoverItem[]>(s, t, `/api/discover/rows/${q(rowId)}`)

export const getShowDetails = (s: string, t: string, kind: 'anime' | 'series', slug: string) =>
  apiGet<ShowDetails>(s, t, `/api/discover/${kind}/${q(slug)}`)

export const getMovieDetails = (s: string, t: string, tmdbId: number) =>
  apiGet<MovieDetails>(s, t, `/api/discover/movie/${q(tmdbId)}`)

export const getGenres = (s: string, t: string) =>
  apiGet<Genre[]>(s, t, '/api/discover/genres')

export function getGenrePage(
  s: string, t: string, id: string,
  opts: { type?: 'anime' | 'series' | 'movie'; sort?: GenreSort; page?: number } = {},
) {
  const params = new URLSearchParams()
  if (opts.type) params.set('type', opts.type)
  if (opts.sort) params.set('sort', opts.sort)
  if (opts.page) params.set('page', String(opts.page))
  const qs = params.toString()
  return apiGet<GenrePage>(s, t, `/api/discover/genre/${q(id)}${qs ? `?${qs}` : ''}`)
}

export const getDiscoverPoster = (s: string, t: string, kind: 'anime' | 'series', slug: string) =>
  apiGet<{ poster_url: string | null }>(s, t, `/api/discover/poster/${kind}/${q(slug)}`)

/** Server path of a proxied Jellyfin poster (needs the Bearer header → AuthenticatedImage). */
export const jellyfinImagePath = (itemId: string) => `/api/discover/jellyfin-image/${q(itemId)}`

/** Per-episode language availability of one season. */
export const getEpisodeLangs = (
  s: string, t: string, slug: string, season: number, langKey: number, typ: 'anime' | 'serie',
) => apiGet<Record<string, boolean>>(
  s, t,
  `/api/info/episode-langs?slug=${q(slug)}&season=${season}&lang_key=${langKey}&typ=${typ}`,
)

// ── Upcoming ─────────────────────────────────────────────────────────────

export const getUpcoming = (s: string, t: string) =>
  apiGet<UpcomingRow[]>(s, t, '/api/upcoming')

export const getUpcomingRequests = (s: string, t: string) =>
  apiGet<UpcomingRequest[]>(s, t, '/api/upcoming/requests')

/** 409 = already requested (send force), 400 = already out / finished airing. */
export async function requestUpcoming(
  s: string, t: string,
  body: { kind: 'movie' | 'anime' | 'series'; id: number; lang_key?: number; force?: boolean },
): Promise<DownloadRequest> {
  const req = await apiSend<DownloadRequest>(s, t, 'POST', '/api/upcoming/request', body)
  rememberSubmittedRequest(req)
  return req
}

export const runUpcomingCheck = (s: string, t: string) =>
  apiSend<{ status: 'started' | 'running' }>(s, t, 'POST', '/api/upcoming/check')

export const checkUpcomingRequest = (s: string, t: string, id: number) =>
  apiSend<{ result: string }>(s, t, 'POST', `/api/upcoming/requests/${id}/check`)

export const saveUpcomingSettings = (s: string, t: string, settings: UpcomingSettings) =>
  apiSend<unknown>(s, t, 'PUT', '/api/upcoming/settings', settings)

// ── Own notifications ────────────────────────────────────────────────────

export const getNotificationSettings = (s: string, t: string) =>
  apiGet<NotificationSettings>(s, t, '/api/me/notifications')

export const saveNotificationSettings = (
  s: string, t: string,
  body: Pick<NotificationSettings, 'discord' | 'webhook_url' | 'events' | 'admin_events'> & { discord_id?: string },
) => apiSend<NotificationSettings>(s, t, 'PUT', '/api/me/notifications', body)

export const testNotifications = (s: string, t: string) =>
  apiSend<{ results: Record<string, string> }>(s, t, 'POST', '/api/me/notifications/test')

// ── Admin: history, schedule extras, storage, sources ────────────────────

export function getAdminHistory(
  s: string, t: string, opts: { limit?: number; offset?: number; status?: string } = {},
) {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 50), offset: String(opts.offset ?? 0) })
  if (opts.status) params.set('status', opts.status)
  return apiGet<DownloadRequest[]>(s, t, `/api/admin/history?${params}`)
}

export const triggerScheduleEntry = (s: string, t: string, id: number) =>
  apiSend<{ queued: boolean; entry_id: number; title: string }>(s, t, 'POST', `/api/admin/schedule/${id}/trigger`)

export const verifySchedule = (s: string, t: string, opts: { autoDownload?: boolean; notify?: boolean } = {}) => {
  const params = new URLSearchParams()
  if (opts.autoDownload !== undefined) params.set('auto_download', String(opts.autoDownload))
  if (opts.notify !== undefined) params.set('notify', String(opts.notify))
  const qs = params.toString()
  return apiSend<ScheduleVerifyResult>(s, t, 'POST', `/api/admin/schedule/verify${qs ? `?${qs}` : ''}`)
}

export const verifyScheduleEntry = (s: string, t: string, id: number) =>
  apiSend<ScheduleVerifyResult>(s, t, 'POST', `/api/admin/schedule/${id}/verify?auto_download=false&notify=false`)

export const downloadMissingForEntry = (s: string, t: string, id: number) =>
  apiSend<{ queued: boolean; request_id?: number; missing?: number[]; note?: string }>(
    s, t, 'POST', `/api/admin/schedule/${id}/download-missing`)

export const getStorage = (s: string, t: string, refresh = true) =>
  apiGet<StorageInfo>(s, t, `/api/admin/storage${refresh ? '' : '?refresh=false'}`)

export const rescanStorage = (s: string, t: string) =>
  apiSend<{ status: 'started' | 'running' }>(s, t, 'POST', '/api/admin/storage/rescan')

export const testStorageTarget = (s: string, t: string, id: string) =>
  apiSend<{ success: boolean; message?: string; space?: [number, number] }>(
    s, t, 'POST', `/api/admin/storage/targets/${q(id)}/test`)

export const getSources = (s: string, t: string) =>
  apiGet<SourcesInfo>(s, t, '/api/admin/sources')

export const runQualityCheck = (s: string, t: string) =>
  apiSend<{ status: 'started' | 'running' }>(s, t, 'POST', '/api/admin/sources/quality/run')

export const runCatalogSync = (s: string, t: string) =>
  apiSend<{ status: 'started' | 'running' }>(s, t, 'POST', '/api/admin/sources/catalog/run')

export const checkQualityMovie = (s: string, t: string, id: number) =>
  apiSend<unknown>(s, t, 'POST', `/api/admin/sources/movies/${id}/check`)
