import React, { useEffect, useState, useCallback } from 'react'
import {
  ArrowLeft,
  Play,
  Check,
  Clock,
  Star,
  Calendar,
  Film,
  Tv2,
  Users,
  Tag,
  Loader2,
  ChevronRight,
  Heart,
  Download,
  Trash2,
  Pause,
  CheckCircle2
} from 'lucide-react'
import { useJellyfin, getItemsApi, getTvShowsApi, type BaseItemDto } from './JellyfinContext'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api'
import { api as appApi } from '../../utils/api'
import {
  addToQueue,
  isItemDownloaded,
  isItemInQueue,
  deleteDownloadedMedia,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  subscribeToDownloadUpdates,
  type DownloadQueueItem
} from '../../utils/jellyfinDownloadManager'
import { loadSettings } from '../../types/settings'
import { isRealItem, isSpecial } from './itemFilters'
import { onJellyfinSoftRefresh, itemsWatchSig } from '../../utils/jellyfinRefreshBus'
import CircularProgress from '../CircularProgress'

// Custom hook for download state
function useDownloadState(itemId: string | undefined) {
  const [isDownloaded, setIsDownloaded] = useState(false)
  const [queueItem, setQueueItem] = useState<DownloadQueueItem | null>(null)

  useEffect(() => {
    if (!itemId) return

    // Initial state
    setIsDownloaded(isItemDownloaded(itemId))
    setQueueItem(isItemInQueue(itemId))

    // Subscribe to updates
    const unsubscribe = subscribeToDownloadUpdates((queue) => {
      const item = queue.find(q => q.id === itemId)
      setQueueItem(item || null)
      if (!item) {
        // Check if it's now downloaded
        setIsDownloaded(isItemDownloaded(itemId))
      }
    })

    return unsubscribe
  }, [itemId])

  return { isDownloaded, queueItem }
}

