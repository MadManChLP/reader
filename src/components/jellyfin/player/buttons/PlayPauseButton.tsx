import React from 'react'
import { Play, Pause } from 'lucide-react'

interface PlayPauseButtonProps {
  isPlaying: boolean
  onToggle: () => void
}

const PlayPauseButton: React.FC<PlayPauseButtonProps> = ({ isPlaying, onToggle }) => (
  <button
    onClick={onToggle}
    className="p-3 mx-1 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
  >
    {isPlaying ? (
      <Pause size={32} className="text-white" fill="white" />
    ) : (
      <Play size={32} className="text-white" fill="white" />
    )}
  </button>
)

export default React.memo(PlayPauseButton)
