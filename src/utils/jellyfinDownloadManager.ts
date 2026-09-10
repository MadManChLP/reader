// Jellyfin Download Manager
// Handles downloading movies/episodes for offline viewing and syncing progress

import { api } from './api'
import { loadSettings } from '../types/settings'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client'

const IS_TAURI = typeof window !== 'undefined' && '__TAURI__' in window

// Types
export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed'

export interface DownloadedMedia {
  id: string              // Jellyfin item ID
  serverId: string        // Server ID for multi-server support
  type: 'Movie' | 'Episode'
  name: string
  seriesName?: string     // For episodes
  seriesId?: string       // For episodes
  seasonNumber?: number
  episodeNumber?: number
  overview?: string
  runTimeTicks: number
  localPath: string       // Path to video file
  posterPath?: string     // Path to poster image
  backdropPath?: string   // Path to backdrop image
  downloadedAt: number
  fileSize: number
  // Extra metadata for offline browsing
  productionYear?: number
  communityRating?: number
  officialRating?: string
  genres?: string[]
}

export interface DownloadQueueItem {
  id: string              // Jellyfin item ID
  serverId: string
  serverUrl: string
  accessToken: string
  type: 'Movie' | 'Episode'
  name: string
  seriesName?: string
  seriesId?: string
  seasonNumber?: number
  episodeNumber?: number
  overview?: string
  runTimeTicks: number
  status: DownloadStatus
  progress: number        // 0-100 percentage
  totalBytes: number
  downloadedBytes: number
  addedAt: number
  error?: string
  /** Automatic retry counter for transient failures */
  attempts?: number
  // Extra metadata carried into DownloadedMedia
  productionYear?: number
  communityRating?: number
  officialRating?: string
  genres?: string[]
}

/** Max automatic retries for a failed download before it stays 'failed' */
const MAX_AUTO_RETRIES = 2

export interface PendingProgressUpdate {
  itemId: string
  serverId: string
  serverUrl: string
  accessToken: string
  positionTicks: number
  timestamp: number
}

// Storage keys
const STORAGE_KEYS = {
  DOWNLOAD_QUEUE: 'jellyfin_download_queue',
  DOWNLOADS: 'jellyfin_downloads',
  PENDING_PROGRESS: 'jellyfin_pending_progress',
}

// Active download state (not persisted)
let activeDownloadId: string | null = null
let activeDownloadUrl: string | null = null
let downloadAbortController: AbortController | null = null
let progressUnlisten: (() => void) | null = null

// Throttled save mechanism - prevents excessive localStorage writes during downloads
let pendingSave: DownloadQueueItem[] | null = null
let saveTimeoutId: ReturnType<typeof setTimeout> | null = null
const SAVE_THROTTLE_MS = 2000 // Save at most every 2 seconds

function throttledSaveQueue(queue: DownloadQueueItem[]): void {
  pendingSave = queue

  // If no timeout is pending, set one
  if (!saveTimeoutId) {
    saveTimeoutId = setTimeout(() => {
      if (pendingSave) {
        localStorage.setItem(STORAGE_KEYS.DOWNLOAD_QUEUE, JSON.stringify(pendingSave))
        notifyDownloadListeners()
        pendingSave = null
      }
      saveTimeoutId = null
    }, SAVE_THROTTLE_MS)
  }
}

function flushPendingSave(): void {
  if (saveTimeoutId) {
    clearTimeout(saveTimeoutId)
    saveTimeoutId = null
  }
  if (pendingSave) {
    localStorage.setItem(STORAGE_KEYS.DOWNLOAD_QUEUE, JSON.stringify(pendingSave))
    notifyDownloadListeners()
    pendingSave = null
  }
}

// Event emitter for download updates
type DownloadEventListener = (queue: DownloadQueueItem[]) => void
const downloadListeners: Set<DownloadEventListener> = new Set()

export function subscribeToDownloadUpdates(listener: DownloadEventListener): () => void {
  downloadListeners.add(listener)
  return () => downloadListeners.delete(listener)
}

