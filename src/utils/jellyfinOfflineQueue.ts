/**
 * Jellyfin Offline Queue
 *
 * Queues Jellyfin progress/play events when offline or when playing local files.
 * Flushed to the Jellyfin server when connectivity is restored.
 *
 * Uses IndexedDB (via idb-keyval) consistent with the rest of the app.
 */

import { get, set } from 'idb-keyval'

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
  return `MediaBrowser Token="${token}", Client="Reader", Device="Desktop", DeviceId="reader-app", Version="1.0"`
}

async function postJellyfin(url: string, token: string, body?: object): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': jellyfinAuthHeader(token),
      },
      body: body ? JSON.stringify(body) : undefined,
      keepalive: true,
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Process all queued operations, sending them to the Jellyfin server.
 * Successful operations are removed from the queue; failed ones remain for retry.
 * Returns the number of successfully processed operations.
 */
export async function processJellyfinQueue(): Promise<number> {
  const queue = await loadQueue()
  if (queue.length === 0) return 0

  console.log(`[JellyfinQueue] Processing ${queue.length} queued operation(s)...`)

  const failedOps: JellyfinQueuedOp[] = []
  let processed = 0

  for (const op of queue) {
    let success = false

    try {
      if (op.type === 'video_progress') {
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
        // Mark video as played (increments play count, sets LastPlayedDate)
        success = await postJellyfin(
          `${op.serverUrl}/Users/${op.userId}/PlayedItems/${op.itemId}`,
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
    } else {
      failedOps.push(op)
    }
  }

  await saveQueue(failedOps)
  console.log(`[JellyfinQueue] Processed ${processed}/${queue.length} operations. ${failedOps.length} remain.`)
  return processed
}
