/**
 * Calibre-Web Sync API Client
 *
 * Unified API for all sync operations through the Calibre-Web Sync API (port 8787).
 * The API proxies OPDS feeds and provides endpoints for:
 * - Read status sync (per-book)
 * - Bookmark/progress sync (per-book per-format)
 * - Started books listing
 *
 * Auth: JWT Bearer token from POST /api/login
 * Supports offline mode with IndexedDB caching and pending changes queue.
 */

import { getItem, setItem, removeItem } from './storage'
import api from './api'

// ============================================================================
// Types
// ============================================================================

export interface SyncState {
  readBooks: string[];          // Array of calibreIds marked as read
  bookmarks: Record<string, string>;  // "calibreId:FORMAT" -> bookmark value
  lastSynced: number;
}

export interface PendingChange {
  type: 'readstatus' | 'bookmark';
  calibreId: string;
  format?: string;              // Only for bookmarks
  value: boolean | string;      // isRead for readstatus, bookmark for bookmark
  timestamp: number;
}

export interface SyncResult {
  readStatus: { pulled: number; pushed: number };
  bookmarks: { pulled: number; pushed: number };
  lastSynced: number;
  errors?: string[];
}

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  READ_BOOKS: 'sync_readBooks',
  BOOKMARKS: 'sync_bookmarks',
  PENDING_CHANGES: 'sync_pendingChanges',
  LAST_SYNCED: 'sync_lastSynced',
};

// ============================================================================
// Auth Helper
// ============================================================================

function bearerHeader(token: string): Record<string, string> {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// ============================================================================
// Local Cache Functions (Async - IndexedDB)
// ============================================================================

/**
 * Load sync state from IndexedDB
 */
export async function loadSyncState(): Promise<SyncState> {
  try {
    const [readBooksStr, bookmarksStr, lastSyncedStr] = await Promise.all([
      getItem(STORAGE_KEYS.READ_BOOKS),
      getItem(STORAGE_KEYS.BOOKMARKS),
      getItem(STORAGE_KEYS.LAST_SYNCED),
    ])

    const readBooks = readBooksStr ? JSON.parse(readBooksStr) : []
    const bookmarks = bookmarksStr ? JSON.parse(bookmarksStr) : {}
    const lastSynced = lastSyncedStr ? parseInt(lastSyncedStr, 10) : 0

    return { readBooks, bookmarks, lastSynced }
  } catch (e) {
    console.error('[SyncApi] Failed to load sync state:', e)
    return { readBooks: [], bookmarks: {}, lastSynced: 0 }
  }
}

/**
 * Load sync state synchronously from memory cache
 * Used only for initial store state - falls back to empty state
 */
export function loadSyncStateSync(): SyncState {
  // Return empty state - actual data will be loaded async in initialize()
  return { readBooks: [], bookmarks: {}, lastSynced: 0 }
}

/**
 * Save sync state to IndexedDB
 */
export async function saveSyncState(state: SyncState): Promise<void> {
  try {
    await Promise.all([
      setItem(STORAGE_KEYS.READ_BOOKS, JSON.stringify(state.readBooks)),
      setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(state.bookmarks)),
      setItem(STORAGE_KEYS.LAST_SYNCED, state.lastSynced.toString()),
    ])
  } catch (e) {
    console.error('[SyncApi] Failed to save sync state:', e)
  }
}

/**
 * Get pending changes queue
 */
export async function getPendingChanges(): Promise<PendingChange[]> {
  try {
    const str = await getItem(STORAGE_KEYS.PENDING_CHANGES)
    return str ? JSON.parse(str) : []
  } catch (e) {
    return []
  }
}

/**
 * Add a pending change to the queue
 */
export async function addPendingChange(change: Omit<PendingChange, 'timestamp'>): Promise<void> {
  const changes = await getPendingChanges()
  const newChange: PendingChange = { ...change, timestamp: Date.now() }

  // Remove any existing change for the same item
  const filtered = changes.filter(c => {
    if (c.type !== newChange.type || c.calibreId !== newChange.calibreId) return true
    if (c.type === 'bookmark' && c.format !== newChange.format) return true
    return false
  })

  filtered.push(newChange)
  await setItem(STORAGE_KEYS.PENDING_CHANGES, JSON.stringify(filtered))
}

