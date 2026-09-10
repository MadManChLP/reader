import React, { useEffect, useState } from 'react'
import { ArrowLeft, Play, Shuffle, Heart, Clock, Disc3, Loader2, Download, Check, X, ListPlus, ListEnd } from 'lucide-react'
import { useJellyfin, getItemsApi, type BaseItemDto } from '../JellyfinContext'
import { MusicTrackRow } from './MusicTrackRow'
import { useMusicPlayer, formatTime, ticksToSeconds, type Track } from '../../../stores/musicPlayerStore'
import { setFavorite } from './musicQueueHelpers'
import { useScrollToTopOnMount } from '../../../hooks/useScrollRestore'
import type { MusicViewType } from './MusicView'
import {
  downloadAlbum,
  isAlbumDownloaded,
  isAlbumDownloading,
  cancelAlbumDownload,
  subscribeToMusicDownloadUpdates,
  type AlbumDownloadProgress
} from '../../../utils/musicDownloadManager'
import CircularProgress from '../../CircularProgress'

interface MusicAlbumDetailsProps {
  album: BaseItemDto
  onNavigate: (view: MusicViewType) => void
  onBack: () => void
}

export function MusicAlbumDetails({ album, onNavigate, onBack }: MusicAlbumDetailsProps) {
  const { api, user, serverUrl, accessToken, serverId } = useJellyfin()
  const scrollTopAnchor = useScrollToTopOnMount()
  const setQueue = useMusicPlayer(s => s.setQueue)
  const addToQueue = useMusicPlayer(s => s.addToQueue)

  const [tracks, setTracks] = useState<BaseItemDto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDownloaded, setIsDownloaded] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<AlbumDownloadProgress | null>(null)
  const [isFavorite, setIsFavorite] = useState(!!album.UserData?.IsFavorite)

  const handleToggleFavorite = () => {
    if (!album.Id || !serverUrl || !accessToken || !user?.Id) return
    const newState = !isFavorite
    setIsFavorite(newState)  // Optimistic
    setFavorite(serverUrl, accessToken, user.Id, album.Id, newState).catch(() => {
      setIsFavorite(!newState)
    })
  }

  // Check download status
  useEffect(() => {
    if (album.Id) {
      setIsDownloaded(isAlbumDownloaded(album.Id))
      setDownloadProgress(isAlbumDownloading(album.Id))
    }

    // Subscribe to download updates
    const unsubscribe = subscribeToMusicDownloadUpdates((queue, albumProgress) => {
      if (album.Id) {
        const progress = albumProgress.find(p => p.albumId === album.Id)
        setDownloadProgress(progress || null)
        if (!progress) {
          setIsDownloaded(isAlbumDownloaded(album.Id))
        }
      }
    })

    return unsubscribe
  }, [album.Id])

  useEffect(() => {
    const fetchTracks = async () => {
      if (!api || !user?.Id || !album.Id) return

      setIsLoading(true)

      try {
        const itemsApi = getItemsApi(api)
        const response = await itemsApi.getItems({
          userId: user.Id,
          parentId: album.Id,
          includeItemTypes: ['Audio'],
          sortBy: ['IndexNumber', 'SortName'],
          sortOrder: ['Ascending', 'Ascending']
        })

        setTracks(response.data.Items || [])
      } catch (e) {
        console.error('Failed to fetch album tracks:', e)
      }

      setIsLoading(false)
    }

    fetchTracks()
  }, [api, user?.Id, album.Id])

  const createTracksFromItems = (items: BaseItemDto[]): Track[] => {
    return items.map(item => ({
      id: item.Id!,
      name: item.Name || 'Unknown Track',
      artists: item.Artists || [item.AlbumArtist || album.AlbumArtist || 'Unknown Artist'],
      artistIds: item.ArtistItems?.map(a => a.Id!) || [],
      albumId: album.Id!,
      albumName: album.Name || 'Unknown Album',
      duration: item.RunTimeTicks || 0,
      indexNumber: item.IndexNumber,
      imageUrl: serverUrl ? `${serverUrl}/Items/${album.Id}/Images/Primary?maxWidth=120` : undefined
    }))
  }

  const handlePlayAll = () => {
    const queueTracks = createTracksFromItems(tracks)
    if (queueTracks.length > 0) {
      setQueue(queueTracks, 0, album.Name)
    }
  }

  const handleShuffle = () => {
    const queueTracks = createTracksFromItems(tracks)
    if (queueTracks.length > 0) {
      // Shuffle before setting queue
      const shuffled = [...queueTracks].sort(() => Math.random() - 0.5)
      setQueue(shuffled, 0, album.Name)
    }
  }

  const handlePlayTrack = (index: number) => {
    const queueTracks = createTracksFromItems(tracks)
    if (queueTracks.length > 0) {
      setQueue(queueTracks, index, album.Name)
    }
  }

  const handleQueueAlbum = (position: 'next' | 'end') => {
    const queueTracks = createTracksFromItems(tracks)
    if (queueTracks.length > 0) {
      addToQueue(queueTracks, position)
    }
  }

  const handleDownloadAlbum = async () => {
    if (!album.Id || !serverUrl || !serverId || !accessToken || tracks.length === 0) return

    const queueTracks = createTracksFromItems(tracks)
    await downloadAlbum(
      album.Id,
      album.Name || 'Unknown Album',
      album.AlbumArtist || 'Unknown Artist',
      album.AlbumArtists?.[0]?.Id,
      queueTracks,
      serverUrl,
      serverId,
      accessToken,
      {
        productionYear: album.ProductionYear,
        overview: album.Overview,
        genres: album.Genres,
      }
    )
  }

  const handleCancelDownload = () => {
    if (album.Id) {
      cancelAlbumDownload(album.Id)
    }
  }

  const imageUrl = serverUrl && album.Id
    ? `${serverUrl}/Items/${album.Id}/Images/Primary?maxWidth=300&quality=90`
    : null

  const totalDuration = tracks.reduce((acc, track) => acc + (track.RunTimeTicks || 0), 0)
  const totalDurationMinutes = Math.round(ticksToSeconds(totalDuration) / 60)

  return (
    <div className="min-h-full" ref={scrollTopAnchor}>
      {/* Header with backdrop */}
      <div className="relative">
        {/* Gradient backdrop */}
        <div className="absolute inset-0 bg-gradient-to-b from-theme-900/40 via-theme-900/20 to-gray-900" />

        <div className="relative px-8 phone:px-4 pt-8 phone:pt-safe pb-6">
          {/* Back button */}
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>Back</span>
          </button>

          {/* Album info */}
          <div className="flex phone:flex-col phone:items-center phone:text-center gap-6 phone:gap-4">
            {/* Cover */}
            <div className="w-48 h-48 phone:w-44 phone:h-44 rounded-lg overflow-hidden shadow-2xl flex-shrink-0">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={album.Name || 'Album'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
                  <Disc3 size={64} className="text-white/30" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex flex-col justify-end min-w-0 phone:items-center">
              <span className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
                Album
              </span>
              <h1 className="text-4xl phone:text-2xl font-bold text-white mb-2">
                {album.Name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-white/70 phone:justify-center">
                <span
                  onClick={() => {
                    if (album.AlbumArtists?.[0]?.Id) {
                      onNavigate({
                        type: 'artist-details',
                        artist: {
                          Id: album.AlbumArtists[0].Id,
                          Name: album.AlbumArtists[0].Name
                        } as BaseItemDto
                      })
                    }
                  }}
                  className="font-medium hover:text-white hover:underline cursor-pointer"
                >
                  {album.AlbumArtist || 'Unknown Artist'}
                </span>
                {album.ProductionYear && (
                  <>
                    <span className="text-white/40">•</span>
                    <span>{album.ProductionYear}</span>
                  </>
                )}
                <span className="text-white/40">•</span>
                <span>{tracks.length} songs</span>
                <span className="text-white/40">•</span>
                <span>{totalDurationMinutes} min</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-8 phone:px-4 py-4 flex flex-wrap items-center gap-4 phone:justify-center">
        <button
          onClick={handlePlayAll}
          disabled={tracks.length === 0}
          className="flex items-center justify-center gap-2 px-6 py-3 phone:w-full bg-theme-500 hover:bg-theme-400
            rounded-full text-white font-semibold transition-colors disabled:opacity-50"
        >
          <Play size={20} fill="currentColor" />
          Play
        </button>

        <button
          onClick={handleShuffle}
          disabled={tracks.length === 0}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
          title="Shuffle"
        >
          <Shuffle size={20} />
        </button>

        <button
          onClick={() => handleQueueAlbum('next')}
          disabled={tracks.length === 0}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
          title="Play next"
        >
          <ListPlus size={20} />
        </button>

        <button
          onClick={() => handleQueueAlbum('end')}
          disabled={tracks.length === 0}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
          title="Add to queue"
        >
          <ListEnd size={20} />
        </button>

        <button
          onClick={handleToggleFavorite}
          disabled={!user?.Id}
          className={`p-3 rounded-full transition-colors ${
            isFavorite
              ? 'bg-theme-500/20 text-theme-400 hover:bg-theme-500/30'
              : 'bg-white/10 hover:bg-white/20 text-white'
          }`}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart size={20} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>

        {/* Download button */}
        {isDownloaded ? (
          <button
            className="p-3 bg-green-500/20 rounded-full text-green-400 cursor-default"
            title="Album downloaded"
          >
            <Check size={20} />
          </button>
        ) : downloadProgress ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full">
              <CircularProgress
                fraction={downloadProgress.totalTracks > 0
                  ? downloadProgress.completedTracks / downloadProgress.totalTracks
                  : null}
                size={16}
                className="text-theme-400"
              />
              <span className="text-sm text-white/70">
                {downloadProgress.completedTracks}/{downloadProgress.totalTracks}
              </span>
            </div>
            <button
              onClick={handleCancelDownload}
              className="p-2 bg-white/10 hover:bg-red-500/20 rounded-full text-white/60 hover:text-red-400 transition-colors"
              title="Cancel download"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <button
            onClick={handleDownloadAlbum}
            disabled={tracks.length === 0}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
            title="Download album"
          >
            <Download size={20} />
          </button>
        )}
      </div>

      {/* Track list */}
      <div className="px-4 pb-8">
        {/* Header */}
        <div className="flex items-center gap-4 px-4 py-2 text-xs font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 mb-2">
          <div className="w-8 text-center">#</div>
          <div className="flex-1">Title</div>
          <div className="w-12 text-right">
            <Clock size={14} />
          </div>
          <div className="w-8" />
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={32} className="animate-spin text-theme-500" />
          </div>
        )}

        {/* Tracks */}
        {!isLoading && tracks.map((track, index) => (
          <MusicTrackRow
            key={track.Id}
            track={track}
            index={index + 1}
            showArtist={true}
            showAlbum={false}
            albumId={album.Id}
            albumName={album.Name || 'Unknown Album'}
            onPlay={() => handlePlayTrack(index)}
            onNavigateToArtist={() => {
              if (track.ArtistItems?.[0]?.Id) {
                onNavigate({
                  type: 'artist-details',
                  artist: {
                    Id: track.ArtistItems[0].Id,
                    Name: track.ArtistItems[0].Name
                  } as BaseItemDto
                })
              }
            }}
          />
        ))}

        {/* Empty state */}
        {!isLoading && tracks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Disc3 size={48} className="text-white/20 mb-4" />
            <p className="text-white/60">No tracks found in this album</p>
          </div>
        )}
      </div>
    </div>
  )
}