function notifyDownloadListeners() {
  const queue = getDownloadQueue()
  downloadListeners.forEach(listener => listener(queue))
}

// ==================== Download Queue Functions ====================

export function getDownloadQueue(): DownloadQueueItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.DOWNLOAD_QUEUE)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveDownloadQueue(queue: DownloadQueueItem[]): void {
  localStorage.setItem(STORAGE_KEYS.DOWNLOAD_QUEUE, JSON.stringify(queue))
  notifyDownloadListeners()
}

export function addToQueue(
  item: BaseItemDto,
  serverUrl: string,
  serverId: string,
  accessToken: string
): DownloadQueueItem | null {
  // Validate item type
  if (item.Type !== 'Movie' && item.Type !== 'Episode') {
    console.error('Only Movies and Episodes can be downloaded')
    return null
  }

  // Check if already in queue or downloaded
  const queue = getDownloadQueue()
  const downloads = getDownloadedMedia()

  if (queue.some(q => q.id === item.Id)) {
    console.log('Item already in download queue')
    return null
  }

  if (downloads.some(d => d.id === item.Id)) {
    console.log('Item already downloaded')
    return null
  }

  const queueItem: DownloadQueueItem = {
    id: item.Id!,
    serverId,
    serverUrl,
    accessToken,
    type: item.Type as 'Movie' | 'Episode',
    name: item.Name || 'Unknown',
    seriesName: item.SeriesName || undefined,
    seriesId: item.SeriesId || undefined,
    seasonNumber: item.ParentIndexNumber ?? undefined,
    episodeNumber: item.IndexNumber ?? undefined,
    overview: item.Overview || undefined,
    runTimeTicks: item.RunTimeTicks || 0,
    status: 'queued',
    progress: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    addedAt: Date.now(),
    productionYear: item.ProductionYear ?? undefined,
    communityRating: item.CommunityRating ?? undefined,
    officialRating: item.OfficialRating ?? undefined,
    genres: item.Genres || undefined,
  }

  queue.push(queueItem)
  saveDownloadQueue(queue)

  // Start processing queue if not already
  processQueue()

  return queueItem
}

/** Abort the actual in-flight transfer (Rust deletes the partial file) */
function abortActiveTransfer(): void {
  if (activeDownloadUrl) {
    api.cancelDownload(activeDownloadUrl)
  }
  downloadAbortController?.abort()
}

export function removeFromQueue(itemId: string): void {
  // If this is the active download, abort it
  if (activeDownloadId === itemId) {
    abortActiveTransfer()
  }

  // Flush any pending throttled save first so it doesn't overwrite our removal
  flushPendingSave()

  const queue = getDownloadQueue()
  const newQueue = queue.filter(q => q.id !== itemId)
  saveDownloadQueue(newQueue)
}

export function pauseDownload(itemId: string): void {
  // If this is the active download, abort it
  if (activeDownloadId === itemId) {
    abortActiveTransfer()
  }

  const queue = getDownloadQueue()
  const item = queue.find(q => q.id === itemId)
  if (item && (item.status === 'downloading' || item.status === 'queued')) {
    item.status = 'paused'
    item.progress = 0
    item.downloadedBytes = 0
    saveDownloadQueue(queue)
  }
}

export function resumeDownload(itemId: string): void {
  const queue = getDownloadQueue()
  const item = queue.find(q => q.id === itemId)
  if (item && item.status === 'paused') {
    item.status = 'queued'
    saveDownloadQueue(queue)
    processQueue()
  }
}

export function cancelDownload(itemId: string): void {
  // Capture queue entry BEFORE removal — cleanup needs serverId and type
  // to construct the correct folder path
  const item = getDownloadQueue().find(q => q.id === itemId)
  removeFromQueue(itemId)
  // Also clean up any partial files
  if (item) cleanupPartialDownload(item)
}