/**
 * Clear pending changes queue
 */
export async function clearPendingChanges(): Promise<void> {
  await removeItem(STORAGE_KEYS.PENDING_CHANGES)
}

/**
 * Replace the pending changes queue with a new list
 */
async function savePendingChanges(changes: PendingChange[]): Promise<void> {
  await setItem(STORAGE_KEYS.PENDING_CHANGES, JSON.stringify(changes))
}

// ============================================================================
// Token lifecycle
// ============================================================================

/**
 * Decode a JWT's `exp` claim (seconds since epoch) without verifying it.
 * Returns null if the token is malformed or has no numeric `exp`.
 */
export function getTokenExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.exp === 'number' ? json.exp : null
  } catch {
    return null
  }
}

/**
 * Exchange a still-valid token for a fresh one via POST /api/refresh.
 * Makes no Calibre-Web round trip (unlike a full login, which re-syncs read
 * status). Returns the new token, or null on failure (caller should re-login).
 */
export async function refreshToken(apiUrl: string, token: string): Promise<string | null> {
  try {
    const res = await api.request({
      method: 'POST',
      url: `${apiUrl.replace(/\/$/, '')}/api/refresh`,
      headers: bearerHeader(token),
    })
    if (res.success && res.data?.token) return res.data.token
  } catch (e) {
    console.error('[SyncApi] Token refresh error:', e)
  }
  return null
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Toggle read status for a book
 * Updates local cache immediately and queues sync server update
 */
export async function toggleReadStatus(
  apiUrl: string,
  token: string,
  calibreId: string,
  isOnline: boolean = true,
): Promise<boolean> {
  // Update local cache immediately
  const state = await loadSyncState()
  const wasRead = state.readBooks.includes(calibreId)
  const newIsRead = !wasRead

  if (newIsRead) {
    state.readBooks.push(calibreId)
  } else {
    state.readBooks = state.readBooks.filter(id => id !== calibreId)
  }
  await saveSyncState(state)

  // If offline, queue the change
  if (!isOnline) {
    await addPendingChange({ type: 'readstatus', calibreId, value: newIsRead })
    return newIsRead
  }

  // Try to sync with server
  try {
    const res = await api.request({
      method: 'PUT',
      url: `${apiUrl}/api/books/${calibreId}/read-status`,
      headers: bearerHeader(token),
      data: { read: newIsRead },
    })

    if (!res.success) {
      // Queue for later if server fails
      await addPendingChange({ type: 'readstatus', calibreId, value: newIsRead })
    }
  } catch (e) {
    console.error('[SyncApi] Toggle read status error:', e)
    await addPendingChange({ type: 'readstatus', calibreId, value: newIsRead })
  }

  return newIsRead
}

/**
 * Set specific read status for a book
 */
export async function setReadStatus(
  apiUrl: string,
  token: string,
  calibreId: string,
  isRead: boolean,
  isOnline: boolean = true,
): Promise<boolean> {
  // Update local cache immediately
  const state = await loadSyncState()
  const wasRead = state.readBooks.includes(calibreId)

  if (isRead && !wasRead) {
    state.readBooks.push(calibreId)
  } else if (!isRead && wasRead) {
    state.readBooks = state.readBooks.filter(id => id !== calibreId)
  }
  await saveSyncState(state)

  // If offline, queue the change
  if (!isOnline) {
    await addPendingChange({ type: 'readstatus', calibreId, value: isRead })
    return isRead
  }

  // Try to sync with server
  try {
    const res = await api.request({
      method: 'PUT',
      url: `${apiUrl}/api/books/${calibreId}/read-status`,
      headers: bearerHeader(token),
      data: { read: isRead },
    })

    if (!res.success) {
      await addPendingChange({ type: 'readstatus', calibreId, value: isRead })
    }
  } catch (e) {
    console.error('[SyncApi] Set read status error:', e)
    await addPendingChange({ type: 'readstatus', calibreId, value: isRead })
  }

  return isRead
}

/**
 * Check if a book is marked as read (async version)
 */
export async function isBookRead(calibreId: string | number | undefined): Promise<boolean> {
  if (!calibreId) return false
  const state = await loadSyncState()
  return state.readBooks.includes(String(calibreId))
}

/**
 * Check if a book is marked as read using cached state
 * For synchronous checks in render - use the store's syncReadBooks instead
 */
export function isBookReadSync(syncReadBooks: string[], calibreId: string | number | undefined): boolean {
  if (!calibreId) return false
  return syncReadBooks.includes(String(calibreId))
}

export interface BookmarkResult {
  position: string | null
  totalPages: number | null
}

/**
 * Get bookmark/progress for a book from the API.
 * Returns both the position and total_pages (for comic formats).
 */
export async function getBookmark(
  apiUrl: string,
  token: string,
  calibreId: string,
  format: string
): Promise<BookmarkResult> {
  const state = await loadSyncState()
  const key = `${calibreId}:${format.toUpperCase()}`
  const cached = state.bookmarks[key] || null

  try {
    const res = await api.request({
      method: 'GET',
      url: `${apiUrl}/api/books/${calibreId}/progress?format=${format.toUpperCase()}`,
      headers: bearerHeader(token),
    })

    if (!res.success) {
      return { position: cached, totalPages: null }
    }

    const data = res.data
    const position: string | null = data.position ?? null
    const totalPages: number | null = data.total_pages ?? null

    if (position) {
      state.bookmarks[key] = position
      await saveSyncState(state)
    }

    return { position: position ?? cached, totalPages }
  } catch (e) {
    console.error('[SyncApi] Get bookmark error:', e)
    return { position: cached, totalPages: null }
  }
}

/**
 * Set bookmark/progress for a book
 * Updates local cache immediately and queues sync server update
 */
export async function setBookmark(
  apiUrl: string,
  token: string,
  calibreId: string,
  format: string,
  bookmark: string,
  isOnline: boolean = true,
): Promise<boolean> {
  const key = `${calibreId}:${format.toUpperCase()}`

  // Update local cache immediately
  const state = await loadSyncState()
  state.bookmarks[key] = bookmark
  await saveSyncState(state)

  // If offline, queue the change
  if (!isOnline) {
    await addPendingChange({ type: 'bookmark', calibreId, format, value: bookmark })
    return true
  }

  // Try to sync with server
  try {
    const res = await api.request({
      method: 'PUT',
      url: `${apiUrl}/api/books/${calibreId}/progress`,
      headers: bearerHeader(token),
      data: { position: bookmark, format: format.toUpperCase() },
    })

    if (!res.success) {
      await addPendingChange({ type: 'bookmark', calibreId, format, value: bookmark })
      return false
    }

    return true
  } catch (e) {
    console.error('[SyncApi] Set bookmark error:', e)
    await addPendingChange({ type: 'bookmark', calibreId, format, value: bookmark })
    return false
  }
}

/**
 * Get bookmark from local cache (async version)
 */
export async function getLocalBookmark(calibreId: string, format: string): Promise<string | null> {
  const state = await loadSyncState()
  const key = `${calibreId}:${format.toUpperCase()}`
  return state.bookmarks[key] || null
}

/**
 * Initialize sync state from local cache
 * Call this on app startup
 */
export async function initializeSyncState(): Promise<SyncState> {
  const state = await loadSyncState()
  console.log(`[SyncApi] Initialized from local cache: ${state.readBooks.length} read books, ${Object.keys(state.bookmarks).length} bookmarks`)
  return state
}

/**
 * Process pending changes when coming back online
 */
export async function processPendingChanges(
  apiUrl: string,
  token: string
): Promise<number> {
  const pending = await getPendingChanges()
  if (pending.length === 0) return 0

  console.log(`[SyncApi] Processing ${pending.length} pending changes...`)
  let processed = 0
  const successIndices = new Set<number>()

  for (let i = 0; i < pending.length; i++) {
    const change = pending[i]
    try {
      if (change.type === 'readstatus') {
        const res = await api.request({
          method: 'PUT',
          url: `${apiUrl}/api/books/${change.calibreId}/read-status`,
          headers: bearerHeader(token),
          data: { read: change.value },
        })
        if (res.success) { processed++; successIndices.add(i) }
      } else if (change.type === 'bookmark' && change.format) {
        const res = await api.request({
          method: 'PUT',
          url: `${apiUrl}/api/books/${change.calibreId}/progress`,
          headers: bearerHeader(token),
          data: { position: change.value, format: change.format.toUpperCase() },
        })
        if (res.success) { processed++; successIndices.add(i) }
      }
    } catch (e) {
      console.error('[SyncApi] Failed to process pending change:', change, e)
    }
  }

  if (successIndices.size === pending.length) {
    await clearPendingChanges()
  } else if (successIndices.size > 0) {
    const remaining = pending.filter((_, i) => !successIndices.has(i))
    await savePendingChanges(remaining)
  }

  console.log(`[SyncApi] Processed ${processed}/${pending.length} pending changes`)
  return processed
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Build the first-class download URL for a book file.
 *
 * Uses the Sync API's streamed download (`GET /api/books/{id}/download?format=`)
 * instead of the raw `/opds/download/...` passthrough. The server streams to a
 * temp file (never fully buffered, honours MAX_COMIC_SIZE) and sets a correct
 * Content-Type + Content-Disposition. Both endpoints need the same Bearer auth.
 */
export function buildDownloadUrl(apiUrl: string, calibreId: string, format: string): string {
  const base = apiUrl.replace(/\/$/, '')
  return `${base}/api/books/${calibreId}/download?format=${(format || 'EPUB').toUpperCase()}`
}

/**
 * Check if a format is a comic format (CBR/CBZ/CBT)
 */
export function isComicFormat(format: string): boolean {
  const fmt = format.toLowerCase()
  return fmt === 'cbr' || fmt === 'cbz' || fmt === 'cbt'
}

/**
 * Check if a progress value is a CFI (epub.js format)
 */
export function isCfi(progress: string | number): boolean {
  return typeof progress === 'string' && progress.includes('epubcfi')
}

// ============================================================================
// Local EPUB Bookmark Functions (for manual bookmarks in Reader)
// ============================================================================

export interface EpubBookmark {
  id: string;
  name: string;
  cfi: string;
  createdAt: number;
}

const BOOKMARKS_STORAGE_KEY = 'epub_bookmarks'

/**
 * Get all local bookmarks for a book
 */
export async function getLocalBookmarks(bookId: string): Promise<EpubBookmark[]> {
  try {
    const stored = await getItem(`${BOOKMARKS_STORAGE_KEY}_${bookId}`)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.error('[SyncApi] Error reading local bookmarks:', e)
  }
  return []
}

/**
 * Save a local bookmark
 */
export async function saveLocalBookmark(bookId: string, name: string, cfi: string): Promise<EpubBookmark> {
  const bookmarks = await getLocalBookmarks(bookId)
  const newBookmark: EpubBookmark = {
    id: crypto.randomUUID(),
    name,
    cfi,
    createdAt: Date.now(),
  }
  bookmarks.push(newBookmark)
  await setItem(`${BOOKMARKS_STORAGE_KEY}_${bookId}`, JSON.stringify(bookmarks))
  return newBookmark
}

/**
 * Delete a local bookmark
 */
export async function deleteLocalBookmark(bookId: string, bookmarkId: string): Promise<void> {
  const bookmarks = await getLocalBookmarks(bookId)
  const filtered = bookmarks.filter(b => b.id !== bookmarkId)
  await setItem(`${BOOKMARKS_STORAGE_KEY}_${bookId}`, JSON.stringify(filtered))
}
