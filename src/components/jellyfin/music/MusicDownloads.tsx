import React, { useState, useEffect, useCallback } from 'react'
import LocalOrRemoteImage from '../../LocalOrRemoteImage'
import {
  Download, Trash2, Play, Pause, X, Music, HardDrive, ListMusic, RefreshCw,
  Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronRight
} from 'lucide-react'
import { useMusicPlayer } from '../../../stores/musicPlayerStore'
import {
  getDownloadedAlbums,
  getDownloadedTracks,
  getMusicDownloadQueue,
  getAlbumDownloadProgress,
  deleteDownloadedAlbum,
  deleteDownloadedTrack,
  removeTrackFromQueue,
  cancelAlbumDownload,
  retryMusicDownload,
  subscribeToMusicDownloadUpdates,
  downloadedTrackToTrack,
  formatBytes,
  getMusicDownloadStats,
  getDownloadedPlaylists,
  getPlaylistDownloadProgress,
  getDownloadedPlaylistTracks,
  deleteDownloadedPlaylist,
  cancelPlaylistDownload,
  setPlaylistAutoSync,
  syncDownloadedPlaylists,
  type DownloadedAlbum,
  type DownloadedTrack,
  type DownloadedPlaylist,
  type MusicDownloadQueueItem,
  type AlbumDownloadProgress,
  type PlaylistDownloadProgress,
} from '../../../utils/musicDownloadManager'
import { useJellyfin } from '../JellyfinContext'

