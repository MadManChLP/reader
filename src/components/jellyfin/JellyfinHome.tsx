import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Play, Info, Clock, Film, Tv2, Music, FolderOpen, ChevronRight, ChevronLeft, Loader2, RefreshCw, HardDrive, Download, CheckCircle2, Heart, Star, Check, EyeOff } from 'lucide-react'
import { motion } from 'framer-motion'
import { useJellyfin, getItemsApi, getUserViewsApi, getUserLibraryApi, type BaseItemDto } from './JellyfinContext'
import { useSettingsStore } from '../../stores/settingsStore'
import { api as appApi, toLocalUrl } from '../../utils/api'
import { ScrollSection } from './ScrollSection'
import { isRealItem } from './itemFilters'
import { onJellyfinSoftRefresh, itemsWatchSig } from '../../utils/jellyfinRefreshBus'
import {
  getDownloadedMedia,
  getDownloadQueue,
  subscribeToDownloadUpdates,
  addToQueue,
  type DownloadedMedia,
  type DownloadQueueItem,
  formatBytes
} from '../../utils/jellyfinDownloadManager'
import { useToast } from '../Toast'

interface JellyfinHomeProps {
  onPlayItem: (item: BaseItemDto) => void
  onViewItem: (item: BaseItemDto) => void
}

interface LibraryLatestItems {
  library: BaseItemDto
  items: BaseItemDto[]
}

// User views that aren't browsable video libraries: music/playlists belong to
// JellyMusic, Live TV has its own tab. Recording folders can't be identified by
// CollectionType — those are hidden manually (hiddenJellyfinLibraries setting).
const NON_LIBRARY_COLLECTION_TYPES = new Set(['music', 'livetv', 'playlists'])

function isVisibleLibrary(lib: BaseItemDto, hiddenIds: Set<string>): boolean {
  if (NON_LIBRARY_COLLECTION_TYPES.has(lib.CollectionType || '')) return false
  return !(lib.Id && hiddenIds.has(lib.Id))
}

