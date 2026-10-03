/**
 * Started Books Index
 *
 * Maintains an index of started book IDs for efficient lookup.
 * Uses IndexedDB for storage via the storage module.
 */

import { getItem, setItem, getKeysWithPrefix, initializeStorage } from './storage'

const STORAGE_KEY = 'started_book_ids'

/**
 * Get the set of started book IDs
 */
export async function getStartedBookIds(): Promise<Set<string>> {
  try {
    const stored = await getItem(STORAGE_KEY)
    if (!stored) return new Set()
    return new Set(JSON.parse(stored) as string[])
  } catch {
    return new Set()
  }
}

/**
 * Add a book ID to the started index
 */
export async function addStartedBookId(bookId: string): Promise<void> {
  const ids = await getStartedBookIds()
  ids.add(bookId)
  await saveStartedBookIds(ids)
}

/**
 * Remove a book ID from the started index
 */
export async function removeStartedBookId(bookId: string): Promise<void> {
  const ids = await getStartedBookIds()
  ids.delete(bookId)
  await saveStartedBookIds(ids)
}

/**
 * Save the started book IDs set
 */
async function saveStartedBookIds(ids: Set<string>): Promise<void> {
  await setItem(STORAGE_KEY, JSON.stringify([...ids]))
}

/**
 * Get all progress data for started books efficiently
 * Uses the index to look up specific keys rather than iterating all keys
 */
export async function getStartedBooksProgress(): Promise<{ id: string; data: any }[]> {
  const ids = await getStartedBookIds()
  if (ids.size === 0) return []

  // Fetch all progress entries in parallel instead of sequentially
  const entries = await Promise.all(
    [...ids].map(async (id) => {
      const key = `progress_${id}`
      try {
        const raw = await getItem(key)
        if (raw) {
          const data = JSON.parse(raw)
          if (data.percentage > 0 && data.percentage < 0.99) {
            return { id, data, stale: false }
          }
        }
        return { id, data: null, stale: true }
      } catch {
        return { id, data: null, stale: true }
      }
    })
  )

  // Clean up stale IDs (progress deleted or corrupted)
  const staleIds = entries.filter((e) => e.stale).map((e) => e.id)
  if (staleIds.length > 0) {
    staleIds.forEach((id) => ids.delete(id))
    await saveStartedBookIds(ids)
  }

  return entries.filter((e) => e.data !== null).map((e) => ({ id: e.id, data: e.data }))
}

/**
 * Rebuild the index from existing progress_ keys
 * Use this once during migration or if index gets corrupted
 */
export async function rebuildStartedBooksIndex(): Promise<Set<string>> {
  const ids = new Set<string>()
  const progressKeys = await getKeysWithPrefix('progress_')

  for (const key of progressKeys) {
    try {
      const raw = await getItem(key)
      if (raw) {
        const val = JSON.parse(raw)
        if (val.percentage > 0 && val.percentage < 0.99) {
          const id = val.id || key.replace('progress_', '')
          ids.add(id)
        }
      }
    } catch {
      // Skip invalid entries
    }
  }

  await saveStartedBookIds(ids)
  return ids
}

/**
 * Initialize the index - rebuilds if not present
 */
export async function initializeStartedBooksIndex(): Promise<void> {
  // Initialize storage first (handles migration)
  await initializeStorage()

  const existing = await getItem(STORAGE_KEY)
  if (!existing) {
    // First time or migrating - rebuild from existing progress_ keys
    await rebuildStartedBooksIndex()
  }
}
