/**
 * Calibre book-list cache with ETag conditional fetching.
 *
 * The full `/api/books` list can be large (thousands of entries) and is needed
 * by several Calibre views (All Books, Series, book details siblings). The Sync
 * API returns a weak `ETag` and honours `If-None-Match` → `304 Not Modified`, so
 * we persist the list + its ETag in IndexedDB and only re-download when the
 * library actually changed. This makes library open near-instant across refreshes
 * and app restarts, and turns in-session refreshes into an empty-body 304.
 */

import { getItem, setItem, removeItem } from './storage'
import api from './api'

const BOOKS_LIST_KEY = 'calibre_books_list'
const BOOKS_ETAG_KEY = 'calibre_books_etag'

/** Case-insensitive header lookup (Rust lowercases keys, axios may too). */
function getHeader(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null
  const lower = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key]
  }
  return null
}

/**
 * Fetch the full Calibre book list, revalidating against a persisted ETag.
 *
 * - Sends `If-None-Match` when a cached ETag exists.
 * - On `304`, returns the persisted list without re-parsing a payload.
 * - On `200`, persists the fresh list + ETag and returns it.
 * - On network failure, falls back to the persisted list (possibly empty).
 *
 * `baseUrl` must be the API server origin with no trailing slash.
 */
export async function fetchBooksList(
  baseUrl: string,
  authHeader: Record<string, string>,
): Promise<any[]> {
  let cachedList: any[] = []
  let etag: string | null = null
  try {
    const [listStr, etagStr] = await Promise.all([
      getItem(BOOKS_LIST_KEY),
      getItem(BOOKS_ETAG_KEY),
    ])
    if (listStr) cachedList = JSON.parse(listStr)
    etag = etagStr
  } catch { /* corrupt cache — treat as empty */ }

  const headers: Record<string, string> = { ...authHeader }
  if (etag) headers['If-None-Match'] = etag

  try {
    const res = await api.request({
      method: 'GET',
      url: `${baseUrl}/api/books`,
      headers,
    })

    // 304 Not Modified — the persisted list is still current.
    if (res.status === 304) {
      return cachedList
    }

    if (res.success && Array.isArray(res.data)) {
      const newEtag = getHeader(res.headers, 'etag')
      // Persist in the background — callers don't need to await the write.
      setItem(BOOKS_LIST_KEY, JSON.stringify(res.data)).catch(() => {})
      if (newEtag) setItem(BOOKS_ETAG_KEY, newEtag).catch(() => {})
      else removeItem(BOOKS_ETAG_KEY).catch(() => {})
      return res.data
    }
  } catch (e) {
    console.error('[BooksList] fetch failed, using cached list', e)
  }

  return cachedList
}

/** Drop the persisted list + ETag (e.g. on logout). */
export async function clearBooksListCache(): Promise<void> {
  await Promise.all([
    removeItem(BOOKS_LIST_KEY).catch(() => {}),
    removeItem(BOOKS_ETAG_KEY).catch(() => {}),
  ])
}
