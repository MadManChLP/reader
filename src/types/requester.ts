// Requester Types — mediamaster-server API

export type MediaType = 'anime' | 'serie' | 'movie' | 'youtube' | 'music'
export type YouTubeType = 'individual' | 'playlist' | 'channel'
export type DownloadStatus =
  | 'pending' | 'approved' | 'queued' | 'downloading' | 'retrying'
  | 'complete' | 'partial' | 'error' | 'rejected' | 'cancelled'
  | 'upcoming' | 'not_found'

/** Statuses that are finished — can be deleted from history, never block a new request */
export const FINISHED_STATUSES: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>([
  'complete', 'partial', 'error', 'rejected', 'cancelled', 'not_found',
])
/** Admin can cancel these (POST /api/download/{id}/cancel) */
export const CANCELLABLE_STATUSES: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>([
  'approved', 'queued', 'downloading', 'retrying', 'upcoming',
])
/** Admin can re-run these (POST /api/download/{id}/retry) */
export const RETRYABLE_STATUSES: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>([
  'error', 'partial', 'cancelled', 'rejected', 'not_found',
])

export interface UserInfo {
  username: string
  role: 'admin' | 'user'
  display_name: string
  auth_mode: 'ldap' | 'local'
}

// Search results
export interface AnimeSearchResult {
  title: string
  slug: string
  url: string
  poster_url: string | null
}

export interface MovieSearchResult {
  title: string
  year: string
  /** null for obscure TMDB-only movies */
  imdb_id: string | null
  /** null for OMDb results */
  tmdb_id?: number | null
  poster_url: string | null
  type: string
}

export interface MusicSearchResult {
  name: string
  spotify_url: string | null
  cover_url: string | null
  type: 'artist' | 'album'
  artist: string | null
  year: string | null
}

// Info / metadata
export interface SeasonInfo {
  number: number
  episode_count: number
  lang_keys: number[]
  languages: string[]
}

export interface MediaInfo {
  title: string
  slug: string
  url: string
  poster_url: string | null
  description: string | null
  seasons: SeasonInfo[]
}

// Download request record (from server history)
export interface DownloadRequest {
  id: number
  user_id: string
  typ: string
  title: string | null
  slug: string | null
  url: string | null
  season: number | null
  lang: string | null
  status: DownloadStatus
  requested_at: string
  approved_at: string | null
  completed_at: string | null
  error_message: string | null
  error_stage?: string | null
  retry_count?: number
  next_retry_at?: string | null
  approved_by: string | null
  poster_url?: string | null
}

// WebSocket events
export interface ConnectedEvent {
  type: 'connected'
  username: string
  role: string
}

export interface StatusEvent {
  /** 'queue_update' is the pre-2026-11 name of the same event */
  type: 'status' | 'queue_update'
  request_id: number
  status: DownloadStatus
  title?: string
  error?: string
  next_retry_at?: string
  retry_attempt?: number
  max_retries?: number
}

export interface ProgressEvent {
  type: 'progress'
  request_id: number
  /** movie / YouTube / music jobs */
  pct?: number
  speed?: string | number
  eta?: string
  /**
   * Forum downloads (manga, books/audiobooks from forum threads), one event per
   * item: queued | starting | waiting | downloading | processing | done | failed.
   * Shelfmark book downloads send shelfmark's task state here.
   */
  stage?: string
  /** Volume (or file/part) number */
  volume?: number | string
  item?: number
  items?: number
  message?: string
  mirror?: string
  /** 0–100 (forum / shelfmark) */
  percent?: number
  bytes?: number
  total?: number
  [key: string]: unknown
}

export interface EpisodeUpdateEvent {
  type: 'episode_update'
  request_id: number
  episode: string
  /** starting | downloading | complete | skipped | unavailable | error | cancelled */
  ep_status: string
  /** 0–100 */
  pct?: number
  /** pre-2026-11 servers */
  progress?: number
  speed?: string
  eta?: string
  reason?: string
}

export interface SeasonUpdateEvent {
  type: 'season_update'
  request_id: number
  season: number
  season_status: string
}

export type WsEvent = ConnectedEvent | StatusEvent | ProgressEvent | EpisodeUpdateEvent | SeasonUpdateEvent

// Schedule
export interface ScheduleEntry {
  id: number
  slug: string
  url: string
  typ: 'anime' | 'serie'
  day: number        // 1=Monday … 7=Sunday
  season: number
  lang: string | null
  title: string | null
  poster_url: string | null
  episode_count: number | null
  last_enriched: string | null
  available_episodes?: string | number[] | null
  lang_episode_count?: number | null
  lang_checked_at?: string | null
  last_verified?: string | null
  verify_status?: 'ok' | 'missing' | 'error' | 'unknown' | null
  missing_episodes?: string | number[] | null
  created_at?: string
}

export interface NewScheduleEntry {
  slug: string
  /** optional since 2026-11 (the server derives it from the slug) */
  url?: string
  typ: 'anime' | 'serie'
  day: number
  season: number
  lang?: string
  title?: string
}

// Language key → label mapping
export const LANG_KEY_MAP: Record<number, string> = {
  1: 'German Dub',
  2: 'English Sub',
  3: 'German Sub',
}

export const SERIES_LANG_KEY_MAP: Record<number, string> = {
  1: 'German Dub',
  2: 'English Dub',
}

export const DAY_NAMES: Record<number, string> = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday',
  4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday',
}
