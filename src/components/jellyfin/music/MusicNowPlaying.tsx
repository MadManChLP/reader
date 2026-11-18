import React, { useCallback, memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { hapticLight, hapticSelection } from '../../../utils/haptics'
import { registerBackHandler } from '../../../utils/navigationBus'
import { toLocalUrl } from '../../../utils/api'
import { useIsPhone } from '../../../hooks/useIsPhone'
import { LyricsPeek } from './MusicLyrics'

interface MusicNowPlayingProps {
  onClose: () => void
  onNavigateToAlbum?: (albumId: string, albumName?: string) => void
  onNavigateToArtist?: (artistId: string, artistName?: string) => void
}

// ── Dominant colour of the artwork (for the background gradient) ─────────────
// Average of a 24×24 downscale, skipping near-black/near-white pixels so a
// white border or black background doesn't wash it out. Falls back to null
// when the image can't be read (cross-origin canvas taint, load error).
function useArtworkColor(src: string | null): string | null {
  const [color, setColor] = useState<string | null>(null)
  useEffect(() => {
    if (!src) { setColor(null); return }
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      if (cancelled) return
      try {
        const size = 24
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data
        let r = 0, g = 0, b = 0, n = 0
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i], pg = data[i + 1], pb = data[i + 2]
          const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb)
          if (max < 30 || min > 225) continue
          // Weight saturated pixels higher — they carry the "colour" of the cover
          const w = 1 + (max - min) / 64
          r += pr * w; g += pg * w; b += pb * w; n += w
        }
        if (n === 0) { setColor(null); return }
        // Darken a little so white text stays readable on top
        const k = 0.6
        setColor(`rgb(${Math.round((r / n) * k)}, ${Math.round((g / n) * k)}, ${Math.round((b / n) * k)})`)
      } catch {
        setColor(null) // tainted canvas
      }
    }
    img.onerror = () => { if (!cancelled) setColor(null) }
    img.src = src
    return () => { cancelled = true }
  }, [src])
  return color
}