export function JellyfinHome({ onPlayItem, onViewItem }: JellyfinHomeProps) {
  const { api, user, getImageUrl, serverUrl } = useJellyfin()
  const cardSize = useSettingsStore((state) => state.jellyfinHomeCardSize)
  const serverId = useSettingsStore((state) => state.activeJellyfinServerId)
  const hiddenLibraries = useSettingsStore((state) => state.hiddenJellyfinLibraries)
  const hideJellyfinLibrary = useSettingsStore((state) => state.hideJellyfinLibrary)
  const toast = useToast()

  const [resumeItems, setResumeItems] = useState<BaseItemDto[]>([])
  const [upNextItems, setUpNextItems] = useState<BaseItemDto[]>([])
  const [libraryLatestItems, setLibraryLatestItems] = useState<LibraryLatestItems[]>([])
  const [libraries, setLibraries] = useState<BaseItemDto[]>([])
  const [favoriteItems, setFavoriteItems] = useState<BaseItemDto[]>([])
  const [heroItems, setHeroItems] = useState<BaseItemDto[]>([])
  const [heroIndex, setHeroIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Holds the currently-loaded visible libraries so a background (silent)
  // refresh can re-fetch their "Latest" rows without re-fetching the library
  // list itself (libraries rarely change; the hero would also reshuffle).
  const librariesRef = useRef<BaseItemDto[]>([])

  // Offline downloads state
  const [downloadedMedia, setDownloadedMedia] = useState<DownloadedMedia[]>([])
  const [downloadQueue, setDownloadQueue] = useState<DownloadQueueItem[]>([])

  // Render-time filter so hiding a library takes effect instantly, without a refetch
  const hiddenIds = new Set(hiddenLibraries.map(l => l.id))
  const visibleLibraries = libraries.filter(lib => isVisibleLibrary(lib, hiddenIds))
  const visibleLatestItems = libraryLatestItems.filter(({ library }) => isVisibleLibrary(library, hiddenIds))
  librariesRef.current = libraries

  // Subscribe to download updates
  useEffect(() => {
    const updateDownloads = () => {
      setDownloadedMedia(getDownloadedMedia())
      setDownloadQueue(getDownloadQueue())
    }
    updateDownloads()
    const unsubscribe = subscribeToDownloadUpdates(updateDownloads)
    return unsubscribe
  }, [])

  // Hero slideshow timer
  useEffect(() => {
    if (heroItems.length <= 1) return

    const timer = setInterval(() => {
      setHeroIndex(prev => (prev + 1) % heroItems.length)
    }, 8000) // Change every 8 seconds

    return () => clearInterval(timer)
  }, [heroItems.length])

  const goToNextHero = useCallback(() => {
    setHeroIndex(prev => (prev + 1) % heroItems.length)
  }, [heroItems.length])

  const goToPrevHero = useCallback(() => {
    setHeroIndex(prev => (prev - 1 + heroItems.length) % heroItems.length)
  }, [heroItems.length])

  // Fetch (and, on a background pass, diff-refresh) all home sections.
  // `silent` skips the loading spinner and, rather than blindly overwriting,
  // only swaps a section's state when its watched signature actually changed
  // (returning the previous reference otherwise so React skips the re-render).
  // A silent pass also leaves the hero (would reshuffle) and the library list
  // untouched, refreshing only the watch-state-driven rows.
  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false
    if (!api || !user?.Id) return

    if (!silent) {
      setIsLoading(true)
      setError(null)
    }

    try {
      const itemsApi = getItemsApi(api)
      const userViewsApi = getUserViewsApi(api)

      // Fetch continue watching
      const resumeResponse = await itemsApi.getResumeItems({
        userId: user.Id!,
        limit: 24,
        mediaTypes: ['Video'],
      })
      const resume = resumeResponse.data.Items || []
      setResumeItems(prev => (itemsWatchSig(prev) === itemsWatchSig(resume) ? prev : resume))

      // Fetch "Up Next" - next episodes to watch from series the user has started
      try {
        const res = await appApi.request({
          method: 'GET',
          url: `${serverUrl}/Shows/NextUp?userId=${user.Id}&limit=24&fields=Overview,PrimaryImageAspectRatio,UserData`,
          headers: {
            'Authorization': `MediaBrowser Token="${api.accessToken}"`
          }
        })

        if (res.success && res.data) {
          const items = (res.data.Items || []).filter(isRealItem)
          // Filter: Only show items that have NOT been started yet (no progress)
          const notStartedItems = items.filter((item: any) =>
            !item.UserData?.PlaybackPositionTicks || item.UserData?.PlaybackPositionTicks === 0
          )
          setUpNextItems(prev => (itemsWatchSig(prev) === itemsWatchSig(notStartedItems) ? prev : notStartedItems))
        } else if (!silent) {
          setUpNextItems([])
        }
      } catch (e) {
        console.error('Failed to fetch next up:', e)
        if (!silent) setUpNextItems([])
      }

      // Fetch libraries (user views). On a silent pass reuse the already-loaded
      // list (libraries rarely change) so we don't rebuild the hero below.
      let visibleLibraries: BaseItemDto[]
      if (!silent) {
        const librariesResponse = await userViewsApi.getUserViews({
          userId: user.Id!,
        })
        const allLibraries = librariesResponse.data.Items || []
        // Snapshot at fetch time; render-time filtering handles mid-session hides
        const hiddenIds = new Set(useSettingsStore.getState().hiddenJellyfinLibraries.map(l => l.id))
        visibleLibraries = allLibraries.filter(lib => isVisibleLibrary(lib, hiddenIds))
        setLibraries(visibleLibraries)
      } else {
        visibleLibraries = librariesRef.current
      }

      // Fetch favorites (movies and series)
      try {
        const favResponse = await itemsApi.getItems({
          userId: user.Id!,
          sortBy: ['DatePlayed', 'SortName'],
          sortOrder: ['Descending', 'Ascending'],
          includeItemTypes: ['Movie', 'Series'],
          limit: 12,
          recursive: true,
          filters: ['IsFavorite'] as any,
          fields: ['UserData'] as any,
        })
        const favorites = favResponse.data.Items || []
        setFavoriteItems(prev => (itemsWatchSig(prev) === itemsWatchSig(favorites) ? prev : favorites))
      } catch (e) {
        console.error('Failed to fetch favorites:', e)
        if (!silent) setFavoriteItems([])
      }

      // Fetch latest media PER LIBRARY (all visible libraries, alphabetical order)
      const userLibApi = getUserLibraryApi(api)
      const latestPerLibrary: LibraryLatestItems[] = []
      let allLatestEpisodes: BaseItemDto[] = []
      const heroContent: BaseItemDto[] = []

      for (const lib of visibleLibraries) {
        try {
          const latestResponse = await userLibApi.getLatestMedia({
            userId: user.Id!,
            parentId: lib.Id!,
            limit: 16,
            fields: ['PrimaryImageAspectRatio' as any, 'ParentId' as any],
            enableUserData: true,
          })
          const items = latestResponse.data || []
          if (items.length > 0) {
            latestPerLibrary.push({ library: lib, items })
            // Collect items for hero slideshow (initial load only — a silent
            // refresh must not reshuffle the hero)
            if (!silent) {
              if (lib.CollectionType === 'movies') {
                for (const movie of items.slice(0, 3)) {
                  if (movie.BackdropImageTags && movie.BackdropImageTags.length > 0) {
                    heroContent.push(movie)
                  }
                }
              } else {
                const episodes = items.filter((i: BaseItemDto) => i.Type === 'Episode')
                allLatestEpisodes = [...allLatestEpisodes, ...episodes.slice(0, 3)]
              }
            }
          }
        } catch (e) {
          console.error(`Failed to fetch latest for ${lib.Name}:`, e)
        }
      }

      // Sort all library sections alphabetically
      latestPerLibrary.sort((a, b) => (a.library.Name || '').localeCompare(b.library.Name || ''))
      const latestSig = (arr: LibraryLatestItems[]) =>
        arr.map(l => `${l.library.Id}#${itemsWatchSig(l.items)}`).join('~')
      setLibraryLatestItems(prev => (latestSig(prev) === latestSig(latestPerLibrary) ? prev : latestPerLibrary))

      // Build hero: add unique series from latest episodes (initial load only)
      if (!silent) {
        const addedSeriesIds = new Set<string>()
        for (const ep of allLatestEpisodes) {
          if (ep.SeriesId && !addedSeriesIds.has(ep.SeriesId)) {
            addedSeriesIds.add(ep.SeriesId)
            try {
              const seriesResponse = await itemsApi.getItems({
                userId: user.Id!,
                ids: [ep.SeriesId],
                fields: ['Genres', 'Overview'] as any,
              })
              if (seriesResponse.data.Items && seriesResponse.data.Items[0]) {
                const series = seriesResponse.data.Items[0]
                if (series.BackdropImageTags && series.BackdropImageTags.length > 0) {
                  heroContent.push(series)
                }
              }
            } catch (e) {
              console.error('Failed to fetch series for hero:', e)
            }
            if (heroContent.length >= 8) break
          }
        }

        // Shuffle and limit hero
        const shuffled = heroContent.sort(() => Math.random() - 0.5).slice(0, 6)
        setHeroItems(shuffled.length > 0 ? shuffled : [])
      }

    } catch (e: any) {
      console.error('Failed to fetch Jellyfin data:', e)
      if (!silent) setError('Failed to load content')
    }

    if (!silent) setIsLoading(false)
  }, [api, user?.Id, serverUrl])

  // Initial load (and reload when the server/user changes)
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Background soft-refresh: diff-refresh the watch-state rows in place
  useEffect(() => onJellyfinSoftRefresh(() => fetchData({ silent: true })), [fetchData])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={48} className="animate-spin text-theme-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
        >
          <RefreshCw size={16} />
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="pb-20 space-y-8">
      {/* Hero Slideshow Section */}
      {heroItems.length > 0 && (
        <HeroSlideshow
          items={heroItems}
          currentIndex={heroIndex}
          getImageUrl={getImageUrl}
          serverUrl={serverUrl}
          onPlay={onPlayItem}
          onInfo={onViewItem}
          onNext={goToNextHero}
          onPrev={goToPrevHero}
          onDotClick={setHeroIndex}
        />
      )}

      {/* Libraries */}
      {visibleLibraries.length > 0 && (
        <ScrollSection
          title="Libraries"
          icon={<FolderOpen size={20} className="text-theme-400" />}
        >
          {visibleLibraries.map((lib) => (
            <LibraryCard
              key={lib.Id}
              library={lib}
              onClick={() => onViewItem(lib)}
              onHide={() => hideJellyfinLibrary(lib.Id!, lib.Name || 'Library')}
              serverUrl={serverUrl}
            />
          ))}
        </ScrollSection>
      )}

      {/* Up Next - Next episodes from started shows (before Continue Watching, Blink order) */}
      {upNextItems.length > 0 && (
        <ScrollSection
          title="Up Next"
          icon={<Tv2 size={20} className="text-theme-400" />}
        >
          {upNextItems.map((item) => (
            <EpisodeCard
              key={item.Id}
              item={item}
              serverUrl={serverUrl}
              onPlay={() => onPlayItem(item)}
              onInfo={() => onViewItem(item)}
              cardWidth={Math.round(cardSize * 1.8)}
              api={api}
              userId={user?.Id}
              serverId={serverId}
            />
          ))}
        </ScrollSection>
      )}

      {/* Continue Watching - Special layout with thumbnails for episodes, posters for movies */}
      {resumeItems.length > 0 && (
        <ContinueWatchingRow
          items={resumeItems}
          getImageUrl={getImageUrl}
          serverUrl={serverUrl}
          onPlay={onPlayItem}
          onInfo={onViewItem}
          cardWidth={cardSize}
          api={api}
          userId={user?.Id}
          serverId={serverId}
        />
      )}

      {/* Downloaded for Offline */}
      {(downloadedMedia.length > 0 || downloadQueue.length > 0) && (
        <DownloadedMediaRow
          downloads={downloadedMedia}
          queue={downloadQueue}
          cardWidth={cardSize}
          onPlay={(item) => {
            // Create a BaseItemDto from downloaded media
            const dto: BaseItemDto = {
              Id: item.id,
              Name: item.name,
              Type: item.type,
              SeriesName: item.seriesName,
              SeriesId: item.seriesId,
              ParentIndexNumber: item.seasonNumber,
              IndexNumber: item.episodeNumber,
              RunTimeTicks: item.runTimeTicks,
            }
            onPlayItem(dto)
          }}
          onViewItem={onViewItem}
        />
      )}

      {/* Favorites */}
      {favoriteItems.length > 0 && (
        <MediaRow
          title="Favorites"
          icon={<Heart size={20} className="text-pink-400 fill-pink-400" />}
          items={favoriteItems}
          getImageUrl={getImageUrl}
          onPlay={onPlayItem}
          onInfo={onViewItem}
          serverUrl={serverUrl}
          api={api}
          userId={user?.Id}
          serverId={serverId}
          cardWidth={cardSize}
        />
      )}

      {/* Latest Media - Per Library, alphabetical (same order as Jellyfin web UI) */}
      {visibleLatestItems.map(({ library, items }) => (
        <ScrollSection
          key={library.Id}
          title={`Latest ${library.Name}`}
          icon={library.CollectionType === 'movies'
            ? <Film size={20} className="text-theme-400" />
            : <Tv2 size={20} className="text-theme-400" />
          }
          rightAction={
            <button className="text-sm text-white/50 hover:text-white/80 flex items-center gap-1 transition-colors">
              See All <ChevronRight size={16} />
            </button>
          }
        >
          {items.map((item) => {
            const isEpisode = item.Type === 'Episode'
            // getLatestMedia groups multiple new episodes under their parent, so a row
            // can contain Season items alongside Episodes and Movies.
            //   Episodes: always the series poster (episode stills are 16:9, cards 2:3).
            //   Seasons:  their own poster when they have one. When they don't, the
            //             server deliberately leaves ImageTags.Primary unset and fills
            //             SeriesPrimaryImageTag instead, so fall back to the series
            //             poster rather than requesting an image that 404s.
            const useSeriesPoster =
              !!item.SeriesId && (isEpisode || (item.Type === 'Season' && !item.ImageTags?.Primary))
            const posterId = useSeriesPoster ? item.SeriesId! : item.Id!
            const imageUrl = serverUrl
              ? `${serverUrl}/Items/${posterId}/Images/Primary?maxWidth=300&quality=90`
              : getImageUrl(posterId, 'Primary', 300)

            return (
              <LatestItemCard
                key={item.Id}
                item={item}
                imageUrl={imageUrl}
                onPlay={() => onPlayItem(item)}
                onInfo={() => {
                  // Episodes navigate to series details
                  if (isEpisode && item.SeriesId) {
                    onViewItem({ Id: item.SeriesId, Name: item.SeriesName, Type: 'Series' } as BaseItemDto)
                  } else {
                    onViewItem(item)
                  }
                }}
                serverUrl={serverUrl}
                api={api}
                userId={user?.Id}
                serverId={serverId}
                cardWidth={cardSize}
              />
            )
          })}
        </ScrollSection>
      ))}
    </div>
  )
}

