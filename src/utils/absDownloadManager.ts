// Audiobookshelf Download Manager
// Downloads audiobooks / podcast episodes for offline listening.
// One "download" = a whole audiobook (all its audio files) or one episode.
// Files land in {downloadPath}/Audiobookshelf/{itemId}/ plus cover.jpg and
// item.json (metadata snapshot), mirroring musicDownloadManager's layout.

import { api } from './api'
import { beginDownloadTracking, endDownloadTracking } from '../stores/downloadProgressStore'
import { loadSettings } from '../types/settings'
import type { AbsApi } from './absApi'
import type { AbsChapter, AbsLibraryItem, AbsPodcastEpisode } from '../types/audiobookshelf'

export interface AbsDownloadedFile {
  localPath: string
  startOffset: number // absolute seconds within the whole book
  duration: number
  mimeType?: string
}

export interface AbsDownloadedItem {
  /** itemId for books, `${itemId}/${episodeId}` for episodes */
  key: string
  itemId: string
  episodeId?: string | null
  mediaType: 'book' | 'podcast'
  title: string
  author: string
  duration: number
  chapters: AbsChapter[]
  files: AbsDownloadedFile[]
  localCoverPath?: string
  downloadedAt: number
  totalSize: number
}

export interface AbsDownloadProgress {
  key: string
  itemId: string
  episodeId?: string | null
  title: string
  totalFiles: number
  completedFiles: number
  /** queued = waiting for the one running download to finish */
  status: 'queued' | 'downloading' | 'failed'
  error?: string
  /** URL of the file being transferred right now (for cancel) */
  currentUrl?: string
  /** Set by cancelAbsDownload — the loop stops and cleans up */
  cancelled?: boolean
}

// How to start a download again (retry after a failure)
const retryFns = new Map<string, () => Promise<boolean>>()

const DOWNLOADS_KEY = 'abs_downloads'

export function downloadKey(itemId: string, episodeId?: string | null): string {
  return episodeId ? `${itemId}/${episodeId}` : itemId
}

// ─── Persisted download index ────────────────────────────────────────────────

