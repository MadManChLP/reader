import React, { useEffect, useState, useCallback, useRef, memo } from 'react'
import { Clock, Disc3, Heart, Shuffle, Loader2, Tag, TrendingUp, Sparkles, CalendarDays, Plus, Play } from 'lucide-react'
import { useJellyfin, getItemsApi, type BaseItemDto } from '../JellyfinContext'
import { ScrollSection } from '../ScrollSection'
import { AlbumCard } from './components/AlbumCard'
import { useMusicPlayer, type Track } from '../../../stores/musicPlayerStore'
import type { MusicViewType } from './JellyMusicView'

interface MusicHomeProps {
  onNavigate: (view: MusicViewType) => void
  musicLibraries: BaseItemDto[]
}

// Sections that keep loading more items as you scroll toward their right end
type PagedSectionKey = 'recent' | 'mostPlayed' | 'newlyAdded' | 'recentlyReleased' | 'random'
const PAGE_SIZE = 20

// Append while dropping items already present (random pages can overlap)
const appendUnique = (prev: BaseItemDto[], next: BaseItemDto[]) => {
  const ids = new Set(prev.map(i => i.Id))
  return [...prev, ...next.filter(i => i.Id && !ids.has(i.Id))]
}

// Skeleton loader for album cards
const AlbumSkeleton = memo(function AlbumSkeleton() {
  return (
    <div className="w-44 flex-shrink-0 animate-pulse">
      <div className="aspect-square rounded-lg bg-white/10 mb-3" />
      <div className="h-4 bg-white/10 rounded w-3/4 mb-2" />
      <div className="h-3 bg-white/10 rounded w-1/2" />
    </div>
  )
})

// Song card for horizontal scroll sections (uses album art)
const SongCard = memo(function SongCard({
  song,
  onPlay,
  onClick,
  getImageUrl,
  serverUrl,
}: {
  song: BaseItemDto
  onPlay: () => void
  onClick: () => void
  getImageUrl: (id: string, type?: 'Primary' | 'Backdrop' | 'Thumb', maxWidth?: number) => string | null
  serverUrl: string | null
}) {
  const imageId = song.AlbumId || song.Id
  const imageUrl = imageId && serverUrl
    ? `${serverUrl}/Items/${imageId}/Images/Primary?maxWidth=250&quality=80`
    : imageId ? getImageUrl(imageId!, 'Primary', 250) : null

  const handlePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onPlay()
  }, [onPlay])

  return (
    <div
      onClick={onClick}
      className="group w-44 flex-shrink-0 cursor-pointer"
    >
      <div className="relative aspect-square rounded-lg overflow-hidden bg-white/5 mb-3 shadow-lg">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={song.Name || 'Song'}
            className="w-full h-full object-cover transition-all duration-300 group-hover:scale-105 group-hover:brightness-75"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
            <Disc3 size={48} className="text-white/30" />
          </div>
        )}
        <button
          onClick={handlePlay}
          className="absolute bottom-2 right-2 p-3 bg-theme-500 rounded-full text-white shadow-xl
            opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0
            transition-all duration-200 hover:scale-105 hover:bg-theme-400"
        >
          <Play size={20} fill="currentColor" />
        </button>
      </div>
      <h3 className="text-sm font-medium text-white truncate">{song.Name}</h3>
      <p className="text-xs text-white/60 truncate">
        {song.Artists?.join(', ') || song.AlbumArtist || 'Unknown Artist'}
      </p>
    </div>
  )
})