// Image that never shows the browser's broken-image icon: on load error it
// retries once (cache-busted, covers transient network hiccups), then renders
// the provided placeholder. Jellyfin returns 404 for image types an item
// simply doesn't have, so errors here are expected, not exceptional.
function DetailImage({ src, alt, className, fallback }: {
  src: string | null
  alt?: string
  className?: string
  fallback: React.ReactNode
}) {
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { setAttempt(0) }, [src])

  if (!src || attempt > 1) return <>{fallback}</>
  const url = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}retry=1`
  return (
    <img
      src={url}
      alt={alt || ''}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setAttempt(a => a + 1)}
    />
  )
}

interface JellyfinItemDetailsProps {
  item: BaseItemDto
  onPlay: (item: BaseItemDto) => void
  onBack: () => void
  onViewItem: (item: BaseItemDto) => void
}

export function JellyfinItemDetails({ item, onPlay, onBack, onViewItem }: JellyfinItemDetailsProps) {
  const { api, user, serverUrl } = useJellyfin()
  const [fullItem, setFullItem] = useState<BaseItemDto>(item)
  const [seasons, setSeasons] = useState<BaseItemDto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch full item details and related data. `silent` (background soft
  // refresh) skips the spinner and only swaps state when the watched signature
  // actually changed, so watched marks stay current while bingeing without a
  // remount.
  const fetchDetails = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false
    if (!api || !user?.Id || !item.Id) return

    if (!silent) {
      setIsLoading(true)
      setError(null)
    }

    try {
      const itemsApi = getItemsApi(api)

      // Fetch full item details
      const itemResponse = await itemsApi.getItems({
        userId: user.Id!,
        ids: [item.Id!],
        fields: [
          'Overview',
          'Genres',
          'People',
          'Studios',
          'MediaSources',
          'ChildCount',
          'SeasonCount',
          'UserData',
          'MediaStreams'
        ] as any
      })

      if (itemResponse.data.Items && itemResponse.data.Items[0]) {
        const fetchedItem = itemResponse.data.Items[0]
        if (!silent) {
          // Preserve UserData from original item (important for resume position)
          // The original item from Continue Watching has accurate PlaybackPositionTicks
          if (item.UserData) {
            fetchedItem.UserData = {
              ...fetchedItem.UserData,
              // Keep the original playback position if the fetched one doesn't have it
              PlaybackPositionTicks: fetchedItem.UserData?.PlaybackPositionTicks || item.UserData.PlaybackPositionTicks,
              // Also preserve other UserData fields that might be missing
              PlayedPercentage: fetchedItem.UserData?.PlayedPercentage || item.UserData.PlayedPercentage,
            }
          }
          setFullItem(fetchedItem)
        } else {
          // Silent: take the server's fresh watch state, but only re-render if
          // it actually changed
          setFullItem(prev => (itemsWatchSig([prev]) === itemsWatchSig([fetchedItem]) ? prev : fetchedItem))
        }
      }

      // For Series, fetch seasons via the dedicated Seasons endpoint.
      // Season entries are themselves "virtual" DB items in Jellyfin (no
      // folder on disk), so filtering them by LocationType/isMissing on a
      // plain getItems call hides ALL seasons. The Seasons endpoint instead
      // derives IsMissing from the episodes inside — isMissing:false keeps
      // real seasons and drops only phantom ones (e.g. a metadata-provider
      // "Specials" season whose episodes are all virtual).
      if (item.Type === 'Series') {
        const seasonsResponse = await getTvShowsApi(api).getSeasons({
          seriesId: item.Id!,
          userId: user.Id!,
          isMissing: false,
        })
        const s = seasonsResponse.data.Items || []
        setSeasons(prev => (itemsWatchSig(prev) === itemsWatchSig(s) ? prev : s))
      }

      // For Season, fetch episodes with UserData for progress
      if (item.Type === 'Season') {
        const episodesResponse = await itemsApi.getItems({
          userId: user.Id!,
          parentId: item.Id!,
          isMissing: false,
          sortBy: ['IndexNumber'],
          sortOrder: ['Ascending'],
          fields: ['UserData', 'Overview', 'MediaSources'] as any,
        })
        const eps = (episodesResponse.data.Items || []).filter(isRealItem) // reuse seasons state for episodes
        setSeasons(prev => (itemsWatchSig(prev) === itemsWatchSig(eps) ? prev : eps))
      }

    } catch (e: any) {
      console.error('Failed to fetch item details:', e)
      if (!silent) setError('Failed to load details')
    }

    if (!silent) setIsLoading(false)
  }, [api, user?.Id, item.Id, item.Type, item.UserData])

  useEffect(() => {
    fetchDetails()
  }, [fetchDetails])

  // Background soft-refresh: diff-refresh watched marks in place
  useEffect(() => onJellyfinSoftRefresh(() => fetchDetails({ silent: true })), [fetchDetails])

  // Get backdrop URL
  const getBackdropUrl = () => {
    if (!serverUrl) return null
    // For episodes, try to use series backdrop
    const backdropId = fullItem.Type === 'Episode' && fullItem.SeriesId
      ? fullItem.SeriesId
      : fullItem.Id
    return `${serverUrl}/Items/${backdropId}/Images/Backdrop?maxWidth=1920&quality=90`
  }

  // Get poster URL
  const getPosterUrl = () => {
    if (!serverUrl) return null
    // For episodes, use series poster
    const posterId = fullItem.Type === 'Episode' && fullItem.SeriesId
      ? fullItem.SeriesId
      : fullItem.Id
    return `${serverUrl}/Items/${posterId}/Images/Primary?maxWidth=400&quality=90`
  }

  // Format runtime
  const formatRuntime = (ticks?: number | null) => {
    if (!ticks) return null
    const minutes = Math.round(ticks / 600000000)
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  }

  // Calculate progress percentage
  const getProgress = () => {
    if (!fullItem.UserData?.PlaybackPositionTicks || !fullItem.RunTimeTicks) return 0
    return (fullItem.UserData.PlaybackPositionTicks / fullItem.RunTimeTicks) * 100
  }

  const progress = getProgress()
  const isWatched = fullItem.UserData?.Played || false

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
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
        >
          <ArrowLeft size={16} />
          Go Back
        </button>
      </div>
    )
  }

  // Render based on item type
  if (fullItem.Type === 'Episode') {
    return (
      <EpisodeDetails
        item={fullItem}
        serverUrl={serverUrl}
        isWatched={isWatched}
        progress={progress}
        formatRuntime={formatRuntime}
        onPlay={onPlay}
        onBack={onBack}
        onViewItem={onViewItem}
      />
    )
  }

  if (fullItem.Type === 'Season') {
    return (
      <SeasonDetails
        item={fullItem}
        episodes={seasons} // reusing seasons state for episodes
        serverUrl={serverUrl}
        getBackdropUrl={getBackdropUrl}
        getPosterUrl={getPosterUrl}
        isWatched={isWatched}
        formatRuntime={formatRuntime}
        onPlay={onPlay}
        onBack={onBack}
      />
    )
  }

  if (fullItem.Type === 'Series') {
    return (
      <SeriesDetails
        item={fullItem}
        seasons={seasons}
        serverUrl={serverUrl}
        getBackdropUrl={getBackdropUrl}
        getPosterUrl={getPosterUrl}
        isWatched={isWatched}
        onPlay={onPlay}
        onBack={onBack}
        onViewItem={onViewItem}
      />
    )
  }

  // Default: Movie details
  return (
    <MovieDetails
      item={fullItem}
      serverUrl={serverUrl}
      getBackdropUrl={getBackdropUrl}
      getPosterUrl={getPosterUrl}
      isWatched={isWatched}
      progress={progress}
      formatRuntime={formatRuntime}
      onPlay={onPlay}
      onBack={onBack}
      onViewItem={onViewItem}
    />
  )
}

// Movie Details Component
function MovieDetails({
  item,
  serverUrl,
  getBackdropUrl,
  getPosterUrl,
  isWatched,
  progress,
  formatRuntime,
  onPlay,
  onBack,
  onViewItem
}: {
  item: BaseItemDto
  serverUrl: string | null
  getBackdropUrl: () => string | null
  getPosterUrl: () => string | null
  isWatched: boolean
  progress: number
  formatRuntime: (ticks?: number | null) => string | null
  onPlay: (item: BaseItemDto) => void
  onBack: () => void
  onViewItem: (item: BaseItemDto) => void
}) {
  const { api, user } = useJellyfin()
  const { isDownloaded, queueItem } = useDownloadState(item.Id)
  const [isDeleting, setIsDeleting] = useState(false)
  const [watched, setWatched] = useState(isWatched)
  const [localProgress, setLocalProgress] = useState(progress)
  const [isTogglingWatched, setIsTogglingWatched] = useState(false)
  const [isFavorite, setIsFavorite] = useState(item.UserData?.IsFavorite || false)
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false)

  // Follow background soft-refreshes: when the parent re-fetches fresh watch
  // state, mirror it onto these local (optimistic) toggles
  useEffect(() => { setWatched(isWatched) }, [isWatched])
  useEffect(() => { setLocalProgress(progress) }, [progress])
  useEffect(() => { setIsFavorite(item.UserData?.IsFavorite || false) }, [item.UserData?.IsFavorite])

  const handleToggleWatched = async () => {
    if (!api || !user?.Id || !item.Id || !serverUrl) return
    setIsTogglingWatched(true)
    try {
      const method = watched ? 'DELETE' : 'POST'
      await appApi.request({
        method,
        url: `${serverUrl}/Users/${user.Id}/PlayedItems/${item.Id}`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
      setWatched(!watched)
      // Reset progress when marking as watched (server resets it too)
      if (!watched) {
        setLocalProgress(0)
      }
    } catch (e) {
      console.error('Failed to toggle watched status:', e)
    }
    setIsTogglingWatched(false)
  }

  const handleToggleFavorite = async () => {
    if (!api || !user?.Id || !item.Id || !serverUrl) return
    setIsTogglingFavorite(true)
    const prev = isFavorite
    setIsFavorite(!prev)
    try {
      const method = prev ? 'DELETE' : 'POST'
      await appApi.request({
        method,
        url: `${serverUrl}/Users/${user.Id}/FavoriteItems/${item.Id}`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
    } catch (e) {
      setIsFavorite(prev)
      console.error('Failed to toggle favorite:', e)
    }
    setIsTogglingFavorite(false)
  }

  const handleDownload = () => {
    if (!item.Id || !serverUrl || !api?.accessToken) return
    const settings = loadSettings()
    const serverId = settings.activeJellyfinServerId || 'default'
    addToQueue(item, serverUrl, serverId, api.accessToken)
  }

  const handleDelete = async () => {
    if (!item.Id) return
    setIsDeleting(true)
    await deleteDownloadedMedia(item.Id)
    setIsDeleting(false)
  }

  const backdropUrl = getBackdropUrl()
  const posterUrl = getPosterUrl()
  const runtime = formatRuntime(item.RunTimeTicks)
  const cast = item.People?.filter(p => p.Type === 'Actor').slice(0, 6) || []
  const genres = item.Genres || []

  return (
    <div className="min-h-full pb-20">
      {/* Hero Section with Backdrop */}
      <div className="relative h-[60vh] min-h-[400px] phone:h-auto phone:min-h-[40vh]">
        {/* Backdrop Image */}
        <div className="absolute inset-0">
          <DetailImage
            src={backdropUrl}
            className="w-full h-full object-cover"
            fallback={<div className="w-full h-full bg-gradient-to-br from-theme-900/50 to-pink-900/50" />}
          />
          {/* Gradients for text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-gray-900/90 via-gray-900/50 to-transparent" />
        </div>

        {/* Back Button */}
        <button
          onClick={onBack}
          className="absolute top-6 left-6 z-20 p-2 bg-black/40 hover:bg-black/60 backdrop-blur-sm rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>

        {/* Content Overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-8 phone:p-4 flex gap-8 phone:gap-4">
          {/* Poster */}
          <div className="hidden md:block flex-shrink-0">
            <div className="w-48 aspect-[2/3] rounded-xl overflow-hidden shadow-2xl bg-white/5">
              <DetailImage
                src={posterUrl}
                alt={item.Name || ''}
                className="w-full h-full object-cover"
                fallback={
                  <div className="w-full h-full flex items-center justify-center">
                    <Film size={48} className="text-white/30" />
                  </div>
                }
              />
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 space-y-4">
            {/* Badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-1 bg-pink-500/80 rounded text-xs font-medium text-white flex items-center gap-1">
                <Film size={12} /> Movie
              </span>
              {watched && (
                <span className="px-2 py-1 bg-theme-500/80 rounded text-xs font-medium text-white flex items-center gap-1">
                  <Check size={12} /> Watched
                </span>
              )}
              {isFavorite && (
                <span className="px-2 py-1 bg-pink-500/80 rounded text-xs font-medium text-white flex items-center gap-1">
                  <Heart size={12} className="fill-white" /> Favorite
                </span>
              )}
            </div>

            {/* Title */}
            <h1 className="text-4xl md:text-5xl phone:text-2xl font-bold text-white">{item.Name}</h1>

            {/* Metadata Row */}
            <div className="flex items-center gap-4 text-sm text-white/70 flex-wrap">
              {item.ProductionYear && (
                <span className="flex items-center gap-1">
                  <Calendar size={14} />
                  {item.ProductionYear}
                </span>
              )}
              {item.OfficialRating && (
                <span className="px-2 py-0.5 border border-white/30 rounded text-xs">
                  {item.OfficialRating}
                </span>
              )}
              {runtime && (
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  {runtime}
                </span>
              )}
              {item.CommunityRating && (
                <span className="flex items-center gap-1">
                  <Star size={14} className="text-yellow-400" />
                  {item.CommunityRating.toFixed(1)}
                </span>
              )}
            </div>

            {/* Genres */}
            {genres.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Tag size={14} className="text-white/50" />
                {genres.map((genre, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-1 bg-white/10 rounded-full text-xs text-white/80"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3 pt-2 flex-wrap">
              <button
                onClick={() => onPlay(item)}
                className="flex items-center gap-2 px-6 py-3 bg-white text-gray-900 rounded-lg font-semibold hover:bg-white/90 transition-colors"
              >
                <Play size={20} fill="currentColor" />
                {localProgress > 0 && !watched ? 'Resume' : 'Play'}
              </button>
              <button
                onClick={handleToggleFavorite}
                disabled={isTogglingFavorite}
                className={`flex items-center gap-2 px-6 py-3 backdrop-blur-sm rounded-lg font-semibold transition-colors ${
                  isFavorite
                    ? 'bg-pink-500/30 text-pink-300 hover:bg-white/20 hover:text-white'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                {isTogglingFavorite ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Heart size={20} className={isFavorite ? 'fill-current' : ''} />
                )}
                {isFavorite ? 'Favorited' : 'Favorite'}
              </button>
              <button
                onClick={handleToggleWatched}
                disabled={isTogglingWatched}
                className={`flex items-center gap-2 px-6 py-3 backdrop-blur-sm rounded-lg font-semibold transition-colors ${
                  watched
                    ? 'bg-theme-500/30 text-theme-300 hover:bg-white/20 hover:text-white'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                {isTogglingWatched ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Check size={20} />
                )}
                {watched ? 'Watched' : 'Mark as Watched'}
              </button>

              {/* Download Button */}
              {isDownloaded ? (
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-2 px-6 py-3 bg-green-500/20 backdrop-blur-sm text-green-400 rounded-lg font-semibold hover:bg-red-500/20 hover:text-red-400 transition-colors group"
                >
                  {isDeleting ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <>
                      <CheckCircle2 size={20} className="group-hover:hidden" />
                      <Trash2 size={20} className="hidden group-hover:block" />
                    </>
                  )}
                  <span className="group-hover:hidden">Downloaded</span>
                  <span className="hidden group-hover:inline">Delete</span>
                </button>
              ) : queueItem ? (
                <div className="flex items-center gap-2">
                  {queueItem.status === 'downloading' && (
                    <div className="flex items-center gap-3 px-6 py-3 bg-theme-500/20 backdrop-blur-sm text-theme-300 rounded-lg">
                      <CircularProgress
                        fraction={queueItem.totalBytes ? queueItem.progress / 100 : null}
                        size={20}
                      />
                      <span>{queueItem.progress}%</span>
                      <button
                        onClick={() => pauseDownload(item.Id!)}
                        className="p-1 hover:bg-white/10 rounded"
                      >
                        <Pause size={16} />
                      </button>
                    </div>
                  )}
                  {queueItem.status === 'queued' && (
                    <div className="flex items-center gap-2 px-6 py-3 bg-white/10 backdrop-blur-sm text-white/70 rounded-lg">
                      <Clock size={20} />
                      <span>Queued</span>
                      <button
                        onClick={() => cancelDownload(item.Id!)}
                        className="p-1 hover:bg-white/10 rounded text-red-400"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                  {queueItem.status === 'paused' && (
                    <button
                      onClick={() => resumeDownload(item.Id!)}
                      className="flex items-center gap-2 px-6 py-3 bg-yellow-500/20 backdrop-blur-sm text-yellow-300 rounded-lg hover:bg-yellow-500/30 transition-colors"
                    >
                      <Play size={20} />
                      <span>Resume ({queueItem.progress}%)</span>
                    </button>
                  )}
                  {queueItem.status === 'failed' && (
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-2 px-6 py-3 bg-red-500/20 backdrop-blur-sm text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                    >
                      <Download size={20} />
                      <span>Retry Download</span>
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-6 py-3 bg-white/20 backdrop-blur-sm text-white rounded-lg font-semibold hover:bg-white/30 transition-colors"
                >
                  <Download size={20} />
                  Download
                </button>
              )}
            </div>

            {/* Progress Bar */}
            {localProgress > 0 && !watched && (
              <div className="max-w-md">
                <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-theme-500 transition-all"
                    style={{ width: `${localProgress}%` }}
                  />
                </div>
                <p className="text-xs text-white/50 mt-1">
                  {Math.round(localProgress)}% watched
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description & Details Section */}
      <div className="px-8 phone:px-4 py-8 space-y-8">
        {/* Overview */}
        {item.Overview && (
          <div className="max-w-4xl">
            <h2 className="text-xl font-semibold mb-3">Overview</h2>
            <p className="text-white/70 leading-relaxed">{item.Overview}</p>
          </div>
        )}

        {/* Cast */}
        {cast.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Users size={20} className="text-theme-400" />
              Cast
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              {cast.map((person) => (
                <CastCard
                  key={person.Id}
                  person={person}
                  serverUrl={serverUrl}
                />
              ))}
            </div>
          </div>
        )}

        {/* More Like This */}
        <MoreLikeThisSection itemId={item.Id} onViewItem={onViewItem} />
      </div>
    </div>
  )
}

// Series Details Component
function SeriesDetails({
  item,
  seasons,
  serverUrl,
  getBackdropUrl,
  getPosterUrl,
  isWatched,
  onPlay,
  onBack,
  onViewItem
}: {
  item: BaseItemDto
  seasons: BaseItemDto[]
  serverUrl: string | null
  getBackdropUrl: () => string | null
  getPosterUrl: () => string | null
  isWatched: boolean
  onPlay: (item: BaseItemDto) => void
  onBack: () => void
  onViewItem: (item: BaseItemDto) => void
}) {
  const { api, user } = useJellyfin()
  const [watched, setWatched] = useState(isWatched)
  const [isTogglingWatched, setIsTogglingWatched] = useState(false)
  const [isFavorite, setIsFavorite] = useState(item.UserData?.IsFavorite || false)
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false)
  const [isResolvingPlay, setIsResolvingPlay] = useState(false)
  const [isQueueingAll, setIsQueueingAll] = useState(false)
  const [queuedAllCount, setQueuedAllCount] = useState<number | null>(null)

  // Follow background soft-refreshes of the parent (fresh watch/favorite state)
  useEffect(() => { setWatched(isWatched) }, [isWatched])
  useEffect(() => { setIsFavorite(item.UserData?.IsFavorite || false) }, [item.UserData?.IsFavorite])

  // A Series item has no media itself — playing it directly opens an empty
  // player. Resolve to the next-up episode (or the very first episode) first.
  const handlePlaySeries = async () => {
    if (!api || !user?.Id || !item.Id || isResolvingPlay) return
    setIsResolvingPlay(true)
    try {
      const res = await appApi.request({
        method: 'GET',
        url: `${serverUrl}/Shows/NextUp?seriesId=${item.Id}&userId=${user.Id}&limit=1&fields=Overview`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
      const next = res.success ? res.data?.Items?.[0] : null
      if (next && isRealItem(next)) {
        onPlay(next)
        return
      }
      // Everything watched or NextUp unavailable — start from episode 1
      // (S1E1, not a season-0 special, and never a virtual placeholder)
      const eps = await getItemsApi(api).getItems({
        userId: user.Id,
        parentId: item.Id,
        includeItemTypes: ['Episode'],
        recursive: true,
        isMissing: false,
        sortBy: ['ParentIndexNumber', 'IndexNumber'] as any,
        sortOrder: ['Ascending'],
        fields: ['Overview'] as any,
      })
      const list = (eps.data.Items || []).filter(isRealItem)
      const first = list.find(ep => !isSpecial(ep)) || list[0]
      if (first) onPlay(first)
    } catch (e) {
      console.error('Failed to resolve series playback:', e)
    } finally {
      setIsResolvingPlay(false)
    }
  }

  // Queue every episode of the series for offline download.
  // addToQueue skips episodes that are already downloaded or queued.
  const handleDownloadAll = async () => {
    if (!api?.accessToken || !user?.Id || !item.Id || !serverUrl || isQueueingAll) return
    setIsQueueingAll(true)
    try {
      const eps = await getItemsApi(api).getItems({
        userId: user.Id,
        parentId: item.Id,
        includeItemTypes: ['Episode'],
        recursive: true,
        isMissing: false,
        sortBy: ['ParentIndexNumber', 'IndexNumber'] as any,
        sortOrder: ['Ascending'],
        fields: ['Overview'] as any,
      })
      const settings = loadSettings()
      const serverId = settings.activeJellyfinServerId || 'default'
      let queued = 0
      for (const ep of (eps.data.Items || []).filter(isRealItem)) {
        if (addToQueue(ep, serverUrl, serverId, api.accessToken)) queued++
      }
      setQueuedAllCount(queued)
    } catch (e) {
      console.error('Failed to queue series download:', e)
    } finally {
      setIsQueueingAll(false)
    }
  }

  const handleToggleWatched = async () => {
    if (!api || !user?.Id || !item.Id || !serverUrl) return
    setIsTogglingWatched(true)
    try {
      const method = watched ? 'DELETE' : 'POST'
      await appApi.request({
        method,
        url: `${serverUrl}/Users/${user.Id}/PlayedItems/${item.Id}`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
      setWatched(!watched)
    } catch (e) {
      console.error('Failed to toggle watched status:', e)
    }
    setIsTogglingWatched(false)
  }

  const handleToggleFavorite = async () => {
    if (!api || !user?.Id || !item.Id || !serverUrl) return
    setIsTogglingFavorite(true)
    const prev = isFavorite
    setIsFavorite(!prev)
    try {
      const method = prev ? 'DELETE' : 'POST'
      await appApi.request({
        method,
        url: `${serverUrl}/Users/${user.Id}/FavoriteItems/${item.Id}`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
    } catch (e) {
      setIsFavorite(prev)
      console.error('Failed to toggle favorite:', e)
    }
    setIsTogglingFavorite(false)
  }

  const backdropUrl = getBackdropUrl()
  const posterUrl = getPosterUrl()
  const cast = item.People?.filter(p => p.Type === 'Actor').slice(0, 6) || []
  const genres = item.Genres || []

  return (
    <div className="min-h-full pb-20">
      {/* Hero Section with Backdrop */}
      <div className="relative h-[60vh] min-h-[400px] phone:h-auto phone:min-h-[40vh]">
        {/* Backdrop Image */}
        <div className="absolute inset-0">
          <DetailImage
            src={backdropUrl}
            className="w-full h-full object-cover"
            fallback={<div className="w-full h-full bg-gradient-to-br from-theme-900/50 to-pink-900/50" />}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-gray-900/90 via-gray-900/50 to-transparent" />
        </div>

        {/* Back Button */}
        <button
          onClick={onBack}
          className="absolute top-6 left-6 z-20 p-2 bg-black/40 hover:bg-black/60 backdrop-blur-sm rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>

        {/* Content Overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-8 phone:p-4 flex gap-8 phone:gap-4">
          {/* Poster */}
          <div className="hidden md:block flex-shrink-0">
            <div className="w-48 aspect-[2/3] rounded-xl overflow-hidden shadow-2xl bg-white/5">
              <DetailImage
                src={posterUrl}
                alt={item.Name || ''}
                className="w-full h-full object-cover"
                fallback={
                  <div className="w-full h-full flex items-center justify-center">
                    <Tv2 size={48} className="text-white/30" />
                  </div>
                }
              />
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 space-y-4">
            {/* Badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-1 bg-theme-500/80 rounded text-xs font-medium text-white flex items-center gap-1">
                <Tv2 size={12} /> Series
              </span>
              {watched && (
                <span className="px-2 py-1 bg-green-500/80 rounded text-xs font-medium text-white flex items-center gap-1">
                  <Check size={12} /> Watched
                </span>
              )}
              {isFavorite && (
                <span className="px-2 py-1 bg-pink-500/80 rounded text-xs font-medium text-white flex items-center gap-1">
                  <Heart size={12} className="fill-white" /> Favorite
                </span>
              )}
            </div>

            {/* Title */}
            <h1 className="text-4xl md:text-5xl phone:text-2xl font-bold text-white">{item.Name}</h1>

            {/* Metadata Row */}
            <div className="flex items-center gap-4 text-sm text-white/70 flex-wrap">
              {item.ProductionYear && (
                <span className="flex items-center gap-1">
                  <Calendar size={14} />
                  {item.ProductionYear}
                  {item.EndDate && ` - ${new Date(item.EndDate).getFullYear()}`}
                </span>
              )}
              {item.OfficialRating && (
                <span className="px-2 py-0.5 border border-white/30 rounded text-xs">
                  {item.OfficialRating}
                </span>
              )}
              {item.ChildCount !== undefined && (
                <span>{item.ChildCount} Season{item.ChildCount !== 1 ? 's' : ''}</span>
              )}
              {item.CommunityRating && (
                <span className="flex items-center gap-1">
                  <Star size={14} className="text-yellow-400" />
                  {item.CommunityRating.toFixed(1)}
                </span>
              )}
            </div>

            {/* Genres */}
            {genres.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Tag size={14} className="text-white/50" />
                {genres.map((genre, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-1 bg-white/10 rounded-full text-xs text-white/80"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3 pt-2 flex-wrap">
              <button
                onClick={handlePlaySeries}
                disabled={isResolvingPlay}
                className="flex items-center gap-2 px-6 py-3 bg-white text-gray-900 rounded-lg font-semibold hover:bg-white/90 transition-colors"
              >
                {isResolvingPlay ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Play size={20} fill="currentColor" />
                )}
                Play
              </button>
              <button
                onClick={handleToggleFavorite}
                disabled={isTogglingFavorite}
                className={`flex items-center gap-2 px-6 py-3 backdrop-blur-sm rounded-lg font-semibold transition-colors ${
                  isFavorite
                    ? 'bg-pink-500/30 text-pink-300 hover:bg-white/20 hover:text-white'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                {isTogglingFavorite ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Heart size={20} className={isFavorite ? 'fill-current' : ''} />
                )}
                {isFavorite ? 'Favorited' : 'Favorite'}
              </button>
              <button
                onClick={handleToggleWatched}
                disabled={isTogglingWatched}
                className={`flex items-center gap-2 px-6 py-3 backdrop-blur-sm rounded-lg font-semibold transition-colors ${
                  watched
                    ? 'bg-green-500/30 text-green-300 hover:bg-white/20 hover:text-white'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                {isTogglingWatched ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Check size={20} />
                )}
                {watched ? 'Watched' : 'Mark as Watched'}
              </button>

              {/* Download all episodes */}
              <button
                onClick={handleDownloadAll}
                disabled={isQueueingAll}
                className="flex items-center gap-2 px-6 py-3 bg-white/20 backdrop-blur-sm text-white rounded-lg font-semibold hover:bg-white/30 transition-colors"
                title="Download every episode of this series"
              >
                {isQueueingAll ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : queuedAllCount !== null ? (
                  <CheckCircle2 size={20} className="text-green-400" />
                ) : (
                  <Download size={20} />
                )}
                {queuedAllCount === null
                  ? 'Download All'
                  : queuedAllCount > 0
                    ? `${queuedAllCount} queued`
                    : 'Already downloaded'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Description & Details Section */}
      <div className="px-8 phone:px-4 py-8 space-y-8">
        {/* Overview */}
        {item.Overview && (
          <div className="max-w-4xl">
            <h2 className="text-xl font-semibold mb-3">Overview</h2>
            <p className="text-white/70 leading-relaxed">{item.Overview}</p>
          </div>
        )}

        {/* Seasons */}
        {seasons.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Seasons</h2>
            {/* Wrapping grid: fills each row, then wraps — so shows with many
                seasons (13+) stay fully reachable instead of overflowing off a
                hidden horizontal scroll. Responsive columns keep phones tidy. */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3 pb-2">
              {seasons.map((season) => (
                <SeasonCard
                  key={season.Id}
                  season={season}
                  serverUrl={serverUrl}
                  onClick={() => onViewItem(season)}
                  api={api}
                  userId={user?.Id}
                  onPlaySeason={(ep) => onPlay(ep)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Cast */}
        {cast.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Users size={20} className="text-theme-400" />
              Cast
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              {cast.map((person) => (
                <CastCard
                  key={person.Id}
                  person={person}
                  serverUrl={serverUrl}
                />
              ))}
            </div>
          </div>
        )}

        {/* More Like This */}
        <MoreLikeThisSection itemId={item.Id} onViewItem={onViewItem} />
      </div>
    </div>
  )
}

// Episode Details Component
function EpisodeDetails({
  item,
  serverUrl,
  isWatched,
  progress,
  formatRuntime,
  onPlay,
  onBack,
  onViewItem
}: {
  item: BaseItemDto
  serverUrl: string | null
  isWatched: boolean
  progress: number
  formatRuntime: (ticks?: number | null) => string | null
  onPlay: (item: BaseItemDto) => void
  onBack: () => void
  onViewItem: (item: BaseItemDto) => void
}) {
  const { api, user } = useJellyfin()
  const { isDownloaded, queueItem } = useDownloadState(item.Id)
  const [isDeleting, setIsDeleting] = useState(false)
  const [watched, setWatched] = useState(isWatched)
  const [localProgress, setLocalProgress] = useState(progress)
  const [isTogglingWatched, setIsTogglingWatched] = useState(false)
  const [isFavorite, setIsFavorite] = useState(item.UserData?.IsFavorite || false)
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false)

  // Follow background soft-refreshes: when the parent re-fetches fresh watch
  // state, mirror it onto these local (optimistic) toggles
  useEffect(() => { setWatched(isWatched) }, [isWatched])
  useEffect(() => { setLocalProgress(progress) }, [progress])
  useEffect(() => { setIsFavorite(item.UserData?.IsFavorite || false) }, [item.UserData?.IsFavorite])

  const handleToggleWatched = async () => {
    if (!api || !user?.Id || !item.Id || !serverUrl) return
    setIsTogglingWatched(true)
    try {
      const method = watched ? 'DELETE' : 'POST'
      await appApi.request({
        method,
        url: `${serverUrl}/Users/${user.Id}/PlayedItems/${item.Id}`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
      setWatched(!watched)
      // Reset progress when marking as watched (server resets it too)
      if (!watched) {
        setLocalProgress(0)
      }
    } catch (e) {
      console.error('Failed to toggle watched status:', e)
    }
    setIsTogglingWatched(false)
  }

  const handleToggleFavorite = async () => {
    if (!api || !user?.Id || !item.Id || !serverUrl) return
    setIsTogglingFavorite(true)
    const prev = isFavorite
    setIsFavorite(!prev)
    try {
      const method = prev ? 'DELETE' : 'POST'
      await appApi.request({
        method,
        url: `${serverUrl}/Users/${user.Id}/FavoriteItems/${item.Id}`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
    } catch (e) {
      setIsFavorite(prev)
      console.error('Failed to toggle favorite:', e)
    }
    setIsTogglingFavorite(false)
  }

  const handleDownload = () => {
    if (!item.Id || !serverUrl || !api?.accessToken) return
    const settings = loadSettings()
    const serverId = settings.activeJellyfinServerId || 'default'
    addToQueue(item, serverUrl, serverId, api.accessToken)
  }

  const handleDelete = async () => {
    if (!item.Id) return
    setIsDeleting(true)
    await deleteDownloadedMedia(item.Id)
    setIsDeleting(false)
  }

  const runtime = formatRuntime(item.RunTimeTicks)

  // Get episode thumbnail or fallback to series
  const getThumbnailUrl = () => {
    if (!serverUrl) return null
    return `${serverUrl}/Items/${item.Id}/Images/Primary?maxWidth=800&quality=90`
  }

  const thumbnailUrl = getThumbnailUrl()

  return (
    <div className="min-h-full pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-md border-b border-white/5">
        <div className="px-8 phone:px-4 py-4 flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div>
            {item.SeriesName && item.SeriesId ? (
              <button
                onClick={() => onViewItem({ Id: item.SeriesId, Type: 'Series' } as BaseItemDto)}
                className="text-theme-400 hover:text-theme-300 text-sm font-medium hover:underline"
              >
                {item.SeriesName}
              </button>
            ) : (
              <p className="text-sm text-white/50">{item.SeriesName}</p>
            )}
            <h1 className="text-lg font-semibold">
              S{item.ParentIndexNumber}:E{item.IndexNumber} - {item.Name}
            </h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 phone:px-4 py-6 space-y-6">
        {/* Episode Thumbnail */}
        <div className="relative max-w-3xl">
          <div className="relative aspect-video rounded-xl overflow-hidden bg-white/5">
            <DetailImage
              src={thumbnailUrl}
              alt={item.Name || ''}
              className="w-full h-full object-cover"
              fallback={
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
                  <Tv2 size={64} className="text-white/30" />
                </div>
              }
            />

            {/* Play button overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
              <button
                onClick={() => onPlay(item)}
                className="p-4 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform"
              >
                <Play size={32} fill="currentColor" />
              </button>
            </div>

            {/* Progress bar */}
            {localProgress > 0 && !watched && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                <div
                  className="h-full bg-theme-500 transition-all"
                  style={{ width: `${localProgress}%` }}
                />
              </div>
            )}

            {/* Watched badge */}
            {watched && (
              <div className="absolute top-4 right-4 px-3 py-1 bg-theme-500 rounded-full flex items-center gap-1">
                <Check size={14} />
                <span className="text-sm font-medium">Watched</span>
              </div>
            )}
          </div>
        </div>

        {/* Episode Info */}
        <div className="max-w-3xl space-y-4">
          {/* Title */}
          <div>
            {item.SeriesName && item.SeriesId ? (
              <button
                onClick={() => onViewItem({ Id: item.SeriesId, Type: 'Series' } as BaseItemDto)}
                className="text-theme-400 hover:text-theme-300 text-sm font-medium hover:underline"
              >
                {item.SeriesName}
              </button>
            ) : (
              <p className="text-theme-400 text-sm font-medium">
                {item.SeriesName}
              </p>
            )}
            <h2 className="text-2xl font-bold">
              Season {item.ParentIndexNumber}, Episode {item.IndexNumber}
            </h2>
            <h3 className="text-xl text-white/80">{item.Name}</h3>
          </div>

          {/* Metadata Row */}
          <div className="flex items-center gap-4 text-sm text-white/70 flex-wrap">
            {item.PremiereDate && (
              <span className="flex items-center gap-1">
                <Calendar size={14} />
                {new Date(item.PremiereDate).toLocaleDateString()}
              </span>
            )}
            {runtime && (
              <span className="flex items-center gap-1">
                <Clock size={14} />
                {runtime}
              </span>
            )}
            {item.CommunityRating && (
              <span className="flex items-center gap-1">
                <Star size={14} className="text-yellow-400" />
                {item.CommunityRating.toFixed(1)}
              </span>
            )}
          </div>

          {/* Progress info */}
          {localProgress > 0 && !watched && (
            <div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden max-w-md">
                <div
                  className="h-full bg-theme-500 transition-all"
                  style={{ width: `${localProgress}%` }}
                />
              </div>
              <p className="text-xs text-white/50 mt-1">
                {Math.round(localProgress)}% watched
              </p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-2 flex-wrap">
            <button
              onClick={() => onPlay(item)}
              className="flex items-center gap-2 px-6 py-3 bg-white text-gray-900 rounded-lg font-semibold hover:bg-white/90 transition-colors"
            >
              <Play size={20} fill="currentColor" />
              {localProgress > 0 && !watched ? 'Resume' : 'Play'}
            </button>
            <button
              onClick={handleToggleFavorite}
              disabled={isTogglingFavorite}
              className={`flex items-center gap-2 px-6 py-3 backdrop-blur-sm rounded-lg font-semibold transition-colors ${
                isFavorite
                  ? 'bg-pink-500/30 text-pink-300 hover:bg-white/20 hover:text-white'
                  : 'bg-white/20 text-white hover:bg-white/30'
              }`}
            >
              {isTogglingFavorite ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Heart size={20} className={isFavorite ? 'fill-current' : ''} />
              )}
              {isFavorite ? 'Favorited' : 'Favorite'}
            </button>
            <button
              onClick={handleToggleWatched}
              disabled={isTogglingWatched}
              className={`flex items-center gap-2 px-6 py-3 backdrop-blur-sm rounded-lg font-semibold transition-colors ${
                watched
                  ? 'bg-theme-500/30 text-theme-300 hover:bg-white/20 hover:text-white'
                  : 'bg-white/20 text-white hover:bg-white/30'
              }`}
            >
              {isTogglingWatched ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Check size={20} />
              )}
              {watched ? 'Watched' : 'Mark as Watched'}
            </button>

            {/* Download Button */}
            {isDownloaded ? (
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-2 px-6 py-3 bg-green-500/20 backdrop-blur-sm text-green-400 rounded-lg font-semibold hover:bg-red-500/20 hover:text-red-400 transition-colors group"
              >
                {isDeleting ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 size={20} className="group-hover:hidden" />
                    <Trash2 size={20} className="hidden group-hover:block" />
                  </>
                )}
                <span className="group-hover:hidden">Downloaded</span>
                <span className="hidden group-hover:inline">Delete</span>
              </button>
            ) : queueItem ? (
              <div className="flex items-center gap-2">
                {queueItem.status === 'downloading' && (
                  <div className="flex items-center gap-3 px-6 py-3 bg-theme-500/20 backdrop-blur-sm text-theme-300 rounded-lg">
                    <Loader2 size={20} className="animate-spin" />
                    <span>{queueItem.progress}%</span>
                    <button
                      onClick={() => pauseDownload(item.Id!)}
                      className="p-1 hover:bg-white/10 rounded"
                    >
                      <Pause size={16} />
                    </button>
                  </div>
                )}
                {queueItem.status === 'queued' && (
                  <div className="flex items-center gap-2 px-6 py-3 bg-white/10 backdrop-blur-sm text-white/70 rounded-lg">
                    <Clock size={20} />
                    <span>Queued</span>
                    <button
                      onClick={() => cancelDownload(item.Id!)}
                      className="p-1 hover:bg-white/10 rounded text-red-400"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
                {queueItem.status === 'paused' && (
                  <button
                    onClick={() => resumeDownload(item.Id!)}
                    className="flex items-center gap-2 px-6 py-3 bg-yellow-500/20 backdrop-blur-sm text-yellow-300 rounded-lg hover:bg-yellow-500/30 transition-colors"
                  >
                    <Play size={20} />
                    <span>Resume ({queueItem.progress}%)</span>
                  </button>
                )}
                {queueItem.status === 'failed' && (
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-2 px-6 py-3 bg-red-500/20 backdrop-blur-sm text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                  >
                    <Download size={20} />
                    <span>Retry Download</span>
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-6 py-3 bg-white/20 backdrop-blur-sm text-white rounded-lg font-semibold hover:bg-white/30 transition-colors"
              >
                <Download size={20} />
                Download
              </button>
            )}
          </div>

          {/* Overview */}
          {item.Overview && (
            <div className="pt-4">
              <h4 className="text-lg font-semibold mb-2">Overview</h4>
              <p className="text-white/70 leading-relaxed">{item.Overview}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Season Details Component (shows episode list)
function SeasonDetails({
  item,
  episodes,
  serverUrl,
  getBackdropUrl,
  getPosterUrl,
  isWatched,
  formatRuntime,
  onPlay,
  onBack
}: {
  item: BaseItemDto
  episodes: BaseItemDto[]
  serverUrl: string | null
  getBackdropUrl: () => string | null
  getPosterUrl: () => string | null
  isWatched: boolean
  formatRuntime: (ticks?: number | null) => string | null
  onPlay: (item: BaseItemDto) => void
  onBack: () => void
}) {
  const { api, user } = useJellyfin()
  const backdropUrl = getBackdropUrl()
  const posterUrl = getPosterUrl()
  const [seasonWatched, setSeasonWatched] = useState(isWatched)
  const [isTogglingSeasonWatched, setIsTogglingSeasonWatched] = useState(false)
  const [episodeStates, setEpisodeStates] = useState<Record<string, { watched: boolean; favorite: boolean }>>({})

  // Follow background soft-refreshes: mirror the season's fresh watched state,
  // and drop per-episode optimistic overrides when the episode list changes so
  // the freshly-fetched UserData shows through (getEpisodeState falls back to it)
  useEffect(() => { setSeasonWatched(isWatched) }, [isWatched])
  const episodesSig = itemsWatchSig(episodes)
  useEffect(() => { setEpisodeStates({}) }, [episodesSig])

  const handleToggleSeasonWatched = async () => {
    if (!api || !user?.Id || !item.Id || !serverUrl) return
    setIsTogglingSeasonWatched(true)
    const prev = seasonWatched
    try {
      const method = prev ? 'DELETE' : 'POST'
      await appApi.request({
        method,
        url: `${serverUrl}/Users/${user.Id}/PlayedItems/${item.Id}`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
      setSeasonWatched(!prev)
      // Update all episode states to match
      const newStates: Record<string, { watched: boolean; favorite: boolean }> = {}
      for (const ep of episodes) {
        if (ep.Id) {
          const currentState = getEpisodeState(ep)
          newStates[ep.Id] = { ...currentState, watched: !prev }
        }
      }
      setEpisodeStates(s => ({ ...s, ...newStates }))
    } catch (e) {
      console.error('Failed to toggle season watched status:', e)
    }
    setIsTogglingSeasonWatched(false)
  }

  const getEpisodeThumbnailUrl = (episode: BaseItemDto) => {
    if (!serverUrl || !episode.Id) return null
    return `${serverUrl}/Items/${episode.Id}/Images/Primary?maxWidth=400&quality=90`
  }

  const handleDownloadEpisode = (episode: BaseItemDto) => {
    if (!episode.Id || !serverUrl || !api?.accessToken) return
    const settings = loadSettings()
    const serverId = settings.activeJellyfinServerId || 'default'
    addToQueue(episode, serverUrl, serverId, api.accessToken)
  }

  // Queue the whole season; addToQueue skips already downloaded/queued episodes
  const [queuedSeasonCount, setQueuedSeasonCount] = useState<number | null>(null)
  const handleDownloadSeason = () => {
    if (!serverUrl || !api?.accessToken || episodes.length === 0) return
    const settings = loadSettings()
    const serverId = settings.activeJellyfinServerId || 'default'
    let queued = 0
    for (const ep of episodes) {
      if (addToQueue(ep, serverUrl, serverId, api.accessToken)) queued++
    }
    setQueuedSeasonCount(queued)
  }

  const getEpisodeState = (episode: BaseItemDto) => {
    if (episodeStates[episode.Id!]) {
      return episodeStates[episode.Id!]
    }
    return {
      watched: episode.UserData?.Played || false,
      favorite: episode.UserData?.IsFavorite || false
    }
  }

  const toggleWatched = async (episode: BaseItemDto) => {
    if (!api || !user?.Id || !episode.Id || !serverUrl) return
    const currentState = getEpisodeState(episode)
    try {
      const method = currentState.watched ? 'DELETE' : 'POST'
      await appApi.request({
        method,
        url: `${serverUrl}/Users/${user.Id}/PlayedItems/${episode.Id}`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
      setEpisodeStates(prev => ({
        ...prev,
        [episode.Id!]: { ...currentState, watched: !currentState.watched }
      }))
    } catch (e) {
      console.error('Failed to toggle watched status:', e)
    }
  }

  const toggleFavorite = async (episode: BaseItemDto) => {
    if (!api || !user?.Id || !episode.Id || !serverUrl) return
    const currentState = getEpisodeState(episode)
    try {
      const method = currentState.favorite ? 'DELETE' : 'POST'
      await appApi.request({
        method,
        url: `${serverUrl}/Users/${user.Id}/FavoriteItems/${episode.Id}`,
        headers: {
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
      })
      setEpisodeStates(prev => ({
        ...prev,
        [episode.Id!]: { ...currentState, favorite: !currentState.favorite }
      }))
    } catch (e) {
      console.error('Failed to toggle favorite status:', e)
    }
  }

  return (
    <div className="min-h-full pb-20">
      {/* Hero Section with Backdrop */}
      <div className="relative h-[40vh] min-h-[300px] phone:h-auto phone:min-h-[40vh]">
        {/* Backdrop Image */}
        <div className="absolute inset-0">
          <DetailImage
            src={backdropUrl}
            className="w-full h-full object-cover"
            fallback={<div className="w-full h-full bg-gradient-to-br from-theme-900/50 to-pink-900/50" />}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-gray-900/90 via-gray-900/50 to-transparent" />
        </div>

        {/* Back Button */}
        <button
          onClick={onBack}
          className="absolute top-6 left-6 z-20 p-2 bg-black/40 hover:bg-black/60 backdrop-blur-sm rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>

        {/* Content Overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-8 phone:p-4 flex gap-6 phone:gap-4">
          {/* Poster */}
          <div className="hidden md:block flex-shrink-0">
            <div className="w-32 aspect-[2/3] rounded-xl overflow-hidden shadow-2xl bg-white/5">
              <DetailImage
                src={posterUrl}
                alt={item.Name || ''}
                className="w-full h-full object-cover"
                fallback={
                  <div className="w-full h-full flex items-center justify-center">
                    <Tv2 size={32} className="text-white/30" />
                  </div>
                }
              />
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 space-y-3">
            {/* Badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-1 bg-theme-500/80 rounded text-xs font-medium text-white flex items-center gap-1">
                <Tv2 size={12} /> Season
              </span>
              {seasonWatched && (
                <span className="px-2 py-1 bg-green-500/80 rounded text-xs font-medium text-white flex items-center gap-1">
                  <Check size={12} /> Watched
                </span>
              )}
            </div>

            {/* Series Name */}
            {item.SeriesName && (
              <p className="text-white/60 text-sm">{item.SeriesName}</p>
            )}

            {/* Title */}
            <h1 className="text-3xl md:text-4xl phone:text-xl font-bold text-white">{item.Name}</h1>

            {/* Metadata Row */}
            <div className="flex items-center gap-4 text-sm text-white/70 flex-wrap">
              {item.ProductionYear && (
                <span className="flex items-center gap-1">
                  <Calendar size={14} />
                  {item.ProductionYear}
                </span>
              )}
              {item.ChildCount !== undefined && (
                <span>{item.ChildCount} Episode{item.ChildCount !== 1 ? 's' : ''}</span>
              )}
            </div>

            {/* Buttons */}
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={() => {
                  // Play first unwatched episode or first episode
                  const firstUnwatched = episodes.find(ep => !ep.UserData?.Played)
                  onPlay(firstUnwatched || episodes[0] || item)
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-white text-gray-900 rounded-lg font-semibold hover:bg-white/90 transition-colors"
              >
                <Play size={18} fill="currentColor" />
                Play
              </button>
              <button
                onClick={handleToggleSeasonWatched}
                disabled={isTogglingSeasonWatched}
                className={`flex items-center gap-2 px-5 py-2.5 backdrop-blur-sm rounded-lg font-semibold transition-colors ${
                  seasonWatched
                    ? 'bg-green-500/30 text-green-300 hover:bg-white/20 hover:text-white'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                {isTogglingSeasonWatched ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={18} className={seasonWatched ? 'fill-current' : ''} />
                )}
                {seasonWatched ? 'Watched' : 'Mark Watched'}
              </button>
              <button
                onClick={handleDownloadSeason}
                className="flex items-center gap-2 px-5 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-lg font-semibold hover:bg-white/30 transition-colors"
                title="Download every episode of this season"
              >
                {queuedSeasonCount !== null ? (
                  <CheckCircle2 size={18} className="text-green-400" />
                ) : (
                  <Download size={18} />
                )}
                {queuedSeasonCount === null
                  ? 'Download Season'
                  : queuedSeasonCount > 0
                    ? `${queuedSeasonCount} queued`
                    : 'Already downloaded'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Episodes List */}
      <div className="px-8 phone:px-4 py-6">
        {item.Overview && (
          <div className="mb-6 max-w-4xl">
            <p className="text-white/70 leading-relaxed">{item.Overview}</p>
          </div>
        )}

        <h2 className="text-xl font-semibold mb-4">Episodes</h2>
        <div className="space-y-3">
          {episodes.map(episode => {
            const thumbUrl = getEpisodeThumbnailUrl(episode)
            const runtime = formatRuntime(episode.RunTimeTicks)
            const runtimeMinutes = episode.RunTimeTicks ? Math.round(episode.RunTimeTicks / 600000000) : null

            return (
              <div
                key={episode.Id}
                className="flex gap-4 p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors"
              >
                {/* Thumbnail */}
                <div className="relative w-48 phone:w-28 flex-shrink-0 aspect-video rounded-lg overflow-hidden bg-white/5">
                  <DetailImage
                    src={thumbUrl}
                    alt={episode.Name || ''}
                    className="w-full h-full object-cover"
                    fallback={
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/30 to-pink-900/30">
                        <Tv2 size={24} className="text-white/30" />
                      </div>
                    }
                  />
                  {/* Progress bar overlay */}
                  {episode.UserData?.PlayedPercentage && episode.UserData.PlayedPercentage > 0 && !getEpisodeState(episode).watched && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                      <div
                        className="h-full bg-theme-500"
                        style={{ width: `${episode.UserData.PlayedPercentage}%` }}
                      />
                    </div>
                  )}
                  {/* Watched badge */}
                  {getEpisodeState(episode).watched && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-theme-500 rounded-full flex items-center justify-center">
                      <Check size={14} className="text-white" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 phone:flex-col phone:gap-2">
                    <div className="min-w-0">
                      <h4 className="font-medium text-white truncate">
                        Episode {episode.IndexNumber}{episode.Name ? ` - ${episode.Name}` : ''}
                      </h4>
                      {runtimeMinutes && (
                        <p className="text-sm text-white/50">{runtimeMinutes} min</p>
                      )}
                    </div>
                    {/* Action buttons */}
                    <div className="flex gap-2 flex-shrink-0 phone:flex-wrap">
                      <button
                        onClick={() => onPlay(episode)}
                        className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                        title="Play"
                      >
                        <Play size={16} className="text-white" />
                      </button>
                      <EpisodeDownloadButton
                        episode={episode}
                        onDownload={() => handleDownloadEpisode(episode)}
                      />
                      <button
                        onClick={() => toggleWatched(episode)}
                        className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                        title={getEpisodeState(episode).watched ? 'Mark as Unwatched' : 'Mark as Watched'}
                      >
                        <Check size={16} className={getEpisodeState(episode).watched ? 'text-theme-400' : 'text-white'} />
                      </button>
                      <button
                        onClick={() => toggleFavorite(episode)}
                        className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                        title={getEpisodeState(episode).favorite ? 'Remove from Favorites' : 'Add to Favorites'}
                      >
                        <Heart
                          size={16}
                          className={getEpisodeState(episode).favorite ? 'text-pink-400 fill-pink-400' : 'text-white'}
                        />
                      </button>
                    </div>
                  </div>
                  {episode.Overview && (
                    <p className="text-sm text-white/60 line-clamp-2 mt-2">{episode.Overview}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Season Card Component (smaller size)
function SeasonCard({
  season,
  serverUrl,
  onClick,
  api,
  userId,
  onPlaySeason,
  episodes,
}: {
  season: BaseItemDto
  serverUrl: string | null
  onClick: () => void
  api?: any
  userId?: string | null
  onPlaySeason?: (episode: BaseItemDto) => void
  episodes?: BaseItemDto[]
}) {
  const posterUrl = serverUrl
    ? `${serverUrl}/Items/${season.Id}/Images/Primary?maxWidth=200&quality=90`
    : null

  const unplayedCount = season.UserData?.UnplayedItemCount || 0
  const [isPlayed, setIsPlayed] = useState(season.UserData?.Played || false)
  const [isResolvingPlay, setIsResolvingPlay] = useState(false)
  const [seasonQueued, setSeasonQueued] = useState(false)

  // Follow background soft-refreshes (new season object swapped in by a diff)
  useEffect(() => { setIsPlayed(season.UserData?.Played || false) }, [season.UserData?.Played])

  const handleTogglePlayed = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!api || !userId || !season.Id || !serverUrl) return
    const prev = isPlayed
    setIsPlayed(!prev)
    try {
      await appApi.request({
        method: prev ? 'DELETE' : 'POST',
        url: `${serverUrl}/Users/${userId}/PlayedItems/${season.Id}`,
        headers: { 'Authorization': `MediaBrowser Token="${api.accessToken}"` },
      })
    } catch { setIsPlayed(prev) }
  }

  const fetchSeasonEpisodes = async (): Promise<BaseItemDto[]> => {
    if (episodes && episodes.length > 0) return episodes
    if (!api || !userId || !season.Id) return []
    const res = await getItemsApi(api).getItems({
      userId,
      parentId: season.Id,
      includeItemTypes: ['Episode'],
      isMissing: false,
      sortBy: ['IndexNumber'],
      sortOrder: ['Ascending'],
      fields: ['Overview'] as any,
    })
    return (res.data.Items || []).filter(isRealItem)
  }

  const handlePlay = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onPlaySeason || isResolvingPlay) return
    setIsResolvingPlay(true)
    try {
      const eps = await fetchSeasonEpisodes()
      if (eps.length > 0) {
        const firstUnwatched = eps.find(ep => !ep.UserData?.Played)
        onPlaySeason(firstUnwatched || eps[0])
      }
    } catch (err) {
      console.error('Failed to resolve season playback:', err)
    } finally {
      setIsResolvingPlay(false)
    }
  }

  const handleDownloadSeason = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!api?.accessToken || !serverUrl || seasonQueued) return
    try {
      const eps = await fetchSeasonEpisodes()
      const settings = loadSettings()
      const serverId = settings.activeJellyfinServerId || 'default'
      for (const ep of eps) {
        addToQueue(ep, serverUrl, serverId, api.accessToken)
      }
      setSeasonQueued(true)
    } catch (err) {
      console.error('Failed to queue season download:', err)
    }
  }

  return (
    <div
      className="group relative cursor-pointer w-full"
      onClick={onClick}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-white/5 mb-1.5">
        <DetailImage
          src={posterUrl}
          alt={season.Name || ''}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
          fallback={
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
              <Tv2 size={24} className="text-white/30" />
            </div>
          }
        />

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
          {onPlaySeason && (
            <button
              onClick={handlePlay}
              className="p-2 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform"
              title="Play next unwatched episode"
            >
              {isResolvingPlay ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Play size={18} fill="currentColor" />
              )}
            </button>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleTogglePlayed}
              className="p-1.5 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title={isPlayed ? 'Mark as Unwatched' : 'Mark as Watched'}
            >
              <CheckCircle2 size={14} className={isPlayed ? 'text-green-400 fill-green-400' : 'text-white'} />
            </button>
            <button
              onClick={handleDownloadSeason}
              className="p-1.5 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors"
              title={seasonQueued ? 'Season queued for download' : 'Download whole season'}
            >
              {seasonQueued ? (
                <CheckCircle2 size={14} className="text-green-400" />
              ) : (
                <Download size={14} className="text-white" />
              )}
            </button>
          </div>
        </div>

        {/* Unplayed count badge */}
        {unplayedCount > 0 && !isPlayed && (
          <div className="absolute top-1.5 right-1.5 min-w-[20px] h-5 px-1 bg-theme-500 rounded-full flex items-center justify-center">
            <span className="text-[10px] font-bold text-white">{unplayedCount}</span>
          </div>
        )}

        {/* Watched badge */}
        {isPlayed && (
          <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
            <Check size={12} className="text-white" />
          </div>
        )}
      </div>

      {/* Title */}
      <h3 className="text-xs font-medium text-white/90 truncate">{season.Name}</h3>
      {season.ProductionYear && (
        <p className="text-[10px] text-white/50">{season.ProductionYear}</p>
      )}
    </div>
  )
}

// "More like this" — Jellyfin similar-items row for movies and series.
// Loads independently of the main details fetch and hides itself when empty.
function MoreLikeThisSection({
  itemId,
  onViewItem
}: {
  itemId: string | undefined | null
  onViewItem: (item: BaseItemDto) => void
}) {
  const { api, user, serverUrl } = useJellyfin()
  const [similarItems, setSimilarItems] = useState<BaseItemDto[]>([])

  useEffect(() => {
    setSimilarItems([])
    if (!api || !itemId) return
    let cancelled = false

    getLibraryApi(api)
      .getSimilarItems({
        itemId,
        userId: user?.Id ?? undefined,
        limit: 12,
        fields: ['PrimaryImageAspectRatio', 'ProductionYear'] as any,
      })
      .then(res => {
        if (cancelled) return
        setSimilarItems((res.data.Items || []).filter(i => i.Id))
      })
      .catch(() => { /* section simply stays hidden */ })

    return () => { cancelled = true }
  }, [api, user?.Id, itemId])

  if (similarItems.length === 0) return null

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Film size={20} className="text-theme-400" />
        More Like This
      </h2>
      <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
        {similarItems.map((similar) => (
          <SimilarItemCard
            key={similar.Id}
            item={similar}
            serverUrl={serverUrl}
            onClick={() => onViewItem(similar)}
          />
        ))}
      </div>
    </div>
  )
}

function SimilarItemCard({
  item,
  serverUrl,
  onClick
}: {
  item: BaseItemDto
  serverUrl: string | null
  onClick: () => void
}) {
  const posterUrl = serverUrl && item.Id
    ? `${serverUrl}/Items/${item.Id}/Images/Primary?maxWidth=300&quality=90`
    : null

  return (
    <div
      className="flex-shrink-0 w-32 cursor-pointer group"
      onClick={onClick}
    >
      <div className="w-32 h-48 rounded-lg overflow-hidden bg-white/5 mb-2 relative group-hover:ring-2 group-hover:ring-theme-500 transition-all">
        <DetailImage
          src={posterUrl}
          alt={item.Name || ''}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          fallback={
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/30 to-pink-900/30">
              {item.Type === 'Series'
                ? <Tv2 size={28} className="text-white/30" />
                : <Film size={28} className="text-white/30" />}
            </div>
          }
        />
      </div>
      <p className="text-sm font-medium text-white/90 truncate">{item.Name}</p>
      {item.ProductionYear && (
        <p className="text-xs text-white/50">{item.ProductionYear}</p>
      )}
    </div>
  )
}

// Cast Card Component
function CastCard({
  person,
  serverUrl
}: {
  person: any
  serverUrl: string | null
}) {
  // Only request an image when the person actually has one (PrimaryImageTag),
  // otherwise every actor without a photo produced a guaranteed 404
  const imageUrl = serverUrl && person.Id && person.PrimaryImageTag
    ? `${serverUrl}/Items/${person.Id}/Images/Primary?maxWidth=200&quality=90&tag=${person.PrimaryImageTag}`
    : null

  return (
    <div className="flex-shrink-0 w-28 text-center">
      <div className="w-20 h-20 mx-auto rounded-full overflow-hidden bg-white/5 mb-2">
        <DetailImage
          src={imageUrl}
          alt={person.Name || ''}
          className="w-full h-full object-cover"
          fallback={
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/30 to-pink-900/30">
              <Users size={24} className="text-white/30" />
            </div>
          }
        />
      </div>
      <p className="text-sm font-medium text-white/90 truncate">{person.Name}</p>
      {person.Role && (
        <p className="text-xs text-white/50 truncate">{person.Role}</p>
      )}
    </div>
  )
}

// Episode Download Button - Small inline button for episode lists
function EpisodeDownloadButton({
  episode,
  onDownload
}: {
  episode: BaseItemDto
  onDownload: () => void
}) {
  const { isDownloaded, queueItem } = useDownloadState(episode.Id)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!episode.Id) return
    setIsDeleting(true)
    await deleteDownloadedMedia(episode.Id)
    setIsDeleting(false)
  }

  if (isDownloaded) {
    return (
      <button
        onClick={handleDelete}
        disabled={isDeleting}
        className="p-2 bg-green-500/20 hover:bg-red-500/20 rounded-lg transition-colors group"
        title="Downloaded - Click to delete"
      >
        {isDeleting ? (
          <Loader2 size={16} className="text-white animate-spin" />
        ) : (
          <>
            <CheckCircle2 size={16} className="text-green-400 group-hover:hidden" />
            <Trash2 size={16} className="text-red-400 hidden group-hover:block" />
          </>
        )}
      </button>
    )
  }

  if (queueItem) {
    if (queueItem.status === 'downloading') {
      return (
        <button
          onClick={() => pauseDownload(episode.Id!)}
          className="p-2 bg-theme-500/20 rounded-lg transition-colors relative"
          title={`Downloading ${queueItem.progress}%`}
        >
          <Loader2 size={16} className="text-theme-400 animate-spin" />
        </button>
      )
    }
    if (queueItem.status === 'queued') {
      return (
        <button
          onClick={() => cancelDownload(episode.Id!)}
          className="p-2 bg-white/10 rounded-lg transition-colors"
          title="Queued - Click to cancel"
        >
          <Clock size={16} className="text-white/60" />
        </button>
      )
    }
    if (queueItem.status === 'paused') {
      return (
        <button
          onClick={() => resumeDownload(episode.Id!)}
          className="p-2 bg-yellow-500/20 hover:bg-yellow-500/30 rounded-lg transition-colors"
          title={`Paused at ${queueItem.progress}% - Click to resume`}
        >
          <Play size={16} className="text-yellow-400" />
        </button>
      )
    }
    if (queueItem.status === 'failed') {
      return (
        <button
          onClick={onDownload}
          className="p-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg transition-colors"
          title="Failed - Click to retry"
        >
          <Download size={16} className="text-red-400" />
        </button>
      )
    }
  }

  return (
    <button
      onClick={onDownload}
      className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
      title="Download for offline"
    >
      <Download size={16} className="text-white" />
    </button>
  )
}

export default JellyfinItemDetails
