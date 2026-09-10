import React from 'react'
import { SkipBack, SkipForward } from 'lucide-react'
import type { BaseItemDto } from '../../JellyfinContext'

interface SkipEpisodeButtonsProps {
  previousEpisode: BaseItemDto | null
  nextEpisode: BaseItemDto | null
  onPlayPrevious: () => void
  onPlayNext: () => void
  hasPlayNext: boolean
}

const SkipEpisodeButtons: React.FC<SkipEpisodeButtonsProps> = ({
  previousEpisode,
  nextEpisode,
  onPlayPrevious,
  onPlayNext,
  hasPlayNext,
}) => (
  <>
    {previousEpisode && hasPlayNext && (
      <button
        onClick={onPlayPrevious}
        className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
        title={`Previous: ${previousEpisode.Name}`}
      >
        <SkipBack size={22} className="text-white" />
      </button>
    )}
    {nextEpisode && hasPlayNext && (
      <button
        onClick={onPlayNext}
        className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
        title={`Next: ${nextEpisode.Name}`}
      >
        <SkipForward size={22} className="text-white" />
      </button>
    )}
  </>
)

// Only export individual wrappers
export const PrevEpisodeButton: React.FC<Pick<SkipEpisodeButtonsProps, 'previousEpisode' | 'onPlayPrevious' | 'hasPlayNext'>> = React.memo(
  ({ previousEpisode, onPlayPrevious, hasPlayNext }) => {
    if (!previousEpisode || !hasPlayNext) return null
    return (
      <button
        onClick={onPlayPrevious}
        className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
        title={`Previous: ${previousEpisode.Name}`}
      >
        <SkipBack size={22} className="text-white" />
      </button>
    )
  }
)

export const NextEpisodeButton: React.FC<Pick<SkipEpisodeButtonsProps, 'nextEpisode' | 'onPlayNext' | 'hasPlayNext'>> = React.memo(
  ({ nextEpisode, onPlayNext, hasPlayNext }) => {
    if (!nextEpisode || !hasPlayNext) return null
    return (
      <button
        onClick={onPlayNext}
        className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
        title={`Next: ${nextEpisode.Name}`}
      >
        <SkipForward size={22} className="text-white" />
      </button>
    )
  }
)

export default React.memo(SkipEpisodeButtons)
