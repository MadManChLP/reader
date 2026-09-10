import React, { memo } from 'react'
import { useShallow } from 'zustand/shallow'
import { Play, Pause, SkipBack, SkipForward, Music, X } from 'lucide-react'
import { useMusicPlayer, formatTime } from '../stores/musicPlayerStore'

interface MusicMiniPlayerProps {
  onSwitchToMusic: () => void
}

export const MusicMiniPlayer = memo(function MusicMiniPlayer({ onSwitchToMusic }: MusicMiniPlayerProps) {
  // Shows a progress bar, so currentTime is needed (4x/sec while playing);
  // useShallow still skips re-renders from queue/lyrics/volume churn.
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    toggle,
    next,
    previous,
    seek,
    clearQueue,
  } = useMusicPlayer(useShallow(s => ({
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    currentTime: s.currentTime,
    duration: s.duration,
    toggle: s.toggle,
    next: s.next,
    previous: s.previous,
    seek: s.seek,
    clearQueue: s.clearQueue,
  })))

  if (!currentTrack) return null

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = (e.clientX - rect.left) / rect.width
    seek(pos * duration)
  }

  return (
    <div className="flex-shrink-0 h-12 bg-black/80 backdrop-blur-md border-b phone:border-b-0 phone:border-t border-white/10 flex items-center px-4 gap-3">
      {/* Track info - clickable to go to music view */}
      <button
        onClick={onSwitchToMusic}
        className="flex items-center gap-2 min-w-0 flex-shrink hover:opacity-80 transition-opacity"
        title="Open JellyMusic"
      >
        <div className="w-7 h-7 flex-shrink-0 rounded bg-white/10 flex items-center justify-center overflow-hidden">
          {currentTrack.imageUrl ? (
            <img
              src={currentTrack.imageUrl}
              alt={currentTrack.albumName}
              className="w-full h-full object-cover"
            />
          ) : (
            <Music size={12} className="text-white/40" />
          )}
        </div>
        <div className="min-w-0 hidden sm:block phone:block">
          <p className="text-xs font-medium text-white truncate max-w-[140px]">{currentTrack.name}</p>
          <p className="text-[10px] text-white/50 truncate max-w-[140px]">{currentTrack.artists.join(', ')}</p>
        </div>
      </button>

      {/* Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={previous}
          className="p-1.5 text-white/60 hover:text-white transition-colors"
        >
          <SkipBack size={14} fill="currentColor" />
        </button>

        <button
          onClick={toggle}
          className="p-1.5 bg-white rounded-full text-black hover:scale-105 transition-transform"
        >
          {isPlaying ? (
            <Pause size={14} fill="currentColor" />
          ) : (
            <Play size={14} fill="currentColor" className="ml-px" />
          )}
        </button>

        <button
          onClick={next}
          className="p-1.5 text-white/60 hover:text-white transition-colors"
        >
          <SkipForward size={14} fill="currentColor" />
        </button>
      </div>

      {/* Progress */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-[10px] text-white/40 tabular-nums flex-shrink-0">{formatTime(currentTime)}</span>
        <div
          className="flex-1 h-1 bg-white/20 rounded-full cursor-pointer group"
          onClick={handleProgressClick}
        >
          <div
            className="h-full bg-theme-400 group-hover:bg-theme-300 rounded-full transition-colors"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-[10px] text-white/40 tabular-nums flex-shrink-0">{formatTime(duration)}</span>
      </div>

      {/* Stop */}
      <button
        onClick={clearQueue}
        className="flex-shrink-0 p-1.5 text-white/40 hover:text-white transition-colors"
        title="Stop playback"
      >
        <X size={14} />
      </button>
    </div>
  )
})
