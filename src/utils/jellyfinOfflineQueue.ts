/**
 * Jellyfin Offline Queue
 *
 * Queues Jellyfin progress/play events when offline or when playing local files.
 * Flushed to the Jellyfin server when connectivity is restored.
 *
 * Uses IndexedDB (via idb-keyval) consistent with the rest of the app.
 */

import { get, set } from 'idb-keyval'
import { api } from './api'
import { getJellyfinDeviceId } from './jellyfinDeviceId'
import { getServerLastPlayed } from './jellyfinDownloadManager'

const QUEUE_KEY = 'jellyfin_offline_queue'

// ─── Queue operation types ───────────────────────────────────────────────────

export type JellyfinQueuedOp =
  /** Video stopped or paused — save resume position */
  | {
      type: 'video_progress'
      itemId: string
      mediaSourceId: string
      positionTicks: number
      serverId: string
      serverUrl: string
      token: string
      userId: string
      timestamp: number
    }
  /** Video watched to completion */
  | {
      type: 'video_played'
      itemId: string
      serverId: string
      serverUrl: string
      token: string
      userId: string
      timestamp: number
    }
  /** Music track played past the 90% threshold */
  | {
      type: 'music_played'
      trackId: string
      albumId: string
      serverId: string
      serverUrl: string
      token: string
      userId: string
      timestamp: number
    }

// ─── Queue management ────────────────────────────────────────────────────────

async function loadQueue(): Promise<JellyfinQueuedOp[]> {
  try {
    const raw = await get<JellyfinQueuedOp[]>(QUEUE_KEY)
    return raw ?? []
  } catch {
    return []
  }
}

async function saveQueue(queue: JellyfinQueuedOp[]): Promise<void> {
  try {
    await set(QUEUE_KEY, queue)
  } catch (e) {
    console.error('[JellyfinQueue] Failed to save queue:', e)
  }
}

export async function addToJellyfinQueue(op: JellyfinQueuedOp): Promise<void> {
  const queue = await loadQueue()

  if (op.type === 'video_progress') {
    // Deduplicate: replace any existing progress entry for the same item
    const existing = queue.findIndex(
      q => q.type === 'video_progress' && q.itemId === op.itemId && q.serverId === op.serverId
    )
    if (existing !== -1) {
      queue[existing] = op
    } else {
      queue.push(op)
    }
  } else {
    // For played events: deduplicate by itemId+type (no double-counting)
    const alreadyQueued = queue.some(
      q => q.type === op.type && (q as any).itemId === (op as any).itemId && q.serverId === op.serverId
    )
    if (!alreadyQueued) {
      queue.push(op)
    }
  }

  await saveQueue(queue)
}

export async function getJellyfinQueue(): Promise<JellyfinQueuedOp[]> {
  return loadQueue()
}

// ─── Queue processing ────────────────────────────────────────────────────────

function jellyfinAuthHeader(token: string): string {
  return `MediaBrowser Token="${token}", Client="Reader", Device="Desktop", DeviceId="${getJellyfinDeviceId()}", Version="1.0"`
}

async function postJellyfin(url: string, token: string, body?: object): Promise<boolean> {
  // Through the app's HTTP layer (Rust), not browser fetch: it honours the
  // self-signed-certificate setting and isn't subject to WebView CORS, so
  // queued ops no longer fail forever on such servers.
  try {
    const res = await api.request({
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': jellyfinAuthHeader(token),
      },
      data: body,
    })
    return res.success || res.status === 204
  } catch {
    return false
  }
}

/**
 * Process all queued operations, sending them to the Jellyfin server.
 * Successful operations are removed from the queue; failed ones remain for retry.
 * Returns the number of successfully processed operations.
 */
let processInFlight: Promise<number> | null = null

/** Identity of a queued op (ops are never edited in place). */
function opKey(op: JellyfinQueuedOp): string {
  return `${op.type}|${op.type === 'music_played' ? op.trackId : op.itemId}|${op.timestamp}`
}

export function processJellyfinQueue(): Promise<number> {
  // Single-flight: concurrent triggers (startup, online, reconnect) share one run
  if (!processInFlight) {
    processInFlight = runJellyfinQueue().finally(() => { processInFlight = null })
  }
  return processInFlight
}

async function runJellyfinQueue(): Promise<number> {
  const queue = await loadQueue()
  if (queue.length === 0) return 0

  console.log(`[JellyfinQueue] Processing ${queue.length} queued operation(s)...`)

  const handled = new Set<string>()
  let processed = 0

  for (const op of queue) {
    let success = false

    try {
      if (op.type === 'video_progress') {
        // Older than playback on another device → drop instead of rolling it back
        const lastPlayed = await getServerLastPlayed(op.serverUrl, op.token, op.itemId)
        if (lastPlayed !== null && lastPlayed > op.timestamp) {
          handled.add(opKey(op))
          continue
        }
        // Report playback stopped with the saved position
        success = await postJellyfin(
          `${op.serverUrl}/Sessions/Playing/Stopped`,
          op.token,
          {
            ItemId: op.itemId,
            MediaSourceId: op.mediaSourceId,
            PositionTicks: op.positionTicks,
            PlaySessionId: `offline-sync-${op.timestamp}`,
            PlayMethod: 'DirectPlay',
            IsPaused: true,
          }
        )
      } else if (op.type === 'video_played') {
        // Mark video as played (increments play count, sets LastPlayedDate).
        // Token-scoped route: queued ops may carry an empty userId.
        success = await postJellyfin(
          `${op.serverUrl}/UserPlayedItems/${op.itemId}`,
          op.token
        )
      } else if (op.type === 'music_played') {
        // Mark track as played. music_played ops carry no userId (the enqueuing
        // side leaves it empty), so use the route that derives the user from the
        // token rather than /Users/{userId}/PlayedItems.
        success = await postJellyfin(
          `${op.serverUrl}/UserPlayedItems/${op.trackId}`,
          op.token
        )
      }
    } catch (e) {
      console.error('[JellyfinQueue] Failed to process op:', op.type, e)
    }

    if (success) {
      processed++
      handled.add(opKey(op))
    }
  }

  // Re-read and remove only what was handled: ops queued while this flush
  // was running used to be overwritten (lost) by the saved snapshot.
  const remaining = (await loadQueue()).filter(op => !handled.has(opKey(op)))
  await saveQueue(remaining)
  console.log(`[JellyfinQueue] Processed ${processed}/${queue.length} operations. ${remaining.length} remain.`)
  return processed
}