export function retryDownload(itemId: string): void {
  const queue = getDownloadQueue()
  const item = queue.find(q => q.id === itemId)
  if (item && item.status === 'failed') {
    item.status = 'queued'
    item.progress = 0
    item.downloadedBytes = 0
    item.error = undefined
    saveDownloadQueue(queue)
    processQueue()
  }
}

// ==================== Download Processing ====================

let isProcessing = false

export async function processQueue(): Promise<void> {
  if (isProcessing) return
  isProcessing = true

  try {
    while (true) {
      const queue = getDownloadQueue()
      const nextItem = queue.find(q => q.status === 'queued')

      if (!nextItem) break

      await downloadItem(nextItem)
    }
  } finally {
    isProcessing = false
  }
}

async function downloadItem(item: DownloadQueueItem): Promise<void> {
  const settings = loadSettings()
  const downloadPath = settings.downloadPath || await api.getDefaultPath()

  // Update status to downloading
  updateQueueItemStatus(item.id, 'downloading')

  activeDownloadId = item.id
  downloadAbortController = new AbortController()

  try {
    // Create directory structure
    const itemFolder = itemFolderFor(downloadPath, item)

    await api.createDirectory(itemFolder)

    // Download poster
    const posterUrl = `${item.serverUrl}/Items/${item.seriesId || item.id}/Images/Primary?maxWidth=400&quality=90`
    const posterResult = await api.downloadFile({
      url: posterUrl,
      folderPath: itemFolder,
      fileName: 'poster.jpg',
      headers: {
        'Authorization': `MediaBrowser Token="${item.accessToken}"`,
      },
    })

    const posterPath = posterResult.success ? `${itemFolder}/poster.jpg` : undefined

    // Download backdrop (nice-to-have for offline details view; failure is fine)
    const backdropUrl = `${item.serverUrl}/Items/${item.seriesId || item.id}/Images/Backdrop?maxWidth=1280&quality=85`
    const backdropResult = await api.downloadFile({
      url: backdropUrl,
      folderPath: itemFolder,
      fileName: 'backdrop.jpg',
      headers: {
        'Authorization': `MediaBrowser Token="${item.accessToken}"`,
      },
    }).catch(() => ({ success: false }))
    const backdropPath = backdropResult.success ? `${itemFolder}/backdrop.jpg` : undefined

    // Download video
    const streamUrl = `${item.serverUrl}/Videos/${item.id}/stream?static=true&ApiKey=${item.accessToken}`

    // First, get content length via HEAD request
    const headResponse = await api.request({
      method: 'HEAD',
      url: streamUrl,
      headers: {
        'Authorization': `MediaBrowser Token="${item.accessToken}"`,
      },
    })

    const totalBytes = parseInt(headResponse.headers?.['content-length'] || '0', 10)
    if (totalBytes > 0) {
      updateQueueItemBytes(item.id, 0, totalBytes)
    }

    // Set up progress listener for Tauri events
    activeDownloadUrl = streamUrl
    if (IS_TAURI) {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        const unlisten = await listen<{ url: string; downloadedBytes: number; totalBytes: number }>('download-progress', (event) => {
          if (event.payload.url === activeDownloadUrl && activeDownloadId) {
            const tb = event.payload.totalBytes || totalBytes
            updateQueueItemBytes(activeDownloadId, event.payload.downloadedBytes, tb)
          }
        })
        progressUnlisten = unlisten
      } catch { /* ignore if listen fails */ }
    }

    // Download the video file
    const videoResult = await api.downloadFile({
      url: streamUrl,
      folderPath: itemFolder,
      fileName: 'video.mp4',
      headers: {
        'Authorization': `MediaBrowser Token="${item.accessToken}"`,
      },
    })

    // If the item was cancelled or paused while the transfer ran, do NOT
    // record it as downloaded — clean up whatever landed on disk instead.
    const itemNow = getDownloadQueue().find(q => q.id === item.id)
    if (!itemNow || itemNow.status !== 'downloading') {
      await cleanupPartialDownload(item)
      return
    }

    if (!videoResult.success) {
      throw new Error(videoResult.error || 'Failed to download video')
    }

    const localPath = `${itemFolder}/video.mp4`

    // Sanity check: the file must actually exist before we record it
    if (!(await api.fileExists(localPath))) {
      throw new Error('Downloaded file missing on disk')
    }

    // Enrich metadata: list items (home rows, grids) usually lack Overview and
    // Genres — Jellyfin only returns them when explicitly requested. Fetch the
    // full item once while we're online so offline details are complete.
    let meta = {
      overview: item.overview,
      productionYear: item.productionYear,
      communityRating: item.communityRating,
      officialRating: item.officialRating,
      genres: item.genres,
    }
    try {
      const userId = loadSettings().jellyfinServers.find(s => s.id === item.serverId)?.userId
      if (userId) {
        const fullRes = await api.request({
          method: 'GET',
          url: `${item.serverUrl}/Users/${userId}/Items/${item.id}`,
          headers: { 'Authorization': `MediaBrowser Token="${item.accessToken}"` },
        })
        if (fullRes.success && fullRes.data) {
          const full = fullRes.data
          meta = {
            overview: full.Overview ?? meta.overview,
            productionYear: full.ProductionYear ?? meta.productionYear,
            communityRating: full.CommunityRating ?? meta.communityRating,
            officialRating: full.OfficialRating ?? meta.officialRating,
            genres: full.Genres?.length ? full.Genres : meta.genres,
          }
        }
      }
    } catch { /* keep queue-item metadata */ }

    // Create metadata file
    const metadata: DownloadedMedia = {
      id: item.id,
      serverId: item.serverId,
      type: item.type,
      name: item.name,
      seriesName: item.seriesName,
      seriesId: item.seriesId,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      overview: meta.overview,
      runTimeTicks: item.runTimeTicks,
      localPath,
      posterPath,
      backdropPath,
      downloadedAt: Date.now(),
      fileSize: totalBytes,
      productionYear: meta.productionYear,
      communityRating: meta.communityRating,
      officialRating: meta.officialRating,
      genres: meta.genres,
    }

    await api.writeFile({
      path: `${itemFolder}/metadata.json`,
      content: JSON.stringify(metadata, null, 2),
    })

    // Add to completed downloads
    addCompletedDownload(metadata)

    // Remove from queue
    removeFromQueue(item.id)

  } catch (error: any) {
    if (error.name === 'AbortError' || error.message === 'Cancelled') {
      // Download was cancelled/paused, don't mark as failed
      return
    }

    console.error('Download failed:', error)

    // Clean up partial files so a retry starts fresh
    await cleanupPartialDownload(item).catch(() => {})

    // Auto-retry transient failures with a short backoff before giving up
    const attempts = (item.attempts ?? 0) + 1
    const stillWanted = getDownloadQueue().some(q => q.id === item.id)
    if (stillWanted && attempts <= MAX_AUTO_RETRIES) {
      console.log(`[Downloads] Retrying "${item.name}" (attempt ${attempts}/${MAX_AUTO_RETRIES})`)
      await new Promise(resolve => setTimeout(resolve, 3000 * attempts))
      const queue = getDownloadQueue()
      const q = queue.find(x => x.id === item.id)
      if (q) {
        q.status = 'queued'
        q.attempts = attempts
        q.progress = 0
        q.downloadedBytes = 0
        saveDownloadQueue(queue)  // processQueue loop picks it up again
      }
    } else {
      updateQueueItemStatus(item.id, 'failed', error.message || 'Download failed')
    }
  } finally {
    activeDownloadId = null
    activeDownloadUrl = null
    downloadAbortController = null
    if (progressUnlisten) {
      progressUnlisten()
      progressUnlisten = null
    }
  }
}

