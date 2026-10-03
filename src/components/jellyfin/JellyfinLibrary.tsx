import React, { useEffect, useState, useMemo, useRef, forwardRef, useCallback } from 'react'
import { ArrowLeft, Play, Film, Tv2, Loader2, ChevronRight, Search, Filter, X, Check, Eye, EyeOff, Heart, SortAsc, SortDesc, Star } from 'lucide-react'

const ITEMS_PER_PAGE = 100
import { VirtuosoGrid, type VirtuosoGridHandle } from 'react-virtuoso'
import { useJellyfin, getItemsApi, type BaseItemDto } from './JellyfinContext'
import { onJellyfinSoftRefresh, itemsWatchSig } from '../../utils/jellyfinRefreshBus'
import { useSettingsStore } from '../../stores/settingsStore'
import { useIsPhone } from '../../hooks/useIsPhone'
import { loadGridState, saveGridState, getScrollPos, setScrollPos } from '../../utils/viewStateCache'
import { BottomSheetSelect } from '../BottomSheet'
import { AlphabetScrollRail } from '../AlphabetScrollRail'

type SortOption = 'SortName' | 'DateCreated' | 'ProductionYear' | 'CommunityRating' | 'PlayCount'
type SortOrder = 'Ascending' | 'Descending'
type WatchedFilter = 'all' | 'watched' | 'unwatched'

// Cached per library so returning from item details restores the loaded
// items, active filters, and scroll position without refetching
interface LibraryGridCache {
  items: BaseItemDto[]
  totalItemCount: number
  genres: string[]
  searchQuery: string
  sortBy: SortOption
  sortOrder: SortOrder
  watchedFilter: WatchedFilter
  selectedGenre: string | null
  showFavoritesOnly: boolean
}

interface JellyfinLibraryProps {
  library: BaseItemDto
  onPlayItem: (item: BaseItemDto) => void
  onViewItem: (item: BaseItemDto) => void
  onBack: () => void
  // Mirrors the VirtuosoGrid scroller element for the parent's
  // pull-to-refresh gesture (the shared content div can't reach it)
  scrollerElRef?: React.MutableRefObject<HTMLElement | null>
}

