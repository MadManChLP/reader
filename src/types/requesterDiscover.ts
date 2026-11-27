// Requester Discover / Upcoming / notifications / admin-health types
// (mediamaster-server API, 2026-11 — see reverence/api.md)

/** Per-title request state the server attaches to discover items */
export type TitleStatus =
  | 'available' | 'processing' | 'pending' | 'downloaded'
  | 'failed' | 'rejected' | 'upcoming'
  | null

export type DiscoverKind = 'anime' | 'series' | 'movie' | 'jellyfin'

export interface DiscoverRowInfo {
  id: string
  title: string
}

export interface DiscoverItem {
  kind: DiscoverKind
  title: string
  subtitle?: string | null
  poster_url?: string | null
  backdrop_url?: string | null
  status?: TitleStatus
  /** anime / series */
  slug?: string
  /** movie */
  tmdb_id?: number
  imdb_id?: string | null
  year?: string | number | null
  overview?: string | null
  rating?: number | null
  /** jellyfin (recently added) */
  jellyfin_id?: string
  media_type?: string
  href?: string
}

export interface TitleRequestInfo {
  season?: number | null
  lang?: string | null
  status: string
  requested_at: string
}

export interface GenreLink {
  name: string
  /** Web-UI link (/ui/genre/<id>?type=…) or null */
  href: string | null
}

export interface ShowDetails {
  title: string
  description?: string | null
  genres?: string[]
  genre_links?: GenreLink[]
  year?: string | number | null
  poster_url?: string | null
  backdrop_url?: string | null
  imdb_id?: string | null
  season_count?: number | null
  age_rating?: string | null
  source_url?: string | null
  status?: TitleStatus
  requests?: TitleRequestInfo[]
}

export interface MovieDetails {
  title: string
  original_title?: string | null
  tagline?: string | null
  overview?: string | null
  year?: string | number | null
  release_date?: string | null
  runtime?: number | null
  rating?: number | null
  genres?: string[]
  genre_links?: GenreLink[]
  release_status?: string | null
  poster_url?: string | null
  backdrop_url?: string | null
  directors?: string[]
  cast?: Array<string | { name: string; character?: string | null }>
  imdb_id?: string | null
  status?: TitleStatus
  requests?: TitleRequestInfo[]
  recommendations?: DiscoverItem[]
}

export interface Genre {
  id: string
  label: string
  anime_only: boolean
  types: Array<'anime' | 'series' | 'movie'>
  counts?: Partial<Record<'anime' | 'series' | 'movie', number>>
  backdrop_url?: string | null
  poster_url?: string | null
}

export type GenreSort = 'popular' | 'newest' | 'rating' | 'title'

export interface GenrePage {
  genre: { id: string; label: string; anime_only: boolean }
  types: Array<'anime' | 'series' | 'movie'>
  type: 'anime' | 'series' | 'movie'
  sort: GenreSort
  page: number
  total: number
  total_pages: number
  items: DiscoverItem[]
}

// ── Upcoming ───────────────────────────────────────────────────────────────

export interface UpcomingItem {
  kind: 'movie' | 'anime' | 'series'
  title: string
  subtitle?: string | null
  poster_url?: string | null
  /** YYYY-MM-DD, YYYY-MM or YYYY */
  release_date?: string | null
  date_label?: string | null
  key: string
  status?: 'upcoming' | 'pending' | 'processing' | null
  tmdb_id?: number
  anilist_id?: number
  slug?: string
  season?: number
}

export interface UpcomingRow {
  /** movies | cinema | anime | series */
  id: string
  title: string
  items: UpcomingItem[]
}

export interface UpcomingRequest {
  id: number
  user_id: string
  title: string
  typ: string
  kind: 'movie' | 'anime' | 'series'
  status: string
  lang?: string | null
  release_date?: string | null
  date_label?: string | null
  last_check?: string | null
  last_result?: string | null
  slug?: string | null
  season?: number | null
}

export interface UpcomingSettings {
  check_start_offset_days: number
  give_up_after_days: number
  check_weekday: number
  check_hour: number
}

// ── Own notifications ──────────────────────────────────────────────────────

export type NotifyEvent = 'complete' | 'failed' | 'rejected'
export type AdminNotifyEvent = 'pending' | 'error' | 'monitor'

export interface NotificationSettings {
  discord: boolean
  webhook_url: string | null
  events: NotifyEvent[]
  admin_events: AdminNotifyEvent[]
  discord_id: string | null
  discord_id_locked: boolean
  push_devices: number
  available: { discord: boolean; webhook: boolean; push: boolean }
}

// ── Admin: storage / sources ───────────────────────────────────────────────

export interface StorageTargetStatus {
  reachable: boolean
  error?: string | null
  checked_at?: string | null
  total?: number | null
  used?: number | null
  free?: number | null
  staging_free?: number | null
  level: 'ok' | 'warn' | 'error'
}

export interface StorageInfo {
  min_free_gb: number
  warn_free_gb: number
  targets: Array<{ id: string; name: string; type: string; [k: string]: unknown }>
  mapping: Record<string, { target: string; subdir?: string }>
  kinds?: string[]
  restart_needed?: boolean
  status: {
    targets: Record<string, StorageTargetStatus>
    sizes: Record<string, { bytes: number; files: number; target: string }>
    scanned_at?: string | null
    scanning?: boolean
  }
}

export interface SourceWindow {
  attempts: number
  ok: number
  rate: number | null
}

export interface SourceHealthRow {
  source: string
  kind: string
  d7: SourceWindow
  d30: SourceWindow
  last_ok?: string | null
  last_fail?: string | null
  last_error?: string | null
  last_error_stage?: string | null
  streak?: number
  types?: string[]
  level: 'ok' | 'warn' | 'error' | 'idle'
}

export interface QualityMovie {
  id: number
  title: string
  year?: number | string | null
  height?: number | null
  source?: string | null
  hoster?: string | null
  last_checked_at?: string | null
  check_count?: number
  last_result?: string | null
  upgrade_status?: string | null
  due?: boolean
  checking?: boolean
}

export interface SourcesInfo {
  settings: Record<string, unknown>
  health: { sites: SourceHealthRow[]; hosters: SourceHealthRow[]; generated_at?: string }
  /** First page of GET /api/admin/sources/movies (shape changed 2026-11-25 — every field optional) */
  quality?: {
    total?: number
    heights?: Record<string, number>
    counts?: { needs?: number; upgraded?: number; all?: number }
    movies?: QualityMovie[]
    candidate_count?: number
    running?: boolean
    busy?: boolean
  } | null
  catalog?: {
    counts?: Record<string, number>
    with_meta?: number
    last_sync?: string | null
    running?: boolean
    last_error?: string | null
    settings?: { enabled?: boolean }
  }
}

// ── Admin: schedule verification ───────────────────────────────────────────

export interface ScheduleVerifyEntry {
  schedule_id: number
  title: string
  season: number
  expected: number
  released: number
  present: number
  missing: number[]
  status: 'ok' | 'missing' | 'error' | 'unknown'
}

export interface ScheduleVerifyResult {
  checked: number
  ok: number
  missing: number
  unknown: number
  queued: number[]
  entries: ScheduleVerifyEntry[]
}
