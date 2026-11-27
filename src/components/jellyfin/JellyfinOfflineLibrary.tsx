import React, { useState, useEffect } from 'react'
import { toLocalUrl } from '../../utils/api'
import {
  ArrowLeft,
  Download,
  Play,
  Trash2,
  Pause,
  Clock,
  Film,
  Tv2,
  CheckCircle2,
  Loader2,
  HardDrive,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Star,
  X
} from 'lucide-react'
import {
  getDownloadQueue,
  getDownloadedMediaGrouped,
  deleteDownloadedMedia,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  retryDownload,
  subscribeToDownloadUpdates,
  formatBytes,
  getDownloadStats,
  type DownloadQueueItem,
  type DownloadedMedia
} from '../../utils/jellyfinDownloadManager'

interface JellyfinOfflineLibraryProps {
  onBack: () => void
  onPlayItem: (itemId: string, localPath: string) => void
  /** When true: server is unreachable, hide queue management and show a cleaner browse layout */
  offlineMode?: boolean
}

type TabType = 'downloads' | 'queue'

export function JellyfinOfflineLibrary({ onBack, onPlayItem, offlineMode }: JellyfinOfflineLibraryProps) {
  const [activeTab, setActiveTab] = useState<TabType>('downloads')
  const [queue, setQueue] = useState<DownloadQueueItem[]>([])
  const [stats, setStats] = useState(getDownloadStats())
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set())

  // Subscribe to download updates
  useEffect(() => {
    const updateData = () => {
      setQueue(getDownloadQueue())
      setStats(getDownloadStats())
    }

    updateData()
    const unsubscribe = subscribeToDownloadUpdates(updateData)
    return unsubscribe
  }, [])

  const toggleSeriesExpanded = (seriesId: string) => {
    setExpandedSeries(prev => {
      const next = new Set(prev)
      if (next.has(seriesId)) {
        next.delete(seriesId)
      } else {
        next.add(seriesId)
      }
      return next
    })
  }

  return (
    <div className="min-h-full bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-md border-b border-white/5">
        <div className="px-6 py-4">
          <div className="flex items-center gap-4">
            {!offlineMode && (
              <button
                onClick={onBack}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <ArrowLeft size={24} />
              </button>
            )}
            <div>
              <h1 className="text-xl font-semibold">
                {offlineMode ? 'Available Offline' : 'Downloads'}
              </h1>
              <p className="text-sm text-white/50">
                {stats.totalDownloads} item{stats.totalDownloads !== 1 ? 's' : ''} • {formatBytes(stats.totalSize)}
              </p>
            </div>
          </div>

          {/* Tabs — hidden in offline mode (queue management not useful when server is down) */}
          {!offlineMode && (
            <div className="flex gap-1 mt-4 bg-white/5 rounded-lg p-1">
              <button
                onClick={() => setActiveTab('downloads')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-colors ${
                  activeTab === 'downloads'
                    ? 'bg-theme-500 text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <HardDrive size={18} />
                Downloaded
                {stats.totalDownloads > 0 && (
                  <span className="ml-1 px-2 py-0.5 bg-white/20 rounded-full text-xs">
                    {stats.totalDownloads}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('queue')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-colors ${
                  activeTab === 'queue'
                    ? 'bg-theme-500 text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <Download size={18} />
                Queue
                {(stats.queueCount + stats.downloadingCount) > 0 && (
                  <span className="ml-1 px-2 py-0.5 bg-white/20 rounded-full text-xs">
                    {stats.queueCount + stats.downloadingCount}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-6">
        {activeTab === 'downloads' || offlineMode ? (
          <DownloadsTab
            onPlayItem={onPlayItem}
            expandedSeries={expandedSeries}
            toggleSeriesExpanded={toggleSeriesExpanded}
            offlineMode={offlineMode}
          />
        ) : (
          <QueueTab queue={queue} />
        )}
      </div>
    </div>
  )
}

// Downloads Tab Component
function DownloadsTab({
  onPlayItem,
  expandedSeries,
  toggleSeriesExpanded,
  offlineMode,
}: {
  onPlayItem: (itemId: string, localPath: string) => void
  expandedSeries: Set<string>
  toggleSeriesExpanded: (seriesId: string) => void
  offlineMode?: boolean
}) {
  const [data, setData] = useState(() => getDownloadedMediaGrouped())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [detailsItem, setDetailsItem] = useState<DownloadedMedia | null>(null)

  useEffect(() => {
    const updateData = () => setData(getDownloadedMediaGrouped())
    updateData()
    const unsubscribe = subscribeToDownloadUpdates(updateData)
    return unsubscribe
  }, [])

  const handleDelete = async (itemId: string) => {
    setDeletingIds(prev => new Set(prev).add(itemId))
    await deleteDownloadedMedia(itemId)
    setDeletingIds(prev => {
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
    setData(getDownloadedMediaGrouped())
  }

  const isEmpty = data.movies.length === 0 && data.series.length === 0

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <HardDrive size={64} className="text-white/20 mb-4" />
        <h3 className="text-xl font-semibold text-white/80 mb-2">No Downloads Yet</h3>
        <p className="text-white/50 max-w-sm">
          Download movies and episodes to watch them offline. Look for the download button on any movie or episode.
        </p>
      </div>
    )
  }

  // Offline mode: expand all series so episodes are immediately accessible
  useEffect(() => {
    if (offlineMode) {
      data.series.forEach(s => toggleSeriesExpanded(s.seriesId))
    }
  }, [offlineMode, data.series.length])

  return (
    <div className="space-y-8">
      {/* Movies Section */}
      {data.movies.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Film size={20} className="text-theme-400" />
            Movies
          </h2>
          {/* Larger grid in offline mode for easier browsing */}
          <div className={`grid gap-4 ${offlineMode
            ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
            : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
          }`}>
            {data.movies.map(movie => (
              <DownloadedMovieCard
                key={movie.id}
                item={movie}
                onPlay={() => onPlayItem(movie.id, movie.localPath)}
                onShowDetails={() => setDetailsItem(movie)}
                onDelete={() => handleDelete(movie.id)}
                isDeleting={deletingIds.has(movie.id)}
                offlineMode={offlineMode}
              />
            ))}
          </div>
        </section>
      )}

      {/* TV Shows Section */}
      {data.series.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Tv2 size={20} className="text-theme-400" />
            TV Shows
          </h2>
          <div className="space-y-3">
            {data.series.map(series => (
              <DownloadedSeriesCard
                key={series.seriesId}
                seriesId={series.seriesId}
                seriesName={series.seriesName}
                episodes={series.episodes}
                isExpanded={expandedSeries.has(series.seriesId)}
                onToggle={() => toggleSeriesExpanded(series.seriesId)}
                onPlayEpisode={(ep) => onPlayItem(ep.id, ep.localPath)}
                onShowDetails={setDetailsItem}
                onDeleteEpisode={handleDelete}
                deletingIds={deletingIds}
              />
            ))}
          </div>
        </section>
      )}

      {/* Details modal */}
      {detailsItem && (
        <DownloadedItemDetails
          item={detailsItem}
          onClose={() => setDetailsItem(null)}
          onPlay={() => {
            setDetailsItem(null)
            onPlayItem(detailsItem.id, detailsItem.localPath)
          }}
        />
      )}
    </div>
  )
}

// Details modal for a downloaded item — shows offline metadata
// (overview, year, rating, genres) stored at download time
function DownloadedItemDetails({
  item,
  onClose,
  onPlay,
}: {
  item: DownloadedMedia
  onClose: () => void
  onPlay: () => void
}) {
  const runtimeMinutes = item.runTimeTicks ? Math.round(item.runTimeTicks / 600000000) : 0
  const subtitle = item.type === 'Episode'
    ? `${item.seriesName || ''} — S${item.seasonNumber}:E${item.episodeNumber}`
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl bg-gray-900 border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Backdrop */}
        {item.backdropPath && (
          <div className="relative h-48 w-full">
            <img
              src={toLocalUrl(item.backdropPath)}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent" />
          </div>
        )}

        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white/80 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>

        <div className="p-6 flex gap-5">
          {/* Poster */}
          <div className="w-32 flex-shrink-0 -mt-16 relative z-10">
            <div className="aspect-[2/3] rounded-xl overflow-hidden bg-white/5 shadow-xl">
              {item.posterPath ? (
                <img src={toLocalUrl(item.posterPath)} alt={item.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
                  <Film size={32} className="text-white/30" />
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            {subtitle && <p className="text-sm text-theme-400 mb-1">{subtitle}</p>}
            <h2 className="text-2xl font-bold text-white mb-2">{item.name}</h2>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/60 mb-3">
              {item.productionYear && <span>{item.productionYear}</span>}
              {runtimeMinutes > 0 && (
                <span className="flex items-center gap-1"><Clock size={13} /> {runtimeMinutes} min</span>
              )}
              {item.communityRating && (
                <span className="flex items-center gap-1">
                  <Star size={13} className="text-yellow-400" fill="currentColor" />
                  {item.communityRating.toFixed(1)}
                </span>
              )}
              {item.officialRating && (
                <span className="px-1.5 py-0.5 border border-white/20 rounded text-xs">{item.officialRating}</span>
              )}
              <span className="text-white/40">{formatBytes(item.fileSize)}</span>
            </div>

            {item.genres && item.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {item.genres.map(genre => (
                  <span key={genre} className="px-2 py-0.5 bg-white/10 rounded-full text-xs text-white/70">
                    {genre}
                  </span>
                ))}
              </div>
            )}

            {item.overview ? (
              <p className="text-sm text-white/70 leading-relaxed max-h-40 overflow-y-auto custom-scrollbar">
                {item.overview}
              </p>
            ) : (
              <p className="text-sm text-white/40 italic">No description available</p>
            )}

            <button
              onClick={onPlay}
              className="mt-4 flex items-center gap-2 px-6 py-2.5 bg-theme-500 hover:bg-theme-400 rounded-full text-white font-semibold transition-colors"
            >
              <Play size={18} fill="currentColor" />
              Play
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Downloaded Movie Card
function DownloadedMovieCard({
  item,
  onPlay,
  onShowDetails,
  onDelete,
  isDeleting,
  offlineMode,
}: {
  item: DownloadedMedia
  onPlay: () => void
  onShowDetails: () => void
  onDelete: () => void
  isDeleting: boolean
  offlineMode?: boolean
}) {
  return (
    <div className="group relative cursor-pointer" onClick={onShowDetails} onDoubleClick={onPlay}>
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-2">
        {item.posterPath ? (
          <img
            src={toLocalUrl(item.posterPath)}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
            <Film size={32} className="text-white/30" />
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay() }}
            className="p-3 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform"
          >
            <Play size={24} fill="currentColor" />
          </button>
          {!offlineMode && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              disabled={isDeleting}
              className="p-2 bg-red-500/80 rounded-full text-white hover:bg-red-500 transition-colors"
            >
              {isDeleting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Trash2 size={16} />
              )}
            </button>
          )}
        </div>

        {/* Downloaded badge */}
        <div className="absolute top-2 right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
          <CheckCircle2 size={14} className="text-white" />
        </div>

        {/* File size */}
        <div className="absolute bottom-2 left-2 right-2">
          <div className="bg-black/70 backdrop-blur-sm rounded px-2 py-1 text-center">
            <p className="text-[10px] text-white/80">{formatBytes(item.fileSize)}</p>
          </div>
        </div>
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium text-white/90 truncate">{item.name}</h3>
      <p className="text-xs text-white/50 flex items-center gap-2">
        {item.productionYear && <span>{item.productionYear}</span>}
        {item.communityRating && (
          <span className="flex items-center gap-0.5">
            <Star size={11} className="text-yellow-400" fill="currentColor" />
            {item.communityRating.toFixed(1)}
          </span>
        )}
      </p>
    </div>
  )
}

// Downloaded Series Card (expandable)
function DownloadedSeriesCard({
  seriesId,
  seriesName,
  episodes,
  isExpanded,
  onToggle,
  onPlayEpisode,
  onShowDetails,
  onDeleteEpisode,
  deletingIds
}: {
  seriesId: string
  seriesName: string
  episodes: DownloadedMedia[]
  isExpanded: boolean
  onToggle: () => void
  onPlayEpisode: (episode: DownloadedMedia) => void
  onShowDetails: (episode: DownloadedMedia) => void
  onDeleteEpisode: (episodeId: string) => void
  deletingIds: Set<string>
}) {
  const totalSize = episodes.reduce((sum, ep) => sum + ep.fileSize, 0)
  const posterPath = episodes[0]?.posterPath

  return (
    <div className="bg-white/5 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-4 hover:bg-white/5 transition-colors"
      >
        {/* Poster thumbnail */}
        <div className="w-16 h-24 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
          {posterPath ? (
            <img
              src={toLocalUrl(posterPath)}
              alt={seriesName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Tv2 size={24} className="text-white/30" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 text-left">
          <h3 className="font-semibold text-white">{seriesName}</h3>
          <p className="text-sm text-white/60">
            {episodes.length} episode{episodes.length !== 1 ? 's' : ''} • {formatBytes(totalSize)}
          </p>
        </div>

        {/* Expand/Collapse */}
        {isExpanded ? (
          <ChevronDown size={20} className="text-white/40" />
        ) : (
          <ChevronRight size={20} className="text-white/40" />
        )}
      </button>

      {/* Episodes List */}
      {isExpanded && (
        <div className="border-t border-white/5">
          {episodes.map(episode => (
            <div
              key={episode.id}
              className="flex items-center gap-4 p-4 hover:bg-white/5 transition-colors cursor-pointer"
              onClick={() => onShowDetails(episode)}
            >
              {/* Episode thumbnail */}
              <div className="w-32 aspect-video rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                {episode.posterPath ? (
                  <img
                    src={toLocalUrl(episode.posterPath)}
                    alt={episode.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Tv2 size={20} className="text-white/30" />
                  </div>
                )}
              </div>

              {/* Episode info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/60">
                  S{episode.seasonNumber}:E{episode.episodeNumber}
                </p>
                <h4 className="font-medium text-white truncate">{episode.name}</h4>
                {episode.overview && (
                  <p className="text-xs text-white/50 line-clamp-2 mt-0.5">{episode.overview}</p>
                )}
                <p className="text-xs text-white/40 mt-0.5">{formatBytes(episode.fileSize)}</p>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onPlayEpisode(episode) }}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  title="Play"
                >
                  <Play size={16} className="text-white" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteEpisode(episode.id) }}
                  disabled={deletingIds.has(episode.id)}
                  className="p-2 bg-white/10 hover:bg-red-500/30 rounded-lg transition-colors"
                  title="Delete"
                >
                  {deletingIds.has(episode.id) ? (
                    <Loader2 size={16} className="text-white animate-spin" />
                  ) : (
                    <Trash2 size={16} className="text-white" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Queue Tab Component
function QueueTab({ queue }: { queue: DownloadQueueItem[] }) {
  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Download size={64} className="text-white/20 mb-4" />
        <h3 className="text-xl font-semibold text-white/80 mb-2">Queue Empty</h3>
        <p className="text-white/50 max-w-sm">
          Add movies or episodes to download and they will appear here.
        </p>
      </div>
    )
  }

  // Group by status
  const downloading = queue.filter(q => q.status === 'downloading')
  const queued = queue.filter(q => q.status === 'queued')
  const paused = queue.filter(q => q.status === 'paused')
  const failed = queue.filter(q => q.status === 'failed')

  return (
    <div className="space-y-6">
      {/* Downloading */}
      {downloading.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wide mb-3">
            Downloading
          </h3>
          <div className="space-y-2">
            {downloading.map(item => (
              <QueueItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Queued */}
      {queued.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wide mb-3">
            Waiting
          </h3>
          <div className="space-y-2">
            {queued.map(item => (
              <QueueItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Paused */}
      {paused.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wide mb-3">
            Paused
          </h3>
          <div className="space-y-2">
            {paused.map(item => (
              <QueueItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Failed */}
      {failed.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wide mb-3">
            Failed
          </h3>
          <div className="space-y-2">
            {failed.map(item => (
              <QueueItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// Queue Item Card
function QueueItemCard({ item }: { item: DownloadQueueItem }) {
  const isEpisode = item.type === 'Episode'
  const title = isEpisode ? item.seriesName || item.name : item.name
  const subtitle = isEpisode ? `S${item.seasonNumber}:E${item.episodeNumber} - ${item.name}` : null

  const getStatusColor = () => {
    switch (item.status) {
      case 'downloading': return 'bg-theme-500/20 border-theme-500/30'
      case 'queued': return 'bg-white/5 border-white/10'
      case 'paused': return 'bg-yellow-500/20 border-yellow-500/30'
      case 'failed': return 'bg-red-500/20 border-red-500/30'
      default: return 'bg-white/5 border-white/10'
    }
  }

  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl border ${getStatusColor()}`}>
      {/* Icon */}
      <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
        {isEpisode ? (
          <Tv2 size={24} className="text-white/50" />
        ) : (
          <Film size={24} className="text-white/50" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-white truncate">{title}</h4>
        {subtitle && (
          <p className="text-sm text-white/60 truncate">{subtitle}</p>
        )}

        {/* Progress bar for downloading */}
        {item.status === 'downloading' && (
          <div className="mt-2">
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-theme-500 transition-all duration-300"
                style={{ width: `${item.progress}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-xs text-white/50">
                {formatBytes(item.downloadedBytes)} / {formatBytes(item.totalBytes)}
              </span>
              <span className="text-xs text-white/50">{item.progress}%</span>
            </div>
          </div>
        )}

        {/* Error message */}
        {item.status === 'failed' && item.error && (
          <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
            <AlertCircle size={12} />
            {item.error}
          </p>
        )}

        {/* Paused indicator */}
        {item.status === 'paused' && (
          <p className="text-xs text-yellow-400 mt-1">
            Paused at {item.progress}%
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-shrink-0">
        {item.status === 'downloading' && (
          <button
            onClick={() => pauseDownload(item.id)}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            title="Pause"
          >
            <Pause size={18} className="text-white" />
          </button>
        )}

        {item.status === 'paused' && (
          <button
            onClick={() => resumeDownload(item.id)}
            className="p-2 bg-yellow-500/20 hover:bg-yellow-500/30 rounded-lg transition-colors"
            title="Resume"
          >
            <Play size={18} className="text-yellow-400" />
          </button>
        )}

        {item.status === 'failed' && (
          <button
            onClick={() => retryDownload(item.id)}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            title="Retry"
          >
            <RefreshCw size={18} className="text-white" />
          </button>
        )}

        <button
          onClick={() => cancelDownload(item.id)}
          className="p-2 bg-white/10 hover:bg-red-500/30 rounded-lg transition-colors"
          title="Cancel"
        >
          <Trash2 size={18} className="text-white" />
        </button>
      </div>
    </div>
  )
}

export default JellyfinOfflineLibrary