export function getAbsDownloads(): AbsDownloadedItem[] {
  try {
    const stored = localStorage.getItem(DOWNLOADS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveAbsDownloads(items: AbsDownloadedItem[]): void {
  localStorage.setItem(DOWNLOADS_KEY, JSON.stringify(items))
  notifyListeners()
}

export function getAbsDownload(itemId: string, episodeId?: string | null): AbsDownloadedItem | null {
  const key = downloadKey(itemId, episodeId)
  return getAbsDownloads().find((d) => d.key === key) || null
}

export function isAbsItemDownloaded(itemId: string, episodeId?: string | null): boolean {
  return getAbsDownload(itemId, episodeId) !== null
}

// ─── Progress events ─────────────────────────────────────────────────────────

const activeDownloads = new Map<string, AbsDownloadProgress>()

type AbsDownloadListener = (active: AbsDownloadProgress[], downloads: AbsDownloadedItem[]) => void
const listeners = new Set<AbsDownloadListener>()

export function subscribeToAbsDownloads(listener: AbsDownloadListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyListeners() {
  const active = Array.from(activeDownloads.values())
  const downloads = getAbsDownloads()
  listeners.forEach((l) => l(active, downloads))
}

export function getActiveAbsDownloads(): AbsDownloadProgress[] {
  return Array.from(activeDownloads.values())
}

// ─── Download ────────────────────────────────────────────────────────────────

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_')
}

async function getAbsFolder(itemId: string, episodeId?: string | null): Promise<string> {
  const settings = loadSettings()
  const downloadPath = settings.downloadPath || (await api.getDefaultPath())
  return episodeId
    ? `${downloadPath}/Audiobookshelf/${itemId}/episodes/${episodeId}`
    : `${downloadPath}/Audiobookshelf/${itemId}`
}

/**
 * Download a whole audiobook or a single podcast episode.
 * `item` must be the EXPANDED library item (media.audioFiles / episodes present).
 */
export async function downloadAbsItem(
  absApi: AbsApi,
  item: AbsLibraryItem,
  episodeId?: string | null,
): Promise<boolean> {
  const key = downloadKey(item.id, episodeId)
  if (activeDownloads.has(key) || isAbsItemDownloaded(item.id, episodeId)) return false

  let episode: AbsPodcastEpisode | undefined
  let audioFiles = item.media.audioFiles ?? []
  let chapters = item.media.chapters ?? []
  let title = item.media.metadata.title || 'Unknown'
  const author = item.media.metadata.authorName || ''

  if (episodeId) {
    episode = item.media.episodes?.find((e) => e.id === episodeId)
    if (!episode?.audioFile) {
      console.error('[AbsDownloads] Episode or its audio file not found:', episodeId)
      return false
    }
    audioFiles = [episode.audioFile]
    chapters = []
    title = episode.title
  }

  if (audioFiles.length === 0) {
    console.error('[AbsDownloads] Item has no audio files:', item.id)
    return false
  }

  retryFns.set(key, () => downloadAbsItem(absApi, item, episodeId))
  const progress: AbsDownloadProgress = {
    key,
    itemId: item.id,
    episodeId: episodeId ?? null,
    title,
    totalFiles: audioFiles.length,
    completedFiles: 0,
    status: 'queued',
  }
  activeDownloads.set(key, progress)
  notifyListeners()

  // One download at a time (tapping download on 15 episodes used to start
  // 15 parallel transfers). The promise resolves when THIS item is done.
  return new Promise<boolean>((resolve) => {
    jobQueue.push({
      key,
      run: () => runAbsDownload(absApi, item, episodeId, progress, { episode, audioFiles, chapters, title, author }),
      resolve,
    })
    void pumpQueue()
  })
}

interface AbsJob {
  key: string
  run: () => Promise<boolean>
  resolve: (ok: boolean) => void
}
const jobQueue: AbsJob[] = []
let pumping = false

async function pumpQueue(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (jobQueue.length > 0) {
      const job = jobQueue.shift()!
      let ok = false
      try { ok = await job.run() } catch { ok = false }
      job.resolve(ok)
    }
  } finally {
    pumping = false
  }
}

async function runAbsDownload(
  absApi: AbsApi,
  item: AbsLibraryItem,
  episodeId: string | null | undefined,
  progress: AbsDownloadProgress,
  src: {
    episode: AbsPodcastEpisode | undefined
    audioFiles: NonNullable<AbsLibraryItem['media']['audioFiles']>
    chapters: AbsChapter[]
    title: string
    author: string
  },
): Promise<boolean> {
  const { key } = progress
  const { episode, audioFiles, chapters, title, author } = src
  // Cancelled while waiting in the queue
  if (progress.cancelled || activeDownloads.get(key) !== progress) return false
  progress.status = 'downloading'
  notifyListeners()

  try {
    const folder = await getAbsFolder(item.id, episodeId)
    await api.createDirectory(folder)

    // Cover (best effort; token is embedded in the URL)
    const coverResult = await api.downloadFile({
      url: absApi.coverUrl(item.id, 600),
      folderPath: folder,
      fileName: 'cover.jpg',
    })
    const localCoverPath = coverResult.success ? `${folder}/cover.jpg` : undefined

    // Audio files, sequential, in track order
    const sorted = [...audioFiles].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const files: AbsDownloadedFile[] = []
    let offset = 0
    let totalSize = 0

    const multiFile = sorted.length > 1
    for (let i = 0; i < sorted.length; i++) {
      const audioFile = sorted[i]
      const baseName = sanitizeFileName(audioFile.metadata.filename || `${audioFile.index}.${audioFile.metadata.ext || 'mp3'}`)
      // Multi-disc books often have CD1/01.mp3 and CD2/01.mp3 — the basename
      // alone collided and disc 2 overwrote disc 1. Number every file.
      const fileName = multiFile ? `${String(i + 1).padStart(3, '0')} - ${baseName}` : baseName
      const fileUrl = absApi.fileDownloadUrl(item.id, audioFile.ino)
      // Byte-level ring on the download buttons; each file re-registers the
      // same key, so the fraction restarts per file
      beginDownloadTracking(key, fileUrl)
      if (progress.cancelled) throw new Error('Cancelled')
      progress.currentUrl = fileUrl
      const result = await api.downloadFile({
        url: fileUrl,
        folderPath: folder,
        fileName,
      })
      if (progress.cancelled) throw new Error('Cancelled')
      if (!result.success) throw new Error(result.error || `Failed to download ${fileName}`)

      const localPath = `${folder}/${fileName}`
      if (!(await api.fileExists(localPath))) throw new Error(`Downloaded file missing on disk: ${fileName}`)

      files.push({
        localPath,
        startOffset: offset,
        duration: audioFile.duration || 0,
        mimeType: audioFile.mimeType,
      })
      offset += audioFile.duration || 0
      totalSize += audioFile.metadata.size || 0

      progress.completedFiles += 1
      notifyListeners()
    }

    const duration = episodeId
      ? episode?.duration || episode?.audioFile?.duration || offset
      : item.media.duration || offset

    const downloaded: AbsDownloadedItem = {
      key,
      itemId: item.id,
      episodeId: episodeId ?? null,
      mediaType: item.mediaType,
      title,
      author,
      duration,
      chapters,
      files,
      localCoverPath,
      downloadedAt: Date.now(),
      totalSize,
    }

    await api.writeFile({
      path: `${folder}/item.json`,
      content: JSON.stringify(downloaded, null, 2),
    })

    const all = getAbsDownloads().filter((d) => d.key !== key)
    all.push(downloaded)
    saveAbsDownloads(all)

    activeDownloads.delete(key)
    retryFns.delete(key)
    notifyListeners()
    return true
  } catch (e: any) {
    if (progress.cancelled) {
      // User cancelled: drop the half-written folder and the entry
      activeDownloads.delete(key)
      retryFns.delete(key)
      notifyListeners()
      getAbsFolder(item.id, episodeId).then(f => api.deleteDirectory(f)).catch(() => {})
      return false
    }
    console.error('[AbsDownloads] Download failed:', e)
    progress.status = 'failed'
    progress.error = e?.message || 'Download failed'
    progress.currentUrl = undefined
    // Stays in the list (retry / dismiss in the download panel)
    notifyListeners()
    return false
  } finally {
    endDownloadTracking(key)
  }
}

/** Abort a running download (the current file transfer is cancelled in Rust). */
export function cancelAbsDownload(key: string): void {
  const p = activeDownloads.get(key)
  if (!p) return
  if (p.status === 'queued') {
    // Not started yet: just take it out of the line
    p.cancelled = true
    const i = jobQueue.findIndex(j => j.key === key)
    const [job] = i >= 0 ? jobQueue.splice(i, 1) : []
    activeDownloads.delete(key)
    retryFns.delete(key)
    notifyListeners()
    job?.resolve(false)
    return
  }
  if (p.status !== 'downloading') return
  p.cancelled = true
  if (p.currentUrl) void api.cancelDownload(p.currentUrl)
}

/** Stop everything (logout / server removed): queued items are dropped, the running one aborted. */
export function cancelAllAbsDownloads(): void {
  for (const p of Array.from(activeDownloads.values())) {
    if (p.status === 'failed') {
      activeDownloads.delete(p.key)
      retryFns.delete(p.key)
    } else {
      cancelAbsDownload(p.key)
    }
  }
  notifyListeners()
}

/** Start a failed download again. */
export function retryAbsDownload(key: string): void {
  const p = activeDownloads.get(key)
  const retry = retryFns.get(key)
  if (!p || p.status !== 'failed' || !retry) return
  activeDownloads.delete(key)
  notifyListeners()
  void retry()
}

/** Remove a failed entry from the list. */
export function dismissAbsDownload(key: string): void {
  const p = activeDownloads.get(key)
  if (!p || p.status !== 'failed') return
  activeDownloads.delete(key)
  retryFns.delete(key)
  notifyListeners()
}

// ─── Delete / verify ─────────────────────────────────────────────────────────

export async function deleteAbsDownload(key: string): Promise<void> {
  const downloads = getAbsDownloads()
  const item = downloads.find((d) => d.key === key)
  if (!item) return

  const folder = await getAbsFolder(item.itemId, item.episodeId)
  await api.deleteDirectory(folder).catch(() => {})

  saveAbsDownloads(downloads.filter((d) => d.key !== key))
}

/** Prune downloads whose files no longer exist on disk (call at startup). */
export async function verifyAbsDownloads(): Promise<number> {
  const downloads = getAbsDownloads()
  if (downloads.length === 0) return 0

  const valid: AbsDownloadedItem[] = []
  let pruned = 0
  for (const d of downloads) {
    const firstFile = d.files[0]
    if (firstFile && (await api.fileExists(firstFile.localPath))) {
      valid.push(d)
    } else {
      console.warn(`[AbsDownloads] Pruning missing download: ${d.title}`)
      pruned++
    }
  }
  if (pruned > 0) saveAbsDownloads(valid)
  return pruned
}