export function JellyfinLibrary({ library, onPlayItem, onViewItem, onBack, scrollerElRef }: JellyfinLibraryProps) {
  const { api, user, getImageUrl, serverUrl } = useJellyfin()
  const libraryCardSize = useSettingsStore((state) => state.jellyfinLibraryCardSize)
  const isPhone = useIsPhone()

  // Restore the cached state for this library (typical on back-navigation
  // from item details; rendered with key={library.Id}, so switching
  // libraries remounts with a fresh cache lookup)
  const cacheKey = `jellyfin-library:${library.Id}`
  const [cached] = useState(() => loadGridState<LibraryGridCache>(cacheKey))
  const [items, setItems] = useState<BaseItemDto[]>(cached?.data.items ?? [])
  const [totalItemCount, setTotalItemCount] = useState(cached?.data.totalItemCount ?? 0)
  const [genres, setGenres] = useState<string[]>(cached?.data.genres ?? [])
  const [isLoading, setIsLoading] = useState(!cached)
  const [isFetchingMore, setIsFetchingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const virtuosoRef = useRef<VirtuosoGridHandle>(null)

  // Scroll position to restore after remounting with cached items. Restored
  // manually on the grid's scroller element — react-virtuoso's
  // restoreStateFrom hangs in an empty "restore in progress" state when the
  // saved offset isn't reachable on the first frame (list height is only
  // measured after mount), so it can't be trusted here.
  const pendingScrollRestoreRef = useRef(cached ? getScrollPos(cacheKey) : 0)
  const scrollerCleanupRef = useRef<(() => void) | null>(null)

  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    scrollerCleanupRef.current?.()
    scrollerCleanupRef.current = null
    if (scrollerElRef) scrollerElRef.current = el instanceof HTMLElement ? el : null
    if (!(el instanceof HTMLElement)) return

    const onScroll = () => setScrollPos(cacheKey, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    scrollerCleanupRef.current = () => el.removeEventListener('scroll', onScroll)

    // Re-apply the saved position over a few frames: the virtualized list
    // grows to its full height as item sizes get measured, so the first
    // attempts may clamp
    const target = pendingScrollRestoreRef.current
    if (target > 0) {
      pendingScrollRestoreRef.current = 0
      let attempts = 0
      const tryScroll = () => {
        el.scrollTop = target
        if (Math.abs(el.scrollTop - target) < 2 || ++attempts > 30) return
        requestAnimationFrame(tryScroll)
      }
      requestAnimationFrame(tryScroll)
    }
  }, [cacheKey, scrollerElRef])

  // Mirrors for building appended lists synchronously inside fetchPage
  // (fetches are serialized by the in-flight guard)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const genresRef = useRef(genres)
  genresRef.current = genres

  // Filter state
  const [searchQuery, setSearchQuery] = useState(cached?.data.searchQuery ?? '')
  const [sortBy, setSortBy] = useState<SortOption>(cached?.data.sortBy ?? 'SortName')
  const [sortOrder, setSortOrder] = useState<SortOrder>(cached?.data.sortOrder ?? 'Ascending')
  const [watchedFilter, setWatchedFilter] = useState<WatchedFilter>(cached?.data.watchedFilter ?? 'all')
  const [selectedGenre, setSelectedGenre] = useState<string | null>(cached?.data.selectedGenre ?? null)
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(cached?.data.showFavoritesOnly ?? false)
  const [showFilters, setShowFilters] = useState(false)

  // Debounce the search input so we don't hit the server on every keystroke
  // (initialized to the cached value so restoring doesn't trigger a refetch)
  const [debouncedSearch, setDebouncedSearch] = useState(cached?.data.searchQuery ?? '')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 350)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const querySig = `${sortBy}|${sortOrder}|${watchedFilter}|${selectedGenre ?? ''}|${showFavoritesOnly}|${debouncedSearch}`

  // Guards against overlapping page fetches; bumping the generation on a
  // query change makes any still-in-flight append from the old query stale
  const fetchInFlightRef = useRef(false)
  const queryGenRef = useRef(0)

  const fetchPage = useCallback(async (startIndex: number) => {
    if (!api || !user?.Id || !library.Id) return

    if (startIndex === 0) {
      // New query: invalidate in-flight appends from the previous one
      queryGenRef.current++
      setIsLoading(true)
      setError(null)
    } else if (fetchInFlightRef.current) {
      return
    }

    const gen = queryGenRef.current
    fetchInFlightRef.current = true
    if (startIndex > 0) setIsFetchingMore(true)

    try {
      const itemsApi = getItemsApi(api)

      // Build filters array
      const filters: string[] = []
      if (watchedFilter === 'watched') filters.push('IsPlayed')
      if (watchedFilter === 'unwatched') filters.push('IsUnplayed')
      if (showFavoritesOnly) filters.push('IsFavorite')

      // searchTerm needs recursive: true to actually match (and the
      // Meilisearch plugin hook only kicks in on recursive item queries).
      // Scope the types so a TV library search returns series, not
      // thousands of individual episodes.
      const isSearching = !!debouncedSearch
      const searchTypes: string[] =
        library.CollectionType === 'movies' ? ['Movie']
        : library.CollectionType === 'tvshows' ? ['Series']
        : ['Movie', 'Series']

      const response = await itemsApi.getItems({
        userId: user.Id!,
        parentId: library.Id!,
        sortBy: [sortBy],
        sortOrder: [sortOrder],
        recursive: isSearching,
        includeItemTypes: isSearching ? (searchTypes as any) : undefined,
        startIndex,
        limit: ITEMS_PER_PAGE,
        searchTerm: debouncedSearch || undefined,
        genres: selectedGenre ? [selectedGenre] : undefined,
        filters: filters.length > 0 ? filters as any : undefined,
      })

      if (gen !== queryGenRef.current) return // stale response, a newer query took over

      const newItems = response.data.Items || []
      const combined = startIndex === 0 ? newItems : [...itemsRef.current, ...newItems]
      const total = response.data.TotalRecordCount || 0
      setItems(combined)
      setTotalItemCount(total)

      // Extract unique genres from items (merge with existing)
      let nextGenres = genresRef.current
      if (startIndex === 0 && !selectedGenre) {
        const merged = new Set<string>(genresRef.current)
        newItems.forEach(item => {
          item.Genres?.forEach(g => merged.add(g))
        })
        nextGenres = Array.from(merged).sort()
        setGenres(nextGenres)
      }

      saveGridState<LibraryGridCache>(cacheKey, `${sortBy}|${sortOrder}|${watchedFilter}|${selectedGenre ?? ''}|${showFavoritesOnly}|${debouncedSearch}`, {
        items: combined,
        totalItemCount: total,
        genres: nextGenres,
        searchQuery: debouncedSearch,
        sortBy,
        sortOrder,
        watchedFilter,
        selectedGenre,
        showFavoritesOnly,
      })
    } catch (e: any) {
      console.error('Failed to fetch library items:', e)
      if (gen === queryGenRef.current && startIndex === 0) setError('Failed to load items')
    }

    if (gen === queryGenRef.current) {
      fetchInFlightRef.current = false
      setIsLoading(false)
      setIsFetchingMore(false)
    }
  }, [api, user?.Id, library.Id, cacheKey, sortBy, sortOrder, watchedFilter, selectedGenre, showFavoritesOnly, debouncedSearch])

  // Background soft-refresh: quietly re-fetch the currently-loaded slice (same
  // filters/sort, from the top) and diff-swap it in — no spinner, no scroll
  // reset — so watched marks / played badges update after playback without a
  // remount. Skips when a real page fetch is in flight or nothing is loaded yet.
  const softRefresh = useCallback(async () => {
    if (!api || !user?.Id || !library.Id) return
    if (fetchInFlightRef.current) return
    const current = itemsRef.current
    if (current.length === 0) return

    const gen = queryGenRef.current
    try {
      const itemsApi = getItemsApi(api)

      const filters: string[] = []
      if (watchedFilter === 'watched') filters.push('IsPlayed')
      if (watchedFilter === 'unwatched') filters.push('IsUnplayed')
      if (showFavoritesOnly) filters.push('IsFavorite')

      const isSearching = !!debouncedSearch
      const searchTypes: string[] =
        library.CollectionType === 'movies' ? ['Movie']
        : library.CollectionType === 'tvshows' ? ['Series']
        : ['Movie', 'Series']

      const response = await itemsApi.getItems({
        userId: user.Id!,
        parentId: library.Id!,
        sortBy: [sortBy],
        sortOrder: [sortOrder],
        recursive: isSearching,
        includeItemTypes: isSearching ? (searchTypes as any) : undefined,
        startIndex: 0,
        limit: current.length,
        searchTerm: debouncedSearch || undefined,
        genres: selectedGenre ? [selectedGenre] : undefined,
        filters: filters.length > 0 ? filters as any : undefined,
      })

      // A newer query (or a page fetch) took over while we were awaiting — drop this
      if (gen !== queryGenRef.current || fetchInFlightRef.current) return

      const fresh = response.data.Items || []
      const total = response.data.TotalRecordCount || 0

      if (itemsWatchSig(itemsRef.current) === itemsWatchSig(fresh)) {
        // Watch state unchanged; keep the total in sync but don't re-render the grid
        if (total !== totalItemCount) setTotalItemCount(total)
        return
      }

      setItems(fresh)
      setTotalItemCount(total)
      saveGridState<LibraryGridCache>(cacheKey, querySig, {
        items: fresh,
        totalItemCount: total,
        genres: genresRef.current,
        searchQuery: debouncedSearch,
        sortBy,
        sortOrder,
        watchedFilter,
        selectedGenre,
        showFavoritesOnly,
      })
    } catch {
      // Silent — a background refresh failing just leaves the current view intact
    }
  }, [api, user?.Id, library.Id, library.CollectionType, cacheKey, querySig, sortBy, sortOrder, watchedFilter, selectedGenre, showFavoritesOnly, debouncedSearch, totalItemCount])

  useEffect(() => onJellyfinSoftRefresh(softRefresh), [softRefresh])

  // Refetch from the top whenever the library or any filter/sort/search
  // changes — unless the cache already holds this exact query (typical on
  // back-navigation), in which case the lazily-initialized state is kept
  useEffect(() => {
    const cachedNow = loadGridState<LibraryGridCache>(cacheKey)
    if (cachedNow && cachedNow.sig === querySig) return
    // New query: drop the saved scroll position so it can't be applied to
    // different results later
    pendingScrollRestoreRef.current = 0
    setScrollPos(cacheKey, 0)
    fetchPage(0)
  }, [fetchPage, cacheKey, querySig])

  // Infinite scroll: VirtuosoGrid calls this when the last rendered item comes
  // into view; append the next page until everything is loaded
  const loadMore = useCallback(() => {
    if (items.length > 0 && items.length < totalItemCount) {
      fetchPage(items.length)
    }
  }, [fetchPage, items.length, totalItemCount])

  const clearFilters = () => {
    setSearchQuery('')
    setSortBy('SortName')
    setSortOrder('Ascending')
    setWatchedFilter('all')
    setSelectedGenre(null)
    setShowFavoritesOnly(false)
  }

  const hasActiveFilters = searchQuery || sortBy !== 'SortName' || sortOrder !== 'Ascending' || watchedFilter !== 'all' || selectedGenre || showFavoritesOnly

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-red-400">{error}</p>
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
        >
          <ArrowLeft size={16} />
          Go Back
        </button>
      </div>
    )
  }

  return (
    // Full-height column: header + grid. The grid (VirtuosoGrid) is the ONLY
    // scroller — the outer view container must never scroll here, otherwise
    // two scrollbars appear side by side.
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header with Search and Filters */}
      <div className="flex-shrink-0 z-10 bg-gray-900/95 border-b border-white/5">
        <div className="px-6 phone:px-4 py-4 phone:py-3 space-y-3">
          {/* Title Row */}
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <ArrowLeft size={24} />
            </button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{library.Name}</h1>
              <p className="text-sm text-white/50">{totalItemCount > 0 ? `${totalItemCount} items` : `${items.length} items`}</p>
            </div>
          </div>

          {/* Search and Filter Bar */}
          <div className="flex items-center gap-3 phone:flex-wrap phone:gap-2">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md phone:max-w-none phone:basis-full">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full pl-10 pr-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-theme-500/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Sort Dropdown */}
            <div className="relative">
              <button
                onClick={() => setSortOrder(sortOrder === 'Ascending' ? 'Descending' : 'Ascending')}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                title={sortOrder === 'Ascending' ? 'Ascending' : 'Descending'}
              >
                {sortOrder === 'Ascending' ? <SortAsc size={20} /> : <SortDesc size={20} />}
              </button>
            </div>

            {/* Phone: bottom sheet of options, desktop: native select */}
            {isPhone ? (
              <BottomSheetSelect<SortOption>
                title="Sort by"
                value={sortBy}
                onChange={setSortBy}
                options={[
                  { value: 'SortName', label: 'Name' },
                  { value: 'DateCreated', label: 'Date Added' },
                  { value: 'ProductionYear', label: 'Year' },
                  { value: 'CommunityRating', label: 'Rating' },
                  { value: 'PlayCount', label: 'Play Count' },
                ]}
                className="flex items-center gap-2 px-3 py-2 bg-white/10 border border-white/10 rounded-lg text-white text-sm"
              />
            ) : (
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="px-3 py-2 bg-white/10 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-theme-500/50 cursor-pointer"
              >
                <option value="SortName">Name</option>
                <option value="DateCreated">Date Added</option>
                <option value="ProductionYear">Year</option>
                <option value="CommunityRating">Rating</option>
                <option value="PlayCount">Play Count</option>
              </select>
            )}

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                showFilters || hasActiveFilters
                  ? 'bg-theme-500/20 text-theme-300 border border-theme-500/30'
                  : 'bg-white/10 hover:bg-white/20 border border-white/10'
              }`}
            >
              <Filter size={18} />
              <span className="text-sm">Filters</span>
              {hasActiveFilters && (
                <span className="w-2 h-2 bg-theme-500 rounded-full" />
              )}
            </button>
          </div>

          {/* Expanded Filters */}
          {showFilters && (
            <div className="flex flex-wrap items-center gap-3 pt-2 pb-1">
              {/* Watched Filter */}
              <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
                <button
                  onClick={() => setWatchedFilter('all')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    watchedFilter === 'all' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setWatchedFilter('unwatched')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    watchedFilter === 'unwatched' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  <EyeOff size={14} />
                  Unwatched
                </button>
                <button
                  onClick={() => setWatchedFilter('watched')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    watchedFilter === 'watched' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  <Eye size={14} />
                  Watched
                </button>
              </div>

              {/* Favorites Toggle */}
              <button
                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  showFavoritesOnly
                    ? 'bg-pink-500/20 text-pink-300 border border-pink-500/30'
                    : 'bg-white/5 text-white/60 hover:text-white/80 border border-white/10'
                }`}
              >
                <Heart size={14} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
                Favorites
              </button>

              {/* Genre Filter — phone: bottom sheet of options, desktop: native select */}
              {genres.length > 0 && (
                isPhone ? (
                  <BottomSheetSelect
                    title="Genre"
                    value={selectedGenre || ''}
                    onChange={(v) => setSelectedGenre(v || null)}
                    options={[
                      { value: '', label: 'All Genres' },
                      ...genres.map(genre => ({ value: genre, label: genre })),
                    ]}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm"
                  />
                ) : (
                  <select
                    value={selectedGenre || ''}
                    onChange={(e) => setSelectedGenre(e.target.value || null)}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-theme-500/50 cursor-pointer"
                  >
                    <option value="">All Genres</option>
                    {genres.map(genre => (
                      <option key={genre} value={genre}>{genre}</option>
                    ))}
                  </select>
                )
              )}

              {/* Clear Filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white/60 hover:text-white/80 transition-colors"
                >
                  <X size={14} />
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={48} className="animate-spin text-theme-500" />
        </div>
      )}

      {/* Virtualized Grid of items - smaller cards with more columns */}
      {!isLoading && (
        <div className="flex-1 min-h-0 px-6 py-4">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/50">
              <Search size={48} className="mb-4 opacity-50" />
              <p className="text-lg">No items found</p>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white/80"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <VirtuosoGrid
              ref={virtuosoRef}
              style={{ height: '100%' }}
              className="custom-scrollbar"
              totalCount={items.length}
              overscan={600}
              endReached={loadMore}
              scrollerRef={handleScrollerRef}
              components={{
                Footer: () => (
                  isFetchingMore ? (
                    <div className="flex justify-center py-6">
                      <Loader2 size={24} className="animate-spin text-white/40" />
                    </div>
                  ) : null
                ),
                List: forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ style, children, ...props }, ref) => (
                  <div
                    ref={ref}
                    {...props}
                    style={{
                      ...style,
                      display: 'grid',
                      gridTemplateColumns: `repeat(auto-fill, minmax(${libraryCardSize}px, 1fr))`,
                      gap: '0.75rem',
                    }}
                  >
                    {children}
                  </div>
                )),
                Item: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
                  <div {...props}>
                    {children}
                  </div>
                ),
              }}
              itemContent={(index) => {
                const item = items[index]
                if (!item) return null
                return (
                  <LibraryItemCard
                    item={item}
                    imageUrl={getImageUrl(item.Id!, 'Primary', 200)}
                    serverUrl={serverUrl}
                    onPlay={() => onPlayItem(item)}
                    onClick={() => onViewItem(item)}
                  />
                )
              }}
            />
          )}

          {/* A–Z fast-scroll rail (phone, name sort ascending, no filters) */}
          <AlphabetScrollRail
            labels={items.map(i => i.Name || '')}
            onJump={(index) => virtuosoRef.current?.scrollToIndex({ index, align: 'start' })}
            enabled={
              sortBy === 'SortName' && sortOrder === 'Ascending' &&
              !debouncedSearch && !selectedGenre && items.length > 30
            }
          />
        </div>
      )}

    </div>
  )
}

