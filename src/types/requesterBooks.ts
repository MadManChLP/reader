// Requester — books, audiobooks and manga, release picking, manga monitors and
// the CAPTCHA inbox (mediamaster-server API, 2026-11-25 — see reverence/api.md).

export type BookSearchKind = 'book' | 'manga'
export type BookContentType = 'ebook' | 'audiobook'
export type ForumSource = 'boerse' | 'darklight' | string
export type ForumKind = 'book' | 'audiobook' | 'manga'

/** A card from GET /api/books/search */
export interface BookCard {
  kind: 'book' | 'manga' | string
  title: string
  subtitle?: string | null
  overview?: string | null
  poster_url?: string | null
  year?: number | string | null
  status?: string | null
  /** manga (AniList) */
  anilist_id?: number
  titles?: string[]
  volumes?: number | null
  anilist_status?: string | null
  authors?: string[]
  /** book (shelfmark metadata) */
  provider?: string
  provider_id?: string
  /** forum fallback when AniList / shelfmark had nothing */
  forum_source?: ForumSource
  thread_id?: string
}

/** GET /api/books/releases */
export interface BookRelease {
  source: string
  source_id: string
  title: string
  format?: string | null
  language?: string | null
  size?: string | number | null
  indexer?: string | null
  seeders?: number | null
  protocol?: string | null
  info_url?: string | null
  content_type: BookContentType
}

/** GET /api/books/forum */
export interface ForumThread {
  source: ForumSource
  thread_id: string
  title: string
  url?: string
  forum_id?: string
  forum?: string
  prefix?: string | null
  preview?: string | null
  last_post?: string | null
  cover_url?: string | null
  series?: string | null
  volumes?: string | null
  first?: number | null
  last?: number | null
  publisher?: string | null
  year?: number | null
  running?: boolean
}

/** GET /api/books/forum/{source}/{thread_id} */
export interface ForumThreadDetail {
  source: ForumSource
  thread_id: string
  title: string
  url?: string
  parsed?: { series?: string; first?: number; last?: number; publisher?: string; year?: number; running?: boolean }
  fields?: Record<string, string>
  summary?: string | null
  cover_url?: string | null
  /** admins only */
  links?: Record<string, string[]>
  containers?: Array<[string, string]>
  passwords?: string[]
  volume_list?: string[]
  link_count?: number
}

/** One forum thread of a release; no `volumes` = every volume, every hoster */
export interface ReleasePart {
  source: ForumSource
  thread_id: string
  volumes?: Record<string, string[]>
}

export type ReleaseBody =
  | { parts: ReleasePart[]; content_type?: BookContentType }
  | { provider: string; book_id: string; content_type: BookContentType; source_id: string }

// ── Manga monitors ─────────────────────────────────────────────────────────

export interface MonitorThread {
  source: ForumSource
  thread_id: string
  title?: string
  link?: string
  known?: number[]
  known_label?: string
}

export interface MonitorFinding {
  source: ForumSource
  thread_id: string
  title?: string
  volumes?: number[]
  new_thread?: boolean
  label?: string
}

export interface MangaMonitor {
  id: number
  title: string
  anilist_id?: number | null
  url: string
  poster_url?: string | null
  query?: string | null
  paused: boolean
  /** new | ok | found | error */
  status: string
  threads: MonitorThread[]
  found: MonitorFinding[]
  ignored?: string[]
  last_checked?: string | null
  last_error?: string | null
  created_by?: string
  created_at?: string
}

export interface NewMonitor {
  anilist_id?: number
  title?: string
  poster_url?: string | null
  threads?: string[]
  thread_id?: string
  source?: ForumSource
  search?: boolean
  paused?: boolean
}

// ── CAPTCHA inbox ──────────────────────────────────────────────────────────

export interface CaptchaPage {
  id: string
  label: string
  since?: string
  url?: string
  live?: boolean
}

export interface CaptchaInbox {
  waiting: CaptchaPage[]
  viewport: { width: number; height: number }
}
