// Unified Download Center store
//
// Aggregates every download source in the app — Calibre books, Jellyfin
// video, JellyMusic tracks/albums, Audiobookshelf items — into one list for
// the global slide-over panel, plus a small persisted history of recent
// completions ("Finished" section, ~20 entries, survives restarts).
//
// The store does NOT own any transfers. The per-app download managers keep
// their own queues and processing loops; this store subscribes to their
// listener APIs and mirrors their state into a unified shape. All actions
// (cancel / retry / delete) delegate straight back to the managers.
//
// Source capabilities (see per-source mapping below):
//   Calibre        cancel (via api.cancelDownload), retry, delete
//   Jellyfin video cancel, resume (paused), retry, delete
//   JellyMusic     cancel (track + whole album), retry, delete
//   Audiobookshelf NO cancel / NO retry (manager has no abort path), delete

import { create } from 'zustand'
import {
  getDownloadQueue,
  subscribeToDownloadUpdates,
  cancelDownload as cancelJellyfinDownload,
  retryDownload as retryJellyfinDownload,
  removeFromQueue as removeJellyfinFromQueue,
  resumeDownload as resumeJellyfinDownload,
  getDownloadedItem,
  deleteDownloadedMedia,
  type DownloadQueueItem,
} from '../../utils/jellyfinDownloadManager'
import {
  getMusicDownloadQueue,
  getAlbumDownloadProgress,
  subscribeToMusicDownloadUpdates,
  removeTrackFromQueue,
  retryMusicDownload,
  resumeMusicDownload,
  cancelAlbumDownload,
  getDownloadedTrack,
  getDownloadedAlbum,
  deleteDownloadedTrack,
  deleteDownloadedAlbum,
  type MusicDownloadQueueItem,
  type AlbumDownloadProgress,
} from '../../utils/musicDownloadManager'
import {
  getActiveAbsDownloads,
  getAbsDownloads,
  subscribeToAbsDownloads,
  deleteAbsDownload,
  type AbsDownloadProgress,
} from '../../utils/absDownloadManager'
import {
  useDownloadProgressStore,
  ensureProgressListener,
} from '../../stores/downloadProgressStore'
import { getUniversalAudioUrl } from '../../utils/audioStream'
import { api } from '../../utils/api'

// ─── Types ───────────────────────────────────────────────────────────────────

export type DownloadSource = 'calibre' | 'jellyfin' | 'jellymusic' | 'audiobookshelf'
export type UnifiedStatus = 'queued' | 'downloading' | 'paused' | 'failed'

export interface UnifiedDownloadItem {
  /** Unique across sources: `${source}:{id}` (music albums use `album:` prefix) */
  key: string
  source: DownloadSource
  /** Source-native id (Jellyfin item id, track/album id, ABS download key, book id) */
  id: string
  kind: 'book' | 'movie' | 'episode' | 'track' | 'album' | 'audiobook'
  title: string
  subtitle?: string
  imageUrl?: string
  status: UnifiedStatus
  /** 0..1, or null = active but size unknown (indeterminate) */
  fraction: number | null
  downloadedBytes?: number
  totalBytes?: number
  /** e.g. "3/12 tracks", "2/5 files" */
  detail?: string
  error?: string
  addedAt: number
  canCancel: boolean
  canRetry: boolean
  canResume: boolean
  canDismiss: boolean
}

/** Minimal Calibre book shape needed for begin/retry/delete round-trips */
export interface CalibreBookRef {
  id: string
  calibreId?: string
  title: string
  author?: string
  cover?: string
  downloadUrl?: string
  formats?: string[]
  [key: string]: unknown
}

export interface DownloadHistoryEntry {
  key: string
  source: DownloadSource
  id: string
  kind: UnifiedDownloadItem['kind']
  title: string
  subtitle?: string
  imageUrl?: string
  size?: number
  completedAt: number
  /** Calibre delete needs the book shape for libraryStore.handleDelete */
  calibreBook?: CalibreBookRef
}

