import React, { useEffect, useState, useCallback, memo } from 'react'
import {
  ArrowLeft, Play, Shuffle, Clock, ListMusic, Loader2, ListPlus, ListEnd,
  Download, Check, X, RefreshCw
} from 'lucide-react'
import { useJellyfin, getPlaylistsApi, type BaseItemDto } from '../JellyfinContext'
import { MusicTrackRow } from './MusicTrackRow'
import { useMusicPlayer, formatTime, ticksToSeconds, type Track } from '../../../stores/musicPlayerStore'
import { useScrollToTopOnMount } from '../../../hooks/useScrollRestore'
import type { MusicViewType } from './JellyMusicView'
import { PlaylistCover } from './PlaylistCover'
import {
  downloadPlaylist,
  getDownloadedPlaylist,
  isPlaylistDownloading,
  cancelPlaylistDownload,
  setPlaylistAutoSync,
  subscribeToMusicDownloadUpdates,
  type DownloadedPlaylist,
  type PlaylistDownloadProgress,
} from '../../../utils/musicDownloadManager'
import CircularProgress from '../../CircularProgress'

interface MusicPlaylistDetailsProps {
  playlist: BaseItemDto
  onNavigate: (view: MusicViewType) => void
  onBack: () => void
}

export const MusicPlaylistDetails = memo(function MusicPlaylistDetails({
  playlist,
  onNavigate,
  onBack
}: MusicPlaylistDetailsProps) {
  const { api, user, serverUrl, accessToken, serverId } = useJellyfin()
  const scrollTopAnchor = useScrollToTopOnMount()
  const setQueue = useMusicPlayer(s => s.setQueue)
  const addToQueue = useMusicPlayer(s => s.addToQueue)

  const [tracks, setTracks] = useState<BaseItemDto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [downloaded, setDownloaded] = useState<DownloadedPlaylist | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<PlaylistDownloadProgress | null>(null)

  // Read the playlist's LIVE membership.
  //
  // `getItems({ parentId })` goes through the generic library query and sorts by
  // whatever is asked for, which loses playlist order. `/Playlists/{id}/Items`
  // is the dedicated route: it returns the playlist's linked children in
  // playlist order, so externally generated/updated playlists show correctly.
  const fetchTracks = useCallback(async (): Promise<BaseItemDto[]> => {
    if (!api || !playlist.Id) return []
    const playlistsApi = getPlaylistsApi(api)
    const response = await playlistsApi.getPlaylistItems({
      playlistId: playlist.Id,
      userId: user?.Id,
      enableImages: true,
      enableUserData: true,
    })
    return response.data.Items || []
  }, [api, user?.Id, playlist.Id])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    fetchTracks()
      .then(items => { if (!cancelled) setTracks(items) })
      .catch(e => console.error('Failed to fetch playlist tracks:', e))
      .finally(() => { if (!cancelled) setIsLoading(false) })

    // The playlist can be rewritten by a generator while this page is open in
    // the background — re-read it when the window is focused again.
    const refetchOnFocus = () => {
      if (document.hidden) return
      fetchTracks().then(items => { if (!cancelled) setTracks(items) }).catch(() => {})
    }
    window.addEventListener('focus', refetchOnFocus)
    document.addEventListener('visibilitychange', refetchOnFocus)

    return () => {
      cancelled = true
      window.removeEventListener('focus', refetchOnFocus)
      document.removeEventListener('visibilitychange', refetchOnFocus)
    }
  }, [fetchTracks])

  // Manual re-read of the playlist from the server (the generator may have
  // rewritten it since this view was opened)
  const handleRefreshTracks = async () => {
    setIsRefreshing(true)
    try {
      setTracks(await fetchTracks())
    } catch (e) {
      console.error('Failed to refresh playlist tracks:', e)
    }
    setIsRefreshing(false)
  }

  // Download state
  useEffect(() => {
    if (!playlist.Id) return
    const sync = () => {
      setDownloaded(getDownloadedPlaylist(playlist.Id!))
      setDownloadProgress(isPlaylistDownloading(playlist.Id!))
    }
    sync()
    return subscribeToMusicDownloadUpdates(sync)
  }, [playlist.Id])

  const createTracksFromItems = (items: BaseItemDto[]): Track[] => {
    return items.map(item => ({
      id: item.Id!,
      name: item.Name || 'Unknown Track',
      artists: item.Artists || [item.AlbumArtist || 'Unknown Artist'],
      artistIds: item.ArtistItems?.map(a => a.Id!) || [],
      albumId: item.AlbumId || '',
      albumName: item.Album || 'Unknown Album',
      duration: item.RunTimeTicks || 0,
      indexNumber: item.IndexNumber,
      imageUrl: item.AlbumId && serverUrl
        ? `${serverUrl}/Items/${item.AlbumId}/Images/Primary?maxWidth=120`
        : undefined
    }))
  }

  const handlePlayAll = () => {
    const queueTracks = createTracksFromItems(tracks)
    if (queueTracks.length > 0) {
      setQueue(queueTracks, 0, playlist.Name)
    }
  }

  const handleShuffle = () => {
    const queueTracks = createTracksFromItems(tracks)
    if (queueTracks.length > 0) {
      const shuffled = [...queueTracks].sort(() => Math.random() - 0.5)
      setQueue(shuffled, 0, playlist.Name)
    }
  }

  const handlePlayTrack = (index: number) => {
    const queueTracks = createTracksFromItems(tracks)
    if (queueTracks.length > 0) {
      setQueue(queueTracks, index, playlist.Name)
    }
  }

  const handleQueuePlaylist = (position: 'next' | 'end') => {
    const queueTracks = createTracksFromItems(tracks)
    if (queueTracks.length > 0) {
      addToQueue(queueTracks, position)
    }
  }

  const handleDownloadPlaylist = async () => {
    if (!playlist.Id || !serverUrl || !serverId || !accessToken) return

    // Re-read the playlist first so what lands on disk is its membership *now*,
    // not what happened to be on screen when the view was opened.
    let items = tracks
    try {
      items = await fetchTracks()
      setTracks(items)
    } catch {
      // Server unreachable — download what we have rather than nothing
    }
    if (items.length === 0) return

    await downloadPlaylist(
      playlist.Id,
      playlist.Name || 'Playlist',
      createTracksFromItems(items),
      serverUrl,
      serverId,
      accessToken,
    )
  }

  const handleCancelDownload = () => {
    if (playlist.Id) cancelPlaylistDownload(playlist.Id)
  }

  const handleToggleAutoSync = () => {
    if (playlist.Id && downloaded) setPlaylistAutoSync(playlist.Id, !downloaded.autoSync)
  }

  // A playlist has no cover of its own until Jellyfin generates the collage, which
  // never happens for some plugin-created ones. Stand in with the first track's
  // album art — that is what the collage would have been built from anyway.
  const fallbackCoverItemId = tracks.find(t => t.AlbumId)?.AlbumId ?? null

  const totalDuration = tracks.reduce((acc, track) => acc + (track.RunTimeTicks || 0), 0)
  const totalDurationMinutes = Math.round(ticksToSeconds(totalDuration) / 60)

  return (
    <div className="min-h-full" ref={scrollTopAnchor}>
      {/* Header with backdrop */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-b from-theme-900/40 via-theme-900/20 to-gray-900" />

        <div className="relative px-8 phone:px-4 pt-8 phone:pt-safe pb-6">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>Back</span>
          </button>

          <div className="flex phone:flex-col phone:items-center phone:text-center gap-6 phone:gap-4">
            <div className="w-48 h-48 phone:w-44 phone:h-44 rounded-lg overflow-hidden shadow-2xl flex-shrink-0">
              <PlaylistCover
                playlist={playlist}
                serverUrl={serverUrl}
                maxWidth={400}
                className="w-full h-full"
                iconSize={64}
                fallbackItemId={fallbackCoverItemId}
              />
            </div>

            <div className="flex flex-col justify-end min-w-0 phone:items-center">
              <span className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
                Playlist
              </span>
              <h1 className="text-4xl phone:text-2xl font-bold text-white mb-2">
                {playlist.Name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-white/70 phone:justify-center">
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
          onClick={() => handleQueuePlaylist('next')}
          disabled={tracks.length === 0}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
          title="Play next"
        >
          <ListPlus size={20} />
        </button>

        <button
          onClick={() => handleQueuePlaylist('end')}
          disabled={tracks.length === 0}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
          title="Add to queue"
        >
          <ListEnd size={20} />
        </button>

        {/* Re-read the playlist from the server */}
        <button
          onClick={handleRefreshTracks}
          disabled={isRefreshing || isLoading}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
          title="Reload playlist from server"
        >
          <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : undefined} />
        </button>

        {/* Offline download */}
        {downloadProgress ? (
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
        ) : downloaded ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleAutoSync}
              className={`flex items-center gap-2 px-4 py-3 rounded-full text-sm font-medium transition-colors ${
                downloaded.autoSync
                  ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  : 'bg-white/10 text-white/60 hover:bg-white/20'
              }`}
              title={downloaded.autoSync
                ? 'Downloaded — kept up to date automatically. Click to stop auto-updating.'
                : 'Downloaded — not auto-updating. Click to keep it in sync.'}
            >
              <Check size={16} />
              {downloaded.autoSync ? 'Auto-updating' : 'Downloaded'}
            </button>
            <button
              onClick={handleCancelDownload}
              className="p-3 bg-white/10 hover:bg-red-500/20 rounded-full text-white/60 hover:text-red-400 transition-colors"
              title="Remove download"
            >
              <X size={20} />
            </button>
          </div>
        ) : (
          <button
            onClick={handleDownloadPlaylist}
            disabled={tracks.length === 0 || !serverId}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
            title="Download playlist for offline listening"
          >
            <Download size={20} />
          </button>
        )}
      </div>

      {/* Track list */}
      <div className="px-4 pb-8">
        <div className="flex items-center gap-4 px-4 py-2 text-xs font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 mb-2">
          <div className="w-8 text-center">#</div>
          <div className="flex-1">Title</div>
          <div className="hidden md:block w-48">Album</div>
          <div className="w-12 text-right">
            <Clock size={14} />
          </div>
          <div className="w-8" />
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={32} className="animate-spin text-theme-500" />
          </div>
        )}

        {!isLoading && tracks.map((track, index) => (
          <MusicTrackRow
            key={track.Id}
            track={track}
            index={index + 1}
            showArtist={true}
            showAlbum={true}
            onPlay={() => handlePlayTrack(index)}
            onNavigateToAlbum={() => {
              if (track.AlbumId) {
                onNavigate({
                  type: 'album-details',
                  album: {
                    Id: track.AlbumId,
                    Name: track.Album,
                    AlbumArtist: track.AlbumArtist
                  } as BaseItemDto
                })
              }
            }}
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

        {!isLoading && tracks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ListMusic size={48} className="text-white/20 mb-4" />
            <p className="text-white/60">This playlist is empty</p>
          </div>
        )}
      </div>
    </div>
  )
})
