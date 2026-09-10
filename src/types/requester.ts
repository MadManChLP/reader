// Requester Types — mediamaster-server API

export type MediaType = 'anime' | 'serie' | 'movie' | 'youtube' | 'music'
export type YouTubeType = 'individual' | 'playlist' | 'channel'
export type DownloadStatus = 'pending' | 'approved' | 'queued' | 'downloading' | 'complete' | 'error' | 'rejected' | 'cancelled'

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
  imdb_id: string
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
  approved_by: string | null
  poster_url?: string | null
}

// WebSocket events
export interface QueueUpdateEvent {
  type: 'queue_update'
  request_id: number
  status: DownloadStatus
  title: string
}

export interface EpisodeUpdateEvent {
  type: 'episode_update'
  request_id: number
  episode: string
  ep_status: string
  progress: number
  speed: string
  eta: string
}

export interface SeasonUpdateEvent {
  type: 'season_update'
  request_id: number
  season: number
  season_status: string
}

export type WsEvent = QueueUpdateEvent | EpisodeUpdateEvent | SeasonUpdateEvent

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
}

export interface NewScheduleEntry {
  slug: string
  url: string
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