interface DownloadCenterState {
  items: UnifiedDownloadItem[]
  history: DownloadHistoryEntry[]
  isOpen: boolean
  setOpen: (open: boolean) => void
  toggleOpen: () => void

  cancelItem: (key: string) => void
  retryItem: (key: string) => void
  resumeItem: (key: string) => void
  /** Drop a failed/queued entry without retrying (no file cleanup beyond the manager's own) */
  dismissItem: (key: string) => void

  /** Delete the downloaded FILE via the per-app deletion path, then drop the entry */
  deleteHistoryEntry: (key: string) => Promise<void>
  /** Remove the history entry only (keeps files) */
  removeHistoryEntry: (key: string) => void
  clearFinished: () => void
}

// ─── Persisted history ───────────────────────────────────────────────────────

const HISTORY_KEY = 'unified_download_history'
const HISTORY_LIMIT = 20

function loadHistory(): DownloadHistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function persistHistory(history: DownloadHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch { /* quota — history is best-effort */ }
}

function pushHistory(entry: DownloadHistoryEntry): void {
  const state = useDownloadCenter.getState()
  const history = [entry, ...state.history.filter((h) => h.key !== entry.key)].slice(0, HISTORY_LIMIT)
  persistHistory(history)
  useDownloadCenter.setState({ history })
}

// ─── Calibre tracking (fed explicitly from App.tsx's handleDownload) ─────────

interface CalibreActive {
  book: CalibreBookRef
  status: 'downloading' | 'failed'
  error?: string
  addedAt: number
  cancelled: boolean
}

const calibreActive = new Map<string, CalibreActive>()

/** Call right before libraryStore.handleDownload starts a book download. */
export function beginCalibreDownload(book: CalibreBookRef): void {
  wireDownloadCenter()
  calibreActive.set(book.id, {
    book,
    status: 'downloading',
    addedAt: Date.now(),
    cancelled: false,
  })
  rebuild()
}

/**
 * Call after libraryStore.handleDownload resolves.
 * Returns how the download ended so callers can pick the right toast
 * ('cancelled' = the user aborted it from the download panel).
 */
export function finishCalibreDownload(
  bookId: string,
  success: boolean,
  error?: string,
): 'completed' | 'cancelled' | 'failed' {
  const entry = calibreActive.get(bookId)
  if (success) {
    calibreActive.delete(bookId)
    if (entry) {
      pushHistory({
        key: `calibre:${bookId}`,
        source: 'calibre',
        id: bookId,
        kind: 'book',
        title: entry.book.title,
        subtitle: entry.book.author,
        completedAt: Date.now(),
        calibreBook: entry.book,
      })
    }
    rebuild()
    return 'completed'
  }
  if (entry?.cancelled) {
    calibreActive.delete(bookId)
    rebuild()
    return 'cancelled'
  }
  if (entry) {
    entry.status = 'failed'
    entry.error = error || 'Download failed'
  }
  rebuild()
  return 'failed'
}

// ─── Per-source mapping ──────────────────────────────────────────────────────

function jellyfinPosterUrl(q: DownloadQueueItem): string {
  return `${q.serverUrl}/Items/${q.seriesId || q.id}/Images/Primary?maxWidth=100&quality=80&ApiKey=${q.accessToken}`
}

