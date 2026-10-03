import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { Search, X, BookOpen, Film, Tv2, Music, Loader2, ArrowRight, Play, Headphones, History } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client'
import { useShallow } from 'zustand/shallow'
import { useSettingsStore } from '../stores/settingsStore'
import { useLibraryStore, type Book } from '../stores/libraryStore'
import { api as appApi } from '../utils/api'
import { AbsApi } from '../utils/absApi'
import { blockGlobalEsc, registerBackHandler } from '../utils/navigationBus'
import { isRealItem } from './jellyfin/itemFilters'
import type { AbsLibrary, AbsLibraryItem } from '../types/audiobookshelf'

interface GlobalSearchProps {
  isOpen: boolean
  onClose: () => void
  onSelectBook: (book: Book) => void
  onSelectJellyfin: (item: BaseItemDto) => void
  onSelectMusic: (item: BaseItemDto) => void
  onSelectAudiobook?: (item: AbsLibraryItem) => void
  // Deep linking: Play directly instead of opening details
  onPlayVideo?: (item: BaseItemDto) => void
  onPlayTrack?: (item: BaseItemDto) => void
}

// Extended BaseItemDto with search hint properties
interface SearchResultItem extends BaseItemDto {
  PrimaryImageTag?: string
  ThumbImageTag?: string
}

interface SearchResults {
  books: Book[]
  videos: SearchResultItem[]  // Movies & Series
  music: SearchResultItem[]   // Albums & Tracks
  audiobooks: AbsLibraryItem[] // Audiobookshelf books & podcasts
}

// Audiobookshelf has no global search — one request per library is needed,
// so the library list is cached module-level for 5 minutes
let absLibrariesCache: { libs: AbsLibrary[]; ts: number; serverUrl: string } | null = null

// ── Recent searches (persisted) ──────────────────────────────────────────────
// Only queries that led to a CLICKED result are recorded (not every keystroke),
// shown as clickable rows while the search box is still empty.
const RECENT_SEARCHES_KEY = 'globalSearchRecent'
const RECENT_SEARCHES_MAX = 10

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string') : []
  } catch {
    return []
  }
}

function persistRecentSearches(list: string[]): string[] {
  const trimmed = list.slice(0, RECENT_SEARCHES_MAX)
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(trimmed))
  } catch { /* storage full/unavailable — recents just won't persist */ }
  return trimmed
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

