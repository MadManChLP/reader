import { create } from 'zustand'
import { useShallow } from 'zustand/shallow'
import { api, type LocalBook } from '../utils/api'
import { CoverCache } from '../utils/coverCache'
import { checkCalibreServer, quickCheck } from '../utils/connectivityManager'
import {
  getStartedBooksProgress,
  addStartedBookId,
  removeStartedBookId,
  initializeStartedBooksIndex,
} from '../utils/startedBooksIndex'
import {
  loadSyncState,
  loadSyncStateSync,
  saveSyncState,
  initializeSyncState,
  processPendingChanges,
  toggleReadStatus as syncToggleReadStatus,
  setReadStatus as syncSetReadStatus,
  isBookReadSync,
  getBookmark,
  setBookmark,
  getLocalBookmark,
  isComicFormat,
  isCfi,
  buildDownloadUrl,
} from '../utils/syncServerApi'
import { getItem, setItem } from '../utils/storage'
import { beginDownloadTracking, endDownloadTracking } from './downloadProgressStore'

// Book types
export interface Book {
  id: string
  calibreId?: string
  title: string
  author: string
  cover: string
  downloadUrl?: string
  formats?: string[]
  isFolder?: boolean
  folderHref?: string
  description?: string
  localPath?: string
  cachedCover?: string
  type: 'local' | 'remote'
  progress?: number | string
  percentage?: number
  timestamp?: number
  series?: string
  series_index?: number
}

// Re-export LocalBook from api
export type { LocalBook }

interface LibraryState {
  // Book lists
  localBooks: LocalBook[]
  heroBooks: Book[]
  recentBooks: Book[]
  remoteBooks: Book[]
  startedBooks: Book[]
  syncReadBooks: string[]

  // Selected book for reading
  selectedBook: Book | null
  isReading: boolean

  // Navigation state
  currentFeedUrl: string
  history: string[]

  // Connection status
  isOnline: boolean
  isCalibreReachable: boolean
  isSyncReachable: boolean
  isAuthenticated: boolean

  // Loading state
  isLoading: boolean

  // Actions - Initialization
  initialize: () => void
  setOnlineStatus: (online: boolean) => void

  // Actions - Connectivity
  checkCalibreReachability: (apiUrl: string, authHeader?: Record<string, string>, options?: { timeout?: number; retries?: number; retryDelay?: number }) => Promise<boolean>

  // Actions - Authentication
  checkSession: (apiUrl: string, authHeader: Record<string, string>) => Promise<boolean>
  checkHealth: (apiUrl: string, authHeader: Record<string, string>) => Promise<void>
  loginToSync: (apiUrl: string, username: string, password: string) => Promise<string | null>

  // Actions - Feed fetching
  parseOpds: (xmlData: string, apiUrl: string, localBooks: LocalBook[]) => Book[]
  fetchFeed: (url: string, authHeader: Record<string, string>) => Promise<Book[]>
  loadDashboard: (apiUrl: string, syncToken: string, authHeader: Record<string, string>) => Promise<void>
  loadLocalBooks: (downloadPath: string) => Promise<void>

  // Actions - Started books & sync
  loadStartedBooks: (apiUrl: string, syncToken: string, downloadPath: string, authHeader: Record<string, string>, localOnly?: boolean) => Promise<void>
  syncPull: (bookId: string, apiUrl: string, syncToken: string, calibreId?: string, format?: string) => Promise<any | null>
  syncPush: (bookId: string, progressData: any, apiUrl: string, syncToken: string, selectedBook: Book | null, isOnline: boolean) => Promise<void>
  updateProgress: (bookId: string, progress: any, percentage: number, apiUrl: string, syncToken: string, downloadPath: string) => Promise<void>

  // Actions - Book actions
  handleRead: (book: Book, apiUrl: string, syncToken: string) => Promise<void>
  handleDownload: (book: Book, downloadPath: string, apiUrl: string, authHeader: Record<string, string>) => Promise<boolean>
  handleDelete: (book: Book, downloadPath: string) => Promise<boolean>

  // Actions - Read status
  getIsRead: (book: Book) => boolean
  toggleReadStatus: (calibreId: string, apiUrl: string, syncToken: string, isOnline: boolean) => Promise<boolean>
  markAsRead: (calibreId: string, apiUrl: string, syncToken: string, isOnline: boolean) => Promise<void>

  // Actions - State setters
  setSelectedBook: (book: Book | null) => void
  setIsReading: (reading: boolean) => void
  setRemoteBooks: (books: Book[]) => void
  setCurrentFeedUrl: (url: string) => void
  pushHistory: (url: string) => void
  popHistory: () => string | undefined
  clearHistory: () => void
  setIsAuthenticated: (authenticated: boolean) => void
}

let listenersRegistered = false

