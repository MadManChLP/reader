// Audiobookshelf REST API client.
// Bearer-token auth with single-flight 401 → refresh → retry-once handling.
// Auth/login itself lives in absAuth.ts — this client only consumes tokens.

import api from './api'
import { normalizeAbsUrl, refreshAbsToken } from './absAuth'
import type {
  AbsLibrary,
  AbsLibraryItem,
  AbsMediaProgress,
  AbsPlaybackSession,
  AbsSearchResult,
  AbsSeries,
  AbsShelf,
  AbsUser,
} from '../types/audiobookshelf'

export class AbsApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'AbsApiError'
  }
  /** true for network-level failures (offline), false for HTTP errors */
  get isNetworkError() {
    return this.status === 0
  }
}

interface AbsApiCallbacks {
  /** Called when a 401 could not be fixed by a token refresh (session expired) */
  onUnauthorized?: () => void
}

// Stable per-install device id (ABS uses it to group playback sessions)
export function getAbsDeviceId(): string {
  let id = localStorage.getItem('abs_device_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('abs_device_id', id)
  }
  return id
}

export class AbsApi {
  readonly serverUrl: string
  private accessToken: string
  private callbacks: AbsApiCallbacks
  private refreshPromise: Promise<string | null> | null = null

  constructor(serverUrl: string, accessToken: string, callbacks: AbsApiCallbacks = {}) {
    this.serverUrl = normalizeAbsUrl(serverUrl)
    this.accessToken = accessToken
    this.callbacks = callbacks
  }

  get token(): string {
    return this.accessToken
  }

  setAccessToken(token: string) {
    this.accessToken = token
  }

  // ─── Core request wrapper ──────────────────────────────────────────────────

  private async rawRequest(method: string, path: string, data?: any) {
    return api.request({
      method,
      url: `${this.serverUrl}${path}`,
      data,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    })
  }

  private async request<T>(method: string, path: string, data?: any): Promise<T> {
    let res = await this.rawRequest(method, path, data)

    if (res.status === 401) {
      // Single-flight: concurrent 401s share one refresh
      if (!this.refreshPromise) {
        this.refreshPromise = refreshAbsToken().finally(() => {
          this.refreshPromise = null
        })
      }
      const newToken = await this.refreshPromise
      if (newToken) {
        this.accessToken = newToken
        res = await this.rawRequest(method, path, data)
      }
      if (res.status === 401) {
        this.callbacks.onUnauthorized?.()
        throw new AbsApiError('Session expired', 401)
      }
    }

    if (!res.success) {
      const detail = typeof res.data === 'string' && res.data ? res.data : res.error || `HTTP ${res.status}`
      throw new AbsApiError(`${method} ${path} failed: ${detail}`, res.status ?? 0)
    }
    return res.data as T
  }

  // ─── User / session ────────────────────────────────────────────────────────

  async getMe(): Promise<AbsUser> {
    return this.request<AbsUser>('GET', '/api/me')
  }

  // ─── Libraries & browsing ──────────────────────────────────────────────────

  async getLibraries(): Promise<AbsLibrary[]> {
    const data = await this.request<{ libraries: AbsLibrary[] }>('GET', '/api/libraries')
    return data.libraries ?? []
  }

  async getLibraryItems(
    libraryId: string,
    options: { limit?: number; page?: number; sort?: string; desc?: boolean; filter?: string } = {},
  ): Promise<{ results: AbsLibraryItem[]; total: number; page: number; limit: number }> {
    const params = new URLSearchParams()
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    if (options.page !== undefined) params.set('page', String(options.page))
    if (options.sort) params.set('sort', options.sort)
    if (options.desc) params.set('desc', '1')
    if (options.filter) params.set('filter', options.filter)
    const qs = params.toString()
    return this.request('GET', `/api/libraries/${libraryId}/items${qs ? `?${qs}` : ''}`)
  }

  /** Personalized home shelves (continue-listening, recently-added, ...) */
  async getPersonalized(libraryId: string, limit = 12): Promise<AbsShelf[]> {
    return this.request<AbsShelf[]>('GET', `/api/libraries/${libraryId}/personalized?limit=${limit}`)
  }

