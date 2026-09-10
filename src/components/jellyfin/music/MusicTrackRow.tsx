import React, { useEffect, useState } from 'react'
import {
  Play, MoreHorizontal, Heart, Download, Check, Loader2,
  ListPlus, ListEnd, Disc, User as UserIcon
} from 'lucide-react'
import { useJellyfin, type BaseItemDto } from '../JellyfinContext'
import { useMusicPlayer, formatTime, ticksToSeconds, type Track } from '../../../stores/musicPlayerStore'
import { MusicContextMenu, useContextMenu, type ContextMenuItem } from './MusicContextMenu'
import { dtoToTrack, setFavorite } from './musicQueueHelpers'
import {
  addTrackToQueue,
  isTrackDownloaded,
  isTrackInQueue,
  subscribeToMusicDownloadUpdates,
  type MusicDownloadQueueItem
} from '../../../utils/musicDownloadManager'

interface MusicTrackRowProps {
  track: BaseItemDto
  index: number
  showAlbum?: boolean
  showArtist?: boolean
  isCompact?: boolean
  albumId?: string
  albumName?: string
  onPlay: () => void
  onNavigateToAlbum?: () => void
  onNavigateToArtist?: () => void
}

export function MusicTrackRow({
  track,
  index,
  showAlbum = false,
  showArtist = true,
  isCompact = false,
  albumId,
  albumName,
  onPlay,
  onNavigateToAlbum,
  onNavigateToArtist
}: MusicTrackRowProps) {
  const { serverUrl, accessToken, serverId, user } = useJellyfin()
  // Granular selectors — a bare useMusicPlayer() would re-render every row
  // ~4x/second during playback (currentTime updates hit all subscribers)
  const isCurrentTrack = useMusicPlayer(s => s.currentTrack?.id === track.Id)
  const isCurrentPlaying = useMusicPlayer(s => s.isPlaying && s.currentTrack?.id === track.Id)
  const toggle = useMusicPlayer(s => s.toggle)
  const addToQueue = useMusicPlayer(s => s.addToQueue)
  const { menuPosition, openAt, close: closeMenu } = useContextMenu()

  const [isDownloaded, setIsDownloaded] = useState(false)
  const [downloadQueueItem, setDownloadQueueItem] = useState<MusicDownloadQueueItem | null>(null)
  const [isFavorite, setIsFavorite] = useState(!!track.UserData?.IsFavorite)

  // Keep favorite state in sync when the item data refreshes
  useEffect(() => {
    setIsFavorite(!!track.UserData?.IsFavorite)
  }, [track.Id, track.UserData?.IsFavorite])

  // Check download status
  useEffect(() => {
    if (track.Id) {
      setIsDownloaded(isTrackDownloaded(track.Id))
      setDownloadQueueItem(isTrackInQueue(track.Id))
    }

    // Subscribe to download updates
    const unsubscribe = subscribeToMusicDownloadUpdates((queue) => {
      if (track.Id) {
        const queueItem = queue.find(q => q.id === track.Id)
        setDownloadQueueItem(queueItem || null)
        if (!queueItem) {
          setIsDownloaded(isTrackDownloaded(track.Id))
        }
      }
    })

    return unsubscribe
  }, [track.Id])

  const durationSeconds = track.RunTimeTicks ? ticksToSeconds(track.RunTimeTicks) : 0

  const handleClick = () => {
    if (isCurrentTrack) {
      toggle()
    } else {
      onPlay()
    }
  }

  // Track object for queue/download actions (with album overrides from props)
  const toTrackData = (): Track => {
    const t = dtoToTrack(track, serverUrl)
    return {
      ...t,
      albumId: albumId || t.albumId,
      albumName: albumName || t.albumName,
      imageUrl: serverUrl && (albumId || track.AlbumId)
        ? `${serverUrl}/Items/${albumId || track.AlbumId}/Images/Primary?maxWidth=300&quality=90`
        : t.imageUrl,
    }
  }

  const handleDownload = () => {
    if (!track.Id || !serverUrl || !serverId || !accessToken) return
    addTrackToQueue(toTrackData(), serverUrl, serverId, accessToken)
  }

  const handleToggleFavorite = () => {
    if (!track.Id || !serverUrl || !accessToken || !user?.Id) return
    const newState = !isFavorite
    setIsFavorite(newState)  // Optimistic
    setFavorite(serverUrl, accessToken, user.Id, track.Id, newState).catch(() => {
      setIsFavorite(!newState)  // Revert on failure
    })
  }

  const menuItems: ContextMenuItem[] = [
    { label: 'Play next', icon: ListPlus, onClick: () => addToQueue([toTrackData()], 'next') },
    { label: 'Add to queue', icon: ListEnd, onClick: () => addToQueue([toTrackData()], 'end') },
    {
      label: isFavorite ? 'Remove from Liked Songs' : 'Add to Liked Songs',
      icon: Heart,
      onClick: handleToggleFavorite,
      disabled: !user?.Id,
      separator: true,
    },
    ...(onNavigateToAlbum ? [{ label: 'Go to album', icon: Disc, onClick: onNavigateToAlbum, separator: true } as ContextMenuItem] : []),
    ...(onNavigateToArtist ? [{ label: 'Go to artist', icon: UserIcon, onClick: onNavigateToArtist, separator: !onNavigateToAlbum } as ContextMenuItem] : []),
    {
      label: isDownloaded ? 'Downloaded' : downloadQueueItem ? 'Downloading…' : 'Download',
      icon: isDownloaded ? Check : Download,
      onClick: handleDownload,
      disabled: isDownloaded || !!downloadQueueItem,
      separator: true,
    },
  ]

  const imageUrl = showAlbum && serverUrl && track.AlbumId
    ? `${serverUrl}/Items/${track.AlbumId}/Images/Primary?maxWidth=80&quality=90`
    : null

  return (
    <div
      onClick={handleClick}
      onContextMenu={openAt}
      className={`group flex items-center gap-3 px-4 ${isCompact ? 'py-2 phone:py-2.5' : 'py-2.5 phone:py-3'} rounded-md cursor-pointer
        ${isCurrentTrack ? 'bg-white/10' : 'hover:bg-white/5'}
        transition-colors`}
    >
      {/* Track number / Play indicator */}
      <div className="w-8 flex items-center justify-center flex-shrink-0">
        {isCurrentPlaying ? (
          <div className="flex items-end gap-0.5 h-4">
            <div className="w-1 bg-theme-500 animate-music-bar-1" />
            <div className="w-1 bg-theme-500 animate-music-bar-2" />
            <div className="w-1 bg-theme-500 animate-music-bar-3" />
          </div>
        ) : (
          <>
            <span className={`text-sm tabular-nums group-hover:hidden ${
              isCurrentTrack ? 'text-theme-400' : 'text-white/50'
            }`}>
              {index}
            </span>
            <Play
              size={16}
              fill="currentColor"
              className={`hidden group-hover:block ${
                isCurrentTrack ? 'text-theme-400' : 'text-white'
              }`}
            />
          </>
        )}
      </div>

      {/* Album art (optional) */}
      {showAlbum && (
        <div className="w-10 h-10 rounded overflow-hidden bg-white/5 flex-shrink-0">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={track.Album || ''}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-theme-900/50 to-pink-900/50" />
          )}
        </div>
      )}

      {/* Track info */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${
          isCurrentTrack ? 'text-theme-400 font-medium' : 'text-white'
        }`}>
          {track.Name}
        </p>
        {showArtist && (
          <p className="text-xs text-white/60 truncate">
            {track.Artists?.length
              ? (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    onNavigateToArtist?.()
                  }}
                  className="hover:text-white hover:underline cursor-pointer"
                >
                  {track.Artists.join(', ')}
                </span>
              )
              : track.AlbumArtist || 'Unknown Artist'
            }
          </p>
        )}
      </div>

      {/* Album name (optional) */}
      {showAlbum && track.Album && (
        <div className="hidden md:block w-48 min-w-0">
          <p
            onClick={(e) => {
              e.stopPropagation()
              onNavigateToAlbum?.()
            }}
            className="text-sm text-white/60 truncate hover:text-white hover:underline cursor-pointer"
          >
            {track.Album}
          </p>
        </div>
      )}

      {/* Heart — always visible when liked, appears on hover otherwise (touch: reachable via ⋯ menu too) */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          handleToggleFavorite()
        }}
        disabled={!user?.Id}
        className={`p-2 -m-0.5 transition-all ${
          isFavorite
            ? 'text-theme-400 hover:text-theme-300 opacity-100'
            : 'text-white/60 hover:text-white opacity-0 group-hover:opacity-100'
        }`}
        title={isFavorite ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
      >
        <Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>

      {/* Download indicator (hover reveal; action also in ⋯ menu) */}
      {isDownloaded ? (
        <span className="p-1.5 text-green-400" title="Downloaded">
          <Check size={16} />
        </span>
      ) : downloadQueueItem ? (
        <span className="p-1.5 text-theme-400" title={`Downloading${downloadQueueItem.status === 'downloading' ? '...' : ' (queued)'}`}>
          <Loader2 size={16} className={downloadQueueItem.status === 'downloading' ? 'animate-spin' : ''} />
        </span>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); handleDownload() }}
          className="p-1.5 text-white/60 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
          title="Download track"
        >
          <Download size={16} />
        </button>
      )}

      {/* Duration */}
      <span className="text-sm text-white/50 tabular-nums w-12 text-right">
        {formatTime(durationSeconds)}
      </span>

      {/* More options — always visible so it works on touch (44px target on phone) */}
      <button
        onClick={openAt}
        className="p-2 phone:p-2.5 -m-0.5 text-white/40 hover:text-white transition-colors"
        title="More options"
      >
        <MoreHorizontal size={18} />
      </button>

      {menuPosition && (
        <MusicContextMenu items={menuItems} position={menuPosition} onClose={closeMenu} />
      )}
    </div>
  )
}

// CSS for music bars animation (add to your global CSS or Tailwind config)
// @keyframes music-bar-1 { 0%, 100% { height: 4px; } 50% { height: 16px; } }
// @keyframes music-bar-2 { 0%, 100% { height: 8px; } 50% { height: 12px; } }
// @keyframes music-bar-3 { 0%, 100% { height: 12px; } 50% { height: 6px; } }
