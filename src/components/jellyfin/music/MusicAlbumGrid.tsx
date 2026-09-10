import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Disc3, Loader2, Search as SearchIcon } from 'lucide-react'
import { useJellyfin, getItemsApi, type BaseItemDto } from '../JellyfinContext'
import type { ItemSortBy, SortOrder } from '@jellyfin/sdk/lib/generated-client'
import { AlbumCard } from './components/AlbumCard'
import { useMusicPlayer, type Track } from '../../../stores/musicPlayerStore'
import { useInfiniteScroll } from '../../../hooks/useInfiniteScroll'
import { useScrollRestore } from '../../../hooks/useScrollRestore'
import { useIsPhone } from '../../../hooks/useIsPhone'
import { loadGridState, saveGridState, setScrollPos } from '../../../utils/viewStateCache'
import { BottomSheetSelect } from '../../BottomSheet'
import { AlphabetScrollRail } from '../../AlphabetScrollRail'
import type { MusicViewType } from './MusicView'

interface MusicAlbumGridProps {
  onNavigate: (view: MusicViewType) => void
  musicLibraries: BaseItemDto[]
}

type SortOption = 'name' | 'artist' | 'date' | 'random'

const CACHE_KEY = 'music-albums'

interface AlbumGridCache {
  items: BaseItemDto[]
  totalCount: number
  loadedCount: number
  sortBy: SortOption
  searchQuery: string
}