function mapJellyfin(q: DownloadQueueItem): UnifiedDownloadItem {
  // Prefer the raw byte event when it belongs to this transfer — the manager
  // only persists byte counts every ~2s (throttled saves)
  let downloadedBytes = q.downloadedBytes
  let totalBytes = q.totalBytes
  if (q.status === 'downloading') {
    const last = useDownloadProgressStore.getState().lastEvent
    const streamUrl = `${q.serverUrl}/Videos/${q.id}/stream?static=true&ApiKey=${q.accessToken}`
    if (last && last.url === streamUrl) {
      downloadedBytes = last.downloadedBytes
      totalBytes = last.totalBytes || totalBytes
    }
  }
  const status: UnifiedStatus = q.status === 'completed' ? 'downloading' : q.status
  const subtitle = q.type === 'Episode' && q.seriesName
    ? `${q.seriesName}${q.seasonNumber != null && q.episodeNumber != null ? ` · S${q.seasonNumber}E${q.episodeNumber}` : ''}`
    : q.type
  return {
    key: `jellyfin:${q.id}`,
    source: 'jellyfin',
    id: q.id,
    kind: q.type === 'Movie' ? 'movie' : 'episode',
    title: q.name,
    subtitle,
    imageUrl: jellyfinPosterUrl(q),
    status,
    fraction:
      totalBytes > 0
        ? Math.min(1, downloadedBytes / totalBytes)
        : q.status === 'downloading'
          ? null
          : 0,
    downloadedBytes,
    totalBytes,
    error: q.error,
    addedAt: q.addedAt,
    canCancel: q.status === 'downloading' || q.status === 'queued' || q.status === 'paused',
    canRetry: q.status === 'failed',
    canResume: q.status === 'paused',
    canDismiss: q.status === 'failed',
  }
}

function albumImageUrl(a: AlbumDownloadProgress): string {
  return `${a.serverUrl}/Items/${a.albumId}/Images/Primary?maxWidth=100&quality=80&ApiKey=${a.accessToken}`
}

function musicTrackByteFraction(t: MusicDownloadQueueItem): number {
  // The music manager records total size once (HEAD) but never byte progress
  // during the transfer — reconstruct the stream URL and match the raw event
  const last = useDownloadProgressStore.getState().lastEvent
  if (t.status !== 'downloading' || !last) return 0
  const streamUrl = getUniversalAudioUrl(t.serverUrl, t.id, t.accessToken)
  if (last.url !== streamUrl || !last.totalBytes) return 0
  return Math.min(1, last.downloadedBytes / last.totalBytes)
}

function mapMusicAlbum(a: AlbumDownloadProgress, queue: MusicDownloadQueueItem[]): UnifiedDownloadItem {
  const albumTracks = queue.filter((t) => t.albumDownloadId === a.albumId)
  const activeTrack = albumTracks.find((t) => t.status === 'downloading')
  const anyPending = albumTracks.some((t) => t.status === 'queued' || t.status === 'downloading')
  const trackFraction = activeTrack ? musicTrackByteFraction(activeTrack) : 0
  const status: UnifiedStatus = a.status === 'failed' && !anyPending ? 'failed' : 'downloading'
  return {
    key: `jellymusic:album:${a.albumId}`,
    source: 'jellymusic',
    id: a.albumId,
    kind: 'album',
    title: a.albumName,
    subtitle: a.artist,
    imageUrl: albumImageUrl(a),
    status,
    fraction: a.totalTracks > 0 ? Math.min(1, (a.completedTracks + trackFraction) / a.totalTracks) : null,
    detail: `${a.completedTracks}/${a.totalTracks} tracks`,
    error: a.error,
    addedAt: a.addedAt,
    canCancel: status !== 'failed',
    canRetry: status === 'failed' && albumTracks.some((t) => t.status === 'failed'),
    canResume: false,
    canDismiss: status === 'failed',
  }
}

function mapMusicTrack(t: MusicDownloadQueueItem): UnifiedDownloadItem {
  const byteFraction = musicTrackByteFraction(t)
  const status: UnifiedStatus = t.status === 'completed' ? 'downloading' : t.status
  return {
    key: `jellymusic:track:${t.id}`,
    source: 'jellymusic',
    id: t.id,
    kind: 'track',
    title: t.trackName,
    subtitle: t.artists.join(', ') || t.albumName,
    imageUrl: t.albumId
      ? `${t.serverUrl}/Items/${t.albumId}/Images/Primary?maxWidth=100&quality=80&ApiKey=${t.accessToken}`
      : undefined,
    status,
    fraction:
      byteFraction > 0
        ? byteFraction
        : t.status === 'downloading'
          ? (t.totalBytes > 0 ? 0 : null)
          : 0,
    totalBytes: t.totalBytes || undefined,
    error: t.error,
    addedAt: t.addedAt,
    canCancel: t.status === 'downloading' || t.status === 'queued' || t.status === 'paused',
    canRetry: t.status === 'failed',
    canResume: t.status === 'paused',
    canDismiss: t.status === 'failed',
  }
}

