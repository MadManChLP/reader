import React from 'react'
import { Play, User } from 'lucide-react'
import { useJellyfin, type BaseItemDto } from '../../JellyfinContext'

interface ArtistCardProps {
  artist: BaseItemDto
  onClick: () => void
  onPlay: () => void
  /** Fills the parent grid cell instead of the fixed slider width */
  fluid?: boolean
}

export function ArtistCard({ artist, onClick, onPlay, fluid = false }: ArtistCardProps) {
  const { getImageUrl } = useJellyfin()

  const imageUrl = artist.Id
    ? getImageUrl(artist.Id, 'Primary', 300)
    : null

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    onPlay()
  }

  return (
    <div
      onClick={onClick}
      className={`group ${fluid ? 'w-full' : 'w-44'} flex-shrink-0 cursor-pointer text-center`}
    >
      {/* Artist image - circular */}
      <div className="relative aspect-square rounded-full overflow-hidden bg-white/5 mb-3 shadow-lg mx-auto">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={artist.Name || 'Artist'}
            className="w-full h-full object-cover transition-all duration-300 group-hover:scale-105 group-hover:brightness-75"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
            <User size={48} className="text-white/30" />
          </div>
        )}

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
        {artist.Name}
      </h3>
      <p className="text-xs text-white/60">
        Artist
      </p>
    </div>
  )
}