function updateQueueItemStatus(itemId: string, status: DownloadStatus, error?: string): void {
  // Flush any pending throttled saves first
  flushPendingSave()

  const queue = getDownloadQueue()
  const item = queue.find(q => q.id === itemId)
  if (item) {
    item.status = status
    if (error) item.error = error
    if (status === 'completed') item.progress = 100
    // Status changes are important - save immediately
    saveDownloadQueue(queue)
  }
}

function updateQueueItemBytes(itemId: string, downloadedBytes: number, totalBytes: number): void {
  const queue = getDownloadQueue()
  const item = queue.find(q => q.id === itemId)
  if (item) {
    item.downloadedBytes = downloadedBytes
    item.totalBytes = totalBytes
    item.progress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0
    // Use throttled save for progress updates to reduce CPU/IO load
    throttledSaveQueue(queue)
  }
}

function itemFolderFor(downloadPath: string, item: Pick<DownloadQueueItem, 'id' | 'serverId' | 'type'>): string {
  const typeFolder = item.type === 'Movie' ? 'movies' : 'episodes'
  return `${downloadPath}/Jellyfin/${item.serverId}/${typeFolder}/${item.id}`
}

async function cleanupPartialDownload(item: Pick<DownloadQueueItem, 'id' | 'serverId' | 'type'>): Promise<void> {
  const settings = loadSettings()
  const downloadPath = settings.downloadPath || await api.getDefaultPath()
  await api.deleteDirectory(itemFolderFor(downloadPath, item)).catch(() => {})
}