export const useLibraryStore = create<LibraryState>((set, get) => ({
  // Initial state
  localBooks: [],
  heroBooks: [],
  recentBooks: [],
  remoteBooks: [],
  startedBooks: [],
  syncReadBooks: loadSyncStateSync().readBooks, // Start empty, load async in initialize()

  selectedBook: null,
  isReading: false,

  currentFeedUrl: '',
  history: [],

  isOnline: navigator.onLine,
  isCalibreReachable: true,  // Optimistic: assume reachable until startup check proves otherwise
  isSyncReachable: false,
  isAuthenticated: false,

  isLoading: false,

  // Initialization - async to handle IndexedDB migration
  initialize: () => {
    // Initialize storage and load sync state asynchronously
    initializeStartedBooksIndex().then(async () => {
      // Load sync state from IndexedDB
      const syncState = await loadSyncState()
      set({ syncReadBooks: syncState.readBooks })
    }).catch(console.error)

    // Set up online/offline listeners (guard against duplicate registration on hot-reload/double-init)
    if (!listenersRegistered) {
      const handleOnline = () => set({ isOnline: true })
      const handleOffline = () => set({ isOnline: false })
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)
      listenersRegistered = true
    }
  },

  setOnlineStatus: (online) => set({ isOnline: online }),

  // Connectivity — checks actual server reachability (any HTTP response = reachable)
  checkCalibreReachability: async (apiUrl, authHeader = {}, options = {}) => {
    if (!apiUrl || !apiUrl.startsWith('http')) {
      set({ isCalibreReachable: false })
      return false
    }
    const reachable = await checkCalibreServer(apiUrl, authHeader, options)
    set({ isCalibreReachable: reachable, isOnline: reachable || navigator.onLine })
    return reachable
  },

  // Authentication
  checkSession: async (apiUrl, authHeader) => {
    if (!apiUrl || !apiUrl.startsWith('http')) return false

    try {
      const res = await api.request({
        method: 'GET',
        url: `${apiUrl.replace(/\/$/, '')}/opds/`,
        headers: authHeader,
      })

      const authenticated = res.success && res.status === 200
      set({ isAuthenticated: authenticated })
      return authenticated
    } catch {
      set({ isAuthenticated: false })
      return false
    }
  },

  checkHealth: async (apiUrl, authHeader) => {
    if (apiUrl && apiUrl.startsWith('http')) {
      try {
        // Unauthenticated /health probe — no upstream Calibre-Web call. Any HTTP
        // response means the sync server is up.
        const res = await api.request({
          method: 'GET',
          url: `${apiUrl.replace(/\/$/, '')}/health`,
          headers: authHeader,
        })
        // Server is reachable if we got any HTTP response (status is a number).
        // A 200 additionally reports whether PostgreSQL-backed features are available.
        const reachable = typeof res.status === 'number' && res.status > 0
        set({ isCalibreReachable: reachable, isSyncReachable: reachable })
      } catch {
        set({ isCalibreReachable: false, isSyncReachable: false })
      }
    }
  },

  loginToSync: async (apiUrl, username, password) => {
    if (!apiUrl || !username || !password || !apiUrl.startsWith('http')) return null

    try {
      const res = await api.request({
        method: 'POST',
        url: `${apiUrl.replace(/\/$/, '')}/api/login`,
        headers: { 'Content-Type': 'application/json' },
        data: { username, password },
      })

      if (res.success && res.data) {
        const data = res.data
        if (data.token) {
          console.log('[Sync] Login Successful (JWT)')
          return data.token
        }
      } else {
        console.error('[Sync] Login Failed', res.status)
      }
    } catch (e) {
      console.error('[Sync] Login Error', e)
    }
    return null
  },

  // OPDS parsing
  parseOpds: (xmlData, calibreUrl, localBooks) => {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlData, 'text/xml')
    const entries = xmlDoc.getElementsByTagName('entry')
    const items: Book[] = []

    const localMap = new Map(localBooks.map((b) => [b.name, b]))

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const title = entry.getElementsByTagName('title')[0]?.textContent || 'Unknown Title'
      const author =
        entry.getElementsByTagName('author')[0]?.getElementsByTagName('name')[0]?.textContent ||
        'Unknown Author'
      const id = entry.getElementsByTagName('id')[0]?.textContent || i.toString()
      const description =
        entry.getElementsByTagName('summary')[0]?.textContent ||
        entry.getElementsByTagName('content')[0]?.textContent ||
        ''

      let cover = ''
      let downloadUrl = ''
      let isFolder = false
      let folderHref = ''
      const formats: string[] = []

      const links = entry.getElementsByTagName('link')
      const apiBase = calibreUrl.replace(/\/$/, '')
      for (let j = 0; j < links.length; j++) {
        const link = links[j]
        const rel = link.getAttribute('rel')
        const href = link.getAttribute('href')
        const type = link.getAttribute('type')
        // OPDS feeds may return absolute URLs pointing to Calibre-Web's own host.
        // Rewrite them to go through the API server so Bearer auth works.
        let fullHref: string
        if (href?.startsWith('http')) {
          try {
            const parsed = new URL(href)
            fullHref = `${apiBase}${parsed.pathname}${parsed.search}`
          } catch {
            fullHref = href
          }
        } else {
          fullHref = `${apiBase}${href}`
        }

        if (rel?.includes('image')) cover = fullHref
        if (rel?.includes('acquisition')) {
          if (href !== fullHref) console.log(`[OPDS] Rewrote URL: ${href} → ${fullHref}`)
          downloadUrl = fullHref
          if (type) {
            // Normalize MIME types: application/epub+zip → epub, application/pdf → pdf
            let fmt = type.split('/').pop() || ''
            fmt = fmt.replace(/\+.*$/, '') // strip "+zip", "+rar" etc.
            if (fmt === 'x-cbz') fmt = 'cbz'
            if (fmt === 'x-cbr') fmt = 'cbr'
            formats.push(fmt)
          }
        }
        if (rel?.includes('subsection') || type?.includes('opds-catalog')) {
          isFolder = true
          folderHref = fullHref
        }
      }

      let calibreId = ''
      const idMatch = downloadUrl.match(/\/download\/(\d+)\//) || downloadUrl.match(/\/books\/(\d+)\//) || id.match(/:(\d+)$/)
      if (idMatch) calibreId = idMatch[1]

      // If no image link was found in OPDS, construct the OPDS cover URL
      if (!cover && calibreId) {
        cover = `${apiBase}/opds/cover/${calibreId}`
      }

      const localMatch = localMap.get(title)

      items.push({
        id,
        calibreId,
        title,
        author,
        cover,
        downloadUrl,
        formats,
        isFolder,
        folderHref,
        description,
        localPath: localMatch ? localMatch.path : undefined,
        type: 'remote',
      })
    }
    return items
  },

  fetchFeed: async (url, authHeader) => {
    if (!url || !url.startsWith('http')) return []
    try {
      const res = await api.request({
        method: 'GET',
        url,
        headers: authHeader,
      })
      if (res.success && res.data) {
        const state = get()
        // We need calibreUrl - extract from the URL
        const urlObj = new URL(url)
        const calibreUrl = `${urlObj.protocol}//${urlObj.host}`
        return state.parseOpds(res.data, calibreUrl, state.localBooks)
      }
    } catch (e) {
      console.error('Fetch feed failed', e)
    }
    return []
  },

  loadDashboard: async (apiUrl, syncToken, authHeader) => {
    const state = get()
    if (!state.isAuthenticated || !apiUrl) return

    set({ isLoading: true })

    const baseUrl = apiUrl.replace(/\/$/, '')

    // Fetch recently added books — single JSON call replaces two OPDS XML fetches
    let heroBooks: Book[] = []
    let recentBooks: Book[] = []
    try {
      const res = await api.request({
        method: 'GET',
        url: `${baseUrl}/api/books/recently-added?limit=60`,
        headers: authHeader,
      })
      if (res.success && Array.isArray(res.data)) {
        const books: Book[] = res.data.map((b: any) => ({
          id: `urn:calibre:${b.id}`,
          calibreId: String(b.id),
          title: b.title,
          author: (b.authors || []).join(', '),
          cover: `${baseUrl}${b.cover_url}`,
          formats: b.formats,
          series: b.series || undefined,
          series_index: b.series_index ?? undefined,
          type: 'remote' as const,
        }))
        // Hero: 5 random picks from the result
        const shuffled = [...books].sort(() => Math.random() - 0.5)
        heroBooks = shuffled.slice(0, 5)
        recentBooks = books.slice(0, 13)
      }
    } catch (e) {
      console.error('[Dashboard] recently-added fetch failed, falling back to OPDS', e)
      const [discover, newBooks] = await Promise.all([
        state.fetchFeed(`${baseUrl}/opds/discover`, authHeader),
        state.fetchFeed(`${baseUrl}/opds/new`, authHeader),
      ])
      heroBooks = discover.filter((b) => !b.isFolder).slice(0, 5)
      recentBooks = newBooks.filter((b) => !b.isFolder).slice(0, 13)
    }
    set({ heroBooks, recentBooks })

    // Initialize sync state from local cache first (instant)
    const syncState = await initializeSyncState()
    set({ syncReadBooks: syncState.readBooks })

    // Pull read status from server and merge — covers multi-device sync
    if (syncToken && state.isOnline) {
      try {
        const readRes = await api.request({
          method: 'GET',
          url: `${baseUrl}/api/books/read`,
          headers: { Authorization: `Bearer ${syncToken}` },
        })
        if (readRes.success && Array.isArray(readRes.data)) {
          const serverReadIds: string[] = readRes.data.map(String)
          // Merge: union of local + server (server is authoritative, never remove local)
          const merged = Array.from(new Set([...syncState.readBooks, ...serverReadIds]))
          syncState.readBooks = merged
          await saveSyncState(syncState)
          set({ syncReadBooks: merged })
          // A book finished on another device since last sync may already sit in
          // Continue Reading (loadStartedBooks ran with the older read list) —
          // read status wins, drop it now.
          const mergedSet = new Set(merged)
          set((s) => ({
            startedBooks: s.startedBooks.filter(
              (b) => !b.calibreId || !mergedSet.has(String(b.calibreId))
            ),
          }))
        }
      } catch (e) {
        console.error('[Dashboard] Failed to fetch read status from server:', e)
      }

      // Process any pending offline changes
      try {
        const processed = await processPendingChanges(baseUrl, syncToken)
        if (processed > 0) {
          console.log(`[Dashboard] Processed ${processed} pending offline changes`)
        }
      } catch (e) {
        console.error('[Dashboard] Failed to process pending changes:', e)
      }
    }

    set({ isLoading: false })
  },

  loadLocalBooks: async (downloadPath) => {
    if (!downloadPath) return
    try {
      const files = await api.readDirectory(downloadPath)
      set({ localBooks: files })

      // Re-apply localPath cross-check to startedBooks — loadStartedBooks may have run
      // before localBooks was populated (parallel effects on startup).
      const { startedBooks } = get()
      if (startedBooks.length > 0 && files.length > 0) {
        const updated = startedBooks.map((book) => {
          if (book.localPath) return book // already linked
          const localMatch = files.find(
            (lb) =>
              (lb.metadata?.calibreId && lb.metadata.calibreId === book.calibreId) ||
              (lb.metadata?.id && lb.metadata.id === book.id) ||
              lb.name === book.title ||
              lb.metadata?.title === book.title
          )
          if (!localMatch) return book
          const updated = { ...book, localPath: localMatch.path, type: 'local' as const }
          if (localMatch.cover && localMatch.cover.includes('book-file')) {
            updated.cover = localMatch.cover
          }
          if (updated.title === 'Unknown Book' && localMatch.name) {
            updated.title = localMatch.name
          }
          return updated
        })
        set({ startedBooks: updated })
      }
    } catch (e) {
      console.error('Failed to load local books:', e)
    }
  },

  // Started books & sync
  loadStartedBooks: async (apiUrl, syncToken, downloadPath, authHeader, localOnly = false) => {
    const state = get()
    const baseUrl = apiUrl.replace(/\/$/, '')

    // 1. Load Local Progress (using optimized index)
    const progressData = await getStartedBooksProgress()
    const allLocalProgress: Book[] = progressData.map(({ id, data }) => {
      let calibreId = data.calibreId || ''
      let downloadUrl = data.downloadUrl || ''

      // Extract calibreId from downloadUrl if missing (old cached data)
      if (!calibreId && downloadUrl) {
        const idMatch = downloadUrl.match(/\/download\/(\d+)\//) || downloadUrl.match(/\/books\/(\d+)\//)
        if (idMatch) calibreId = idMatch[1]
      }

      // Rewrite stale downloadUrl to go through API server
      if (downloadUrl && baseUrl) {
        try {
          const dlUrl = new URL(downloadUrl)
          const apiHost = new URL(baseUrl).host
          if (dlUrl.host !== apiHost) {
            downloadUrl = `${baseUrl}${dlUrl.pathname}${dlUrl.search}`
          }
        } catch { /* not a valid URL */ }
      }

      // Use OPDS cover URL if we have a calibreId (fixes stale cached URLs)
      let cover = data.cover || ''
      if (calibreId && baseUrl) {
        cover = `${baseUrl}/opds/cover/${calibreId}`
      }

      return {
        id: data.id || id,
        title: data.title || 'Unknown Book',
        author: data.author || 'Unknown',
        cover,
        calibreId,
        // progress = reading position (page/CFI), percentage = 0..1 fraction for UI bars.
        // Older records only stored percentage — fall back so syncPush still has a value.
        progress: data.progress ?? data.percentage,
        percentage: data.percentage,
        timestamp: data.timestamp || 0,
        localPath: data.localPath,
        cachedCover: data.cachedCover,
        downloadUrl,
        formats: data.formats,
        type: 'local' as const,
      }
    })

    // A book finished on another device is synced as read, but its stale local
    // position here can survive the merge (EPUB CFIs carry no percentage to
    // compare) — read status wins: drop read books from Continue Reading and
    // purge their index entry, like a locally finished book.
    const readIds = new Set(state.syncReadBooks.map(String))
    const unreadProgress = allLocalProgress.filter((p) => {
      if (!p.calibreId || !readIds.has(String(p.calibreId))) return true
      removeStartedBookId(p.id).catch(() => {})
      return false
    })

    // The same book can be stored under two local keys: the OPDS URN id when
    // opened from the library, and the numeric calibreId when opened from a
    // server-sourced Continue Reading entry. Dedupe by calibreId — keep the
    // newest record and purge the other's index entry.
    const localProgress: Book[] = []
    const localByCalibreId = new Map<string, Book>()
    unreadProgress.forEach((p) => {
      if (!p.calibreId) {
        localProgress.push(p)
        return
      }
      const prev = localByCalibreId.get(p.calibreId)
      if (!prev) {
        localByCalibreId.set(p.calibreId, p)
        return
      }
      const loser = (p.timestamp || 0) > (prev.timestamp || 0) ? prev : p
      const winner = loser === prev ? p : prev
      localByCalibreId.set(p.calibreId, winner)
      removeStartedBookId(loser.id).catch(() => {})
    })
    localProgress.push(...localByCalibreId.values())

    // Show local data immediately so the UI is not blank while server loads
    if (localProgress.length > 0) {
      const localSorted = [...localProgress].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      set({ startedBooks: localSorted })
    }

    // localOnly = just populate the UI from cache, no network calls
    if (localOnly) return

    // 2. Fetch Server Progress from /api/books/started (if online)
    let serverProgress: Book[] = []
    if (apiUrl && syncToken && state.isOnline) {
      try {
        const bearerAuth = { 'Authorization': `Bearer ${syncToken}` }
        const res = await api.request({
          method: 'GET',
          url: `${baseUrl}/api/books/started?include_details=true`,
          headers: bearerAuth,
        })
        if (res.success && res.data) {
          const startedItems = res.data.filter(
            (p: any) => p.position && p.position !== '0'
          )

          // Details already embedded — map directly, no extra API calls needed
          serverProgress = startedItems.map((p: any): Book => {
            const bookId = String(p.book_id)
            const formats: string[] = p.formats?.length ? p.formats : (p.format ? [p.format] : [])
            // Prefer the format the progress belongs to (a book can have several formats)
            const fmt = (p.format || formats[0] || 'epub').toLowerCase()
            // total_pages (joined server-side from the page-count cache) lets us show
            // progress bars without one /progress call per book. CFI positions → NaN → skipped.
            let percentage: number | undefined
            const posNum = parseInt(p.position, 10)
            if (p.total_pages > 0 && !isNaN(posNum)) {
              const page = isComicFormat(fmt) ? posNum + 1 : posNum // comic positions are 0-indexed
              percentage = Math.max(0, Math.min(1, page / p.total_pages))
            }
            return {
              id: bookId,
              title: p.title || 'Unknown Book',
              author: (p.authors || []).join(', ') || 'Unknown',
              cover: p.cover_url ? `${baseUrl}${p.cover_url}` : `${baseUrl}/opds/cover/${bookId}`,
              calibreId: bookId,
              progress: p.position,
              percentage,
              formats,
              downloadUrl: buildDownloadUrl(baseUrl, bookId, fmt),
              timestamp: p.updated_at ? new Date(p.updated_at).getTime() : 0,
              series: p.series || undefined,
              series_index: p.series_index ?? undefined,
              type: 'remote' as const,
            }
          }).filter((b: Book) => !readIds.has(String(b.calibreId)))
        }
      } catch (e) {
        console.error('Failed to fetch started books', e)
      }
    }

    // 3. Merge Strategies (Source of Truth = Latest Timestamp)
    // Use calibreId as primary merge key (local uses OPDS IDs, server uses Calibre IDs)
    const mergedMap = new Map<string, Book>()
    const calibreIdToKey = new Map<string, string>() // calibreId → mergedMap key
    const localOnlyIds = new Set(localProgress.map((p) => p.id))
    const booksToPush: Book[] = []

    // Add all local first
    const titleKey = (b: Book) =>
      b.title && b.title !== 'Unknown Book' ? `${b.title} ${b.author}`.toLowerCase() : null
    const noIdKeyByTitle = new Map<string, string>() // title+author → key, for records lacking calibreId
    localProgress.forEach((p) => {
      mergedMap.set(p.id, p)
      if (p.calibreId) {
        calibreIdToKey.set(p.calibreId, p.id)
      } else {
        // Old cached record with no calibreId (unparseable downloadUrl) — allow
        // the server row to still find it by title+author instead of duplicating.
        const tk = titleKey(p)
        if (tk) noIdKeyByTitle.set(tk, p.id)
      }
    })

    // Merge server: match by calibreId first, then by id, then title+author fallback
    serverProgress.forEach((p) => {
      const tk = titleKey(p)
      const existingKey =
        (p.calibreId && calibreIdToKey.get(p.calibreId)) ||
        (mergedMap.has(p.id) ? p.id : null) ||
        (tk && noIdKeyByTitle.get(tk)) ||
        null
      const existing = existingKey ? mergedMap.get(existingKey) : null

      if (existingKey) {
        localOnlyIds.delete(existingKey)
      }
      localOnlyIds.delete(p.id)

      // Backfill calibreId onto legacy records matched via the title fallback,
      // so future loads (and a possible second format row) match directly.
      if (existing && existingKey && !existing.calibreId && p.calibreId) {
        existing.calibreId = p.calibreId
        calibreIdToKey.set(p.calibreId, existingKey)
      }

      if (!existing || (p.timestamp || 0) > (existing.timestamp || 0)) {
        // Server is Newer or New - preserve local metadata
        if (existing?.localPath) {
          p.localPath = existing.localPath
          p.type = 'local'
        }
        if (existing?.cachedCover) {
          p.cachedCover = existing.cachedCover
        }
        if (existing?.downloadUrl && !p.downloadUrl) {
          p.downloadUrl = existing.downloadUrl
          p.formats = existing.formats
        }
        if (existing && p.title === 'Unknown Book' && existing.title !== 'Unknown Book') {
          p.title = existing.title
          p.author = existing.author
          p.cover = existing.cover
        }
        // Keep the local percentage when the server row has none (EPUB CFI positions,
        // or page count not cached yet) — otherwise the progress bar disappears and the
        // stored record gets purged from the started-books index (requires percentage).
        if (p.percentage === undefined && existing?.percentage !== undefined) {
          p.percentage = existing.percentage
        }
        // Use existing key to replace (avoids duplicate with different IDs)
        const key = existingKey || p.id
        if (existingKey && existingKey !== p.id) {
          // Remove old entry if we're replacing with a different key
          mergedMap.delete(existingKey)
        }
        mergedMap.set(key, p)

        // Update local cache
        if (existing) {
          setItem(`progress_${key}`, JSON.stringify({ ...p, id: key }))
        }
      } else if (existing && (existing.timestamp || 0) > (p.timestamp || 0)) {
        // Local is Newer -> Needs Push
        booksToPush.push(existing)
      }
    })

    // Cross-check with Local Books
    mergedMap.forEach((book) => {
      const localMatch = state.localBooks.find(
        (lb) =>
          // Match by calibreId (most reliable — stored explicitly since fix #16)
          (lb.metadata?.calibreId && lb.metadata.calibreId === book.calibreId) ||
          // Match by full id (legacy URN match)
          (lb.metadata?.id && lb.metadata.id === book.id) ||
          // Fallback: title match
          lb.name === book.title ||
          lb.metadata?.title === book.title
      )
      if (localMatch) {
        book.localPath = localMatch.path
        book.type = 'local'
        // Only use local cover.jpg if it's a proper book-file:// URL (not empty/stale path)
        if (localMatch.cover && localMatch.cover.includes('book-file')) {
          book.cover = localMatch.cover
        }
        if (book.title === 'Unknown Book' && localMatch.name) book.title = localMatch.name
      }
    })

    // Add missing local books to push queue
    localOnlyIds.forEach((id) => {
      const book = mergedMap.get(id)
      if (book) booksToPush.push(book)
    })

    const sorted = Array.from(mergedMap.values()).sort(
      (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
    )

    // 3b. Sync Newer/Missing Local to Server (Background)
    if (state.isOnline && apiUrl && syncToken) {
      booksToPush.forEach(async (book) => {
        console.log(`[Sync] Pushing newer/missing book to server: ${book.title}`)
        try {
          await state.syncPush(book.id, book, baseUrl, syncToken, book, state.isOnline)
        } catch (e) {
          console.error(`[Sync] Failed to push ${book.id}`, e)
        }
      })
    }

    // 3c. Cache Covers for Offline (Background)
    if (state.isOnline && apiUrl) {
      sorted.forEach(async (book) => {
        if (book.cover && book.cover.startsWith('http') && !book.cachedCover) {
          const cachedPath = await CoverCache.ensureCached(
            book.cover,
            book.id,
            authHeader,
            downloadPath
          )
          if (cachedPath) {
            book.cachedCover = cachedPath
            set((s) => ({
              startedBooks: s.startedBooks.map((b) =>
                b.id === book.id ? { ...b, cachedCover: cachedPath } : b
              ),
            }))
            // Update storage
            const key = `progress_${book.id}`
            getItem(key).then(raw => {
              if (raw) {
                const data = JSON.parse(raw)
                data.cachedCover = cachedPath
                setItem(key, JSON.stringify(data))
              }
            }).catch(e => console.error('[CoverCache] Failed to update cached cover:', e))
          }
        }
      })
    }

    set({ startedBooks: sorted })
  },

  syncPull: async (bookId, apiUrl, syncToken, calibreId, format) => {
    const fmt = format?.toLowerCase() || ''

    // All formats: Try to get progress from API first (GET /api/books/{id}/progress)
    if (apiUrl && syncToken && calibreId) {
      try {
        const { position, totalPages } = await getBookmark(apiUrl, syncToken, calibreId, fmt || 'EPUB')
        if (position) {
          if (isComicFormat(fmt)) {
            // API stores 0-indexed pages, internal uses 1-indexed
            const page = parseInt(position, 10) + 1
            if (!isNaN(page)) {
              return { progress: page, percentage: 0, totalPages }
            }
          }
          // CFI strings (EPUB) or plain page numbers (PDF) — return as-is
          return { progress: position, percentage: 0, totalPages }
        }
      } catch (e) {
        console.error('[Sync] Get bookmark error:', e)
      }
    }

    // Fallback: Check local cache
    if (calibreId) {
      const localBookmark = await getLocalBookmark(calibreId, fmt || 'EPUB')
      if (localBookmark) {
        if (isComicFormat(fmt)) {
          const page = parseInt(localBookmark, 10) + 1
          if (!isNaN(page)) {
            return { progress: page, percentage: 0 }
          }
        }
        // CFI strings or plain page numbers — return as-is
        return { progress: localBookmark, percentage: 0 }
      }
    }

    return null
  },

  syncPush: async (bookId, progressData, apiUrl, syncToken, selectedBook, isOnline) => {
    const format = progressData.formats?.[0]?.toLowerCase() || selectedBook?.formats?.[0]?.toLowerCase() || ''
    const calibreId = progressData.calibreId

    // Push bookmark via API
    console.log(`[SyncPush] calibreId=${calibreId}, format=${format}, progress=${progressData.progress}, apiUrl=${apiUrl}, hasToken=${!!syncToken}`)
    if (apiUrl && syncToken && calibreId) {
      try {
        let bookmarkValue: string
        if (isComicFormat(format)) {
          const page =
            typeof progressData.progress === 'number'
              ? progressData.progress - 1
              : parseInt(progressData.progress) - 1
          if (isNaN(page) || page < 0) return
          bookmarkValue = page.toString()
        } else if (isCfi(progressData.progress)) {
          bookmarkValue = progressData.progress
        } else {
          bookmarkValue = progressData.progress.toString()
        }

        console.log(`[SyncPush] Sending: PUT /api/books/${calibreId}/progress { position: "${bookmarkValue}", format: "${(format || 'EPUB').toUpperCase()}" }`)
        await setBookmark(
          apiUrl,
          syncToken,
          calibreId,
          format || 'EPUB',
          bookmarkValue,
          isOnline,
        )
      } catch (e) {
        console.error('[Sync] Push bookmark error:', e)
      }
    }
  },

  updateProgress: async (bookId, progress, percentage, apiUrl, syncToken, downloadPath) => {
    const state = get()
    const timestamp = Date.now()
    const calibreId = state.selectedBook?.id === bookId ? state.selectedBook.calibreId : undefined

    const data = {
      id: bookId,
      progress,
      percentage,
      timestamp,
      calibreId,
      title: state.selectedBook?.title,
      cover: state.selectedBook?.cover,
      author: state.selectedBook?.author,
      localPath: state.selectedBook?.localPath,
      cachedCover: state.selectedBook?.cachedCover,
      downloadUrl: state.selectedBook?.downloadUrl,
      formats: state.selectedBook?.formats,
    }

    await setItem(`progress_${bookId}`, JSON.stringify(data))

    // Update started books index
    if (percentage > 0 && percentage < 0.99) {
      await addStartedBookId(bookId)
    }

    if (state.selectedBook?.id === bookId) {
      set({ selectedBook: { ...state.selectedBook, progress: percentage } })
    }

    // Sync to server
    if (apiUrl && syncToken) {
      try {
        await state.syncPush(bookId, data, apiUrl, syncToken, state.selectedBook, state.isOnline)
      } catch (e) {
        console.error('[Sync] Push failed:', e)
      }
    }

    // Handle completion
    if (percentage > 0.99) {
      await CoverCache.deleteCached(bookId, downloadPath)
      await removeStartedBookId(bookId)

      if (state.selectedBook?.calibreId && apiUrl && syncToken) {
        const alreadyRead = isBookReadSync(state.syncReadBooks, state.selectedBook.calibreId)
        if (!alreadyRead) {
          try {
            console.log('[Sync] Book completed, marking as read...')
            const newIsRead = await syncToggleReadStatus(
              apiUrl,
              syncToken,
              state.selectedBook.calibreId,
              state.isOnline,
            )
            if (newIsRead) {
              set((s) => ({
                syncReadBooks: [...s.syncReadBooks, String(state.selectedBook!.calibreId)],
              }))
            }
          } catch (e) {
            console.error('[Sync] Failed to mark as read:', e)
          }
        }
      }
    }
  },

  // Book actions
  handleRead: async (book, apiUrl, syncToken) => {
    const state = get()
    let bookWithProgress = { ...book }
    const baseUrl = apiUrl.replace(/\/$/, '')

    // Extract calibreId from downloadUrl if missing (e.g. old cached progress data)
    if (!bookWithProgress.calibreId && bookWithProgress.downloadUrl) {
      const idMatch = bookWithProgress.downloadUrl.match(/\/download\/(\d+)\//) || bookWithProgress.downloadUrl.match(/\/books\/(\d+)\//)
      if (idMatch) bookWithProgress.calibreId = idMatch[1]
    }

    // Rewrite stale downloadUrl to go through the API server (not Calibre-Web directly)
    if (bookWithProgress.downloadUrl && apiUrl) {
      try {
        const dlUrl = new URL(bookWithProgress.downloadUrl)
        const apiHost = new URL(baseUrl).host
        if (dlUrl.host !== apiHost) {
          bookWithProgress.downloadUrl = `${baseUrl}${dlUrl.pathname}${dlUrl.search}`
        }
      } catch { /* not a valid URL, leave as-is */ }
    }

    // Fallback for Remote Books missing URL
    if (book.type === 'remote' && !bookWithProgress.downloadUrl && bookWithProgress.calibreId && apiUrl) {
      let ext = 'epub'
      if (bookWithProgress.formats?.length) {
        const f = bookWithProgress.formats[0].toLowerCase()
        if (f.includes('pdf')) ext = 'pdf'
        else if (f.includes('cbr')) ext = 'cbr'
        else if (f.includes('cbz')) ext = 'cbz'
      }
      bookWithProgress.downloadUrl = buildDownloadUrl(baseUrl, bookWithProgress.calibreId, ext)
      if (!bookWithProgress.formats) bookWithProgress.formats = [ext]
    }
    console.log(`[handleRead] Book: calibreId=${bookWithProgress.calibreId}, formats=${JSON.stringify(bookWithProgress.formats)}, downloadUrl=${bookWithProgress.downloadUrl}`)

    // Check local storage for progress
    const localDataRaw = await getItem(`progress_${book.id}`)
    let localData: any = null
    if (localDataRaw) {
      try {
        localData = JSON.parse(localDataRaw)
      } catch {}
    }

    // Fetch progress from server (GET /api/books/{id}/progress)
    const format = bookWithProgress.formats?.[0]?.toLowerCase() || ''
    if (apiUrl && syncToken && state.isOnline) {
      const syncData = await state.syncPull(book.id, baseUrl, syncToken, book.calibreId, format)
      if (syncData?.progress) {
        // Server is source of truth when online — always use server progress
        const parsed = parseFloat(syncData.progress)
        const isNum = !isNaN(parsed) && isFinite(parsed)
        bookWithProgress.progress = isNum ? parsed : syncData.progress
        await setItem(
          `progress_${book.id}`,
          JSON.stringify({
            ...localData,
            progress: bookWithProgress.progress,
            percentage: syncData.percentage || localData?.percentage || 0,
            timestamp: Date.now(),
            calibreId: book.calibreId,
          })
        )
      } else if (localData) {
        bookWithProgress.progress = localData.progress
      }
    } else if (localData) {
      bookWithProgress.progress = localData.progress
    }

    set({ selectedBook: bookWithProgress, isReading: true })
  },

  handleDownload: async (book, downloadPath, apiUrl, authHeader) => {
    if (!downloadPath) return false

    let url = book.downloadUrl
    let ext = book.formats?.[0] || 'epub'

    if (!url && book.calibreId && apiUrl) {
      if (book.formats?.length) {
        const f = book.formats[0].toLowerCase()
        if (f.includes('pdf')) ext = 'pdf'
        else if (f.includes('cbr')) ext = 'cbr'
        else if (f.includes('cbz')) ext = 'cbz'
      }
      url = buildDownloadUrl(apiUrl, book.calibreId, ext)
    }

    if (!url) return false

    if (ext.includes('epub')) ext = 'epub'
    if (ext.includes('pdf')) ext = 'pdf'
    if (ext.includes('cbz')) ext = 'cbz'
    if (ext.includes('cbr')) ext = 'cbr'
    if (ext.includes('cbt')) ext = 'cbt'

    const safeTitle = book.title.replace(/[\\/:*?"<>|]/g, '_')
    const fileName = `${safeTitle}.${ext}`
    const bookFolder = `${downloadPath}/${safeTitle}`

    // Progress ring on the download buttons (BookCard / BookDetails)
    beginDownloadTracking(book.id, url)
    try {
      await api.createDirectory(bookFolder)
      const res = await api.downloadFile({
        url,
        folderPath: bookFolder,
        fileName,
        headers: authHeader,
      })

      if (res.success) {
        if (book.cover) {
          await api.downloadFile({
            url: book.cover,
            folderPath: bookFolder,
            fileName: 'cover.jpg',
            headers: authHeader,
          })
        }
        // Save metadata — always persist calibreId explicitly so cross-linking
        // works even when book.id is a URN string rather than the numeric ID.
        await api.writeFile({
          path: `${bookFolder}/metadata.json`,
          content: JSON.stringify({
            ...book,
            calibreId: book.calibreId || '',
            downloadUrl: url,
            added: new Date().toISOString(),
            fileName,
          }),
        })

        // Reload local books
        const state = get()
        await state.loadLocalBooks(downloadPath)
        return true
      }
    } catch (e) {
      console.error('[Download] Exception:', e)
    } finally {
      endDownloadTracking(book.id)
    }
    return false
  },

  handleDelete: async (book, downloadPath) => {
    const state = get()
    if (!downloadPath) return false

    const isDownloaded = state.localBooks.some(
      (lb) =>
        lb.metadata?.id === book.id ||
        (book.calibreId && lb.metadata?.calibreId === book.calibreId)
    )
    if (!isDownloaded) return false

    const safeTitle = book.title.replace(/[\\/:*?"<>|]/g, '_')
    const folderToDelete = `${downloadPath}/${safeTitle}`

    try {
      const res = await api.deleteDirectory(folderToDelete)
      if (res.success) {
        // Update state
        set((s) => ({
          startedBooks: s.startedBooks.map((b) =>
            b.id === book.id ? { ...b, localPath: undefined, type: 'remote' as const } : b
          ),
        }))

        // Update storage
        const key = `progress_${book.id}`
        const raw = await getItem(key)
        if (raw) {
          const data = JSON.parse(raw)
          delete data.localPath
          await setItem(key, JSON.stringify(data))
        }

        await state.loadLocalBooks(downloadPath)
        return true
      }
    } catch (e) {
      console.error('[Delete] Exception:', e)
    }
    return false
  },

  // Read status - synchronous check using cached state
  getIsRead: (book) => {
    const state = get()

    // Check using cached syncReadBooks state
    if (book.calibreId && isBookReadSync(state.syncReadBooks, book.calibreId)) {
      return true
    }

    // Note: Progress check is now async, so we rely on syncReadBooks for sync checks
    // The actual percentage is checked when loading books
    return false
  },

  toggleReadStatus: async (calibreId, apiUrl, syncToken, isOnline) => {
    const result = await syncToggleReadStatus(apiUrl, syncToken, calibreId, isOnline)
    if (result) {
      set((s) => ({
        syncReadBooks: [...s.syncReadBooks, String(calibreId)],
      }))
    } else {
      set((s) => ({
        syncReadBooks: s.syncReadBooks.filter((id) => id !== String(calibreId)),
      }))
    }
    return result
  },

  markAsRead: async (calibreId, apiUrl, syncToken, isOnline) => {
    await syncSetReadStatus(apiUrl, syncToken, calibreId, true, isOnline)
    set((s) => ({
      syncReadBooks: [...s.syncReadBooks, String(calibreId)],
    }))
  },

  // State setters
  setSelectedBook: (book) => set({ selectedBook: book }),
  setIsReading: (reading) => set({ isReading: reading }),
  setRemoteBooks: (books) => set({ remoteBooks: books }),
  setCurrentFeedUrl: (url) => set({ currentFeedUrl: url }),
  pushHistory: (url) => set((s) => ({ history: [...s.history, url] })),
  popHistory: () => {
    const state = get()
    if (state.history.length === 0) return undefined
    const last = state.history[state.history.length - 1]
    set({ history: state.history.slice(0, -1) })
    return last
  },
  clearHistory: () => set({ history: [] }),
  setIsAuthenticated: (authenticated) => set({ isAuthenticated: authenticated }),
}))

// Selector hooks for optimized re-renders
export const useStartedBooks = () =>
  useLibraryStore(useShallow((state) => state.startedBooks))

export const useHeroBooks = () =>
  useLibraryStore(useShallow((state) => state.heroBooks))

export const useRecentBooks = () =>
  useLibraryStore(useShallow((state) => state.recentBooks))

export const useLocalBooks = () =>
  useLibraryStore(useShallow((state) => state.localBooks))

export const useSelectedBook = () =>
  useLibraryStore((state) => state.selectedBook)

export const useIsReading = () =>
  useLibraryStore((state) => state.isReading)

export const useIsOnline = () =>
  useLibraryStore((state) => state.isOnline)

export const useIsAuthenticated = () =>
  useLibraryStore((state) => state.isAuthenticated)

export const useIsLoading = () =>
  useLibraryStore((state) => state.isLoading)
