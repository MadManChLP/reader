import React, { memo, useCallback } from 'react'
import { Play, Disc3, MoreHorizontal, ListPlus, ListEnd } from 'lucide-react'
import { useJellyfin, type BaseItemDto } from '../../JellyfinContext'
import { useMusicPlayer } from '../../../../stores/musicPlayerStore'
import { MusicContextMenu, useContextMenu, type ContextMenuItem } from '../MusicContextMenu'
import { fetchContainerTracks } from '../musicQueueHelpers'

interface AlbumCardProps {
  album: BaseItemDto
  onClick: () => void
  onPlay: () => void
  /** 'fluid' fills the parent grid cell; fixed widths are for horizontal sliders */
  size?: 'normal' | 'small' | 'fluid'
}

export const AlbumCard = memo(function AlbumCard({ album, onClick, onPlay, size = 'normal' }: AlbumCardProps) {
  const { getImageUrl, api, user, serverUrl } = useJellyfin()
  const addToQueue = useMusicPlayer((state) => state.addToQueue)
  // longPressHandlers: the ⋯ button below is hover-revealed, so phones reach
  // the menu via long-press instead (no-op spread on desktop)
  const { menuPosition, openAt, close: closeMenu, longPressHandlers } = useContextMenu()

  // Use lower quality for grid views to improve performance
  const imageUrl = album.Id
    ? getImageUrl(album.Id, 'Primary', size === 'small' ? 200 : 250)
    : null

  const handlePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onPlay()
  }, [onPlay])

  const queueAlbum = useCallback(async (position: 'next' | 'end') => {
    if (!api || !user?.Id || !album.Id) return
    try {
      const tracks = await fetchContainerTracks(api, user.Id, album, serverUrl)
      if (tracks.length > 0) addToQueue(tracks, position)
    } catch (e) {
      console.error('Failed to queue album:', e)
    }
  }, [api, user?.Id, album, serverUrl, addToQueue])

  const menuItems: ContextMenuItem[] = [
    { label: 'Play', icon: Play, onClick: onPlay },
    { label: 'Play next', icon: ListPlus, onClick: () => void queueAlbum('next'), separator: true },
    { label: 'Add to queue', icon: ListEnd, onClick: () => void queueAlbum('end') },
  ]

  const cardSize = size === 'small' ? 'w-36' : size === 'fluid' ? 'w-full' : 'w-44'

  return (
    <div
      onClick={onClick}
      onContextMenu={openAt}
      {...longPressHandlers}
      className={`group ${cardSize} flex-shrink-0 cursor-pointer`}
    >
      {/* Album art */}
      <div className="relative aspect-square rounded-lg overflow-hidden bg-white/5 mb-3 shadow-lg">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={album.Name || 'Album'}
            className="w-full h-full object-cover transition-all duration-300 group-hover:scale-105 group-hover:brightness-75"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
            <Disc3 size={48} className="text-white/30" />
          </div>
        )}

        {/* More options — bottom left, mirrors the play overlay */}
        <button
          onClick={openAt}
          className="absolute bottom-2 left-2 p-2.5 bg-black/60 backdrop-blur-sm rounded-full text-white/90 shadow-xl
            opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0
            transition-all duration-200 hover:bg-black/80"
          title="More options"
        >
          <MoreHorizontal size={18} />
        </button>

        {/* Play button overlay */}
        <button
          onClick={handlePlay}
          className="absolute bottom-2 right-2 p-3 bg-theme-500 rounded-full text-white shadow-xl
            opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0
            transition-all duration-200 hover:scale-105 hover:bg-theme-400"
        >
          <Play size={20} fill="currentColor" />
        </button>
      </div>

      {/* Info */}
      <h3 className="text-sm font-medium text-white truncate">
        {album.Name}
      </h3>
      <p className="text-xs text-white/60 truncate">
        {album.AlbumArtist || album.Artists?.join(', ') || 'Unknown Artist'}
      </p>

      {menuPosition && (
        <MusicContextMenu items={menuItems} position={menuPosition} onClose={closeMenu} />
      )}
    </div>
  )
})
