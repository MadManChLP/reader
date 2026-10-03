// Offline progress queue for Audiobookshelf.
// When a progress sync fails (server unreachable), the latest position is
// queued here and flushed via PATCH /api/me/progress/... once the server is
// reachable again (mirrors jellyfinOfflineQueue).
//
// Additionally keeps a local "last position" map (abs_local_progress) that is
// ALWAYS updated during playback — offline playback resumes from it.

import type { AbsApi } from './absApi'

export interface AbsQueuedProgress {
  itemId: string
  episodeId?: string | null
  currentTime: number
  duration: number
  progress: number // 0..1
  isFinished: boolean
  ts: number
}

const QUEUE_KEY = 'abs_offline_progress_queue'
const LOCAL_PROGRESS_KEY = 'abs_local_progress'

function entryKey(itemId: string, episodeId?: string | null): string {
  return episodeId ? `${itemId}/${episodeId}` : itemId
}

// ─── Offline queue (pending server syncs) ────────────────────────────────────

export function getAbsQueue(): AbsQueuedProgress[] {
  try {
    const stored = localStorage.getItem(QUEUE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveAbsQueue(queue: AbsQueuedProgress[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

/** Queue a progress update; only the newest entry per item/episode is kept. */
export function addToAbsQueue(entry: Omit<AbsQueuedProgress, 'ts'>): void {
  const key = entryKey(entry.itemId, entry.episodeId)
  const queue = getAbsQueue().filter((q) => entryKey(q.itemId, q.episodeId) !== key)
  queue.push({ ...entry, ts: Date.now() })
  saveAbsQueue(queue)
}

/** Flush all queued progress updates to the server. Keeps entries that fail. */
export async function processAbsQueue(api: AbsApi): Promise<void> {
  const queue = getAbsQueue()
  if (queue.length === 0) return

  console.log(`[AbsQueue] Flushing ${queue.length} queued progress update(s)`)
  const remaining: AbsQueuedProgress[] = []

  for (const entry of queue) {
    try {
      await api.patchProgress(
        entry.itemId,
        {
          currentTime: entry.currentTime,
          duration: entry.duration,
          progress: entry.progress,
          isFinished: entry.isFinished,
        },
        entry.episodeId,
      )
    } catch (e) {
      console.warn('[AbsQueue] Flush failed for', entry.itemId, e)
      remaining.push(entry)
    }
  }

  saveAbsQueue(remaining)
}

// ─── Local last-position map (offline resume) ────────────────────────────────

interface LocalProgressEntry {
  currentTime: number
  duration: number
  ts: number
}

function getLocalProgressMap(): Record<string, LocalProgressEntry> {
  try {
    const stored = localStorage.getItem(LOCAL_PROGRESS_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

export function saveLocalAbsProgress(itemId: string, episodeId: string | null | undefined, currentTime: number, duration: number): void {
  const map = getLocalProgressMap()
  map[entryKey(itemId, episodeId)] = { currentTime, duration, ts: Date.now() }
  localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(map))
}

export function getLocalAbsProgress(itemId: string, episodeId?: string | null): LocalProgressEntry | null {
  return getLocalProgressMap()[entryKey(itemId, episodeId)] ?? null
}
