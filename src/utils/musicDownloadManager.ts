// Music Download Manager
// Handles downloading music tracks and albums for offline listening

import { api } from './api'
import { loadSettings } from '../types/settings'
import { getUniversalAudioUrl } from './audioStream'
import type { Track } from '../stores/musicPlayerStore'

// Types
export type MusicDownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed'

export interface DownloadedTrack {
  id: string              // Jellyfin item ID
  serverId: string        // Server ID for multi-server support
  name: string
  artists: string[]
  artistIds: string[]
  albumId: string
  albumName: string
  duration: number        // ticks (100ns units)
  indexNumber?: number | null
  localPath: string       // Path to audio file
  imageUrl?: string       // Original image URL (for reference)
  localImagePath?: string // Path to local album art
  downloadedAt: number
  fileSize: number
}

export interface DownloadedAlbum {
  id: string              // Jellyfin album ID
  serverId: string
  name: string
  artist: string
  artistId?: string
  productionYear?: number
  overview?: string
  genres?: string[]
  localImagePath?: string
  trackIds: string[]      // IDs of downloaded tracks
  downloadedAt: number
  totalSize: number
}

export interface MusicDownloadQueueItem {
  id: string              // Track ID
  serverId: string
  serverUrl: string
  accessToken: string
  albumId: string
  albumName: string
  trackName: string
  artists: string[]
  artistIds: string[]
  duration: number
  indexNumber?: number | null
  status: MusicDownloadStatus
  progress: number        // 0-100 percentage
  totalBytes: number
  downloadedBytes: number
  addedAt: number
  error?: string
  /** Automatic retry counter for transient failures */
  attempts?: number
  // For album downloads
  isPartOfAlbumDownload?: boolean
  albumDownloadId?: string
  // For playlist downloads (a track can belong to both an album and a playlist download)
  playlistDownloadId?: string
}

/** Max automatic retries for a failed track download before it stays 'failed' */
const MAX_AUTO_RETRIES = 2

export interface AlbumDownloadProgress {
  albumId: string
  serverId: string
  serverUrl: string
  accessToken: string
  albumName: string
  artist: string
  artistId?: string
  totalTracks: number
  completedTracks: number
  status: MusicDownloadStatus
  addedAt: number
  error?: string
  // Metadata carried into DownloadedAlbum on completion
  productionYear?: number
  overview?: string
  genres?: string[]
}

/** Optional album metadata stored for offline browsing */
export interface AlbumDownloadMeta {
  productionYear?: number | null
  overview?: string | null
  genres?: string[] | null
}

// Storage keys
const STORAGE_KEYS = {
  MUSIC_DOWNLOAD_QUEUE: 'music_download_queue',
  DOWNLOADED_TRACKS: 'downloaded_music_tracks',
  DOWNLOADED_ALBUMS: 'downloaded_music_albums',
  ALBUM_DOWNLOAD_PROGRESS: 'album_download_progress',
  DOWNLOADED_PLAYLISTS: 'downloaded_music_playlists',
  PLAYLIST_DOWNLOAD_PROGRESS: 'playlist_download_progress',
}

// Active download state (not persisted)
let activeDownloadId: string | null = null
let activeDownloadUrl: string | null = null
let downloadAbortController: AbortController | null = null

/** Abort the actual in-flight transfer (Rust deletes the partial file) */
function abortActiveTransfer(): void {
  if (activeDownloadUrl) {
    api.cancelDownload(activeDownloadUrl)
  }
  downloadAbortController?.abort()
}

// Event emitter for download updates
type MusicDownloadEventListener = (
  queue: MusicDownloadQueueItem[],
  albumProgress: AlbumDownloadProgress[],
  playlistProgress: PlaylistDownloadProgress[],
) => void
const downloadListeners: Set<MusicDownloadEventListener> = new Set()

export function subscribeToMusicDownloadUpdates(listener: MusicDownloadEventListener): () => void {
  downloadListeners.add(listener)
  return () => downloadListeners.delete(listener)
}

function notifyDownloadListeners() {
  const queue = getMusicDownloadQueue()
  const albumProgress = getAlbumDownloadProgress()
  const playlistProgress = getPlaylistDownloadProgress()
  downloadListeners.forEach(listener => listener(queue, albumProgress, playlistProgress))
}

// ==================== Download Queue Functions ====================

export function getMusicDownloadQueue(): MusicDownloadQueueItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.MUSIC_DOWNLOAD_QUEUE)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveMusicDownloadQueue(queue: MusicDownloadQueueItem[]): void {
  localStorage.setItem(STORAGE_KEYS.MUSIC_DOWNLOAD_QUEUE, JSON.stringify(queue))
  notifyDownloadListeners()
}

export function getAlbumDownloadProgress(): AlbumDownloadProgress[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.ALBUM_DOWNLOAD_PROGRESS)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveAlbumDownloadProgress(progress: AlbumDownloadProgress[]): void {
  localStorage.setItem(STORAGE_KEYS.ALBUM_DOWNLOAD_PROGRESS, JSON.stringify(progress))
  notifyDownloadListeners()
}

