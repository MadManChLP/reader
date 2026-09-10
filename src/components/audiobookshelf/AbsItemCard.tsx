import React, { memo, useCallback } from 'react'
import { Play, BookAudio, Mic } from 'lucide-react'
import type { AbsLibraryItem } from '../../types/audiobookshelf'
import { getItemAuthor, getItemTitle } from './absHelpers'

interface AbsItemCardProps {
  item: AbsLibraryItem
  coverUrl: string | null
  /** 0..1 listening progress (undefined = no progress bar) */
  progress?: number
  onClick: () => void
  onPlay?: () => void
}

export const AbsItemCard = memo(function AbsItemCard({ item, coverUrl, progress, onClick, onPlay }: AbsItemCardProps) {
  const isPodcast = item.mediaType === 'podcast'

  const handlePlay = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onPlay?.()
    },
    [onPlay],
  )

  return (
    <div onClick={onClick} className="group w-40 flex-shrink-0 cursor-pointer">
      <div className="relative aspect-square rounded-lg overflow-hidden bg-white/5 mb-3 shadow-lg">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={getItemTitle(item)}
            className="w-full h-full object-cover transition-all duration-300 group-hover:scale-105 group-hover:brightness-75"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-red-900/50">
            {isPodcast ? <Mic size={40} className="text-white/30" /> : <BookAudio size={40} className="text-white/30" />}
          </div>
        )}

        {onPlay && (
          <button
            onClick={handlePlay}
            className="absolute bottom-2 right-2 p-3 bg-theme-500 rounded-full text-white shadow-xl
              opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0
              transition-all duration-200 hover:scale-105 hover:bg-theme-400"
          >
            <Play size={18} fill="currentColor" />
          </button>
        )}

        {progress !== undefined && progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
            <div
              className="h-full bg-theme-500"
              style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
            />
          </div>
        )}
      </div>

      <h3 className="text-sm font-medium text-white truncate">{getItemTitle(item)}</h3>
      <p className="text-xs text-white/60 truncate">{getItemAuthor(item) || (isPodcast ? 'Podcast' : '')}</p>
    </div>
  )
})