function formatDuration(ticks: number): string {
  const totalSeconds = Math.floor(ticks / 10000000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

interface AlbumRowProps {
  album: DownloadedAlbum
  tracks: DownloadedTrack[]
  onDelete: (albumId: string) => void
  onPlayAlbum: (tracks: DownloadedTrack[]) => void
  onPlayTrack: (track: DownloadedTrack, allTracks: DownloadedTrack[]) => void
  onDeleteTrack: (trackId: string) => void
}

function AlbumRow({ album, tracks, onDelete, onPlayAlbum, onPlayTrack, onDeleteTrack }: AlbumRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const currentTrack = useMusicPlayer(s => s.currentTrack)
  const isPlaying = useMusicPlayer(s => s.isPlaying)
  const { getImageUrl } = useJellyfin()

  const remoteImageUrl = getImageUrl(album.id, 'Primary', 120)

  const handleDelete = async () => {
    setDeleting(true)
    await deleteDownloadedAlbum(album.id)
    onDelete(album.id)
    setDeleting(false)
  }

  const albumTracks = tracks
    .filter(t => t.albumId === album.id)
    .sort((a, b) => (a.indexNumber || 0) - (b.indexNumber || 0))

  return (
    <div className="bg-white/5 rounded-xl overflow-hidden border border-white/10">
      {/* Album header */}
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-shrink-0 text-white/40 hover:text-white transition-colors"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-white/10">
          {(album.localImagePath || remoteImageUrl) ? (
            <LocalOrRemoteImage
              localPath={album.localImagePath}
              remoteUrl={remoteImageUrl}
              alt={album.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music size={16} className="text-white/30" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0" onClick={() => setExpanded(!expanded)}>
          <p className="font-medium truncate text-sm cursor-pointer">{album.name}</p>
          <p className="text-xs text-white/50 truncate">
            {album.artist}{album.productionYear ? ` · ${album.productionYear}` : ''} · {albumTracks.length} tracks · {formatBytes(album.totalSize)}
          </p>
          {album.genres && album.genres.length > 0 && (
            <p className="text-xs text-white/35 truncate">{album.genres.join(', ')}</p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onPlayAlbum(albumTracks)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white"
            title="Play album"
            disabled={albumTracks.length === 0}
          >
            <Play size={16} fill="currentColor" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-2 hover:bg-red-500/20 rounded-full transition-colors text-white/40 hover:text-red-400"
            title="Delete album"
          >
            {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
        </div>
      </div>

      {/* Track list */}
      {expanded && albumTracks.length > 0 && (
        <div className="border-t border-white/10">
          {albumTracks.map((track) => {
            const isCurrentlyPlaying = currentTrack?.id === track.id && isPlaying
            return (
              <div
                key={track.id}
                className={`flex items-center gap-3 px-4 py-2 hover:bg-white/5 group transition-colors ${
                  currentTrack?.id === track.id ? 'bg-theme-500/10' : ''
                }`}
              >
                <span className="w-6 text-center text-xs text-white/30 group-hover:hidden">
                  {track.indexNumber || '·'}
                </span>
                <button
                  onClick={() => onPlayTrack(track, albumTracks)}
                  className="w-6 text-center hidden group-hover:flex items-center justify-center text-white/60 hover:text-white"
                >
                  {isCurrentlyPlaying ? (
                    <Pause size={14} fill="currentColor" />
                  ) : (
                    <Play size={14} fill="currentColor" />
                  )}
                </button>

                <span className={`flex-1 text-sm truncate ${currentTrack?.id === track.id ? 'text-theme-300' : ''}`}>
                  {track.name}
                </span>
                <span className="text-xs text-white/40">{formatDuration(track.duration)}</span>
                <button
                  onClick={() => onDeleteTrack(track.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all text-white/40"
                  title="Remove track"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface PlaylistRowProps {
  playlist: DownloadedPlaylist
  onChanged: () => void
  onPlay: (tracks: DownloadedTrack[], startIndex: number, name: string) => void
  offlineMode?: boolean
}

function PlaylistRow({ playlist, onChanged, onPlay, offlineMode }: PlaylistRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const currentTrack = useMusicPlayer(s => s.currentTrack)
  const isPlaying = useMusicPlayer(s => s.isPlaying)
  const { getImageUrl } = useJellyfin()

  const tracks = getDownloadedPlaylistTracks(playlist.id)
  const missing = playlist.trackIds.length - tracks.length

  const handleDelete = async () => {
    setDeleting(true)
    await deleteDownloadedPlaylist(playlist.id)
    onChanged()
    setDeleting(false)
  }

  const handleToggleAutoSync = () => {
    setPlaylistAutoSync(playlist.id, !playlist.autoSync)
    onChanged()
  }

  const lastSynced = playlist.lastSyncedAt
    ? new Date(playlist.lastSyncedAt).toLocaleString()
    : 'never'

  return (
    <div className="bg-white/5 rounded-xl overflow-hidden border border-white/10">
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-shrink-0 text-white/40 hover:text-white transition-colors"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-white/10">
          {(playlist.localImagePath || getImageUrl(playlist.id, 'Primary', 120)) ? (
            <LocalOrRemoteImage
              localPath={playlist.localImagePath}
              remoteUrl={getImageUrl(playlist.id, 'Primary', 120)}
              alt={playlist.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ListMusic size={16} className="text-white/30" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0" onClick={() => setExpanded(!expanded)}>
          <p className="font-medium truncate text-sm cursor-pointer">{playlist.name}</p>
          <p className="text-xs text-white/50 truncate">
            {tracks.length} of {playlist.trackIds.length} tracks
            {missing > 0 ? ` · ${missing} pending` : ''}
            {' · '}
            {formatBytes(tracks.reduce((sum, t) => sum + t.fileSize, 0))}
          </p>
          <p className="text-xs text-white/35 truncate">
            {playlist.autoSync ? `Auto-updating · last checked ${lastSynced}` : 'Auto-update off'}
            {playlist.syncError ? ` · ${playlist.syncError}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleToggleAutoSync}
            className={`p-2 rounded-full transition-colors ${
              playlist.autoSync
                ? 'text-green-400 hover:bg-green-500/20'
                : 'text-white/30 hover:bg-white/10 hover:text-white/60'
            }`}
            title={playlist.autoSync
              ? 'Auto-update on — checks the server for changes when the app comes back online'
              : 'Auto-update off — click to keep this playlist in sync'}
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => onPlay(tracks, 0, playlist.name)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white"
            title="Play playlist"
            disabled={tracks.length === 0}
          >
            <Play size={16} fill="currentColor" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-2 hover:bg-red-500/20 rounded-full transition-colors text-white/40 hover:text-red-400"
            title="Remove download"
          >
            {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
        </div>
      </div>

      {expanded && tracks.length > 0 && (
        <div className="border-t border-white/10">
          {tracks.map((track, index) => {
            const isCurrent = currentTrack?.id === track.id
            return (
              <div
                key={track.id}
                className={`flex items-center gap-3 px-4 py-2 hover:bg-white/5 group transition-colors ${
                  isCurrent ? 'bg-theme-500/10' : ''
                }`}
              >
                <span className="w-6 text-center text-xs text-white/30 group-hover:hidden">
                  {index + 1}
                </span>
                <button
                  onClick={() => onPlay(tracks, index, playlist.name)}
                  className="w-6 text-center hidden group-hover:flex items-center justify-center text-white/60 hover:text-white"
                >
                  {isCurrent && isPlaying
                    ? <Pause size={14} fill="currentColor" />
                    : <Play size={14} fill="currentColor" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${isCurrent ? 'text-theme-300' : ''}`}>{track.name}</p>
                  <p className="text-xs text-white/40 truncate">
                    {track.artists.join(', ')} · {track.albumName}
                  </p>
                </div>
                <span className="text-xs text-white/40">{formatDuration(track.duration)}</span>
              </div>
            )
          })}
        </div>
      )}

      {expanded && tracks.length === 0 && (
        <div className="border-t border-white/10 px-4 py-3 text-xs text-white/40">
          {offlineMode
            ? 'No tracks downloaded yet — reconnect to finish this playlist.'
            : 'No tracks downloaded yet.'}
        </div>
      )}
    </div>
  )
}

interface QueueItemRowProps {
  item: MusicDownloadQueueItem
  onCancel: (id: string) => void
  onRetry: (id: string) => void
}

function QueueItemRow({ item, onCancel, onRetry }: QueueItemRowProps) {
  const statusColor = {
    queued: 'text-white/40',
    downloading: 'text-blue-400',
    paused: 'text-yellow-400',
    completed: 'text-green-400',
    failed: 'text-red-400',
  }[item.status]

  const StatusIcon = {
    queued: () => <div className="w-3 h-3 rounded-full border border-white/30" />,
    downloading: () => <Loader2 size={14} className="animate-spin text-blue-400" />,
    paused: () => <Pause size={14} />,
    completed: () => <CheckCircle2 size={14} className="text-green-400" />,
    failed: () => <AlertCircle size={14} className="text-red-400" />,
  }[item.status]

  return (
    <div className="flex items-center gap-3 py-2 px-3 hover:bg-white/5 rounded-lg group transition-colors">
      <span className={statusColor}>
        <StatusIcon />
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{item.trackName}</p>
        <p className="text-xs text-white/40 truncate">{item.albumName}</p>
        {item.status === 'downloading' && item.totalBytes > 0 && (
          <div className="mt-1 h-0.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}
        {item.error && (
          <p className="text-xs text-red-400 mt-0.5">{item.error}</p>
        )}
      </div>

      {item.status === 'failed' ? (
        <button
          onClick={() => onRetry(item.id)}
          className="opacity-0 group-hover:opacity-100 text-xs text-blue-400 hover:text-blue-300 transition-all"
        >
          Retry
        </button>
      ) : item.status !== 'completed' && (
        <button
          onClick={() => onCancel(item.id)}
          className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-red-400 transition-all"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

interface AlbumDownloadRowProps {
  progress: AlbumDownloadProgress
  onCancel: (albumId: string) => void
}

function AlbumDownloadRow({ progress, onCancel }: AlbumDownloadRowProps) {
  const pct = progress.totalTracks > 0
    ? Math.round((progress.completedTracks / progress.totalTracks) * 100)
    : 0

  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-white/5 rounded-lg">
      <Loader2 size={14} className="animate-spin text-theme-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{progress.albumName}</p>
        <p className="text-xs text-white/50">{progress.artist}</p>
        <div className="mt-1 flex items-center gap-2">
          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-theme-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-white/40 flex-shrink-0">
            {progress.completedTracks}/{progress.totalTracks}
          </span>
        </div>
      </div>
      <button
        onClick={() => onCancel(progress.albumId)}
        className="p-1 text-white/40 hover:text-red-400 transition-colors"
        title="Cancel"
      >
        <X size={14} />
      </button>
    </div>
  )
}

interface PlaylistDownloadRowProps {
  progress: PlaylistDownloadProgress
  onCancel: (playlistId: string) => void
}

function PlaylistDownloadRow({ progress, onCancel }: PlaylistDownloadRowProps) {
  const pct = progress.totalTracks > 0
    ? Math.round((progress.completedTracks / progress.totalTracks) * 100)
    : 0

  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-white/5 rounded-lg">
      {progress.status === 'failed'
        ? <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
        : <Loader2 size={14} className="animate-spin text-theme-400 flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{progress.name}</p>
        <p className="text-xs text-white/50">Playlist</p>
        <div className="mt-1 flex items-center gap-2">
          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${progress.status === 'failed' ? 'bg-red-500' : 'bg-theme-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-white/40 flex-shrink-0">
            {progress.completedTracks}/{progress.totalTracks}
          </span>
        </div>
        {progress.error && <p className="text-xs text-red-400 mt-0.5">{progress.error}</p>}
      </div>
      <button
        onClick={() => onCancel(progress.playlistId)}
        className="p-1 text-white/40 hover:text-red-400 transition-colors"
        title="Cancel"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function MusicDownloads({ offlineMode }: { offlineMode?: boolean } = {}) {
  const setQueue = useMusicPlayer(s => s.setQueue)
  const toggle = useMusicPlayer(s => s.toggle)
  const currentTrack = useMusicPlayer(s => s.currentTrack)
  const isPlaying = useMusicPlayer(s => s.isPlaying)
  const [albums, setAlbums] = useState<DownloadedAlbum[]>([])
  const [tracks, setTracks] = useState<DownloadedTrack[]>([])
  const [queue, setQueueState] = useState<MusicDownloadQueueItem[]>([])
  const [albumProgress, setAlbumProgress] = useState<AlbumDownloadProgress[]>([])
  const [playlists, setPlaylists] = useState<DownloadedPlaylist[]>([])
  const [playlistProgress, setPlaylistProgress] = useState<PlaylistDownloadProgress[]>([])
  const [isSyncing, setIsSyncing] = useState(false)

  const refresh = useCallback(() => {
    setAlbums(getDownloadedAlbums())
    setTracks(getDownloadedTracks())
    setQueueState(getMusicDownloadQueue())
    setAlbumProgress(getAlbumDownloadProgress())
    setPlaylists(getDownloadedPlaylists())
    setPlaylistProgress(getPlaylistDownloadProgress())
  }, [])

  useEffect(() => {
    refresh()
    const unsub = subscribeToMusicDownloadUpdates((q, ap, pp) => {
      setQueueState(q)
      setAlbumProgress(ap)
      setPlaylistProgress(pp)
      setAlbums(getDownloadedAlbums())
      setTracks(getDownloadedTracks())
      setPlaylists(getDownloadedPlaylists())
    })
    return unsub
  }, [refresh])

  const handleSyncPlaylists = useCallback(async () => {
    setIsSyncing(true)
    await syncDownloadedPlaylists().catch(() => {})
    refresh()
    setIsSyncing(false)
  }, [refresh])

  const handlePlayPlaylist = useCallback((
    playlistTracks: DownloadedTrack[], startIndex: number, name: string,
  ) => {
    if (playlistTracks.length === 0) return
    setQueue(playlistTracks.map(downloadedTrackToTrack), startIndex, name)
  }, [setQueue])

  const handlePlayAlbum = useCallback((albumTracks: DownloadedTrack[]) => {
    const playerTracks = albumTracks.map(downloadedTrackToTrack)
    setQueue(playerTracks, 0, playerTracks[0]?.albumName)
  }, [setQueue])

  const handlePlayTrack = useCallback((track: DownloadedTrack, albumTracks: DownloadedTrack[]) => {
    if (currentTrack?.id === track.id) {
      toggle()
      return
    }
    const playerTracks = albumTracks.map(downloadedTrackToTrack)
    const index = albumTracks.findIndex(t => t.id === track.id)
    setQueue(playerTracks, index, playerTracks[0]?.albumName)
  }, [setQueue, currentTrack, toggle])

  const handleDeleteAlbum = useCallback((_albumId: string) => {
    refresh()
  }, [refresh])

  const handleDeleteTrack = useCallback(async (trackId: string) => {
    await deleteDownloadedTrack(trackId)
    refresh()
  }, [refresh])

  const handleCancelQueueItem = useCallback((trackId: string) => {
    removeTrackFromQueue(trackId)
  }, [])

  const handleCancelAlbumDownload = useCallback((albumId: string) => {
    cancelAlbumDownload(albumId)
  }, [])

  const handleRetry = useCallback((trackId: string) => {
    retryMusicDownload(trackId)
  }, [])

  const stats = getMusicDownloadStats()
  // Tracks belonging to an album or playlist download are represented by that
  // download's own aggregate row, so they must not be listed a second time here
  const activeQueue = queue.filter(
    q => q.status !== 'completed' && !q.isPartOfAlbumDownload && !q.playlistDownloadId
  )
  const hasContent = albums.length > 0 || playlists.length > 0 ||
    albumProgress.length > 0 || playlistProgress.length > 0 || activeQueue.length > 0

  return (
    <div className="p-6 space-y-6">
      {/* Header + Stats */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <Download size={24} className="text-theme-400" />
          <h1 className="text-2xl font-bold">
            {offlineMode ? 'Available Offline' : 'Downloads'}
          </h1>
        </div>

        <div className="ml-auto flex items-center gap-4 text-sm text-white/50">
          {stats.totalTracks > 0 && (
            <>
              <span className="flex items-center gap-1.5">
                <HardDrive size={14} />
                {formatBytes(stats.totalSize)}
              </span>
              <span>{stats.totalAlbums} albums</span>
              {stats.totalPlaylists > 0 && <span>{stats.totalPlaylists} playlists</span>}
              <span>{stats.totalTracks} tracks</span>
            </>
          )}
          {!offlineMode && playlists.length > 0 && (
            <button
              onClick={handleSyncPlaylists}
              disabled={isSyncing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20
                text-white/70 hover:text-white transition-colors disabled:opacity-50"
              title="Check the server for playlist changes now"
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : undefined} />
              {isSyncing ? 'Syncing…' : 'Sync playlists'}
            </button>
          )}
        </div>
      </div>

      {/* Active Downloads — hidden in offline mode (server unreachable, can't start new ones) */}
      {!offlineMode && (albumProgress.length > 0 || playlistProgress.length > 0 || activeQueue.length > 0) && (
        <section>
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
            Downloading
          </h2>
          <div className="space-y-2">
            {albumProgress.map(ap => (
              <AlbumDownloadRow
                key={ap.albumId}
                progress={ap}
                onCancel={handleCancelAlbumDownload}
              />
            ))}
            {playlistProgress.map(pp => (
              <PlaylistDownloadRow
                key={pp.playlistId}
                progress={pp}
                onCancel={cancelPlaylistDownload}
              />
            ))}
            {activeQueue.map(item => (
              <QueueItemRow
                key={item.id}
                item={item}
                onCancel={handleCancelQueueItem}
                onRetry={handleRetry}
              />
            ))}
          </div>
        </section>
      )}

      {/* Downloaded playlists */}
      {playlists.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
            Downloaded Playlists
          </h2>
          <div className="space-y-2">
            {playlists.map(playlist => (
              <PlaylistRow
                key={playlist.id}
                playlist={playlist}
                onChanged={refresh}
                onPlay={handlePlayPlaylist}
                offlineMode={offlineMode}
              />
            ))}
          </div>
        </section>
      )}

      {/* Downloaded albums */}
      {albums.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
            Downloaded Albums
          </h2>
          <div className="space-y-2">
            {albums.map(album => (
              <AlbumRow
                key={album.id}
                album={album}
                tracks={tracks}
                onDelete={handleDeleteAlbum}
                onPlayAlbum={handlePlayAlbum}
                onPlayTrack={handlePlayTrack}
                onDeleteTrack={handleDeleteTrack}
              />
            ))}
          </div>
        </section>
      )}

      {/* Individual tracks not in an album */}
      {(() => {
        // Tracks pulled in by a playlist download are listed under that playlist,
        // so only genuinely standalone tracks belong in this section
        const orphanTracks = tracks.filter(t =>
          !albums.some(a => a.trackIds.includes(t.id)) &&
          !playlists.some(p => p.trackIds.includes(t.id))
        )
        if (orphanTracks.length === 0) return null
        return (
          <section>
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
              Individual Tracks
            </h2>
            <div className="bg-white/5 rounded-xl overflow-hidden border border-white/10">
              {orphanTracks.map((track) => (
                <div
                  key={track.id}
                  className={`flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 group transition-colors border-b border-white/5 last:border-0 ${
                    currentTrack?.id === track.id ? 'bg-theme-500/10' : ''
                  }`}
                >
                  <button
                    onClick={() => handlePlayTrack(track, orphanTracks)}
                    className="p-1 text-white/40 hover:text-white transition-colors"
                  >
                    {currentTrack?.id === track.id && isPlaying
                      ? <Pause size={14} fill="currentColor" />
                      : <Play size={14} fill="currentColor" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${currentTrack?.id === track.id ? 'text-theme-300' : ''}`}>
                      {track.name}
                    </p>
                    <p className="text-xs text-white/40 truncate">
                      {track.artists.join(', ')} · {track.albumName}
                    </p>
                  </div>
                  <span className="text-xs text-white/40">{formatDuration(track.duration)}</span>
                  <button
                    onClick={() => handleDeleteTrack(track.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-red-400 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )
      })()}

      {/* Empty state */}
      {!hasContent && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Download size={48} className="text-white/20 mb-4" />
          <p className="text-white/60 text-lg font-medium mb-2">No downloads yet</p>
          <p className="text-white/40 text-sm max-w-sm">
            Download albums, playlists or single tracks for offline listening. Look for the download
            button on an album or playlist page, and in the player bar. Downloaded playlists keep
            themselves up to date whenever the app comes back online.
          </p>
        </div>
      )}
    </div>
  )
}