// Genre card component
const GenreCard = memo(function GenreCard({
  genre,
  onClick
}: {
  genre: BaseItemDto
  onClick: () => void
}) {
  // Generate a consistent color based on genre name
  const colors = [
    'from-theme-500 to-indigo-600',
    'from-pink-500 to-rose-600',
    'from-blue-500 to-cyan-600',
    'from-green-500 to-emerald-600',
    'from-orange-500 to-amber-600',
    'from-red-500 to-pink-600',
    'from-teal-500 to-green-600',
    'from-violet-500 to-theme-600',
  ]
  const colorIndex = (genre.Name?.charCodeAt(0) || 0) % colors.length

  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 w-40 h-24 rounded-lg bg-gradient-to-br ${colors[colorIndex]}
        flex items-end p-3 hover:scale-105 transition-transform shadow-lg`}
    >
      <span className="text-sm font-bold text-white truncate">{genre.Name}</span>
    </button>
  )
})

// Hero Slideshow for Music
const MusicHeroSlideshow = memo(function MusicHeroSlideshow({
  items,
  onPlay,
  onDetails,
  getImageUrl,
  serverUrl
}: {
  items: BaseItemDto[]
  onPlay: (item: BaseItemDto) => void
  onDetails: (item: BaseItemDto) => void
  getImageUrl: (id: string, type?: 'Primary' | 'Backdrop' | 'Thumb', maxWidth?: number) => string | null
  serverUrl: string | null
}) {
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (items.length <= 1) return
    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % items.length)
    }, 10000)
    return () => clearInterval(interval)
  }, [items.length])

  const item = items[currentIndex]
  if (!item) return null

  // For albums, primary image is fine. For tracks, use AlbumId image if available.
  const imageId = item.Type === 'Audio' ? item.AlbumId : item.Id
  const imageUrl = imageId && serverUrl
    ? `${serverUrl}/Items/${imageId}/Images/Primary?maxWidth=1000&quality=90`
    : imageId ? getImageUrl(imageId, 'Primary', 1000) : null

  return (
    <div className="relative w-full h-[350px] overflow-hidden group border-b border-white/5">
      {/* Background (Blurry) */}
      <div className="absolute inset-0">
        {imageUrl ? (
           <img
             src={imageUrl}
             key={`bg-${item.Id}`}
             className="w-full h-full object-cover opacity-30 blur-3xl scale-110 transition-opacity duration-1000"
             alt=""
           />
        ) : (
           <div className="w-full h-full bg-gradient-to-br from-theme-900/50 to-gray-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-gray-900 via-gray-900/30 to-transparent" />
      </div>

      {/* Content */}
      <div className="absolute inset-0 flex items-center px-12 gap-8">
        {/* Cover Image */}
        <div
          className="flex-shrink-0 h-[250px] aspect-square rounded-xl overflow-hidden shadow-2xl z-10 transform transition-transform group-hover:scale-105 duration-500 cursor-pointer ring-1 ring-white/10"
          onClick={() => onDetails(item)}
        >
           {imageUrl ? (
             <img
               src={imageUrl}
               key={`cover-${item.Id}`}
               className="w-full h-full object-cover"
               alt={item.Name || ''}
             />
           ) : (
             <div className="w-full h-full bg-gray-800 flex items-center justify-center text-white/40">No Cover</div>
           )}
        </div>

        {/* Info */}
        <div className="flex flex-col gap-4 max-w-2xl z-10">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-theme-500/80 rounded text-[10px] font-bold text-white uppercase tracking-wider">
              Featured {item.Type === 'Audio' ? 'Track' : 'Album'}
            </span>
          </div>
          <h1 className="text-4xl font-bold leading-tight line-clamp-2 text-white drop-shadow-lg">
            {item.Name}
          </h1>
          <div className="text-lg text-white/70 font-medium">
            {item.AlbumArtist || item.Artists?.join(', ') || 'Unknown Artist'}
          </div>
          {item.Type === 'Audio' && item.Album && (
            <div className="text-sm text-white/50">
              From the album <span className="text-white/70 italic">{item.Album}</span>
            </div>
          )}

          <div className="flex gap-3 mt-2">
            <button
              onClick={() => onPlay(item)}
              className="px-6 py-2.5 bg-white text-black rounded-full font-semibold flex items-center gap-2 hover:scale-105 transition-transform shadow-lg"
            >
              <Play size={18} fill="currentColor" />
              Listen Now
            </button>
            <button
              onClick={() => onDetails(item)}
              className="px-6 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-full font-semibold flex items-center gap-2 hover:bg-white/20 transition-colors"
            >
              <Sparkles size={18} />
              View Details
            </button>
          </div>
        </div>
      </div>

      {/* Indicators */}
      {items.length > 1 && (
        <div className="absolute bottom-6 right-12 flex gap-2 z-20">
          {items.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              className={`h-1 rounded-full transition-all duration-300 ${
                idx === currentIndex
                  ? 'w-6 bg-theme-500'
                  : 'w-1.5 bg-white/30 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
})

export const MusicHome = memo(function MusicHome({ onNavigate, musicLibraries }: MusicHomeProps) {
  const { api, user, serverUrl, getImageUrl } = useJellyfin()
  const setQueue = useMusicPlayer(s => s.setQueue)

  // Section states - each loads independently for better performance
  const [heroItems, setHeroItems] = useState<BaseItemDto[]>([])
  const [recentSongs, setRecentSongs] = useState<BaseItemDto[]>([])
  const [favoriteAlbums, setFavoriteAlbums] = useState<BaseItemDto[]>([])
  const [randomAlbums, setRandomAlbums] = useState<BaseItemDto[]>([])
  const [mostPlayedSongs, setMostPlayedSongs] = useState<BaseItemDto[]>([])
  const [newlyAddedAlbums, setNewlyAddedAlbums] = useState<BaseItemDto[]>([])
  const [recentlyReleasedAlbums, setRecentlyReleasedAlbums] = useState<BaseItemDto[]>([])
  const [genres, setGenres] = useState<BaseItemDto[]>([])

  // Loading states per section
  const [loadingStates, setLoadingStates] = useState({
    hero: true,
    recent: true,
    favorites: true,
    random: true,
    mostPlayed: true,
    newlyAdded: true,
    recentlyReleased: true,
    genres: true
  })

  const [initialLoad, setInitialLoad] = useState(true)

  // Infinite-strip paging: busy/hasMore live in a ref (no re-render needed),
  // loadingMore drives the trailing skeleton per section
  const pagingRef = useRef<Record<PagedSectionKey, { busy: boolean; hasMore: boolean }>>({
    recent: { busy: false, hasMore: true },
    mostPlayed: { busy: false, hasMore: true },
    newlyAdded: { busy: false, hasMore: true },
    recentlyReleased: { busy: false, hasMore: true },
    random: { busy: false, hasMore: true },
  })
  const [loadingMore, setLoadingMore] = useState<Record<PagedSectionKey, boolean>>({
    recent: false,
    mostPlayed: false,
    newlyAdded: false,
    recentlyReleased: false,
    random: false,
  })

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }

  // Fetch data for each section independently (parallel loading)
  useEffect(() => {
    if (!api || !user?.Id || musicLibraries.length === 0) {
      setInitialLoad(false)
      return
    }

    const itemsApi = getItemsApi(api)
    const libraryId = musicLibraries[0].Id

    // Fresh library/user: reset infinite-strip paging
    for (const key of Object.keys(pagingRef.current) as PagedSectionKey[]) {
      pagingRef.current[key] = { busy: false, hasMore: true }
    }

    // Fetch hero items (random mix of albums and highly rated tracks)
    const fetchHero = async () => {
      try {
        const response = await itemsApi.getItems({
          userId: user.Id,
          parentId: libraryId,
          includeItemTypes: ['MusicAlbum', 'Audio'],
          sortBy: ['Random'],
          limit: 10,
          recursive: true,
          fields: ['UserData', 'ArtistItems', 'AlbumId'] as any
        })
        setHeroItems(response.data.Items || [])
      } catch (e) {
        console.error('Failed to fetch hero items:', e)
      }
      setLoadingStates(prev => ({ ...prev, hero: false }))
    }

    // Fetch recently played songs (Jellyfin tracks play data on Audio items, not albums)
    const fetchRecent = async () => {
      try {
        const response = await itemsApi.getItems({
          userId: user.Id,
          parentId: libraryId,
          includeItemTypes: ['Audio'],
          sortBy: ['DatePlayed'],
          sortOrder: ['Descending'],
          limit: 20,
          recursive: true,
          filters: ['IsPlayed']
        })
        setRecentSongs(response.data.Items || [])
      } catch (e) {
        console.error('Failed to fetch recent songs:', e)
      }
      setLoadingStates(prev => ({ ...prev, recent: false }))
    }

    // Fetch favorite albums
    const fetchFavorites = async () => {
      try {
        const response = await itemsApi.getItems({
          userId: user.Id,
          parentId: libraryId,
          includeItemTypes: ['MusicAlbum'],
          sortBy: ['SortName'],
          sortOrder: ['Ascending'],
          limit: 10,
          recursive: true,
          filters: ['IsFavorite']
        })
        setFavoriteAlbums(response.data.Items || [])
      } catch (e) {
        console.error('Failed to fetch favorite albums:', e)
      }
      setLoadingStates(prev => ({ ...prev, favorites: false }))
    }

    // Fetch random albums (Explore from library)
    const fetchRandom = async () => {
      try {
        const response = await itemsApi.getItems({
          userId: user.Id,
          parentId: libraryId,
          includeItemTypes: ['MusicAlbum'],
          sortBy: ['Random'],
          limit: PAGE_SIZE,
          recursive: true
        })
        setRandomAlbums(response.data.Items || [])
      } catch (e) {
        console.error('Failed to fetch random albums:', e)
      }
      setLoadingStates(prev => ({ ...prev, random: false }))
    }

    // Fetch most played songs (Jellyfin tracks play counts on Audio items, not albums)
    const fetchMostPlayed = async () => {
      try {
        const response = await itemsApi.getItems({
          userId: user.Id,
          parentId: libraryId,
          includeItemTypes: ['Audio'],
          sortBy: ['PlayCount'],
          sortOrder: ['Descending'],
          limit: 50,
          recursive: true,
          filters: ['IsPlayed']
        })
        setMostPlayedSongs(response.data.Items || [])
      } catch (e) {
        console.error('Failed to fetch most played songs:', e)
      }
      setLoadingStates(prev => ({ ...prev, mostPlayed: false }))
    }

    // Fetch newly added albums
    const fetchNewlyAdded = async () => {
      try {
        const response = await itemsApi.getItems({
          userId: user.Id,
          parentId: libraryId,
          includeItemTypes: ['MusicAlbum'],
          sortBy: ['DateCreated'],
          sortOrder: ['Descending'],
          limit: PAGE_SIZE,
          recursive: true
        })
        setNewlyAddedAlbums(response.data.Items || [])
      } catch (e) {
        console.error('Failed to fetch newly added albums:', e)
      }
      setLoadingStates(prev => ({ ...prev, newlyAdded: false }))
    }

    // Fetch recently released albums (by production year)
    const fetchRecentlyReleased = async () => {
      try {
        const currentYear = new Date().getFullYear()
        const response = await itemsApi.getItems({
          userId: user.Id,
          parentId: libraryId,
          includeItemTypes: ['MusicAlbum'],
          sortBy: ['ProductionYear', 'PremiereDate'],
          sortOrder: ['Descending', 'Descending'],
          limit: PAGE_SIZE,
          recursive: true,
          minPremiereDate: `${currentYear - 2}-01-01`
        })
        setRecentlyReleasedAlbums(response.data.Items || [])
      } catch (e) {
        console.error('Failed to fetch recently released albums:', e)
      }
      setLoadingStates(prev => ({ ...prev, recentlyReleased: false }))
    }

    // Fetch genres
    const fetchGenres = async () => {
      try {
        const response = await itemsApi.getItems({
          userId: user.Id,
          parentId: libraryId,
          includeItemTypes: ['MusicGenre'],
          sortBy: ['SortName'],
          sortOrder: ['Ascending'],
          limit: 20,
          recursive: true
        })
        setGenres(response.data.Items || [])
      } catch (e) {
        console.error('Failed to fetch genres:', e)
      }
      setLoadingStates(prev => ({ ...prev, genres: false }))
    }

    // Start all fetches in parallel — use allSettled so a single failure doesn't
    // block other sections or leave the component in a permanent loading state.
    Promise.allSettled([
      fetchHero(),
      fetchRecent(),
      fetchFavorites(),
      fetchRandom(),
      fetchMostPlayed(),
      fetchNewlyAdded(),
      fetchRecentlyReleased(),
      fetchGenres()
    ]).then(() => {
      setInitialLoad(false)
    })
  }, [api, user?.Id, musicLibraries])

  // ── Infinite strips: fetch the next page when a row is scrolled near its end ──
  const loadMoreSection = useCallback(async (
    key: PagedSectionKey,
    currentCount: number,
    setItems: React.Dispatch<React.SetStateAction<BaseItemDto[]>>
  ) => {
    const paging = pagingRef.current[key]
    if (paging.busy || !paging.hasMore || !api || !user?.Id || musicLibraries.length === 0) return
    paging.busy = true
    setLoadingMore(prev => ({ ...prev, [key]: true }))

    try {
      const itemsApi = getItemsApi(api)
      const base = {
        userId: user.Id,
        parentId: musicLibraries[0].Id,
        recursive: true,
        limit: PAGE_SIZE,
      }

      let params: Parameters<typeof itemsApi.getItems>[0]
      switch (key) {
        case 'recent':
          params = { ...base, includeItemTypes: ['Audio'], sortBy: ['DatePlayed'], sortOrder: ['Descending'], filters: ['IsPlayed'], startIndex: currentCount }
          break
        case 'mostPlayed':
          params = { ...base, includeItemTypes: ['Audio'], sortBy: ['PlayCount'], sortOrder: ['Descending'], filters: ['IsPlayed'], startIndex: currentCount }
          break
        case 'newlyAdded':
          params = { ...base, includeItemTypes: ['MusicAlbum'], sortBy: ['DateCreated'], sortOrder: ['Descending'], startIndex: currentCount }
          break
        case 'recentlyReleased': {
          const currentYear = new Date().getFullYear()
          params = { ...base, includeItemTypes: ['MusicAlbum'], sortBy: ['ProductionYear', 'PremiereDate'], sortOrder: ['Descending', 'Descending'], minPremiereDate: `${currentYear - 2}-01-01`, startIndex: currentCount }
          break
        }
        case 'random':
          // Random has no stable order to paginate — fetch another random page
          // and de-duplicate; stop once a page brings nothing new
          params = { ...base, includeItemTypes: ['MusicAlbum'], sortBy: ['Random'] }
          break
      }

      const response = await itemsApi.getItems(params)
      const fetched = response.data.Items || []
      if (fetched.length < PAGE_SIZE && key !== 'random') paging.hasMore = false

      setItems(prev => {
        const merged = appendUnique(prev, fetched)
        if (key === 'random' && merged.length === prev.length) paging.hasMore = false
        return merged
      })
    } catch (e) {
      console.error(`Failed to load more (${key}):`, e)
    }

    paging.busy = false
    setLoadingMore(prev => ({ ...prev, [key]: false }))
  }, [api, user?.Id, musicLibraries])

  const handlePlayAlbum = useCallback(async (album: BaseItemDto) => {
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
  }, [api, user?.Id, serverUrl, setQueue])

  const handlePlaySong = useCallback((song: BaseItemDto, songList: BaseItemDto[]) => {
    if (!serverUrl) return

    const tracks: Track[] = songList.map(item => ({
      id: item.Id!,
      name: item.Name || 'Unknown Track',
      artists: item.Artists || [item.AlbumArtist || 'Unknown Artist'],
      artistIds: item.ArtistItems?.map(a => a.Id!) || [],
      albumId: item.AlbumId || '',
      albumName: item.Album || 'Unknown Album',
      duration: item.RunTimeTicks || 0,
      indexNumber: item.IndexNumber,
      imageUrl: item.AlbumId ? `${serverUrl}/Items/${item.AlbumId}/Images/Primary?maxWidth=120` : undefined
    }))

    const idx = tracks.findIndex(t => t.id === song.Id)
    if (tracks.length > 0) {
      setQueue(tracks, idx >= 0 ? idx : 0)
    }
  }, [serverUrl, setQueue])

  // Show initial loading only briefly
  if (initialLoad && Object.values(loadingStates).every(v => v)) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={48} className="animate-spin text-theme-500" />
      </div>
    )
  }

  if (musicLibraries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Disc3 size={64} className="text-white/20 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">No Music Libraries</h2>
        <p className="text-white/60 max-w-md">
          No music libraries found in your Jellyfin server. Add a music library to get started.
        </p>
      </div>
    )
  }

  // Render skeleton or content for each section
  const renderSection = (
    title: string,
    icon: React.ReactNode,
    items: BaseItemDto[],
    isLoading: boolean,
    showIfEmpty = false,
    paged?: { key: PagedSectionKey; setItems: React.Dispatch<React.SetStateAction<BaseItemDto[]>> }
  ) => {
    if (!isLoading && items.length === 0 && !showIfEmpty) return null

    return (
      <ScrollSection
        title={title}
        icon={icon}
        onEndReached={paged ? () => loadMoreSection(paged.key, items.length, paged.setItems) : undefined}
      >
        {isLoading ? (
          // Show skeletons while loading
          <>
            <AlbumSkeleton />
            <AlbumSkeleton />
            <AlbumSkeleton />
            <AlbumSkeleton />
            <AlbumSkeleton />
          </>
        ) : (
          <>
            {items.map((album) => (
              <AlbumCard
                key={album.Id}
                album={album}
                onClick={() => onNavigate({ type: 'album-details', album })}
                onPlay={() => handlePlayAlbum(album)}
              />
            ))}
            {paged && loadingMore[paged.key] && <AlbumSkeleton />}
          </>
        )}
      </ScrollSection>
    )
  }

  return (
    <div className="pb-8 space-y-6">
      {/* Header */}
      <div className="px-8 pt-6">
        <h1 className="text-3xl font-bold text-white mb-1">{getGreeting()}</h1>
        <p className="text-white/60 text-sm">Listen to your favorite music</p>
      </div>

      {/* Genres */}
      {(loadingStates.genres || genres.length > 0) && (
        <ScrollSection
          title="Genres"
          icon={<Tag size={20} className="text-green-400" />}
        >
          {loadingStates.genres ? (
            <>
              <div className="w-40 h-24 rounded-lg bg-white/10 animate-pulse flex-shrink-0" />
              <div className="w-40 h-24 rounded-lg bg-white/10 animate-pulse flex-shrink-0" />
              <div className="w-40 h-24 rounded-lg bg-white/10 animate-pulse flex-shrink-0" />
            </>
          ) : (
            genres.map((genre) => (
              <GenreCard
                key={genre.Id}
                genre={genre}
                onClick={() => onNavigate({ type: 'genre-details', genre })}
              />
            ))
          )}
        </ScrollSection>
      )}

      {/* Recently Played Songs */}
      {(loadingStates.recent || recentSongs.length > 0) && (
        <ScrollSection
          title="Recently Played"
          icon={<Clock size={20} className="text-theme-400" />}
          onEndReached={() => loadMoreSection('recent', recentSongs.length, setRecentSongs)}
        >
          {loadingStates.recent ? (
            <>
              <AlbumSkeleton />
              <AlbumSkeleton />
              <AlbumSkeleton />
              <AlbumSkeleton />
              <AlbumSkeleton />
            </>
          ) : (
            <>
              {recentSongs.map((song) => (
                <SongCard
                  key={song.Id}
                  song={song}
                  getImageUrl={getImageUrl}
                  serverUrl={serverUrl}
                  onPlay={() => handlePlaySong(song, recentSongs)}
                  onClick={() => song.AlbumId
                    ? onNavigate({ type: 'album-details', album: { Id: song.AlbumId, Name: song.Album, Type: 'MusicAlbum' } as BaseItemDto })
                    : undefined}
                />
              ))}
              {loadingMore.recent && <AlbumSkeleton />}
            </>
          )}
        </ScrollSection>
      )}

      {/* Most Played Songs */}
      {(loadingStates.mostPlayed || mostPlayedSongs.length > 0) && (
        <ScrollSection
          title="Most Played"
          icon={<TrendingUp size={20} className="text-orange-400" />}
          onEndReached={() => loadMoreSection('mostPlayed', mostPlayedSongs.length, setMostPlayedSongs)}
        >
          {loadingStates.mostPlayed ? (
            <>
              <AlbumSkeleton />
              <AlbumSkeleton />
              <AlbumSkeleton />
              <AlbumSkeleton />
              <AlbumSkeleton />
            </>
          ) : (
            <>
              {mostPlayedSongs.map((song) => (
                <SongCard
                  key={song.Id}
                  song={song}
                  getImageUrl={getImageUrl}
                  serverUrl={serverUrl}
                  onPlay={() => handlePlaySong(song, mostPlayedSongs)}
                  onClick={() => song.AlbumId
                    ? onNavigate({ type: 'album-details', album: { Id: song.AlbumId, Name: song.Album, Type: 'MusicAlbum' } as BaseItemDto })
                    : undefined}
                />
              ))}
              {loadingMore.mostPlayed && <AlbumSkeleton />}
            </>
          )}
        </ScrollSection>
      )}

      {/* Favorite Albums */}
      {renderSection(
        'Favorite Albums',
        <Heart size={20} className="text-pink-400" />,
        favoriteAlbums,
        loadingStates.favorites
      )}

      {/* Newly Added to Library */}
      {renderSection(
        'Newly Added',
        <Plus size={20} className="text-blue-400" />,
        newlyAddedAlbums,
        loadingStates.newlyAdded,
        false,
        { key: 'newlyAdded', setItems: setNewlyAddedAlbums }
      )}

      {/* Recently Released */}
      {renderSection(
        'Recently Released',
        <CalendarDays size={20} className="text-cyan-400" />,
        recentlyReleasedAlbums,
        loadingStates.recentlyReleased,
        false,
        { key: 'recentlyReleased', setItems: setRecentlyReleasedAlbums }
      )}

      {/* Explore / Random */}
      {renderSection(
        'Explore Your Library',
        <Sparkles size={20} className="text-yellow-400" />,
        randomAlbums,
        loadingStates.random,
        false,
        { key: 'random', setItems: setRandomAlbums }
      )}

      {/* Empty state if nothing to show after loading */}
      {!initialLoad &&
        recentSongs.length === 0 &&
        favoriteAlbums.length === 0 &&
        randomAlbums.length === 0 &&
        mostPlayedSongs.length === 0 &&
        newlyAddedAlbums.length === 0 &&
        genres.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <Disc3 size={64} className="text-white/20 mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">Your Library is Empty</h2>
            <p className="text-white/60">Start by browsing albums or artists</p>
          </div>
        )}
    </div>
  )
})