export function addTrackToQueue(
  track: Track,
  serverUrl: string,
  serverId: string,
  accessToken: string,
  albumDownloadId?: string,
  playlistDownloadId?: string
): MusicDownloadQueueItem | null {
  // Check if already in queue or downloaded
  const queue = getMusicDownloadQueue()
  const downloads = getDownloadedTracks()

  const queued = queue.find(q => q.id === track.id)
  if (queued) {
    // Already pending for another album/playlist — just record this claim too so
    // cancelling the other one doesn't take this playlist's track with it.
    if (playlistDownloadId && !queued.playlistDownloadId) {
      queued.playlistDownloadId = playlistDownloadId
      saveMusicDownloadQueue(queue)
    }
    return null
  }

  if (downloads.some(d => d.id === track.id)) {
    console.log('Track already downloaded')
    return null
  }

  const queueItem: MusicDownloadQueueItem = {
    id: track.id,
    serverId,
    serverUrl,
    accessToken,
    albumId: track.albumId,
    albumName: track.albumName,
    trackName: track.name,
    artists: track.artists,
    artistIds: track.artistIds,
    duration: track.duration,
    indexNumber: track.indexNumber,
    status: 'queued',
    progress: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    addedAt: Date.now(),
    isPartOfAlbumDownload: !!albumDownloadId,
    albumDownloadId,
    playlistDownloadId,
  }

  queue.push(queueItem)
  saveMusicDownloadQueue(queue)

  // Start processing queue if not already
  processMusicQueue()

  return queueItem
}

export function removeTrackFromQueue(trackId: string): void {
  // If this is the active download, abort it
  if (activeDownloadId === trackId) {
    abortActiveTransfer()
  }

  const queue = getMusicDownloadQueue()
  const newQueue = queue.filter(q => q.id !== trackId)
  saveMusicDownloadQueue(newQueue)
}

export function pauseMusicDownload(trackId: string): void {
  // If this is the active download, abort it
  if (activeDownloadId === trackId) {
    abortActiveTransfer()
  }

  const queue = getMusicDownloadQueue()
  const item = queue.find(q => q.id === trackId)
  if (item && (item.status === 'downloading' || item.status === 'queued')) {
    item.status = 'paused'
    saveMusicDownloadQueue(queue)
  }
}

export function resumeMusicDownload(trackId: string): void {
  const queue = getMusicDownloadQueue()
  const item = queue.find(q => q.id === trackId)
  if (item && item.status === 'paused') {
    item.status = 'queued'
    saveMusicDownloadQueue(queue)
    processMusicQueue()
  }
}

export function retryMusicDownload(trackId: string): void {
  const queue = getMusicDownloadQueue()
  const item = queue.find(q => q.id === trackId)
  if (item && item.status === 'failed') {
    item.status = 'queued'
    item.progress = 0
    item.downloadedBytes = 0
    item.error = undefined
    saveMusicDownloadQueue(queue)
    processMusicQueue()
  }
}

// ==================== Album Download Functions ====================

export async function downloadAlbum(
  albumId: string,
  albumName: string,
  artist: string,
  artistId: string | undefined,
  tracks: Track[],
  serverUrl: string,
  serverId: string,
  accessToken: string,
  meta?: AlbumDownloadMeta
): Promise<void> {
  // Check if album is already being downloaded or is downloaded
  const existingProgress = getAlbumDownloadProgress()
  if (existingProgress.some(p => p.albumId === albumId && p.status !== 'failed')) {
    console.log('Album already being downloaded')
    return
  }

  const existingAlbums = getDownloadedAlbums()
  if (existingAlbums.some(a => a.id === albumId)) {
    console.log('Album already downloaded')
    return
  }

  // Create album download progress entry
  const albumProgress: AlbumDownloadProgress = {
    albumId,
    serverId,
    serverUrl,
    accessToken,
    albumName,
    artist,
    artistId,
    totalTracks: tracks.length,
    completedTracks: 0,
    status: 'downloading',
    addedAt: Date.now(),
    productionYear: meta?.productionYear ?? undefined,
    overview: meta?.overview ?? undefined,
    genres: meta?.genres ?? undefined,
  }

  const progress = [...existingProgress, albumProgress]
  saveAlbumDownloadProgress(progress)

  // Download album artwork first
  const settings = loadSettings()
  const downloadPath = settings.downloadPath || await api.getDefaultPath()
  const albumFolder = `${downloadPath}/JellyMusic/${serverId}/albums/${albumId}`

  await api.createDirectory(albumFolder)

  // Download album art
  // 1000px: big enough for the fullscreen Now Playing artwork on retina phones
  const imageUrl = `${serverUrl}/Items/${albumId}/Images/Primary?maxWidth=1000&quality=90`
  const imageResult = await api.downloadFile({
    url: imageUrl,
    folderPath: albumFolder,
    fileName: 'cover.jpg',
    headers: {
      'Authorization': `MediaBrowser Token="${accessToken}"`,
    },
  })

  const localImagePath = imageResult.success ? `${albumFolder}/cover.jpg` : undefined

  // Add all tracks to the queue with album download ID
  for (const track of tracks) {
    // Add imageUrl pointing to local album cover for offline playback
    const trackWithImage: Track = {
      ...track,
      imageUrl: localImagePath || track.imageUrl,
    }
    addTrackToQueue(trackWithImage, serverUrl, serverId, accessToken, albumId)
  }

  // Save album metadata
  const albumMetadata = {
    id: albumId,
    name: albumName,
    artist,
    artistId,
    productionYear: meta?.productionYear ?? undefined,
    overview: meta?.overview ?? undefined,
    genres: meta?.genres ?? undefined,
    localImagePath,
    trackIds: tracks.map(t => t.id),
  }

  await api.writeFile({
    path: `${albumFolder}/metadata.json`,
    content: JSON.stringify(albumMetadata, null, 2),
  })
}