function mapAbs(p: AbsDownloadProgress): UnifiedDownloadItem {
  const byte = useDownloadProgressStore.getState().active[p.key]
  const fileFraction = byte && byte.totalBytes > 0 ? Math.min(1, byte.downloadedBytes / byte.totalBytes) : 0
  const fraction =
    p.totalFiles > 0
      ? Math.min(1, (p.completedFiles + fileFraction) / p.totalFiles)
      : null
  return {
    key: `audiobookshelf:${p.key}`,
    source: 'audiobookshelf',
    id: p.key,
    kind: 'audiobook',
    title: p.title,
    status: p.status === 'failed' ? 'failed' : 'downloading',
    // Single-file items with unknown size: show indeterminate instead of 0%
    fraction: p.status === 'failed' ? 0 : (fraction === 0 && !byte?.totalBytes ? null : fraction),
    detail: p.totalFiles > 1 ? `${p.completedFiles}/${p.totalFiles} files` : undefined,
    error: p.error,
    addedAt: Date.now(),
    // The ABS manager has no abort or retry path — greyed out in the panel
    canCancel: false,
    canRetry: false,
    canResume: false,
    canDismiss: false, // failed entries auto-clear after 10s
  }
}

function mapCalibre(c: CalibreActive): UnifiedDownloadItem {
  const byte = useDownloadProgressStore.getState().active[c.book.id]
  return {
    key: `calibre:${c.book.id}`,
    source: 'calibre',
    id: c.book.id,
    kind: 'book',
    title: c.book.title,
    subtitle: c.book.author,
    status: c.status,
    fraction:
      c.status === 'failed'
        ? 0
        : byte && byte.totalBytes > 0
          ? Math.min(1, byte.downloadedBytes / byte.totalBytes)
          : null,
    downloadedBytes: byte?.downloadedBytes,
    totalBytes: byte?.totalBytes || undefined,
    error: c.error,
    addedAt: c.addedAt,
    canCancel: c.status === 'downloading' && !!byte?.url,
    canRetry: c.status === 'failed',
    canResume: false,
    canDismiss: c.status === 'failed',
  }
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<UnifiedStatus, number> = {
  downloading: 0,
  queued: 1,
  paused: 2,
  failed: 3,
}

function rebuild(): void {
  const items: UnifiedDownloadItem[] = []

  // Jellyfin video queue
  for (const q of getDownloadQueue()) items.push(mapJellyfin(q))

  // JellyMusic: albums as single rows, plus standalone tracks
  const musicQueue = getMusicDownloadQueue()
  const albumProgress = getAlbumDownloadProgress()
  const albumIds = new Set(albumProgress.map((a) => a.albumId))
  for (const a of albumProgress) items.push(mapMusicAlbum(a, musicQueue))
  for (const t of musicQueue) {
    if (t.albumDownloadId && albumIds.has(t.albumDownloadId)) continue
    items.push(mapMusicTrack(t))
  }

  // Audiobookshelf active downloads
  for (const p of getActiveAbsDownloads()) items.push(mapAbs(p))

  // Calibre books (fed via begin/finishCalibreDownload)
  for (const c of calibreActive.values()) items.push(mapCalibre(c))

  items.sort((x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status] || x.addedAt - y.addedAt)
  useDownloadCenter.setState({ items })
}

// ─── Completion detection (queue diffs → history entries) ────────────────────

let prevJellyfinIds = new Set<string>()
let prevTrackIds = new Set<string>()
let prevAlbumIds = new Set<string>()
let prevAbsKeys = new Set<string>()

function detectJellyfinCompletions(queue: DownloadQueueItem[]): void {
  const ids = new Set(queue.map((q) => q.id))
  for (const id of prevJellyfinIds) {
    if (ids.has(id)) continue
    const done = getDownloadedItem(id)
    if (!done) continue // cancelled, not completed
    pushHistory({
      key: `jellyfin:${id}`,
      source: 'jellyfin',
      id,
      kind: done.type === 'Movie' ? 'movie' : 'episode',
      title: done.name,
      subtitle: done.type === 'Episode' && done.seriesName
        ? `${done.seriesName}${done.seasonNumber != null && done.episodeNumber != null ? ` · S${done.seasonNumber}E${done.episodeNumber}` : ''}`
        : undefined,
      size: done.fileSize || undefined,
      completedAt: done.downloadedAt,
    })
  }
  prevJellyfinIds = ids
}

function detectMusicCompletions(queue: MusicDownloadQueueItem[], albums: AlbumDownloadProgress[]): void {
  const trackIds = new Set(queue.map((t) => t.id))
  const albumIds = new Set(albums.map((a) => a.albumId))

  for (const id of prevAlbumIds) {
    if (albumIds.has(id)) continue
    const album = getDownloadedAlbum(id)
    if (!album) continue
    pushHistory({
      key: `jellymusic:album:${id}`,
      source: 'jellymusic',
      id,
      kind: 'album',
      title: album.name,
      subtitle: album.artist,
      size: album.totalSize || undefined,
      completedAt: album.downloadedAt,
    })
  }

  for (const id of prevTrackIds) {
    if (trackIds.has(id)) continue
    const track = getDownloadedTrack(id)
    if (!track) continue
    // Album-download tracks are represented by their album entry
    if (getDownloadedAlbum(track.albumId) || albumIds.has(track.albumId)) continue
    pushHistory({
      key: `jellymusic:track:${id}`,
      source: 'jellymusic',
      id,
      kind: 'track',
      title: track.name,
      subtitle: track.artists.join(', ') || track.albumName,
      size: track.fileSize || undefined,
      completedAt: track.downloadedAt,
    })
  }

  prevTrackIds = trackIds
  prevAlbumIds = albumIds
}

function detectAbsCompletions(active: AbsDownloadProgress[]): void {
  const keys = new Set(active.map((p) => p.key))
  for (const key of prevAbsKeys) {
    if (keys.has(key)) continue
    const done = getAbsDownloads().find((d) => d.key === key)
    if (!done) continue
    pushHistory({
      key: `audiobookshelf:${key}`,
      source: 'audiobookshelf',
      id: key,
      kind: 'audiobook',
      title: done.title,
      subtitle: done.author || undefined,
      size: done.totalSize || undefined,
      completedAt: done.downloadedAt,
    })
  }
  prevAbsKeys = keys
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

let wired = false

/** Attach manager listeners once. Safe to call repeatedly. */
export function wireDownloadCenter(): void {
  if (wired) return
  wired = true

  // Baseline the diff sets so pre-existing queue items don't fake completions
  prevJellyfinIds = new Set(getDownloadQueue().map((q) => q.id))
  const musicQueue = getMusicDownloadQueue()
  prevTrackIds = new Set(musicQueue.map((t) => t.id))
  prevAlbumIds = new Set(getAlbumDownloadProgress().map((a) => a.albumId))
  prevAbsKeys = new Set(getActiveAbsDownloads().map((p) => p.key))

  subscribeToDownloadUpdates((queue) => {
    detectJellyfinCompletions(queue)
    rebuild()
  })
  subscribeToMusicDownloadUpdates((queue, albums) => {
    detectMusicCompletions(queue, albums)
    rebuild()
  })
  subscribeToAbsDownloads((active) => {
    detectAbsCompletions(active)
    rebuild()
  })

  // Byte-level updates (Calibre / ABS fractions + lastEvent for the rest)
  ensureProgressListener()
  useDownloadProgressStore.subscribe(() => {
    // Only worth recomputing while something is visible
    if (useDownloadCenter.getState().items.length > 0) rebuild()
  })

  rebuild()
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useDownloadCenter = create<DownloadCenterState>((set, get) => ({
  items: [],
  history: loadHistory(),
  isOpen: false,

  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  cancelItem: (key) => {
    const item = get().items.find((i) => i.key === key)
    if (!item || !item.canCancel) return
    switch (item.source) {
      case 'jellyfin':
        cancelJellyfinDownload(item.id)
        break
      case 'jellymusic':
        if (item.kind === 'album') cancelAlbumDownload(item.id)
        else removeTrackFromQueue(item.id)
        break
      case 'calibre': {
        const entry = calibreActive.get(item.id)
        const byte = useDownloadProgressStore.getState().active[item.id]
        if (entry) entry.cancelled = true
        if (byte?.url) api.cancelDownload(byte.url) // Rust aborts + deletes the partial file
        rebuild()
        break
      }
      case 'audiobookshelf':
        break // not supported
    }
  },

  retryItem: (key) => {
    const item = get().items.find((i) => i.key === key)
    if (!item || !item.canRetry) return
    switch (item.source) {
      case 'jellyfin':
        retryJellyfinDownload(item.id)
        break
      case 'jellymusic':
        if (item.kind === 'album') {
          // Re-queue every failed track of the album; updateAlbumProgress
          // clears the failed album state as tracks complete
          for (const t of getMusicDownloadQueue()) {
            if (t.albumDownloadId === item.id && t.status === 'failed') retryMusicDownload(t.id)
          }
        } else {
          retryMusicDownload(item.id)
        }
        break
      case 'calibre': {
        const entry = calibreActive.get(item.id)
        if (!entry) return
        entry.status = 'downloading'
        entry.error = undefined
        entry.cancelled = false
        rebuild()
        ;(async () => {
          const [{ useLibraryStore }, { useSettingsStore }] = await Promise.all([
            import('../../stores/libraryStore'),
            import('../../stores/settingsStore'),
          ])
          const settings = useSettingsStore.getState()
          const ok = await useLibraryStore
            .getState()
            .handleDownload(entry.book as any, settings.downloadPath, settings.calibreWeb.url, settings.getAuthHeader())
          finishCalibreDownload(item.id, ok)
        })()
        break
      }
      case 'audiobookshelf':
        break // not supported
    }
  },

  resumeItem: (key) => {
    const item = get().items.find((i) => i.key === key)
    if (!item || !item.canResume) return
    if (item.source === 'jellyfin') resumeJellyfinDownload(item.id)
    else if (item.source === 'jellymusic' && item.kind === 'track') resumeMusicDownload(item.id)
  },

  dismissItem: (key) => {
    const item = get().items.find((i) => i.key === key)
    if (!item || !item.canDismiss) return
    switch (item.source) {
      case 'jellyfin':
        removeJellyfinFromQueue(item.id)
        break
      case 'jellymusic':
        if (item.kind === 'album') cancelAlbumDownload(item.id)
        else removeTrackFromQueue(item.id)
        break
      case 'calibre':
        calibreActive.delete(item.id)
        rebuild()
        break
      case 'audiobookshelf':
        break
    }
  },

  deleteHistoryEntry: async (key) => {
    const entry = get().history.find((h) => h.key === key)
    if (!entry) return
    try {
      switch (entry.source) {
        case 'jellyfin':
          await deleteDownloadedMedia(entry.id)
          break
        case 'jellymusic':
          if (entry.kind === 'album') await deleteDownloadedAlbum(entry.id)
          else await deleteDownloadedTrack(entry.id)
          break
        case 'audiobookshelf':
          await deleteAbsDownload(entry.id)
          break
        case 'calibre': {
          if (entry.calibreBook) {
            const [{ useLibraryStore }, { useSettingsStore }] = await Promise.all([
              import('../../stores/libraryStore'),
              import('../../stores/settingsStore'),
            ])
            const downloadPath = useSettingsStore.getState().downloadPath
            await useLibraryStore.getState().handleDelete(entry.calibreBook as any, downloadPath)
          }
          break
        }
      }
    } catch (e) {
      console.error('[DownloadCenter] Delete failed:', e)
    }
    get().removeHistoryEntry(key)
  },

  removeHistoryEntry: (key) => {
    const history = get().history.filter((h) => h.key !== key)
    persistHistory(history)
    set({ history })
  },

  clearFinished: () => {
    persistHistory([])
    set({ history: [] })
  },
}))