  /** All series of a library (each with its books embedded) */
  async getSeries(
    libraryId: string,
    options: { limit?: number; page?: number; desc?: boolean } = {},
  ): Promise<{ results: AbsSeries[]; total: number; page: number; limit: number }> {
    const params = new URLSearchParams({ sort: 'name' })
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    if (options.page !== undefined) params.set('page', String(options.page))
    if (options.desc) params.set('desc', '1')
    return this.request('GET', `/api/libraries/${libraryId}/series?${params.toString()}`)
  }

  /** Books of one series (filter value is the base64-encoded series id) */
  async getSeriesBooks(libraryId: string, seriesId: string): Promise<AbsLibraryItem[]> {
    const filter = encodeURIComponent(`series.${btoa(seriesId)}`)
    const res = await this.request<{ results: AbsLibraryItem[] }>(
      'GET',
      `/api/libraries/${libraryId}/items?filter=${filter}&limit=500&sort=media.metadata.series.sequence`,
    )
    return res.results ?? []
  }

  async getItem(itemId: string, expanded = true): Promise<AbsLibraryItem> {
    return this.request<AbsLibraryItem>('GET', `/api/items/${itemId}${expanded ? '?expanded=1' : ''}`)
  }

  async search(libraryId: string, query: string, limit = 6): Promise<AbsSearchResult> {
    return this.request<AbsSearchResult>(
      'GET',
      `/api/libraries/${libraryId}/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    )
  }

  // ─── Playback sessions ─────────────────────────────────────────────────────

  /** Start a playback session; returns audio tracks + resume position. */
  async play(itemId: string, episodeId?: string | null): Promise<AbsPlaybackSession> {
    const path = episodeId ? `/api/items/${itemId}/play/${episodeId}` : `/api/items/${itemId}/play`
    return this.request<AbsPlaybackSession>('POST', path, {
      deviceInfo: {
        deviceId: getAbsDeviceId(),
        clientName: 'Reader',
      },
      supportedMimeTypes: [
        'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/ogg', 'audio/webm', 'audio/x-m4b',
      ],
      mediaPlayer: 'html5',
      forceDirectPlay: true,
    })
  }

  async syncSession(sessionId: string, body: { currentTime: number; timeListened: number; duration: number }): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/sync`, body)
  }

  async closeSession(sessionId: string, body?: { currentTime: number; timeListened: number; duration: number }): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/close`, body)
  }

  // ─── Progress (lightweight, session-less — also used by the offline queue) ─

  async getProgress(itemId: string, episodeId?: string | null): Promise<AbsMediaProgress | null> {
    try {
      const path = episodeId ? `/api/me/progress/${itemId}/${episodeId}` : `/api/me/progress/${itemId}`
      return await this.request<AbsMediaProgress>('GET', path)
    } catch (e) {
      // 404 = no progress yet
      if (e instanceof AbsApiError && e.status === 404) return null
      throw e
    }
  }

  async patchProgress(
    itemId: string,
    body: Partial<Pick<AbsMediaProgress, 'currentTime' | 'duration' | 'progress' | 'isFinished'>>,
    episodeId?: string | null,
  ): Promise<void> {
    const path = episodeId ? `/api/me/progress/${itemId}/${episodeId}` : `/api/me/progress/${itemId}`
    await this.request('PATCH', path, body)
  }

  // ─── URL builders (token embedded — always build at render time so a
  //     refreshed token is picked up; never cache these) ─────────────────────

  coverUrl(itemId: string, width = 300): string {
    return `${this.serverUrl}/api/items/${itemId}/cover?token=${this.accessToken}&width=${width}&format=webp`
  }

  /** Absolute stream URL for a session audio track's contentUrl */
  trackUrl(contentUrl: string): string {
    const sep = contentUrl.includes('?') ? '&' : '?'
    return `${this.serverUrl}${contentUrl}${sep}token=${this.accessToken}`
  }

  /** Direct download URL for a single audio file (offline downloads) */
  fileDownloadUrl(itemId: string, fileIno: string): string {
    return `${this.serverUrl}/api/items/${itemId}/file/${fileIno}/download?token=${this.accessToken}`
  }
}