export function cancelAlbumDownload(albumId: string): void {
  // Remove all queued tracks for this album
  const queue = getMusicDownloadQueue()
  const tracksToRemove = queue.filter(q => q.albumDownloadId === albumId)
  const serverId = tracksToRemove[0]?.serverId

  for (const track of tracksToRemove) {
    removeTrackFromQueue(track.id)
  }

  // Remove album progress
  const progress = getAlbumDownloadProgress()
  const newProgress = progress.filter(p => p.albumId !== albumId)
  saveAlbumDownloadProgress(newProgress)

  // Clean up the album folder (cover + metadata + any partial tracks),
  // unless some tracks of this album finished and remain downloaded
  const hasCompletedTracks = getDownloadedTracks().some(t => t.albumId === albumId)
  if (serverId && !hasCompletedTracks) {
    ;(async () => {
      const settings = loadSettings()
      const downloadPath = settings.downloadPath || await api.getDefaultPath()
      await api.deleteDirectory(`${downloadPath}/JellyMusic/${serverId}/albums/${albumId}`).catch(() => {})
      await api.deleteDirectory(`${downloadPath}/JellyMusic/${serverId}/tracks/${albumId}`).catch(() => {})
    })()
  }
}

function updateAlbumProgress(albumId: string): void {
  const progress = getAlbumDownloadProgress()
  const albumProgress = progress.find(p => p.albumId === albumId)
  if (!albumProgress) return

  const queue = getMusicDownloadQueue()
  const downloads = getDownloadedTracks()

  // Count completed tracks for this album
  const albumTracks = queue.filter(q => q.albumDownloadId === albumId)
  const downloadedAlbumTracks = downloads.filter(d => d.albumId === albumId)

  albumProgress.completedTracks = downloadedAlbumTracks.length

  // Check if album is complete
  if (albumProgress.completedTracks >= albumProgress.totalTracks) {
    albumProgress.status = 'completed'

    // Create the downloaded album entry
    const existingAlbums = getDownloadedAlbums()
    const newAlbum: DownloadedAlbum = {
      id: albumId,
      serverId: albumProgress.serverId,
      name: albumProgress.albumName,
      artist: albumProgress.artist,
      artistId: albumProgress.artistId,
      productionYear: albumProgress.productionYear,
      overview: albumProgress.overview,
      genres: albumProgress.genres,
      localImagePath: downloadedAlbumTracks[0]?.localImagePath,
      trackIds: downloadedAlbumTracks.map(t => t.id),
      downloadedAt: Date.now(),
      totalSize: downloadedAlbumTracks.reduce((sum, t) => sum + t.fileSize, 0),
    }
    existingAlbums.push(newAlbum)
    saveDownloadedAlbums(existingAlbums)

    // Remove from progress list
    const newProgress = progress.filter(p => p.albumId !== albumId)
    saveAlbumDownloadProgress(newProgress)
  } else {
    // Check if any tracks failed
    const failedTracks = albumTracks.filter(t => t.status === 'failed')
    if (failedTracks.length > 0 && albumTracks.every(t => t.status === 'failed' || t.status === 'completed')) {
      albumProgress.status = 'failed'
      albumProgress.error = `${failedTracks.length} track(s) failed to download`
    }

    saveAlbumDownloadProgress(progress)
  }
}

// ==================== Download Processing ====================

let isProcessing = false

export async function processMusicQueue(): Promise<void> {
  if (isProcessing) return
  isProcessing = true

  try {
    while (true) {
      const queue = getMusicDownloadQueue()
      const nextItem = queue.find(q => q.status === 'queued')

      if (!nextItem) break

      await downloadTrack(nextItem)
    }
  } finally {
    isProcessing = false
  }
}

