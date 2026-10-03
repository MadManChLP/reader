import React, { useCallback, memo, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, ListMusic, Mic2, Moon
} from 'lucide-react'
import LocalOrRemoteImage from '../../LocalOrRemoteImage'
import { useJellyfin } from '../JellyfinContext'
import { useMusicPlayer, formatTime, getLocalTrackImage } from '../../../stores/musicPlayerStore'
import { useSleepTimer } from '../../../stores/sleepTimerStore'
import SleepTimerPanel, { SleepTimerCountdown } from '../player/SleepTimerPanel'
import { BottomSheet } from '../../BottomSheet'
import { SystemVolumeSlider } from '../../SystemVolumeSlider'

interface MusicNowPlayingProps {
  onClose: () => void
}

// Phone-only fullscreen "Now Playing" view, opened by tapping the compact
// player bar. Queue/lyrics reuse the existing store-flag panels (which render
// fullscreen above this view on phones).
export const MusicNowPlaying = memo(function MusicNowPlaying({ onClose }: MusicNowPlayingProps) {
  const { getImageUrl } = useJellyfin()
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    shuffleMode,
    repeatMode,
    toggle,
    next,
    previous,
    seek,
    toggleShuffle,
    cycleRepeat,
    toggleQueueOpen,
    toggleLyricsOpen,
  } = useMusicPlayer(useShallow(s => ({
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    currentTime: s.currentTime,
    duration: s.duration,
    shuffleMode: s.shuffleMode,
    repeatMode: s.repeatMode,
    toggle: s.toggle,
    next: s.next,
    previous: s.previous,
    seek: s.seek,
    toggleShuffle: s.toggleShuffle,
    cycleRepeat: s.cycleRepeat,
    toggleQueueOpen: s.toggleQueueOpen,
    toggleLyricsOpen: s.toggleLyricsOpen,
  })))

  const [sleepOpen, setSleepOpen] = useState(false)
  const sleepActive = useSleepTimer(s => s.target === 'music' && s.mode !== null)

  const handleSeekPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const update = (clientX: number) => {
      const rect = el.getBoundingClientRect()
      const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      seek(pos * duration)
    }
    update(e.clientX)
    const move = (ev: PointerEvent) => update(ev.clientX)
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }, [duration, seek])

  if (!currentTrack) return null

  // Fullscreen artwork on a retina phone needs real resolution: request the
  // display width × devicePixelRatio (max-w-sm ≈ 384px CSS → ~1150px at 3x).
  const artworkPx = Math.min(1500, Math.round(448 * (window.devicePixelRatio || 1)))
  const remoteImageUrl = currentTrack.albumId
    ? getImageUrl(currentTrack.albumId, 'Primary', artworkPx)
    : null
  const localImagePath = getLocalTrackImage(currentTrack)
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col pt-safe pb-safe">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3">
        <button
          onClick={onClose}
          className="p-2 -m-2 text-white/70 active:text-white transition-colors"
          title="Close"
        >
          <ChevronDown size={26} />
        </button>
        <span className="text-xs font-semibold uppercase tracking-wider text-white/50">Now Playing</span>
        <span className="w-6" />
      </div>

      {/* Artwork */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-8 py-2">
        {(localImagePath || remoteImageUrl) ? (
          <LocalOrRemoteImage
            localPath={localImagePath}
            remoteUrl={remoteImageUrl}
            alt={currentTrack.albumName}
            className="max-h-full w-full max-w-sm aspect-square rounded-2xl object-cover shadow-2xl"
          />
        ) : (
          <div className="w-full max-w-sm aspect-square rounded-2xl bg-white/5" />
        )}
      </div>

      {/* Track info */}
      <div className="flex-shrink-0 px-6 pt-4">
        <p className="text-xl font-bold text-white truncate">{currentTrack.name}</p>
        <p className="text-sm text-white/60 truncate mt-0.5">{currentTrack.artists.join(', ')}</p>
      </div>

      {/* Seek bar */}
      <div className="flex-shrink-0 px-6 pt-4">
        <div
          className="group relative h-8 flex items-center cursor-pointer touch-none"
          onPointerDown={handleSeekPointerDown}
        >
          <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full" style={{ width: `${progressPercent}%` }} />
          </div>
          <div
            className="absolute w-3.5 h-3.5 bg-white rounded-full shadow -translate-x-1/2"
            style={{ left: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-white/50 -mt-1">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 flex items-center justify-between px-8 py-4">
        <button
          onClick={toggleShuffle}
          className={`p-2 transition-colors ${shuffleMode ? 'text-theme-400' : 'text-white/60'}`}
          title="Shuffle"
        >
          <Shuffle size={22} />
        </button>
        <button onClick={previous} className="p-2 text-white active:scale-95 transition-transform" title="Previous">
          <SkipBack size={30} fill="currentColor" />
        </button>
        <button
          onClick={toggle}
          className="w-16 h-16 bg-white rounded-full text-black flex items-center justify-center active:scale-95 transition-transform shadow-lg"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" className="ml-1" />}
        </button>
        <button onClick={next} className="p-2 text-white active:scale-95 transition-transform" title="Next">
          <SkipForward size={30} fill="currentColor" />
        </button>
        <button
          onClick={cycleRepeat}
          className={`p-2 transition-colors ${repeatMode !== 'off' ? 'text-theme-400' : 'text-white/60'}`}
          title="Repeat"
        >
          {repeatMode === 'one' ? <Repeat1 size={22} /> : <Repeat size={22} />}
        </button>
      </div>

      {/* System volume (mobile only — renders nothing elsewhere) */}
      <SystemVolumeSlider className="flex-shrink-0 px-8 pb-2" />

      {/* Bottom actions */}
      <div className="flex-shrink-0 flex items-center justify-center gap-10 pb-3">
        <button
          onClick={toggleLyricsOpen}
          className="flex items-center gap-1.5 text-sm text-white/60 active:text-white transition-colors p-2"
          title="Lyrics"
        >
          <Mic2 size={17} />
          Lyrics
        </button>
        <button
          onClick={toggleQueueOpen}
          className="flex items-center gap-1.5 text-sm text-white/60 active:text-white transition-colors p-2"
          title="Queue"
        >
          <ListMusic size={17} />
          Queue
        </button>
        <button
          onClick={() => setSleepOpen(true)}
          className={`flex items-center gap-1.5 text-sm transition-colors p-2 ${sleepActive ? 'text-theme-400' : 'text-white/60 active:text-white'}`}
          title="Sleep timer"
        >
          <Moon size={17} />
          {sleepActive ? <SleepTimerCountdown /> : 'Sleep'}
        </button>
      </div>

      {/* Sleep timer bottom sheet */}
      {sleepOpen && (
        <BottomSheet
          title={<><Moon size={16} />Sleep Timer</>}
          onClose={() => setSleepOpen(false)}
        >
          <div className="px-3 pb-2">
            <SleepTimerPanel target="music" endOfItemLabel="track" onAction={() => setSleepOpen(false)} />
          </div>
        </BottomSheet>
      )}
    </div>
  )
})