function LibraryItemCard({
  item,
  imageUrl,
  serverUrl,
  onPlay,
  onClick
}: {
  item: BaseItemDto
  imageUrl: string | null
  serverUrl: string | null
  onPlay: () => void
  onClick: () => void
}) {
  const isPlayable = item.Type === 'Movie' || item.Type === 'Episode'
  const isSeries = item.Type === 'Series'
  const unplayedCount = item.UserData?.UnplayedItemCount || 0
  const isFavorite = item.UserData?.IsFavorite

  return (
    <div
      className="group relative cursor-pointer"
      onClick={onClick}
    >
      {/* Poster - smaller with rounded corners */}
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-white/5 mb-1.5">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.Name || ''}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
            {isSeries ? <Tv2 size={24} className="text-white/30" /> : <Film size={24} className="text-white/30" />}
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          {isPlayable ? (
            <button
              onClick={(e) => { e.stopPropagation(); onPlay(); }}
              className="p-2.5 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform"
            >
              <Play size={18} fill="currentColor" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-white text-sm">
              <span>Browse</span>
              <ChevronRight size={16} />
            </div>
          )}
        </div>

        {/* Unplayed count badge for series */}
        {isSeries && unplayedCount > 0 && (
          <div className="absolute top-1.5 right-1.5 min-w-[20px] h-5 px-1 bg-theme-500 rounded-full flex items-center justify-center">
            <span className="text-[10px] font-bold text-white">{unplayedCount}</span>
          </div>
        )}

        {/* Played Badge */}
        {item.UserData?.Played && !isSeries && (
          <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-theme-500 rounded-full flex items-center justify-center">
            <Check size={12} className="text-white" />
          </div>
        )}

        {/* Favorite Badge */}
        {isFavorite && (
          <div className="absolute top-1.5 left-1.5 w-5 h-5 bg-pink-500 rounded-full flex items-center justify-center">
            <Heart size={10} className="text-white" fill="white" />
          </div>
        )}

        {/* Rating Badge */}
        {item.CommunityRating && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 px-1.5 py-0.5 bg-black/70 rounded text-[10px] text-white">
            <Star size={10} className="text-yellow-400" fill="currentColor" />
            {item.CommunityRating.toFixed(1)}
          </div>
        )}
      </div>

      {/* Title */}
      <h3 className="text-xs font-medium text-white/90 truncate leading-tight">{item.Name}</h3>
      {item.ProductionYear && (
        <p className="text-[10px] text-white/50">{item.ProductionYear}</p>
      )}
    </div>
  )
}