// Hero Slideshow Component
function HeroSlideshow({
  items,
  currentIndex,
  getImageUrl,
  serverUrl,
  onPlay,
  onInfo,
  onNext,
  onPrev,
  onDotClick
}: {
  items: BaseItemDto[]
  currentIndex: number
  getImageUrl: (id: string, type?: 'Primary' | 'Backdrop' | 'Thumb', maxWidth?: number) => string | null
  serverUrl: string | null
  onPlay: (item: BaseItemDto) => void
  onInfo: (item: BaseItemDto) => void
  onNext: () => void
  onPrev: () => void
  onDotClick: (index: number) => void
}) {
  const item = items[currentIndex]
  if (!item) return null

  const backdropUrl = serverUrl
    ? `${serverUrl}/Items/${item.Id}/Images/Backdrop?maxWidth=1920&quality=90`
    : getImageUrl(item.Id!, 'Backdrop', 1920)

  const isSeries = item.Type === 'Series'

  return (
    <div className="relative h-[60vh] min-h-[400px] phone:h-[45vh] phone:min-h-[280px] overflow-hidden">
      {/* Background with fade transition */}
      <div className="absolute inset-0">
        {items.map((heroItem, idx) => {
          const bgUrl = serverUrl
            ? `${serverUrl}/Items/${heroItem.Id}/Images/Backdrop?maxWidth=1920&quality=90`
            : null
          return (
            <div
              key={heroItem.Id}
              className={`absolute inset-0 transition-opacity duration-1000 ${idx === currentIndex ? 'opacity-100' : 'opacity-0'}`}
            >
              {bgUrl ? (
                <img
                  src={bgUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-theme-900/50 to-pink-900/50" />
              )}
            </div>
          )
        })}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-gray-900/80 to-transparent" />
      </div>

      {/* Navigation Arrows */}
      {items.length > 1 && (
        <>
          <button
            onClick={onPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/40 hover:bg-black/60 rounded-full transition-colors z-10"
          >
            <ChevronLeft size={28} className="text-white" />
          </button>
          <button
            onClick={onNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/40 hover:bg-black/60 rounded-full transition-colors z-10"
          >
            <ChevronRight size={28} className="text-white" />
          </button>
        </>
      )}

      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 p-8 phone:p-4 space-y-4 phone:space-y-2">
        {/* Type Badge */}
        <div className="flex items-center gap-2">
          {isSeries ? (
            <span className="px-2 py-1 bg-theme-500/80 rounded text-xs font-medium text-white flex items-center gap-1">
              <Tv2 size={12} /> Series
            </span>
          ) : (
            <span className="px-2 py-1 bg-pink-500/80 rounded text-xs font-medium text-white flex items-center gap-1">
              <Film size={12} /> Movie
            </span>
          )}
          <span className="px-2 py-1 bg-white/20 rounded text-xs text-white/80">New</span>
        </div>

        <h1 className="text-4xl md:text-5xl phone:text-2xl font-bold text-white max-w-2xl">
          {item.Name}
        </h1>

        {item.Overview && (
          <p className="text-white/70 max-w-xl line-clamp-3 phone:line-clamp-2 text-sm md:text-base phone:text-sm">
            {item.Overview}
          </p>
        )}

        <div className="flex items-center gap-3 text-sm text-white/60 flex-wrap">
          {item.ProductionYear && <span>{item.ProductionYear}</span>}
          {item.OfficialRating && (
            <span className="px-2 py-0.5 border border-white/30 rounded text-xs">
              {item.OfficialRating}
            </span>
          )}
          {item.CommunityRating && (
            <span className="flex items-center gap-1">
              <Star size={14} className="text-yellow-400 fill-yellow-400" />
              {item.CommunityRating.toFixed(1)}
            </span>
          )}
          {item.RunTimeTicks && !isSeries && (
            <span>{Math.round(item.RunTimeTicks / 600000000)} min</span>
          )}
          {isSeries && item.ChildCount && (
            <span>{item.ChildCount} Season{item.ChildCount !== 1 ? 's' : ''}</span>
          )}
          {item.Genres && item.Genres.length > 0 && (
            <span className="text-white/50">
              {item.Genres.slice(0, 4).join(' / ')}
            </span>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => onPlay(item)}
            className="flex items-center gap-2 px-6 py-3 bg-white text-gray-900 rounded-lg font-semibold hover:bg-white/90 transition-colors"
          >
            <Play size={20} fill="currentColor" />
            Play
          </button>
          <button
            onClick={() => onInfo(item)}
            className="flex items-center gap-2 px-6 py-3 bg-white/20 backdrop-blur-sm text-white rounded-lg font-semibold hover:bg-white/30 transition-colors"
          >
            <Info size={20} />
            More Info
          </button>
        </div>

        {/* Dot Indicators */}
        {items.length > 1 && (
          <div className="flex items-center gap-2 pt-4">
            {items.map((_, idx) => (
              <button
                key={idx}
                onClick={() => onDotClick(idx)}
                className={`w-2 h-2 rounded-full transition-all ${
                  idx === currentIndex
                    ? 'bg-white w-6'
                    : 'bg-white/40 hover:bg-white/60'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Media Row Component
function MediaRow({
  title,
  icon,
  items,
  getImageUrl,
  onPlay,
  onInfo,
  showProgress = false,
  serverUrl,
  api,
  userId,
  serverId,
  cardWidth
}: {
  title: string
  icon?: React.ReactNode
  items: BaseItemDto[]
  getImageUrl: (id: string, type?: 'Primary' | 'Backdrop' | 'Thumb', maxWidth?: number) => string | null
  onPlay: (item: BaseItemDto) => void
  onInfo: (item: BaseItemDto) => void
  showProgress?: boolean
  serverUrl?: string | null
  api?: any
  userId?: string | null
  serverId?: string | null
  cardWidth?: number
}) {
  return (
    <ScrollSection
      title={title}
      icon={icon}
      rightAction={
        <button className="text-sm text-white/50 hover:text-white/80 flex items-center gap-1 transition-colors">
          See All <ChevronRight size={16} />
        </button>
      }
    >
      {items.map((item) => (
        <MediaCard
          key={item.Id}
          item={item}
          imageUrl={getImageUrl(item.Id!, 'Primary', 300)}
          onPlay={() => onPlay(item)}
          onInfo={() => onInfo(item)}
          showProgress={showProgress}
          serverUrl={serverUrl}
          api={api}
          userId={userId}
          serverId={serverId}
          cardWidth={cardWidth}
        />
      ))}
    </ScrollSection>
  )
}

// Media Card Component - Blink-style with badges, progress, hover overlay, favorites
function MediaCard({
  item,
  imageUrl,
  onPlay,
  onInfo,
  showProgress = false,
  serverUrl,
  api,
  userId,
  serverId,
  cardWidth
}: {
  item: BaseItemDto
  imageUrl: string | null
  onPlay: () => void
  onInfo: () => void
  showProgress?: boolean
  serverUrl?: string | null
  api?: any
  userId?: string | null
  serverId?: string | null
  cardWidth?: number
}) {
  const mediaToast = useToast()
  const progress = item.UserData?.PlayedPercentage || 0
  const unplayedCount = item.UserData?.UnplayedItemCount || 0
  const [isPlayed, setIsPlayed] = useState(item.UserData?.Played || false)
  const [isFavorite, setIsFavorite] = useState(item.UserData?.IsFavorite || false)
  const [imageLoaded, setImageLoaded] = useState(false)

  // Follow background soft-refreshes: when a diff swaps in a new item object,
  // reflect its updated watched/favorite state on the badge
  useEffect(() => { setIsPlayed(item.UserData?.Played || false) }, [item.UserData?.Played])
  useEffect(() => { setIsFavorite(item.UserData?.IsFavorite || false) }, [item.UserData?.IsFavorite])

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!api || !userId || !item.Id || !serverUrl) return
    const prev = isFavorite
    setIsFavorite(!prev)
    try {
      const method = prev ? 'DELETE' : 'POST'
      await appApi.request({
        method,
        url: `${serverUrl}/Users/${userId}/FavoriteItems/${item.Id}`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
    } catch (e) {
      setIsFavorite(prev) // revert on failure
      console.error('Failed to toggle favorite:', e)
    }
  }

  const handleTogglePlayed = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!api || !userId || !item.Id || !serverUrl) return
    const prev = isPlayed
    setIsPlayed(!prev)
    try {
      const method = prev ? 'DELETE' : 'POST'
      await appApi.request({
        method,
        url: `${serverUrl}/Users/${userId}/PlayedItems/${item.Id}`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
    } catch (e) {
      setIsPlayed(prev) // revert on failure
      console.error('Failed to toggle played status:', e)
    }
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!serverUrl || !serverId || !api?.accessToken || !item.Id) return
    if (item.Type !== 'Movie' && item.Type !== 'Episode') {
      mediaToast.info('Only movies and episodes can be downloaded')
      return
    }
    const result = addToQueue(item, serverUrl, serverId, api.accessToken)
    if (result) {
      mediaToast.success('Queued for download')
    } else {
      mediaToast.info('Already downloaded or queued')
    }
  }

  const w = cardWidth || 160

  return (
    <div
      className="group relative flex-shrink-0 cursor-pointer"
      style={{ width: `${w}px` }}
      onClick={onInfo}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-2">
        {imageUrl ? (
          <motion.img
            src={imageUrl}
            alt={item.Name || ''}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
            decoding="async"
            initial={{ opacity: 0 }}
            animate={{ opacity: imageLoaded ? 1 : 0 }}
            transition={{ duration: 0.3 }}
            onLoad={() => setImageLoaded(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
            <Film size={32} className="text-white/30" />
          </div>
        )}

        {/* Hover Overlay with Play, Favorite, Mark Played */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            className="p-3 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform"
          >
            <Play size={24} fill="currentColor" />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleFavorite}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
            >
              <Heart size={16} className={isFavorite ? 'text-pink-400 fill-pink-400' : 'text-white'} />
            </button>
            <button
              onClick={handleTogglePlayed}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title={isPlayed ? 'Mark as Unwatched' : 'Mark as Watched'}
            >
              <CheckCircle2 size={16} className={isPlayed ? 'text-green-400 fill-green-400' : 'text-white'} />
            </button>
            <button
              onClick={handleDownload}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title="Download"
            >
              <Download size={16} className="text-white" />
            </button>
          </div>
        </div>

        {/* Progress Bar - thin, purple, at bottom */}
        {progress > 0 && !isPlayed && (
          <div className="absolute bottom-0 left-1 right-1 h-[3px] bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-theme-500 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Played Checkmark Badge - top right */}
        {isPlayed && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-theme-500 rounded-full flex items-center justify-center shadow-lg">
            <Check size={14} className="text-white" />
          </div>
        )}

        {/* Unplayed Count Badge - top right (for series) */}
        {!isPlayed && unplayedCount > 0 && (
          <div className="absolute top-2 right-2 min-w-[24px] h-6 px-1.5 bg-theme-500 rounded-full flex items-center justify-center shadow-lg">
            <span className="text-xs font-bold text-white">{unplayedCount}</span>
          </div>
        )}

        {/* Favorite indicator (when not hovering) */}
        {isFavorite && (
          <div className="absolute top-2 left-2 group-hover:opacity-0 transition-opacity">
            <Heart size={16} className="text-pink-400 fill-pink-400 drop-shadow-lg" />
          </div>
        )}
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium text-white/90 truncate">{item.Name}</h3>
      {item.ProductionYear && (
        <p className="text-xs text-white/50">{item.ProductionYear}</p>
      )}
    </div>
  )
}

// Continue Watching Row - Episodes show thumbnail (brighter), Movies show poster
function ContinueWatchingRow({
  items,
  getImageUrl,
  serverUrl,
  onPlay,
  onInfo,
  cardWidth,
  api,
  userId,
  serverId,
}: {
  items: BaseItemDto[]
  getImageUrl: (id: string, type?: 'Primary' | 'Backdrop' | 'Thumb', maxWidth?: number) => string | null
  serverUrl: string | null
  onPlay: (item: BaseItemDto) => void
  onInfo: (item: BaseItemDto) => void
  cardWidth?: number
  api?: any
  userId?: string | null
  serverId?: string | null
}) {
  return (
    <ScrollSection
      title="Continue Watching"
      icon={<Clock size={20} className="text-theme-400" />}
      rightAction={
        <button className="text-sm text-white/50 hover:text-white/80 flex items-center gap-1 transition-colors">
          See All <ChevronRight size={16} />
        </button>
      }
    >
      {items.map((item) => {
        const isEpisode = item.Type === 'Episode'

        if (isEpisode) {
          // For episodes: show thumbnail (brighter) with episode info
          const thumbUrl = serverUrl
            ? `${serverUrl}/Items/${item.Id}/Images/Primary?maxWidth=400&quality=90`
            : null

          return (
            <ContinueWatchingEpisodeCard
              key={item.Id}
              item={item}
              imageUrl={thumbUrl}
              onPlay={() => onPlay(item)}
              onInfo={() => onInfo(item)}
              cardWidth={cardWidth ? Math.round(cardWidth * 1.8) : undefined}
              api={api}
              userId={userId}
              serverUrl={serverUrl}
              serverId={serverId}
            />
          )
        } else {
          // For movies: show poster
          return (
            <MediaCard
              key={item.Id}
              item={item}
              imageUrl={getImageUrl(item.Id!, 'Primary', 300)}
              onPlay={() => onPlay(item)}
              onInfo={() => onInfo(item)}
              showProgress
              serverUrl={serverUrl}
              api={api}
              userId={userId}
              serverId={serverId}
              cardWidth={cardWidth}
            />
          )
        }
      })}
    </ScrollSection>
  )
}

// Continue Watching Episode Card - Wide thumbnail style (brighter)
function ContinueWatchingEpisodeCard({
  item,
  imageUrl,
  onPlay,
  onInfo,
  cardWidth,
  api,
  userId,
  serverUrl,
  serverId,
}: {
  item: BaseItemDto
  imageUrl: string | null
  onPlay: () => void
  onInfo: () => void
  cardWidth?: number
  api?: any
  userId?: string | null
  serverUrl?: string | null
  serverId?: string | null
}) {
  const progress = item.UserData?.PlayedPercentage || 0
  const [imageLoaded, setImageLoaded] = useState(false)
  const [isPlayed, setIsPlayed] = useState(item.UserData?.Played || false)
  // Follow background soft-refreshes (new item object swapped in by a diff)
  useEffect(() => { setIsPlayed(item.UserData?.Played || false) }, [item.UserData?.Played])
  const cwToast = useToast()
  const w = cardWidth || 288

  const handleTogglePlayed = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!api || !userId || !item.Id || !serverUrl) return
    const prev = isPlayed
    setIsPlayed(!prev)
    try {
      await appApi.request({
        method: prev ? 'DELETE' : 'POST',
        url: `${serverUrl}/Users/${userId}/PlayedItems/${item.Id}`,
        headers: { 'Authorization': `MediaBrowser Token="${api.accessToken}"` },
      })
    } catch { setIsPlayed(prev) }
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!serverUrl || !serverId || !api?.accessToken) return
    const result = addToQueue(item, serverUrl, serverId, api.accessToken)
    if (result) cwToast.success('Queued for download')
    else cwToast.info('Already downloaded or queued')
  }

  return (
    <div
      className="group relative flex-shrink-0 cursor-pointer"
      style={{ width: `${w}px` }}
      onClick={onInfo}
    >
      {/* Thumbnail - Wide aspect ratio */}
      <div className="relative aspect-video rounded-xl overflow-hidden bg-white/5 mb-2">
        {imageUrl ? (
          <motion.img
            src={imageUrl}
            alt={item.Name || ''}
            className="w-full h-full object-cover transition-transform group-hover:scale-105 brightness-110"
            loading="lazy"
            decoding="async"
            initial={{ opacity: 0 }}
            animate={{ opacity: imageLoaded ? 1 : 0 }}
            transition={{ duration: 0.3 }}
            onLoad={() => setImageLoaded(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
            <Tv2 size={32} className="text-white/30" />
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            className="p-3 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform"
          >
            <Play size={24} fill="currentColor" />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleTogglePlayed}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title={isPlayed ? 'Mark as Unwatched' : 'Mark as Watched'}
            >
              <CheckCircle2 size={16} className={isPlayed ? 'text-green-400 fill-green-400' : 'text-white'} />
            </button>
            <button
              onClick={handleDownload}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title="Download"
            >
              <Download size={16} className="text-white" />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        {progress > 0 && !isPlayed && (
          <div className="absolute bottom-0 left-1 right-1 h-[3px] bg-black/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-theme-500 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Played checkmark */}
        {isPlayed && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-theme-500 rounded-full flex items-center justify-center shadow-lg">
            <Check size={14} className="text-white" />
          </div>
        )}
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium text-white/90 truncate">{item.SeriesName || item.Name}</h3>
      <p className="text-xs text-white/50 truncate">
        S{item.ParentIndexNumber}:E{item.IndexNumber} - {item.Name}
      </p>
    </div>
  )
}

// Latest Item Card - Blink-style flat card for getLatestMedia results
function LatestItemCard({
  item,
  imageUrl,
  onPlay,
  onInfo,
  serverUrl,
  api,
  userId,
  serverId,
  cardWidth,
}: {
  item: BaseItemDto
  imageUrl: string | null
  onPlay: () => void
  onInfo: () => void
  serverUrl?: string | null
  api?: any
  userId?: string | null
  serverId?: string | null
  cardWidth?: number
}) {
  const latestToast = useToast()
  const [imageLoaded, setImageLoaded] = useState(false)
  const [isPlayed, setIsPlayed] = useState(item.UserData?.Played || false)
  const [isFavorite, setIsFavorite] = useState(item.UserData?.IsFavorite || false)
  // Follow background soft-refreshes (new item object swapped in by a diff)
  useEffect(() => { setIsPlayed(item.UserData?.Played || false) }, [item.UserData?.Played])
  useEffect(() => { setIsFavorite(item.UserData?.IsFavorite || false) }, [item.UserData?.IsFavorite])
  const isEpisode = item.Type === 'Episode'
  const isSeries = item.Type === 'Series'
  // getLatestMedia collapses several new episodes of the same season into a Season
  // item, so these rows carry Seasons too — they must read as the show, not "Season 2".
  const isSeason = item.Type === 'Season'
  const unplayedCount = item.UserData?.UnplayedItemCount || 0
  const progress = item.UserData?.PlayedPercentage || 0
  const w = cardWidth || 160

  // Display title: series name for episodes and seasons, item name otherwise
  const displayTitle = isEpisode || isSeason ? (item.SeriesName || item.Name) : item.Name
  // Display subtitle: episode info for episodes, season name for seasons, year otherwise
  const displaySubtitle = isEpisode
    ? `S${item.ParentIndexNumber ?? 0}:E${item.IndexNumber ?? 0} - ${item.Name ?? ''}`
    : isSeason
      ? (item.Name || (item.IndexNumber != null ? `Season ${item.IndexNumber}` : ''))
      : isSeries
        ? `${item.ProductionYear || ''}${item.EndDate ? ` - ${new Date(item.EndDate).getFullYear()}` : ''}`
        : item.ProductionYear?.toString() || ''

  const handleTogglePlayed = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!api || !userId || !item.Id || !serverUrl) return
    const prev = isPlayed
    setIsPlayed(!prev)
    try {
      await appApi.request({
        method: prev ? 'DELETE' : 'POST',
        url: `${serverUrl}/Users/${userId}/PlayedItems/${item.Id}`,
        headers: { 'Authorization': `MediaBrowser Token="${api.accessToken}"` },
      })
    } catch { setIsPlayed(prev) }
  }

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!api || !userId || !item.Id || !serverUrl) return
    const prev = isFavorite
    setIsFavorite(!prev)
    try {
      await appApi.request({
        method: prev ? 'DELETE' : 'POST',
        url: `${serverUrl}/Users/${userId}/FavoriteItems/${item.Id}`,
        headers: { 'Authorization': `MediaBrowser Token="${api.accessToken}"` },
      })
    } catch { setIsFavorite(prev) }
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!serverUrl || !serverId || !api?.accessToken || !item.Id) return
    if (item.Type !== 'Movie' && item.Type !== 'Episode') {
      latestToast.info('Only movies and episodes can be downloaded')
      return
    }
    const result = addToQueue(item, serverUrl, serverId, api.accessToken)
    if (result) latestToast.success('Queued for download')
    else latestToast.info('Already downloaded or queued')
  }

  return (
    <div
      className="group relative flex-shrink-0 cursor-pointer"
      style={{ width: `${w}px` }}
      onClick={onInfo}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-2">
        {imageUrl ? (
          <motion.img
            src={imageUrl}
            alt={displayTitle || ''}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
            decoding="async"
            initial={{ opacity: 0 }}
            animate={{ opacity: imageLoaded ? 1 : 0 }}
            transition={{ duration: 0.3 }}
            onLoad={() => setImageLoaded(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
            {isEpisode || isSeries || isSeason ? <Tv2 size={32} className="text-white/30" /> : <Film size={32} className="text-white/30" />}
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            className="p-3 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform"
          >
            <Play size={24} fill="currentColor" />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleFavorite}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
            >
              <Heart size={16} className={isFavorite ? 'text-pink-400 fill-pink-400' : 'text-white'} />
            </button>
            <button
              onClick={handleTogglePlayed}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title={isPlayed ? 'Mark as Unwatched' : 'Mark as Watched'}
            >
              <CheckCircle2 size={16} className={isPlayed ? 'text-green-400 fill-green-400' : 'text-white'} />
            </button>
            <button
              onClick={handleDownload}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title="Download"
            >
              <Download size={16} className="text-white" />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        {progress > 0 && !isPlayed && (
          <div className="absolute bottom-0 left-1 right-1 h-[3px] bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-theme-500 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Played Checkmark */}
        {isPlayed && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-theme-500 rounded-full flex items-center justify-center shadow-lg">
            <Check size={14} className="text-white" />
          </div>
        )}

        {/* Unplayed Count Badge (for series) */}
        {!isPlayed && unplayedCount > 0 && (
          <div className="absolute top-2 right-2 min-w-[24px] h-6 px-1.5 bg-theme-500 rounded-full flex items-center justify-center shadow-lg">
            <span className="text-xs font-bold text-white">{unplayedCount}</span>
          </div>
        )}

        {/* Favorite indicator */}
        {isFavorite && (
          <div className="absolute top-2 left-2 group-hover:opacity-0 transition-opacity">
            <Heart size={16} className="text-pink-400 fill-pink-400 drop-shadow-lg" />
          </div>
        )}
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium text-white/90 truncate">{displayTitle}</h3>
      {displaySubtitle && (
        <p className="text-xs text-white/50 truncate">{displaySubtitle}</p>
      )}
    </div>
  )
}

// Episode Card - For Up Next section with episode thumbnails
function EpisodeCard({
  item,
  serverUrl,
  onPlay,
  onInfo,
  cardWidth,
  api,
  userId,
  serverId,
}: {
  item: BaseItemDto
  serverUrl: string | null
  onPlay: () => void
  onInfo: () => void
  cardWidth?: number
  api?: any
  userId?: string | null
  serverId?: string | null
}) {
  // Use episode thumbnail/primary image
  const thumbUrl = serverUrl
    ? `${serverUrl}/Items/${item.Id}/Images/Primary?maxWidth=400&quality=90`
    : null
  const [imageLoaded, setImageLoaded] = useState(false)
  const [isPlayed, setIsPlayed] = useState(item.UserData?.Played || false)
  // Follow background soft-refreshes (new item object swapped in by a diff)
  useEffect(() => { setIsPlayed(item.UserData?.Played || false) }, [item.UserData?.Played])
  const epToast = useToast()
  const w = cardWidth || 288

  const handleTogglePlayed = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!api || !userId || !item.Id || !serverUrl) return
    const prev = isPlayed
    setIsPlayed(!prev)
    try {
      await appApi.request({
        method: prev ? 'DELETE' : 'POST',
        url: `${serverUrl}/Users/${userId}/PlayedItems/${item.Id}`,
        headers: { 'Authorization': `MediaBrowser Token="${api.accessToken}"` },
      })
    } catch { setIsPlayed(prev) }
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!serverUrl || !serverId || !api?.accessToken) return
    const result = addToQueue(item, serverUrl, serverId, api.accessToken)
    if (result) epToast.success('Queued for download')
    else epToast.info('Already downloaded or queued')
  }

  return (
    <div
      className="group relative flex-shrink-0 cursor-pointer"
      style={{ width: `${w}px` }}
      onClick={onInfo}
    >
      {/* Thumbnail - Wide aspect ratio */}
      <div className="relative aspect-video rounded-xl overflow-hidden bg-white/5 mb-2">
        {thumbUrl ? (
          <motion.img
            src={thumbUrl}
            alt={item.Name || ''}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
            decoding="async"
            initial={{ opacity: 0 }}
            animate={{ opacity: imageLoaded ? 1 : 0 }}
            transition={{ duration: 0.3 }}
            onLoad={() => setImageLoaded(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
            <Tv2 size={32} className="text-white/30" />
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            className="p-3 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform"
          >
            <Play size={24} fill="currentColor" />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleTogglePlayed}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title={isPlayed ? 'Mark as Unwatched' : 'Mark as Watched'}
            >
              <CheckCircle2 size={16} className={isPlayed ? 'text-green-400 fill-green-400' : 'text-white'} />
            </button>
            <button
              onClick={handleDownload}
              className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title="Download"
            >
              <Download size={16} className="text-white" />
            </button>
          </div>
        </div>

        {/* Played checkmark */}
        {isPlayed && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-theme-500 rounded-full flex items-center justify-center shadow-lg">
            <Check size={14} className="text-white" />
          </div>
        )}
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium text-white/90 truncate">{item.SeriesName || item.Name}</h3>
      <p className="text-xs text-white/50 truncate">
        S{item.ParentIndexNumber}:E{item.IndexNumber} - {item.Name}
      </p>
    </div>
  )
}

// Library Card Component - With library images (responsive sizing)
function LibraryCard({ library, onClick, onHide, serverUrl }: { library: BaseItemDto; onClick: () => void; onHide: () => void; serverUrl: string | null }) {
  const getIcon = () => {
    switch (library.CollectionType) {
      case 'movies': return <Film size={24} />
      case 'tvshows': return <Tv2 size={24} />
      case 'music': return <Music size={24} />
      default: return <FolderOpen size={24} />
    }
  }

  // Get library image
  const imageUrl = serverUrl && library.Id
    ? `${serverUrl}/Items/${library.Id}/Images/Primary?maxWidth=400&quality=90`
    : null

  return (
    // div instead of button: the hide control is a nested button (invalid inside <button>)
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      className="flex-shrink-0 relative min-w-[160px] w-40 lg:w-48 xl:w-56 h-24 lg:h-28 xl:h-32 rounded-xl overflow-hidden group transition-transform hover:scale-105 shadow-lg cursor-pointer"
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={library.Name || ''}
          className="w-full h-full object-cover"
          onError={(e) => {
            // If image fails to load, hide it to show gradient fallback
            (e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      ) : null}
      {/* Gradient fallback - always visible as overlay or when no image */}
      <div className="absolute inset-0 bg-gradient-to-br from-theme-500/80 to-pink-500/80 flex items-center justify-center opacity-100 group-hover:opacity-90 transition-opacity">
        {!imageUrl && (
          <div className="text-white">
            {getIcon()}
          </div>
        )}
      </div>
      {/* Image with gradient overlay when image exists */}
      {imageUrl && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />
      )}
      {/* Overlay with name */}
      <div className="absolute inset-0 flex items-end p-3">
        <div className="flex items-center gap-2">
          <div className="text-white/90">{getIcon()}</div>
          <h3 className="font-semibold text-base lg:text-lg text-white">{library.Name}</h3>
        </div>
      </div>
      {/* Hide button - hover only; restore via Settings → Jellyfin → Hidden Libraries */}
      <button
        onClick={(e) => { e.stopPropagation(); onHide() }}
        className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white/70 hover:text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Hide library (restore in Settings)"
      >
        <EyeOff size={14} />
      </button>
    </div>
  )
}

// Downloaded Media Row - Shows offline content
function DownloadedMediaRow({
  downloads,
  queue,
  onPlay,
  onViewItem,
  cardWidth
}: {
  downloads: DownloadedMedia[]
  queue: DownloadQueueItem[]
  onPlay: (item: DownloadedMedia) => void
  onViewItem: (item: BaseItemDto) => void
  cardWidth?: number
}) {
  const activeDownloads = queue.filter(q => q.status === 'downloading' || q.status === 'queued')

  const titleWithBadge = (
    <>
      Downloaded for Offline
      {activeDownloads.length > 0 && (
        <span className="ml-2 px-2 py-0.5 bg-theme-500/30 rounded text-xs text-theme-300 flex items-center gap-1">
          <Download size={12} className="animate-pulse" />
          {activeDownloads.length} downloading
        </span>
      )}
    </>
  )

  return (
    <ScrollSection
      title="Downloaded for Offline"
      icon={<HardDrive size={20} className="text-green-400" />}
      rightAction={
        <button className="text-sm text-white/50 hover:text-white/80 flex items-center gap-1 transition-colors">
          Manage <ChevronRight size={16} />
        </button>
      }
    >
      {/* Active Downloads First */}
      {activeDownloads.map((item) => (
        <DownloadingCard key={item.id} item={item} cardWidth={cardWidth} />
      ))}

      {/* Completed Downloads */}
      {downloads.slice(0, 12).map((item) => (
        <DownloadedMediaCard
          key={item.id}
          item={item}
          onPlay={() => onPlay(item)}
          cardWidth={cardWidth}
          onViewDetails={() => {
            const dto: BaseItemDto = {
              Id: item.id,
              Name: item.name,
              Type: item.type,
              SeriesName: item.seriesName,
              SeriesId: item.seriesId,
              ParentIndexNumber: item.seasonNumber,
              IndexNumber: item.episodeNumber,
            }
            onViewItem(dto)
          }}
        />
      ))}
    </ScrollSection>
  )
}

// Downloaded Media Card
function DownloadedMediaCard({
  item,
  onPlay,
  onViewDetails,
  cardWidth
}: {
  item: DownloadedMedia
  onPlay: () => void
  onViewDetails: () => void
  cardWidth?: number
}) {
  const isEpisode = item.type === 'Episode'
  const w = cardWidth || 160

  return (
    <div
      className="group relative flex-shrink-0 cursor-pointer"
      style={{ width: `${w}px` }}
      onClick={onViewDetails}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-2">
        {item.posterPath ? (
          <img
            src={toLocalUrl(item.posterPath)}
            alt={item.name}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
            {isEpisode ? <Tv2 size={32} className="text-white/30" /> : <Film size={32} className="text-white/30" />}
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            className="p-3 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform"
          >
            <Play size={24} fill="currentColor" />
          </button>
        </div>

        {/* Downloaded badge */}
        <div className="absolute top-2 right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
          <CheckCircle2 size={14} className="text-white" />
        </div>

        {/* Episode badge */}
        {isEpisode && (
          <div className="absolute bottom-2 left-2 right-2">
            <div className="bg-black/70 backdrop-blur-sm rounded px-2 py-1 text-center">
              <p className="text-[10px] text-white font-medium">
                S{item.seasonNumber}:E{item.episodeNumber}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium text-white/90 truncate">
        {isEpisode ? item.seriesName || item.name : item.name}
      </h3>
      {isEpisode && (
        <p className="text-xs text-white/50 truncate">{item.name}</p>
      )}
    </div>
  )
}

// Downloading Card - Shows download progress
function DownloadingCard({ item, cardWidth }: { item: DownloadQueueItem; cardWidth?: number }) {
  const isEpisode = item.type === 'Episode'
  const isActive = item.status === 'downloading'
  const w = cardWidth || 160

  return (
    <div className="relative flex-shrink-0" style={{ width: `${w}px` }}>
      {/* Poster placeholder */}
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-2">
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-theme-900/30 to-pink-900/30">
          {isEpisode ? <Tv2 size={32} className="text-white/30" /> : <Film size={32} className="text-white/30" />}
          <div className="mt-4 w-3/4">
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-theme-500 transition-all duration-300"
                style={{ width: `${item.progress}%` }}
              />
            </div>
            <p className="text-xs text-white/50 text-center mt-1">{item.progress}%</p>
          </div>
        </div>

        {/* Downloading indicator */}
        <div className="absolute top-2 right-2 w-6 h-6 bg-theme-500 rounded-full flex items-center justify-center">
          {isActive ? (
            <Download size={14} className="text-white animate-bounce" />
          ) : (
            <Clock size={14} className="text-white" />
          )}
        </div>

        {/* Episode badge */}
        {isEpisode && (
          <div className="absolute bottom-2 left-2 right-2">
            <div className="bg-black/70 backdrop-blur-sm rounded px-2 py-1 text-center">
              <p className="text-[10px] text-white font-medium">
                S{item.seasonNumber}:E{item.episodeNumber}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium text-white/90 truncate">
        {isEpisode ? item.seriesName || item.name : item.name}
      </h3>
      <p className="text-xs text-white/50 truncate">
        {isActive ? 'Downloading...' : 'Queued'}
      </p>
    </div>
  )
}