export function MusicAlbumGrid({ onNavigate, musicLibraries }: MusicAlbumGridProps) {
  const { api, user, serverUrl } = useJellyfin()
  const setQueue = useMusicPlayer(s => s.setQueue)
  const isPhone = useIsPhone()

  // Restore the last state (items + query) so coming back from album details
  // neither refetches nor loses the scroll position
  const [cached] = useState(() => loadGridState<AlbumGridCache>(CACHE_KEY))
  const [albums, setAlbums] = useState<BaseItemDto[]>(cached?.data.items ?? [])
  const [isLoading, setIsLoading] = useState(!cached)
  const [sortBy, setSortBy] = useState<SortOption>(cached?.data.sortBy ?? 'name')
  const [searchQuery, setSearchQuery] = useState(cached?.data.searchQuery ?? '')
  const [totalCount, setTotalCount] = useState(cached?.data.totalCount ?? 0)
  const [loadedCount, setLoadedCount] = useState(cached?.data.loadedCount ?? 0)

  // Mirror for building appended lists synchronously inside fetchAlbums
  // (fetches are serialized by the infinite-scroll guards)
  const albumsRef = useRef(albums)
  albumsRef.current = albums

  // Grid element — A–Z rail jumps by scrolling the Nth card into view
  const gridRef = useRef<HTMLDivElement>(null)
  const jumpToIndex = useCallback((i: number) => {
    (gridRef.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: 'start' })
  }, [])

  const querySig = `${musicLibraries[0]?.Id ?? ''}|${sortBy}|${searchQuery}`

  const ITEMS_PER_PAGE = 50

  const fetchAlbums = useCallback(async (startIndex = 0, append = false) => {
    if (!api || !user?.Id || musicLibraries.length === 0) return

    if (startIndex === 0) {
      setIsLoading(true)
    }

    try {
      const itemsApi = getItemsApi(api)
      const libraryId = musicLibraries[0].Id

      const sortOptions: Record<SortOption, { sortBy: ItemSortBy[]; sortOrder: SortOrder[] }> = {
        name: { sortBy: ['SortName' as ItemSortBy], sortOrder: ['Ascending'] },
        artist: { sortBy: ['AlbumArtist' as ItemSortBy, 'SortName' as ItemSortBy], sortOrder: ['Ascending', 'Ascending'] },
        date: { sortBy: ['ProductionYear' as ItemSortBy, 'PremiereDate' as ItemSortBy], sortOrder: ['Descending', 'Descending'] },
        random: { sortBy: ['Random' as ItemSortBy], sortOrder: ['Ascending'] }
      }

      const { sortBy: sortByField, sortOrder } = sortOptions[sortBy]

      const response = await itemsApi.getItems({
        userId: user.Id,
        parentId: libraryId,
        includeItemTypes: ['MusicAlbum'],
        sortBy: sortByField,
        sortOrder,
        startIndex,
        limit: ITEMS_PER_PAGE,
        recursive: true,
        searchTerm: searchQuery || undefined
      })

      const newAlbums = response.data.Items || []
      const total = response.data.TotalRecordCount || 0
      const combined = append ? [...albumsRef.current, ...newAlbums] : newAlbums

      setTotalCount(total)
      setAlbums(combined)
      setLoadedCount(startIndex + newAlbums.length)

      saveGridState<AlbumGridCache>(CACHE_KEY, `${libraryId ?? ''}|${sortBy}|${searchQuery}`, {
        items: combined,
        totalCount: total,
        loadedCount: startIndex + newAlbums.length,
        sortBy,
        searchQuery,
      })

    } catch (e) {
      console.error('Failed to fetch albums:', e)
    }

    setIsLoading(false)
  }, [api, user?.Id, musicLibraries, sortBy, searchQuery])

  // Blocks re-requesting the same page after a failed fetch (would loop forever
  // since the sentinel stays visible); reset when the query changes
  const lastRequestedIndexRef = useRef(-1)

  useEffect(() => {
    lastRequestedIndexRef.current = -1
    const cachedNow = loadGridState<AlbumGridCache>(CACHE_KEY)
    if (cachedNow && cachedNow.sig === querySig) {
      // Cache matches the current query (typical on back-navigation) — reuse
      // it instead of refetching. Also covers effect re-runs caused by the
      // parent refetching musicLibraries (new array identity, same content).
      setAlbums(cachedNow.data.items)
      setTotalCount(cachedNow.data.totalCount)
      setLoadedCount(cachedNow.data.loadedCount)
      setIsLoading(false)
      return
    }
    setScrollPos(CACHE_KEY, 0)
    fetchAlbums(0, false)
  }, [fetchAlbums, querySig])

  const hasMore = loadedCount < totalCount
  const handleLoadMore = useCallback(() => {
    if (lastRequestedIndexRef.current === loadedCount) return
    lastRequestedIndexRef.current = loadedCount
    return fetchAlbums(loadedCount, true)
  }, [fetchAlbums, loadedCount])

  const { sentinelRef } = useInfiniteScroll({
    hasMore,
    isLoading,
    onLoadMore: handleLoadMore,
  })

  const scrollAnchorRef = useScrollRestore(CACHE_KEY, !isLoading && albums.length > 0)

  const handlePlayAlbum = async (album: BaseItemDto) => {
    if (!api || !user?.Id) return

    try {
      const itemsApi = getItemsApi(api)
      const tracksResponse = await itemsApi.getItems({
        userId: user.Id,
        parentId: album.Id,
        includeItemTypes: ['Audio'],
        sortBy: ['IndexNumber'],
        sortOrder: ['Ascending']
      })

      const tracks: Track[] = (tracksResponse.data.Items || []).map(item => ({
        id: item.Id!,
        name: item.Name || 'Unknown Track',
        artists: item.Artists || [item.AlbumArtist || 'Unknown Artist'],
        artistIds: item.ArtistItems?.map(a => a.Id!) || [],
        albumId: album.Id!,
        albumName: album.Name || 'Unknown Album',
        duration: item.RunTimeTicks || 0,
        indexNumber: item.IndexNumber,
        imageUrl: serverUrl ? `${serverUrl}/Items/${album.Id}/Images/Primary?maxWidth=120` : undefined
      }))

      if (tracks.length > 0) {
        setQueue(tracks, 0, album.Name)
      }
    } catch (e) {
      console.error('Failed to play album:', e)
    }
  }

  return (
    <div className="p-8" ref={scrollAnchorRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Albums</h1>

        <div className="flex items-center gap-4">
          {/* Search */}
          <div className="relative">
            <SearchIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search albums..."
              className="w-64 pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg
                text-white placeholder-white/40 focus:outline-none focus:border-theme-500/50"
            />
          </div>

          {/* Sort — phone: bottom sheet of options, desktop: native select */}
          {isPhone ? (
            <BottomSheetSelect<SortOption>
              title="Sort by"
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: 'name', label: 'Name' },
                { value: 'artist', label: 'Artist' },
                { value: 'date', label: 'Release Date' },
                { value: 'random', label: 'Random' },
              ]}
            />
          ) : (
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white
                focus:outline-none focus:border-theme-500/50 cursor-pointer"
            >
              <option value="name">Name</option>
              <option value="artist">Artist</option>
              <option value="date">Release Date</option>
              <option value="random">Random</option>
            </select>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading && albums.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={48} className="animate-spin text-theme-500" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && albums.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <Disc3 size={64} className="text-white/20 mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">No Albums Found</h2>
          <p className="text-white/60">
            {searchQuery ? 'Try a different search term' : 'Your music library appears to be empty'}
          </p>
        </div>
      )}

      {/* Album Grid */}
      {albums.length > 0 && (
        <>
          <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-6">
            {albums.map((album) => (
              <AlbumCard
                key={album.Id}
                album={album}
                size="fluid"
                onClick={() => onNavigate({ type: 'album-details', album })}
                onPlay={() => handlePlayAlbum(album)}
              />
            ))}
          </div>

          {/* Infinite scroll sentinel */}
          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-8">
              <Loader2 size={24} className="animate-spin text-white/40" />
            </div>
          )}

          {/* A–Z fast-scroll rail (phone, name sort only) */}
          <AlphabetScrollRail
            labels={albums.map(a => a.Name || '')}
            onJump={jumpToIndex}
            enabled={sortBy === 'name' && !searchQuery && albums.length > 30}
          />
        </>
      )}
    </div>
  )
}