// ==================== Completed Downloads Functions ====================

export function getDownloadedMedia(): DownloadedMedia[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.DOWNLOADS)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveDownloadedMedia(downloads: DownloadedMedia[]): void {
  localStorage.setItem(STORAGE_KEYS.DOWNLOADS, JSON.stringify(downloads))
}

function addCompletedDownload(media: DownloadedMedia): void {
  const downloads = getDownloadedMedia()
  const existingIndex = downloads.findIndex(d => d.id === media.id)

  if (existingIndex >= 0) {
    downloads[existingIndex] = media
  } else {
    downloads.push(media)
  }

  saveDownloadedMedia(downloads)
}

export function getDownloadedItem(itemId: string): DownloadedMedia | null {
  const downloads = getDownloadedMedia()
  return downloads.find(d => d.id === itemId) || null
}

export function isItemDownloaded(itemId: string): boolean {
  return getDownloadedItem(itemId) !== null
}

/**
 * Prune download entries whose files no longer exist on disk (deleted
 * externally, moved download folder, …). Returns the number pruned.
 * Call once at startup so the offline library never lists unplayable items.
 */
export async function verifyDownloadedMedia(): Promise<number> {
  const downloads = getDownloadedMedia()
  if (downloads.length === 0) return 0

  const stillValid: DownloadedMedia[] = []
  for (const item of downloads) {
    if (await api.fileExists(item.localPath)) {
      stillValid.push(item)
    } else {
      console.warn(`[Downloads] Pruning missing download: ${item.name} (${item.localPath})`)
    }
  }

  const pruned = downloads.length - stillValid.length
  if (pruned > 0) saveDownloadedMedia(stillValid)
  return pruned
}

export function isItemInQueue(itemId: string): DownloadQueueItem | null {
  const queue = getDownloadQueue()
  return queue.find(q => q.id === itemId) || null
}

export async function deleteDownloadedMedia(itemId: string): Promise<boolean> {
  const downloads = getDownloadedMedia()
  const item = downloads.find(d => d.id === itemId)

  if (!item) return false

  try {
    // Delete the directory containing the files
    const folderPath = item.localPath.replace(/\/video\.mp4$/, '')
    await api.deleteDirectory(folderPath)

    // Remove from downloads list
    const newDownloads = downloads.filter(d => d.id !== itemId)
    saveDownloadedMedia(newDownloads)

    return true
  } catch (error) {
    console.error('Failed to delete downloaded media:', error)
    return false
  }
}