async function downloadTrack(item: MusicDownloadQueueItem): Promise<void> {
  const settings = loadSettings()
  const downloadPath = settings.downloadPath || await api.getDefaultPath()

  // Update status to downloading
  updateQueueItemStatus(item.id, 'downloading')

  activeDownloadId = item.id
  downloadAbortController = new AbortController()

  try {
    // Create directory structure
    const trackFolder = `${downloadPath}/JellyMusic/${item.serverId}/tracks/${item.albumId}`
    await api.createDirectory(trackFolder)

    // Download the audio file
    // Jellyfin universal endpoint: direct-play supported containers, transcode the rest to mp3
    const streamUrl = getUniversalAudioUrl(item.serverUrl, item.id, item.accessToken)
    activeDownloadUrl = streamUrl

    // Get file size first
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

    // Determine file extension from content-type or default to mp3
    const contentType = headResponse.headers?.['content-type'] || 'audio/mpeg'
    let extension = 'mp3'
    if (contentType.includes('flac')) extension = 'flac'
    else if (contentType.includes('aac') || contentType.includes('mp4')) extension = 'm4a'
    else if (contentType.includes('webm')) extension = 'webm'
    else if (contentType.includes('ogg') || contentType.includes('opus')) extension = 'ogg'
    else if (contentType.includes('wav')) extension = 'wav'

    // Use track index in filename for proper ordering
    const trackIndex = item.indexNumber ? String(item.indexNumber).padStart(2, '0') : '00'
    const safeTrackName = item.trackName.replace(/[<>:"/\\|?*]/g, '_')
    const fileName = `${trackIndex} - ${safeTrackName}.${extension}`

    // Download the audio file
    const audioResult = await api.downloadFile({
      url: streamUrl,
      folderPath: trackFolder,
      fileName,
      headers: {
        'Authorization': `MediaBrowser Token="${item.accessToken}"`,
      },
    })

    // If the track was cancelled or paused while the transfer ran, do NOT
    // record it as downloaded — remove whatever landed on disk instead.
    const itemNow = getMusicDownloadQueue().find(q => q.id === item.id)
    if (!itemNow || itemNow.status !== 'downloading') {
      await api.deleteFile(`${trackFolder}/${fileName}`).catch(() => {})
      return
    }

    if (!audioResult.success) {
      throw new Error(audioResult.error || 'Failed to download track')
    }

    const localPath = `${trackFolder}/${fileName}`

    // Sanity check: the file must actually exist before we record it
    if (!(await api.fileExists(localPath))) {
      throw new Error('Downloaded file missing on disk')
    }

    // Get album art path if it exists
    const albumFolder = `${downloadPath}/JellyMusic/${item.serverId}/albums/${item.albumId}`
    const albumCoverPath = `${albumFolder}/cover.jpg`
    const hasAlbumCover = await api.fileExists(albumCoverPath)

    // Create downloaded track metadata
    const downloadedTrack: DownloadedTrack = {
      id: item.id,
      serverId: item.serverId,
      name: item.trackName,
      artists: item.artists,
      artistIds: item.artistIds,
      albumId: item.albumId,
      albumName: item.albumName,
      duration: item.duration,
      indexNumber: item.indexNumber,
      localPath,
      localImagePath: hasAlbumCover ? albumCoverPath : undefined,
      downloadedAt: Date.now(),
      fileSize: totalBytes,
    }

    // Save track metadata
    await api.writeFile({
      path: `${trackFolder}/${item.id}.json`,
      content: JSON.stringify(downloadedTrack, null, 2),
    })

    // Add to completed downloads
    addCompletedTrackDownload(downloadedTrack)

    // Remove from queue
    removeTrackFromQueue(item.id)

    // Update album progress if this was part of an album download
    if (item.albumDownloadId) {
      updateAlbumProgress(item.albumDownloadId)
    }
    // A track can belong to several downloaded playlists — refresh them all
    refreshPlaylistsContaining(item.id)

  } catch (error: any) {
    if (error.name === 'AbortError' || error.message === 'Cancelled') {
      // Download was cancelled/paused, don't mark as failed
      return
    }

    console.error('Track download failed:', error)

    // Auto-retry transient failures with a short backoff before giving up
    const attempts = (item.attempts ?? 0) + 1
    const stillWanted = getMusicDownloadQueue().some(q => q.id === item.id)
    if (stillWanted && attempts <= MAX_AUTO_RETRIES) {
      console.log(`[MusicDownloads] Retrying "${item.trackName}" (attempt ${attempts}/${MAX_AUTO_RETRIES})`)
      await new Promise(resolve => setTimeout(resolve, 3000 * attempts))
      const queue = getMusicDownloadQueue()
      const q = queue.find(x => x.id === item.id)
      if (q) {
        q.status = 'queued'
        q.attempts = attempts
        q.progress = 0
        q.downloadedBytes = 0
        saveMusicDownloadQueue(queue)  // processMusicQueue loop picks it up again
      }
    } else {
      updateQueueItemStatus(item.id, 'failed', error.message || 'Download failed')

      // Update album progress if this was part of an album download
      if (item.albumDownloadId) {
        updateAlbumProgress(item.albumDownloadId)
      }
      refreshPlaylistsContaining(item.id)
    }
  } finally {
    activeDownloadId = null
    activeDownloadUrl = null
    downloadAbortController = null
  }
}

/** Recompute progress for every downloaded playlist that lists this track. */
function refreshPlaylistsContaining(trackId: string): void {
  for (const playlist of getDownloadedPlaylists()) {
    if (playlist.trackIds.includes(trackId)) updatePlaylistProgress(playlist.id)
  }
}

function updateQueueItemStatus(trackId: string, status: MusicDownloadStatus, error?: string): void {
  const queue = getMusicDownloadQueue()
  const item = queue.find(q => q.id === trackId)
  if (item) {
    item.status = status
    if (error) item.error = error
    if (status === 'completed') item.progress = 100
    saveMusicDownloadQueue(queue)
  }
}

function updateQueueItemBytes(trackId: string, downloadedBytes: number, totalBytes: number): void {
  const queue = getMusicDownloadQueue()
  const item = queue.find(q => q.id === trackId)
  if (item) {
    item.downloadedBytes = downloadedBytes
    item.totalBytes = totalBytes
    item.progress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0
    saveMusicDownloadQueue(queue)
  }
}

// ==================== Completed Downloads Functions ====================

export function getDownloadedTracks(): DownloadedTrack[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.DOWNLOADED_TRACKS)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveDownloadedTracks(tracks: DownloadedTrack[]): void {
  localStorage.setItem(STORAGE_KEYS.DOWNLOADED_TRACKS, JSON.stringify(tracks))
}

function addCompletedTrackDownload(track: DownloadedTrack): void {
  const downloads = getDownloadedTracks()
  const existingIndex = downloads.findIndex(d => d.id === track.id)

  if (existingIndex >= 0) {
    downloads[existingIndex] = track
  } else {
    downloads.push(track)
  }

  saveDownloadedTracks(downloads)
}

export function getDownloadedAlbums(): DownloadedAlbum[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.DOWNLOADED_ALBUMS)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveDownloadedAlbums(albums: DownloadedAlbum[]): void {
  localStorage.setItem(STORAGE_KEYS.DOWNLOADED_ALBUMS, JSON.stringify(albums))
}

export function getDownloadedTrack(trackId: string): DownloadedTrack | null {
  const downloads = getDownloadedTracks()
  return downloads.find(d => d.id === trackId) || null
}

export function isTrackDownloaded(trackId: string): boolean {
  return getDownloadedTrack(trackId) !== null
}

/**
 * Prune track entries whose files no longer exist on disk and fix up album
 * entries that reference them. Returns the number of tracks pruned.
 * Call once at startup so offline playback never hits missing files.
 */
export async function verifyDownloadedTracks(): Promise<number> {
  const tracks = getDownloadedTracks()
  if (tracks.length === 0) return 0

  const stillValid: DownloadedTrack[] = []
  const prunedIds = new Set<string>()
  for (const track of tracks) {
    if (await api.fileExists(track.localPath)) {
      stillValid.push(track)
    } else {
      console.warn(`[MusicDownloads] Pruning missing track: ${track.name} (${track.localPath})`)
      prunedIds.add(track.id)
    }
  }

  if (prunedIds.size === 0) return 0
  saveDownloadedTracks(stillValid)

  // Remove pruned tracks from album entries; drop albums that lost all tracks
  const albums = getDownloadedAlbums()
  const updatedAlbums = albums
    .map(a => ({ ...a, trackIds: a.trackIds.filter(id => !prunedIds.has(id)) }))
    .filter(a => a.trackIds.length > 0)
  saveDownloadedAlbums(updatedAlbums)

  // Playlists keep their membership — a pruned track is simply "not downloaded
  // yet" and the next sync re-queues it. Only refresh their progress display.
  for (const playlist of getDownloadedPlaylists()) {
    if (playlist.trackIds.some(id => prunedIds.has(id))) updatePlaylistProgress(playlist.id)
  }

  return prunedIds.size
}

export function isTrackInQueue(trackId: string): MusicDownloadQueueItem | null {
  const queue = getMusicDownloadQueue()
  return queue.find(q => q.id === trackId) || null
}

export function getDownloadedAlbum(albumId: string): DownloadedAlbum | null {
  const albums = getDownloadedAlbums()
  return albums.find(a => a.id === albumId) || null
}

export function isAlbumDownloaded(albumId: string): boolean {
  return getDownloadedAlbum(albumId) !== null
}

export function isAlbumDownloading(albumId: string): AlbumDownloadProgress | null {
  const progress = getAlbumDownloadProgress()
  return progress.find(p => p.albumId === albumId) || null
}

export async function deleteDownloadedTrack(trackId: string): Promise<boolean> {
  const tracks = getDownloadedTracks()
  const track = tracks.find(t => t.id === trackId)

  if (!track) return false

  try {
    // Delete the audio file and metadata
    await api.deleteFile(track.localPath).catch(() => {})

    const settings = loadSettings()
    const downloadPath = settings.downloadPath || await api.getDefaultPath()
    const metadataPath = `${downloadPath}/JellyMusic/${track.serverId}/tracks/${track.albumId}/${trackId}.json`
    await api.deleteFile(metadataPath).catch(() => {})

    // Remove from downloads list
    const newTracks = tracks.filter(t => t.id !== trackId)
    saveDownloadedTracks(newTracks)

    // Update any album that contained this track
    const albums = getDownloadedAlbums()
    const album = albums.find(a => a.trackIds.includes(trackId))
    if (album) {
      album.trackIds = album.trackIds.filter(id => id !== trackId)
      if (album.trackIds.length === 0) {
        // All tracks deleted, remove album
        const newAlbums = albums.filter(a => a.id !== album.id)
        saveDownloadedAlbums(newAlbums)
      } else {
        saveDownloadedAlbums(albums)
      }
    }

    return true
  } catch (error) {
    console.error('Failed to delete downloaded track:', error)
    return false
  }
}

export async function deleteDownloadedAlbum(albumId: string): Promise<boolean> {
  const albums = getDownloadedAlbums()
  const album = albums.find(a => a.id === albumId)

  if (!album) return false

  try {
    // Delete all tracks in the album
    for (const trackId of album.trackIds) {
      await deleteDownloadedTrack(trackId)
    }

    // Delete album folder
    const settings = loadSettings()
    const downloadPath = settings.downloadPath || await api.getDefaultPath()
    const albumFolder = `${downloadPath}/JellyMusic/${album.serverId}/albums/${albumId}`
    await api.deleteDirectory(albumFolder).catch(() => {})

    // Remove album from list (should already be removed when all tracks were deleted)
    const newAlbums = albums.filter(a => a.id !== albumId)
    saveDownloadedAlbums(newAlbums)

    return true
  } catch (error) {
    console.error('Failed to delete downloaded album:', error)
    return false
  }
}

// ==================== Utility Functions ====================

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function getMusicDownloadStats(): {
  totalTracks: number
  totalAlbums: number
  totalPlaylists: number
  totalSize: number
  queueCount: number
  downloadingCount: number
} {
  const tracks = getDownloadedTracks()
  const albums = getDownloadedAlbums()
  const queue = getMusicDownloadQueue()

  return {
    totalTracks: tracks.length,
    totalAlbums: albums.length,
    totalPlaylists: getDownloadedPlaylists().length,
    totalSize: tracks.reduce((sum, t) => sum + t.fileSize, 0),
    queueCount: queue.filter(q => q.status === 'queued' || q.status === 'paused').length,
    downloadingCount: queue.filter(q => q.status === 'downloading').length,
  }
}

// Get downloaded tracks for an album (for offline playback)
export function getDownloadedAlbumTracks(albumId: string): DownloadedTrack[] {
  const tracks = getDownloadedTracks()
  return tracks
    .filter(t => t.albumId === albumId)
    .sort((a, b) => (a.indexNumber || 0) - (b.indexNumber || 0))
}

// Convert downloaded track to Track format for playback
export function downloadedTrackToTrack(downloaded: DownloadedTrack): Track {
  return {
    id: downloaded.id,
    name: downloaded.name,
    artists: downloaded.artists,
    artistIds: downloaded.artistIds,
    albumId: downloaded.albumId,
    albumName: downloaded.albumName,
    duration: downloaded.duration,
    indexNumber: downloaded.indexNumber,
    imageUrl: downloaded.localImagePath,
    // Include local audio file path so the player can play offline without streaming
    localPath: downloaded.localPath ? `book-file://${downloaded.localPath}` : undefined,
  }
}

// ==================== Playlist Downloads ====================
//
// A downloaded playlist is a *reference* to tracks, not a container: its tracks
// live in the normal `tracks/{albumId}/` folders and are shared with album
// downloads and other playlists. Only the cover and metadata live under
// `playlists/{playlistId}/`. Deleting a playlist therefore only removes the
// audio files that nothing else still references.

/** A playlist kept available offline. `trackIds` is the last synced membership, in playlist order. */
export interface DownloadedPlaylist {
  id: string                // Jellyfin playlist ID
  serverId: string
  serverUrl: string
  accessToken: string
  name: string
  localImagePath?: string
  /** Track IDs in playlist order, as of the last successful sync */
  trackIds: string[]
  downloadedAt: number
  lastSyncedAt?: number
  /** Re-check the server for changes whenever the app comes back online */
  autoSync: boolean
  /** Set when the last sync attempt failed (cleared on the next success) */
  syncError?: string
}

export interface PlaylistDownloadProgress {
  playlistId: string
  serverId: string
  name: string
  totalTracks: number
  completedTracks: number
  status: MusicDownloadStatus
  addedAt: number
  error?: string
}

export interface PlaylistSyncResult {
  /** Playlists whose membership actually changed */
  changed: number
  /** Tracks newly added to some playlist */
  added: number
  /** Tracks dropped from some playlist (and deleted if unreferenced) */
  removed: number
  /** Playlists whose sync request failed */
  failed: number
}

export function getDownloadedPlaylists(): DownloadedPlaylist[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.DOWNLOADED_PLAYLISTS)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveDownloadedPlaylists(playlists: DownloadedPlaylist[]): void {
  localStorage.setItem(STORAGE_KEYS.DOWNLOADED_PLAYLISTS, JSON.stringify(playlists))
}

export function getPlaylistDownloadProgress(): PlaylistDownloadProgress[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.PLAYLIST_DOWNLOAD_PROGRESS)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function savePlaylistDownloadProgress(progress: PlaylistDownloadProgress[]): void {
  localStorage.setItem(STORAGE_KEYS.PLAYLIST_DOWNLOAD_PROGRESS, JSON.stringify(progress))
  notifyDownloadListeners()
}

export function getDownloadedPlaylist(playlistId: string): DownloadedPlaylist | null {
  return getDownloadedPlaylists().find(p => p.id === playlistId) || null
}

export function isPlaylistDownloaded(playlistId: string): boolean {
  return getDownloadedPlaylist(playlistId) !== null
}

export function isPlaylistDownloading(playlistId: string): PlaylistDownloadProgress | null {
  return getPlaylistDownloadProgress().find(p => p.playlistId === playlistId) || null
}

/** True when an album download or another playlist still needs this track's file. */
function isTrackReferencedElsewhere(trackId: string, excludePlaylistId?: string): boolean {
  if (getDownloadedAlbums().some(a => a.trackIds.includes(trackId))) return true
  return getDownloadedPlaylists().some(p => p.id !== excludePlaylistId && p.trackIds.includes(trackId))
}

/**
 * Make sure `albums/{albumId}/cover.jpg` exists for every album the given tracks
 * belong to. Playlist tracks usually come from albums that were never downloaded
 * as a whole, and `downloadTrack` picks its artwork up from that path — without
 * this an offline playlist would have no covers.
 */
async function ensureAlbumCovers(
  tracks: Track[],
  serverUrl: string,
  serverId: string,
  accessToken: string,
): Promise<void> {
  const settings = loadSettings()
  const downloadPath = settings.downloadPath || await api.getDefaultPath()
  const albumIds = Array.from(new Set(tracks.map(t => t.albumId).filter(Boolean)))

  for (const albumId of albumIds) {
    const albumFolder = `${downloadPath}/JellyMusic/${serverId}/albums/${albumId}`
    const coverPath = `${albumFolder}/cover.jpg`
    if (await api.fileExists(coverPath)) continue

    await api.createDirectory(albumFolder)
    await api.downloadFile({
      url: `${serverUrl}/Items/${albumId}/Images/Primary?maxWidth=1000&quality=90`,
      folderPath: albumFolder,
      fileName: 'cover.jpg',
      headers: { 'Authorization': `MediaBrowser Token="${accessToken}"` },
    }).catch(() => {})
  }
}

/**
 * Download every track of a playlist for offline listening.
 * Tracks already on disk (from an album or another playlist) are reused as-is.
 */
export async function downloadPlaylist(
  playlistId: string,
  playlistName: string,
  tracks: Track[],
  serverUrl: string,
  serverId: string,
  accessToken: string,
  autoSync = true,
): Promise<void> {
  const playlists = getDownloadedPlaylists()
  if (playlists.some(p => p.id === playlistId)) {
    console.log('[MusicDownloads] Playlist already downloaded')
    return
  }

  const settings = loadSettings()
  const downloadPath = settings.downloadPath || await api.getDefaultPath()
  const playlistFolder = `${downloadPath}/JellyMusic/${serverId}/playlists/${playlistId}`
  await api.createDirectory(playlistFolder)

  const imageResult = await api.downloadFile({
    url: `${serverUrl}/Items/${playlistId}/Images/Primary?maxWidth=1000&quality=90`,
    folderPath: playlistFolder,
    fileName: 'cover.jpg',
    headers: { 'Authorization': `MediaBrowser Token="${accessToken}"` },
  }).catch(() => ({ success: false } as { success: boolean }))

  const entry: DownloadedPlaylist = {
    id: playlistId,
    serverId,
    serverUrl,
    accessToken,
    name: playlistName,
    localImagePath: imageResult.success ? `${playlistFolder}/cover.jpg` : undefined,
    trackIds: tracks.map(t => t.id),
    downloadedAt: Date.now(),
    lastSyncedAt: Date.now(),
    autoSync,
  }
  saveDownloadedPlaylists([...playlists, entry])

  await api.writeFile({
    path: `${playlistFolder}/metadata.json`,
    content: JSON.stringify({ id: playlistId, name: playlistName, trackIds: entry.trackIds }, null, 2),
  })

  await ensureAlbumCovers(tracks, serverUrl, serverId, accessToken)

  for (const track of tracks) {
    addTrackToQueue(track, serverUrl, serverId, accessToken, undefined, playlistId)
  }

  updatePlaylistProgress(playlistId)
}

/**
 * Recompute a playlist's completion from what is actually on disk. Tracks can
 * arrive via an album download or another playlist, so membership of the
 * download queue is not a reliable measure — presence in the track store is.
 */
export function updatePlaylistProgress(playlistId: string): void {
  const entry = getDownloadedPlaylist(playlistId)
  const progress = getPlaylistDownloadProgress()
  const existingIndex = progress.findIndex(p => p.playlistId === playlistId)

  const dropProgress = () => {
    if (existingIndex >= 0) {
      progress.splice(existingIndex, 1)
      savePlaylistDownloadProgress(progress)
    }
  }

  if (!entry) {
    dropProgress()
    return
  }

  const downloadedIds = new Set(getDownloadedTracks().map(t => t.id))
  const completed = entry.trackIds.filter(id => downloadedIds.has(id)).length

  // Fully offline — nothing left to show in the "downloading" list
  if (completed >= entry.trackIds.length) {
    dropProgress()
    return
  }

  // Still incomplete: report failure only once nothing is moving any more
  const queue = getMusicDownloadQueue()
  const pending = entry.trackIds.filter(id => !downloadedIds.has(id))
  const failedCount = pending.filter(id => queue.find(q => q.id === id)?.status === 'failed').length
  const stalled = pending.every(id => {
    const status = queue.find(q => q.id === id)?.status
    return status === 'failed' || status === undefined
  })
  const hasFailed = stalled && failedCount > 0

  const next: PlaylistDownloadProgress = {
    playlistId,
    serverId: entry.serverId,
    name: entry.name,
    totalTracks: entry.trackIds.length,
    completedTracks: completed,
    status: hasFailed ? 'failed' : 'downloading',
    addedAt: existingIndex >= 0 ? progress[existingIndex].addedAt : Date.now(),
    error: hasFailed ? `${failedCount} track(s) failed to download` : undefined,
  }

  if (existingIndex >= 0) progress[existingIndex] = next
  else progress.push(next)
  savePlaylistDownloadProgress(progress)
}

/** Turn automatic re-syncing on or off for a downloaded playlist. */
export function setPlaylistAutoSync(playlistId: string, autoSync: boolean): void {
  const playlists = getDownloadedPlaylists()
  const entry = playlists.find(p => p.id === playlistId)
  if (!entry) return
  entry.autoSync = autoSync
  saveDownloadedPlaylists(playlists)
  notifyDownloadListeners()
}

/** Stop an in-progress playlist download and remove everything it brought in. */
export function cancelPlaylistDownload(playlistId: string): void {
  const queue = getMusicDownloadQueue()
  for (const item of queue.filter(q => q.playlistDownloadId === playlistId)) {
    removeTrackFromQueue(item.id)
  }
  void deleteDownloadedPlaylist(playlistId)
}

/**
 * Remove a downloaded playlist. Audio files are deleted only when no downloaded
 * album and no other downloaded playlist still references them.
 */
export async function deleteDownloadedPlaylist(playlistId: string): Promise<boolean> {
  const playlists = getDownloadedPlaylists()
  const entry = playlists.find(p => p.id === playlistId)
  if (!entry) return false

  // Drop the entry first so the reference check below no longer counts itself
  saveDownloadedPlaylists(playlists.filter(p => p.id !== playlistId))

  for (const trackId of entry.trackIds) {
    if (!isTrackReferencedElsewhere(trackId)) {
      await deleteDownloadedTrack(trackId)
    }
  }

  const settings = loadSettings()
  const downloadPath = settings.downloadPath || await api.getDefaultPath()
  await api.deleteDirectory(
    `${downloadPath}/JellyMusic/${entry.serverId}/playlists/${playlistId}`
  ).catch(() => {})

  updatePlaylistProgress(playlistId)
  notifyDownloadListeners()
  return true
}

/** Downloaded tracks of a playlist, in playlist order (not-yet-downloaded ones skipped). */
export function getDownloadedPlaylistTracks(playlistId: string): DownloadedTrack[] {
  const entry = getDownloadedPlaylist(playlistId)
  if (!entry) return []
  const byId = new Map(getDownloadedTracks().map(t => [t.id, t]))
  return entry.trackIds
    .map(id => byId.get(id))
    .filter((t): t is DownloadedTrack => !!t)
}

/**
 * Re-read every auto-syncing playlist from the server and reconcile the local
 * copy: newly added tracks are queued for download, removed ones are deleted
 * (unless something else still references them), and the stored order is updated.
 *
 * Uses `GET /Playlists/{id}/Items` — the route that returns the playlist's live
 * membership in playlist order — so externally generated playlists are picked up.
 */
export async function syncDownloadedPlaylists(): Promise<PlaylistSyncResult> {
  const result: PlaylistSyncResult = { changed: 0, added: 0, removed: 0, failed: 0 }
  const entries = getDownloadedPlaylists().filter(p => p.autoSync)
  if (entries.length === 0) return result

  const settings = loadSettings()

  for (const entry of entries) {
    // Prefer the current session's credentials — the stored token may have been
    // rotated by a re-login since the playlist was downloaded.
    const server = settings.jellyfinServers.find(s => s.id === entry.serverId)
    const serverUrl = server?.url || entry.serverUrl
    const token = server?.accessToken || entry.accessToken
    const userId = server?.userId

    if (!serverUrl || !token) {
      result.failed++
      continue
    }

    const params = new URLSearchParams({ enableImages: 'false', enableUserData: 'false' })
    if (userId) params.set('userId', userId)

    let items: any[]
    try {
      const res = await api.request({
        method: 'GET',
        url: `${serverUrl}/Playlists/${entry.id}/Items?${params.toString()}`,
        headers: { 'Authorization': `MediaBrowser Token="${token}"` },
      })
      if (!res.success || res.status !== 200 || !res.data) {
        throw new Error(res.error || `HTTP ${res.status}`)
      }
      items = res.data.Items || []
    } catch (e: any) {
      console.warn(`[PlaylistSync] "${entry.name}" failed:`, e?.message || e)
      markPlaylistSyncError(entry.id, e?.message || 'Sync failed')
      result.failed++
      continue
    }

    const tracks: Track[] = items
      .filter(i => i?.Id)
      .map(i => ({
        id: i.Id as string,
        name: i.Name || 'Unknown Track',
        artists: i.Artists?.length ? i.Artists : [i.AlbumArtist || 'Unknown Artist'],
        artistIds: (i.ArtistItems || []).map((a: any) => a?.Id).filter(Boolean),
        albumId: i.AlbumId || '',
        albumName: i.Album || 'Unknown Album',
        duration: i.RunTimeTicks || 0,
        indexNumber: i.IndexNumber ?? null,
      }))

    const newIds = tracks.map(t => t.id)
    const oldIds = entry.trackIds
    const addedIds = newIds.filter(id => !oldIds.includes(id))
    const removedIds = oldIds.filter(id => !newIds.includes(id))

    // Commit the new membership before touching files: the reference check for
    // removed tracks must already see this playlist's updated track list.
    const playlists = getDownloadedPlaylists()
    const stored = playlists.find(p => p.id === entry.id)
    if (!stored) continue
    stored.trackIds = newIds
    stored.lastSyncedAt = Date.now()
    stored.syncError = undefined
    saveDownloadedPlaylists(playlists)

    for (const trackId of removedIds) {
      if (!isTrackReferencedElsewhere(trackId)) {
        await deleteDownloadedTrack(trackId)
      }
    }

    // Queue everything not on disk yet — this also retakes tracks whose download
    // failed or was interrupted in an earlier session, not just new additions.
    const downloadedIds = new Set(getDownloadedTracks().map(t => t.id))
    const missing = tracks.filter(t => !downloadedIds.has(t.id) && !isTrackInQueue(t.id))

    if (missing.length > 0) {
      await ensureAlbumCovers(missing, serverUrl, entry.serverId, token)
      for (const track of missing) {
        addTrackToQueue(track, serverUrl, entry.serverId, token, undefined, entry.id)
      }
    }

    updatePlaylistProgress(entry.id)

    if (addedIds.length > 0 || removedIds.length > 0) {
      result.changed++
      result.added += addedIds.length
      result.removed += removedIds.length
      console.log(
        `[PlaylistSync] "${entry.name}": +${addedIds.length} / -${removedIds.length} track(s)`
      )
    }
  }

  notifyDownloadListeners()
  return result
}

function markPlaylistSyncError(playlistId: string, error: string): void {
  const playlists = getDownloadedPlaylists()
  const entry = playlists.find(p => p.id === playlistId)
  if (!entry) return
  entry.syncError = error
  saveDownloadedPlaylists(playlists)
}