export const GlobalSearch = memo(function GlobalSearch({
  isOpen,
  onClose,
  onSelectBook,
  onSelectJellyfin,
  onSelectMusic,
  onSelectAudiobook,
  onPlayVideo,
  onPlayTrack
}: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SearchResults>({ books: [], videos: [], music: [], audiobooks: [] })
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Record the current query as a recent search — called when the user CLICKS
  // a result (i.e. the query was actually useful), not on every keystroke
  const recordQuery = useCallback(() => {
    const q = query.trim()
    if (q.length < 2) return
    setRecentSearches(prev => {
      const next = [q, ...prev.filter(p => p.toLowerCase() !== q.toLowerCase())]
      return persistRecentSearches(next)
    })
  }, [query])

  const removeRecentSearch = useCallback((q: string) => {
    setRecentSearches(prev => persistRecentSearches(prev.filter(p => p !== q)))
  }, [])

  const clearRecentSearches = useCallback(() => {
    setRecentSearches(persistRecentSearches([]))
  }, [])

  // Debounced query
  const debouncedQuery = useDebounce(query, 350)

  // Get stores
  const localBooks = useLibraryStore((state) => state.localBooks)
  const remoteBooks = useLibraryStore((state) => state.remoteBooks)
  const recentBooks = useLibraryStore((state) => state.recentBooks)
  const jellyfinServers = useSettingsStore((state) => state.jellyfinServers)
  const activeJellyfinServerId = useSettingsStore((state) => state.activeJellyfinServerId)
  const calibreUrl = useSettingsStore((state) => state.calibreWeb.url)
  const syncToken = useSettingsStore((state) => state.syncToken)

  const activeServer = jellyfinServers.find(s => s.id === activeJellyfinServerId)

  // Audiobookshelf client (token refresh handled inside AbsApi)
  const absConfig = useSettingsStore(useShallow((state) => state.audiobookshelf))
  const absApi = useMemo(
    () => (absConfig.url && absConfig.accessToken ? new AbsApi(absConfig.url, absConfig.accessToken) : null),
    [absConfig.url, absConfig.accessToken],
  )

  // Focus input when opened; load persisted recent searches
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
      setRecentSearches(loadRecentSearches())
    }
    if (!isOpen) {
      setQuery('')
      setResults({ books: [], videos: [], music: [], audiobooks: [] })
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // While open: suppress the global Esc-as-back dispatcher (this modal owns
  // Escape) and register a back handler so the mouse back button closes the
  // modal instead of navigating the view underneath
  useEffect(() => {
    if (!isOpen) return
    const releaseEsc = blockGlobalEsc()
    const unregister = registerBackHandler(() => {
      onClose()
      return true
    })
    return () => {
      releaseEsc()
      unregister()
    }
  }, [isOpen, onClose])

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Search function
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setResults({ books: [], videos: [], music: [], audiobooks: [] })
      return
    }

    setIsSearching(true)
    const lowerQuery = searchQuery.toLowerCase()

    // Search local books
    const allBooks = [
      ...localBooks.map(b => ({
        ...b,
        id: b.metadata?.id || b.path,
        title: b.name || b.metadata?.title || 'Unknown',
        author: b.author || b.metadata?.author || 'Unknown Author',
        cover: b.cover || b.metadata?.cover,
        localPath: b.path,
        type: 'local' as const,
        formats: [b.path.split('.').pop() || ''],
      })),
      ...recentBooks,
      ...remoteBooks.filter(b => !b.isFolder),
    ]

    // Deduplicate by id
    const bookMap = new Map<string, Book>()
    for (const book of allBooks) {
      if (!bookMap.has(book.id)) {
        bookMap.set(book.id, book as Book)
      }
    }

    const matchedBooks = Array.from(bookMap.values()).filter(book =>
      book.title?.toLowerCase().includes(lowerQuery) ||
      book.author?.toLowerCase().includes(lowerQuery)
    ).slice(0, 8)

    // Server-side book search — covers the WHOLE Calibre library, not just the
    // books already loaded into memory (local/recent/remote). The Sync API filters
    // in-memory over its cached list, so this is one cheap round trip.
    let serverBooks: Book[] = []
    if (calibreUrl && syncToken) {
      try {
        const baseUrl = calibreUrl.replace(/\/$/, '')
        const res = await appApi.request({
          method: 'GET',
          url: `${baseUrl}/api/books?search=${encodeURIComponent(searchQuery)}&limit=20`,
          headers: { Authorization: `Bearer ${syncToken}` },
        })
        // limit>0 returns a paginated { items, total, ... } shape; tolerate a flat array too.
        const items = res.success ? (Array.isArray(res.data) ? res.data : res.data?.items) : null
        if (Array.isArray(items)) {
          serverBooks = items.map((b: any): Book => ({
            id: `urn:calibre:${b.id}`,
            calibreId: String(b.id),
            title: b.title,
            author: (b.authors || []).join(', '),
            cover: b.cover_url ? `${baseUrl}${b.cover_url}` : '',
            formats: b.formats,
            series: b.series || undefined,
            series_index: b.series_index ?? undefined,
            type: 'remote' as const,
          }))
        }
      } catch (e) {
        console.error('Calibre book search failed:', e)
      }
    }

    // Merge local + server results. Local entries win (they may be downloaded /
    // available offline). Dedupe by calibreId, falling back to title+author.
    const bookKey = (b: Book) =>
      b.calibreId
        ? `c:${b.calibreId}`
        : `t:${(b.title || '').toLowerCase()}|${(b.author || '').toLowerCase()}`
    const mergedBooks = new Map<string, Book>()
    for (const b of matchedBooks) mergedBooks.set(bookKey(b), b)
    for (const b of serverBooks) {
      const k = bookKey(b)
      if (!mergedBooks.has(k)) mergedBooks.set(k, b)
    }
    const finalBooks = Array.from(mergedBooks.values()).slice(0, 12)

    // Search Jellyfin — one request PER type group, like jellyfin-web does.
    // A single mixed-type query loses results: JellySearch/Meilisearch caps
    // limit at 20 and relevance-orders across types (a flood of song matches
    // starves movies out entirely), while vanilla Jellyfin sorts the mixed
    // set alphabetically and cuts at the limit. /Items?searchTerm= works on
    // both engines (JellySearch intercepts any request with searchTerm).
    let videos: SearchResultItem[] = []
    let music: SearchResultItem[] = []

    if (activeServer?.url && activeServer?.accessToken && activeServer?.userId) {
      const searchGroup = async (
        includeItemTypes: string,
        limit: number,
        extra?: Record<string, string>,
      ): Promise<SearchResultItem[]> => {
        const params = new URLSearchParams({
          userId: activeServer.userId!,
          searchTerm: searchQuery,
          recursive: 'true',
          limit: String(limit),
          includeItemTypes,
          enableImages: 'true',
          ...extra,
        })
        const res = await appApi.request({
          method: 'GET',
          url: `${activeServer.url}/Items?${params.toString()}`,
          headers: {
            'Authorization': `MediaBrowser Token="${activeServer.accessToken}"`
          }
        })
        if (!res.success || !res.data?.Items) throw new Error(res.error || `Search failed (${res.status})`)
        return (res.data.Items as SearchResultItem[]).filter(isRealItem)
      }

      const groups = await Promise.allSettled([
        searchGroup('Movie,Series', 8),
        // Ghost/virtual episodes excluded server-side; isRealItem is the backstop
        searchGroup('Episode', 5, { isMissing: 'false' }),
        searchGroup('MusicAlbum,MusicArtist', 8),
        searchGroup('Audio', 6),
      ])
      const [movieGroup, episodeGroup, albumGroup, trackGroup] = groups.map(
        (g) => (g.status === 'fulfilled' ? g.value : []),
      )
      videos = [...movieGroup, ...episodeGroup]
      music = [...albumGroup, ...trackGroup]

      const failed = groups.filter((g): g is PromiseRejectedResult => g.status === 'rejected')
      if (failed.length > 0) {
        console.error('Jellyfin search failed:', failed.map(f => f.reason))
      }
    }

    // Search Audiobookshelf (one request per library, libraries cached)
    let audiobooks: AbsLibraryItem[] = []
    if (absApi) {
      try {
        const now = Date.now()
        if (
          !absLibrariesCache ||
          absLibrariesCache.serverUrl !== absApi.serverUrl ||
          now - absLibrariesCache.ts > 5 * 60 * 1000
        ) {
          absLibrariesCache = { libs: await absApi.getLibraries(), ts: now, serverUrl: absApi.serverUrl }
        }
        const perLibrary = await Promise.all(
          absLibrariesCache.libs.map((lib) => absApi.search(lib.id, searchQuery, 5).catch(() => null)),
        )
        for (const result of perLibrary) {
          if (!result) continue
          for (const entry of result.book ?? []) audiobooks.push(entry.libraryItem)
          for (const entry of result.podcast ?? []) audiobooks.push(entry.libraryItem)
        }
        audiobooks = audiobooks.slice(0, 8)
      } catch (e) {
        console.error('Audiobookshelf search failed:', e)
      }
    }

    setResults({ books: finalBooks, videos, music, audiobooks })
    setIsSearching(false)
  }, [localBooks, recentBooks, remoteBooks, activeServer, absApi, calibreUrl, syncToken])

  // Trigger search when debounced query changes
  useEffect(() => {
    performSearch(debouncedQuery)
  }, [debouncedQuery, performSearch])

  // Get image URL for Jellyfin items
  const getJellyfinImageUrl = (item: SearchResultItem) => {
    if (!activeServer?.url || !activeServer?.accessToken || !item.Id) return null
    // Try to get image even without tag (Jellyfin will return 404 if no image)
    return `${activeServer.url}/Items/${item.Id}/Images/Primary?maxWidth=80&quality=90&ApiKey=${activeServer.accessToken}`
  }

  const hasResults = results.books.length > 0 || results.videos.length > 0 || results.music.length > 0 || results.audiobooks.length > 0
  const hasQuery = query.trim().length > 0

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 phone:pt-[calc(env(safe-area-inset-top)+0.5rem)] phone:px-2 bg-black/60 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-2xl bg-gray-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <Search size={20} className="text-white/40" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search books, movies, TV shows, music..."
            className="flex-1 bg-transparent text-white placeholder-white/40 outline-none text-lg"
          />
          {isSearching && <Loader2 size={20} className="animate-spin text-theme-400" />}
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} className="text-white/60" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
          {/* No query: recent searches (if any), else the empty hint */}
          {!hasQuery && recentSearches.length > 0 && (
            <div className="p-4">
              <div className="flex items-center justify-between mb-3 px-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white/60">
                  <History size={16} className="text-theme-400" />
                  Recent Searches
                </h3>
                <button
                  onClick={clearRecentSearches}
                  className="text-xs text-white/40 hover:text-white/70 transition-colors"
                >
                  Clear all
                </button>
              </div>
              <div className="space-y-1">
                {recentSearches.map((q) => (
                  <div
                    key={q}
                    className="group flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors"
                  >
                    <button
                      onClick={() => setQuery(q)}
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                    >
                      <Search size={16} className="text-white/30 flex-shrink-0" />
                      <span className="text-white/80 truncate">{q}</span>
                    </button>
                    <button
                      onClick={() => removeRecentSearch(q)}
                      className="p-1 rounded-lg text-white/30 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove from recent searches"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!hasQuery && recentSearches.length === 0 && (
            <div className="px-6 py-12 text-center text-white/40">
              <Search size={48} className="mx-auto mb-4 opacity-50" />
              <p>Start typing to search across your library</p>
              <p className="text-sm mt-1">Books, Movies, TV Shows, and Music</p>
            </div>
          )}

          {/* Loading */}
          {hasQuery && isSearching && !hasResults && (
            <div className="px-6 py-12 text-center">
              <Loader2 size={32} className="mx-auto animate-spin text-theme-400" />
              <p className="mt-3 text-white/60">Searching...</p>
            </div>
          )}

          {/* No results */}
          {hasQuery && !isSearching && !hasResults && (
            <div className="px-6 py-12 text-center text-white/40">
              <p>No results found for "{query}"</p>
            </div>
          )}

          {/* Books Section */}
          {results.books.length > 0 && (
            <div className="p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white/60 mb-3 px-2">
                <BookOpen size={16} className="text-theme-400" />
                Books
              </h3>
              <div className="space-y-1">
                {results.books.map((book) => (
                  <button
                    key={book.id}
                    onClick={() => {
                      recordQuery()
                      onSelectBook(book)
                      onClose()
                    }}
                    className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors text-left"
                  >
                    {book.cover ? (
                      <img
                        src={book.cover}
                        alt=""
                        className="w-10 h-14 object-cover rounded-lg bg-white/5"
                      />
                    ) : (
                      <div className="w-10 h-14 rounded-lg bg-gradient-to-br from-theme-500/30 to-pink-500/30 flex items-center justify-center">
                        <BookOpen size={16} className="text-white/40" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate">{book.title}</p>
                      <p className="text-sm text-white/50 truncate">{book.author}</p>
                    </div>
                    <ArrowRight size={16} className="text-white/30" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Movies & TV Section */}
          {results.videos.length > 0 && (
            <div className="p-4 border-t border-white/5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white/60 mb-3 px-2">
                <Tv2 size={16} className="text-theme-400" />
                Movies & TV Shows
              </h3>
              <div className="space-y-1">
                {results.videos.map((item) => {
                  // Deep linking: Movies and Episodes can be played directly
                  const isPlayable = item.Type === 'Movie' || item.Type === 'Episode'

                  const handleClick = () => {
                    recordQuery()
                    if (isPlayable && onPlayVideo) {
                      // Play directly
                      onPlayVideo(item)
                    } else {
                      // Navigate to details (Series, or fallback)
                      onSelectJellyfin(item)
                    }
                    onClose()
                  }

                  return (
                    <button
                      key={item.Id}
                      onClick={handleClick}
                      className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors text-left group"
                    >
                      {getJellyfinImageUrl(item) ? (
                        <div className="relative">
                          <img
                            src={getJellyfinImageUrl(item)!}
                            alt=""
                            className="w-10 h-14 object-cover rounded-lg bg-white/5"
                          />
                          {isPlayable && (
                            <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <Play size={16} className="text-white fill-white" />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="w-10 h-14 rounded-lg bg-gradient-to-br from-theme-500/30 to-pink-500/30 flex items-center justify-center">
                          {item.Type === 'Movie' ? (
                            <Film size={16} className="text-white/40" />
                          ) : (
                            <Tv2 size={16} className="text-white/40" />
                          )}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white truncate">
                          {item.Type === 'Episode' ? item.SeriesName : item.Name}
                        </p>
                        <p className="text-sm text-white/50 truncate">
                          {item.Type === 'Episode' ? item.Name : null}
                          {item.Type === 'Movie' && item.ProductionYear ? item.ProductionYear : null}
                          {item.Type === 'Series' ? 'TV Series' : null}
                        </p>
                      </div>
                      <span className="px-2 py-0.5 text-xs rounded bg-white/10 text-white/60">
                        {item.Type}
                      </span>
                      {isPlayable ? (
                        <Play size={16} className="text-theme-400" />
                      ) : (
                        <ArrowRight size={16} className="text-white/30" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Music Section */}
          {results.music.length > 0 && (
            <div className="p-4 border-t border-white/5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white/60 mb-3 px-2">
                <Music size={16} className="text-theme-400" />
                Music
              </h3>
              <div className="space-y-1">
                {results.music.map((item) => {
                  // Deep linking: Audio tracks can be played directly
                  const isPlayable = item.Type === 'Audio'

                  const handleClick = () => {
                    recordQuery()
                    if (isPlayable && onPlayTrack) {
                      // Play directly
                      onPlayTrack(item)
                    } else {
                      // Navigate to details (MusicAlbum, MusicArtist, or fallback)
                      onSelectMusic(item)
                    }
                    onClose()
                  }

                  return (
                    <button
                      key={item.Id}
                      onClick={handleClick}
                      className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors text-left group"
                    >
                      {getJellyfinImageUrl(item) ? (
                        <div className="relative">
                          <img
                            src={getJellyfinImageUrl(item)!}
                            alt=""
                            className="w-10 h-10 object-cover rounded-lg bg-white/5"
                          />
                          {isPlayable && (
                            <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <Play size={12} className="text-white fill-white" />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-theme-500/30 to-pink-500/30 flex items-center justify-center">
                          <Music size={16} className="text-white/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white truncate">{item.Name}</p>
                        <p className="text-sm text-white/50 truncate">
                          {item.Type === 'MusicAlbum' ? item.AlbumArtist : null}
                          {item.Type === 'Audio' ? item.Artists?.join(', ') || item.Album : null}
                          {item.Type === 'MusicArtist' ? 'Artist' : null}
                        </p>
                      </div>
                      <span className="px-2 py-0.5 text-xs rounded bg-white/10 text-white/60">
                        {item.Type === 'MusicAlbum' ? 'Album' : item.Type === 'Audio' ? 'Track' : 'Artist'}
                      </span>
                      {isPlayable ? (
                        <Play size={16} className="text-theme-400" />
                      ) : (
                        <ArrowRight size={16} className="text-white/30" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {/* Audiobooks Section */}
          {results.audiobooks.length > 0 && (
            <div className="p-4 border-t border-white/5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white/60 mb-3 px-2">
                <Headphones size={16} className="text-orange-400" />
                Audiobooks & Podcasts
              </h3>
              <div className="space-y-1">
                {results.audiobooks.map((item) => {
                  const isBook = item.mediaType === 'book'
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        recordQuery()
                        onSelectAudiobook?.(item)
                        onClose()
                      }}
                      className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors text-left group"
                    >
                      {absApi ? (
                        <div className="relative">
                          <img
                            src={absApi.coverUrl(item.id, 80)}
                            alt=""
                            className="w-10 h-10 object-cover rounded-lg bg-white/5"
                          />
                          {isBook && (
                            <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <Play size={12} className="text-white fill-white" />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500/30 to-red-500/30 flex items-center justify-center">
                          <Headphones size={16} className="text-white/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white truncate">{item.media?.metadata?.title || 'Unknown'}</p>
                        <p className="text-sm text-white/50 truncate">{item.media?.metadata?.authorName || (isBook ? '' : 'Podcast')}</p>
                      </div>
                      <span className="px-2 py-0.5 text-xs rounded bg-white/10 text-white/60">
                        {isBook ? 'Audiobook' : 'Podcast'}
                      </span>
                      {isBook ? (
                        <Play size={16} className="text-orange-400" />
                      ) : (
                        <ArrowRight size={16} className="text-white/30" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer hint */}
        {hasResults && (
          <div className="px-4 py-2 border-t border-white/5 text-center">
            <p className="text-xs text-white/30">
              Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/50">Esc</kbd> to close
            </p>
          </div>
        )}
      </div>
    </div>
  )
})

// Search trigger button for the nav bar
export const SearchButton = memo(function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-colors"
      title="Search (Ctrl+K)"
    >
      <Search size={16} className="text-white/60" />
      <span className="text-sm text-white/40 hidden sm:inline">Search...</span>
      <kbd className="hidden sm:inline px-1.5 py-0.5 text-xs bg-white/10 rounded text-white/40">⌘K</kbd>
    </button>
  )
})

export default GlobalSearch