// Fullscreen "Now Playing" (phone: opened from the compact bar; desktop:
// from the cover in the player bar). Queue/lyrics reuse the store-flag panels.
export const MusicNowPlaying = memo(function MusicNowPlaying({ onClose, onNavigateToAlbum, onNavigateToArtist }: MusicNowPlayingProps) {
  const { getImageUrl } = useJellyfin()
  const isPhone = useIsPhone()
  const {
    currentTrack, isPlaying, currentTime, duration, shuffleMode, repeatMode,
    queueContextName, nextTrack,
    toggle, next, previous, seek, toggleShuffle, cycleRepeat, toggleQueueOpen, toggleLyricsOpen,
  } = useMusicPlayer(useShallow(s => ({
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    currentTime: s.currentTime,
    duration: s.duration,
    shuffleMode: s.shuffleMode,
    repeatMode: s.repeatMode,
    queueContextName: s.queueContextName,
    nextTrack: s.manualQueue[0] ?? s.queue[s.queueIndex + 1] ?? null,
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

  // Back / Esc / edge-swipe close the view
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => registerBackHandler(() => { onCloseRef.current(); return true }), [])

  // ── Gestures: swipe the artwork sideways to skip, drag down to close ──────
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const gestureRef = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null)
  const onGestureStart = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    gestureRef.current = { x: e.clientX, y: e.clientY, axis: null }
  }
  const onGestureMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.axis && Math.hypot(dx, dy) > 12) g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    if (g.axis === 'x') setDrag({ dx, dy: 0 })
    else if (g.axis === 'y' && dy > 0) setDrag({ dx: 0, dy })
  }
  const onGestureEnd = () => {
    const g = gestureRef.current
    const d = drag
    gestureRef.current = null
    setDrag(null)
    if (!g || !d) return
    if (g.axis === 'x' && Math.abs(d.dx) > 70) {
      hapticLight()
      if (d.dx < 0) next()
      else previous()
    } else if (g.axis === 'y' && d.dy > 120) {
      onClose()
    }
  }

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

  // Fullscreen artwork on a retina phone needs real resolution: request the
  // display width × devicePixelRatio (max-w-sm ≈ 384px CSS → ~1150px at 3x).
  const artworkPx = Math.min(1500, Math.round((isPhone ? 448 : 640) * (window.devicePixelRatio || 1)))
  const remoteImageUrl = currentTrack?.albumId
    ? getImageUrl(currentTrack.albumId, 'Primary', artworkPx)
    : null
  const localImagePath = currentTrack ? getLocalTrackImage(currentTrack) : null
  const colorSource = currentTrack?.albumId
    ? (localImagePath ? toLocalUrl(localImagePath) : getImageUrl(currentTrack.albumId, 'Primary', 64))
    : null
  const bgColor = useArtworkColor(colorSource)

  if (!currentTrack) return null

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0
  // Desktop queue/lyrics panels sit below this fullscreen view — close it first
  const openQueue = () => { if (!isPhone) onClose(); toggleQueueOpen() }
  const openLyrics = () => { if (!isPhone) onClose(); toggleLyricsOpen() }
  const playingFrom = queueContextName || currentTrack.albumName

  const goAlbum = onNavigateToAlbum && currentTrack.albumId
    ? () => { onClose(); onNavigateToAlbum(currentTrack.albumId, currentTrack.albumName) }
    : undefined
  const goArtist = (i: number) => onNavigateToArtist && currentTrack.artistIds[i]
    ? () => { onClose(); onNavigateToArtist(currentTrack.artistIds[i], currentTrack.artists[i]) }
    : undefined

  const artwork = (
    <div
      className={`touch-pan-y select-none ${isPhone ? 'w-full max-w-sm' : 'w-full max-w-[480px]'}`}
      onPointerDown={onGestureStart}
      onPointerMove={onGestureMove}
      onPointerUp={onGestureEnd}
      onPointerCancel={onGestureEnd}
      style={{
        transform: drag?.dx ? `translateX(${drag.dx}px) rotate(${drag.dx / 40}deg)` : undefined,
        transition: drag ? 'none' : 'transform 200ms ease-out',
      }}
    >
      {(localImagePath || remoteImageUrl) ? (
        <LocalOrRemoteImage
          localPath={localImagePath}
          remoteUrl={remoteImageUrl}
          alt={currentTrack.albumName}
          className="w-full aspect-square rounded-2xl object-cover shadow-2xl shadow-black/50 pointer-events-none"
        />
      ) : (
        <div className="w-full aspect-square rounded-2xl bg-white/5" />
      )}
    </div>
  )

  const info = (
    <div className="min-w-0">
      {goAlbum ? (
        <button onClick={goAlbum} className="block max-w-full text-left text-xl md:text-3xl font-bold text-white truncate hover:underline">
          {currentTrack.name}
        </button>
      ) : (
        <p className="text-xl md:text-3xl font-bold text-white truncate">{currentTrack.name}</p>
      )}
      <p className="text-sm md:text-base text-white/60 truncate mt-0.5">
        {currentTrack.artists.map((a, i) => {
          const go = goArtist(i)
          return (
            <React.Fragment key={`${a}-${i}`}>
              {i > 0 && ', '}
              {go ? <button onClick={go} className="hover:text-white hover:underline">{a}</button> : a}
            </React.Fragment>
          )
        })}
      </p>
    </div>
  )

  const seekBar = (
    <div>
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
  )

  const controls = (
    <div className="flex items-center justify-between">
      <button
        onClick={() => { hapticSelection(); toggleShuffle() }}
        className={`p-2 transition-colors ${shuffleMode ? 'text-theme-400' : 'text-white/60 hover:text-white'}`}
        title="Shuffle"
      >
        <Shuffle size={22} />
      </button>
      <button onClick={() => { hapticLight(); previous() }} className="p-2 text-white active:scale-95 transition-transform" title="Previous">
        <SkipBack size={30} fill="currentColor" />
      </button>
      <button
        onClick={() => { hapticLight(); toggle() }}
        className="w-16 h-16 bg-white rounded-full text-black flex items-center justify-center active:scale-95 hover:scale-105 transition-transform shadow-lg"
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" className="ml-1" />}
      </button>
      <button onClick={() => { hapticLight(); next() }} className="p-2 text-white active:scale-95 transition-transform" title="Next">
        <SkipForward size={30} fill="currentColor" />
      </button>
      <button
        onClick={() => { hapticSelection(); cycleRepeat() }}
        className={`p-2 transition-colors ${repeatMode !== 'off' ? 'text-theme-400' : 'text-white/60 hover:text-white'}`}
        title="Repeat"
      >
        {repeatMode === 'one' ? <Repeat1 size={22} /> : <Repeat size={22} />}
      </button>
    </div>
  )

  // Queue peek: what plays next — tap for the full queue
  const nextUp = nextTrack ? (
    <button
      onClick={openQueue}
      className="w-full flex items-center gap-3 rounded-xl bg-black/20 hover:bg-black/30 active:bg-black/40 px-3 py-2 text-left transition-colors"
    >
      <ListMusic size={16} className="text-white/50 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wider text-white/40">Next</p>
        <p className="text-sm text-white/85 truncate">
          {nextTrack.name}<span className="text-white/40"> · {nextTrack.artists.join(', ')}</span>
        </p>
      </div>
    </button>
  ) : null

  const actions = (
    <div className="flex items-center justify-center gap-10">
      <button onClick={openLyrics} className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white active:text-white transition-colors p-2" title="Lyrics">
        <Mic2 size={17} />
        Lyrics
      </button>
      <button onClick={openQueue} className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white active:text-white transition-colors p-2" title="Queue">
        <ListMusic size={17} />
        Queue
      </button>
      <button
        onClick={() => setSleepOpen(true)}
        className={`flex items-center gap-1.5 text-sm transition-colors p-2 ${sleepActive ? 'text-theme-400' : 'text-white/60 hover:text-white active:text-white'}`}
        title="Sleep timer"
      >
        <Moon size={17} />
        {sleepActive ? <SleepTimerCountdown /> : 'Sleep'}
      </button>
    </div>
  )

  const header = (
    <div
      className="flex-shrink-0 flex items-center justify-between px-4 py-3 touch-none"
      onPointerDown={onGestureStart}
      onPointerMove={onGestureMove}
      onPointerUp={onGestureEnd}
      onPointerCancel={onGestureEnd}
    >
      <button onClick={onClose} className="p-2 -m-2 text-white/70 hover:text-white active:text-white transition-colors" title="Close">
        <ChevronDown size={26} />
      </button>
      <div className="min-w-0 flex-1 text-center px-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Playing from</p>
        {goAlbum && !queueContextName ? (
          <button onClick={goAlbum} className="text-sm font-semibold text-white truncate max-w-full hover:underline">{playingFrom}</button>
        ) : (
          <p className="text-sm font-semibold text-white truncate">{playingFrom}</p>
        )}
      </div>
      <span className="w-6" />
    </div>
  )

  // Portal: the player bars use backdrop-blur, which would trap a fixed child
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col pt-safe pb-safe bg-gray-900"
      style={{
        background: bgColor ? `linear-gradient(180deg, ${bgColor} 0%, rgb(17 24 39) 85%)` : undefined,
        transform: drag?.dy ? `translateY(${drag.dy}px)` : undefined,
        transition: drag ? 'none' : 'transform 200ms ease-out, background 600ms ease',
      }}
    >
      {header}

      {isPhone ? (
        <>
          <div className="flex-1 min-h-0 flex items-center justify-center px-8 py-2">{artwork}</div>
          <div className="flex-shrink-0 px-6 pt-4">{info}</div>
          <div className="flex-shrink-0 px-6 pt-3"><LyricsPeek onOpen={openLyrics} /></div>
          <div className="flex-shrink-0 px-6 pt-4">{seekBar}</div>
          <div className="flex-shrink-0 px-8 py-4">{controls}</div>
          <SystemVolumeSlider className="flex-shrink-0 px-8 pb-2" />
          {nextUp && <div className="flex-shrink-0 px-6 pb-2">{nextUp}</div>}
          <div className="flex-shrink-0 pb-3">{actions}</div>
        </>
      ) : (
        // Desktop: artwork left, everything else right
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-12 items-center px-16 pb-10 max-w-6xl w-full mx-auto">
          <div className="flex justify-end">{artwork}</div>
          <div className="flex flex-col gap-6 max-w-md w-full">
            {info}
            <LyricsPeek onOpen={openLyrics} />
            {seekBar}
            {controls}
            {nextUp}
            {actions}
          </div>
        </div>
      )}

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
    </div>,
    document.body,
  )
})