// Get downloads grouped by series (for episodes)
export function getDownloadedMediaGrouped(): {
  movies: DownloadedMedia[]
  series: { seriesId: string; seriesName: string; episodes: DownloadedMedia[] }[]
} {
  const downloads = getDownloadedMedia()

  const movies = downloads.filter(d => d.type === 'Movie')
  const episodes = downloads.filter(d => d.type === 'Episode')

  // Group episodes by series
  const seriesMap = new Map<string, { seriesName: string; episodes: DownloadedMedia[] }>()

  for (const episode of episodes) {
    const seriesId = episode.seriesId || 'unknown'
    if (!seriesMap.has(seriesId)) {
      seriesMap.set(seriesId, {
        seriesName: episode.seriesName || 'Unknown Series',
        episodes: [],
      })
    }
    seriesMap.get(seriesId)!.episodes.push(episode)
  }

  // Sort episodes within each series
  for (const series of seriesMap.values()) {
    series.episodes.sort((a, b) => {
      const seasonDiff = (a.seasonNumber || 0) - (b.seasonNumber || 0)
      if (seasonDiff !== 0) return seasonDiff
      return (a.episodeNumber || 0) - (b.episodeNumber || 0)
    })
  }

  return {
    movies,
    series: Array.from(seriesMap.entries()).map(([seriesId, data]) => ({
      seriesId,
      ...data,
    })),
  }
}

// ==================== Progress Sync Functions ====================

export function getPendingProgress(): PendingProgressUpdate[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.PENDING_PROGRESS)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function savePendingProgress(updates: PendingProgressUpdate[]): void {
  localStorage.setItem(STORAGE_KEYS.PENDING_PROGRESS, JSON.stringify(updates))
}

export function addPendingProgress(
  itemId: string,
  serverId: string,
  serverUrl: string,
  accessToken: string,
  positionTicks: number
): void {
  const updates = getPendingProgress()

  // Update existing or add new
  const existingIndex = updates.findIndex(u => u.itemId === itemId)
  const update: PendingProgressUpdate = {
    itemId,
    serverId,
    serverUrl,
    accessToken,
    positionTicks,
    timestamp: Date.now(),
  }

  if (existingIndex >= 0) {
    updates[existingIndex] = update
  } else {
    updates.push(update)
  }

  savePendingProgress(updates)
}

export function clearPendingProgress(itemId: string): void {
  const updates = getPendingProgress()
  const newUpdates = updates.filter(u => u.itemId !== itemId)
  savePendingProgress(newUpdates)
}

export async function syncPendingProgress(): Promise<{ synced: number; failed: number }> {
  const updates = getPendingProgress()
  let synced = 0
  let failed = 0

  for (const update of updates) {
    try {
      // Report as "Stopped" — reliably persists the resume position on the
      // server even without an open play session (unlike Progress).
      // NOTE: data must be a plain object; JSON.stringify here would make the
      // Tauri backend send a JSON *string* body that Jellyfin ignores.
      const response = await api.request({
        method: 'POST',
        url: `${update.serverUrl}/Sessions/Playing/Stopped`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `MediaBrowser Token="${update.accessToken}"`,
        },
        data: {
          ItemId: update.itemId,
          PositionTicks: update.positionTicks,
          PlaySessionId: `offline-sync-${update.timestamp}`,
          PlayMethod: 'DirectPlay',
        },
      })

      if (response.success || response.status === 204) {
        clearPendingProgress(update.itemId)
        synced++
      } else {
        failed++
      }
    } catch (error) {
      console.error('Failed to sync progress for item:', update.itemId, error)
      failed++
    }
  }

  return { synced, failed }
}

// ==================== Utility Functions ====================

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function getDownloadStats(): {
  totalDownloads: number
  totalSize: number
  queueCount: number
  downloadingCount: number
} {
  const downloads = getDownloadedMedia()
  const queue = getDownloadQueue()

  return {
    totalDownloads: downloads.length,
    totalSize: downloads.reduce((sum, d) => sum + d.fileSize, 0),
    queueCount: queue.filter(q => q.status === 'queued' || q.status === 'paused').length,
    downloadingCount: queue.filter(q => q.status === 'downloading').length,
  }
}
