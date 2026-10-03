import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  Volume2, VolumeX, Maximize, Minimize, Tv2, Radio as RadioIcon,
  ChevronUp, ChevronDown, LayoutGrid, X, Loader2, AlertCircle, Square,
  Music2,
} from 'lucide-react'
import { api as appApi, IS_PHONE } from '../../utils/api'
import { useIsPhone } from '../../hooks/useIsPhone'
import { useMusicPlayer } from '../../stores/musicPlayerStore'
import { useAudiobookPlayer } from '../../stores/audiobookPlayerStore'
import { useAudioOutputDevice } from '../../hooks/useAudioOutputDevice'
import type { LiveTVChannel, EPGProgram } from './EPGGrid'

// ─── Device profiles ───────────────────────────────────────────────────────────
// TV channels: force H.264/AAC HLS transcoding (WebView2 can't decode raw MPEG-TS)
const TV_DEVICE_PROFILE = {
  DirectPlayProfiles: [],
  TranscodingProfiles: [
    {
      Container: 'ts',
      Type: 'Video',
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      Protocol: 'hls',
      Context: 'Streaming',
    },
  ],
  ResponseProfiles: [],
  SubtitleProfiles: [],
  CodecProfiles: [],
}

// Radio channels: audio-only profile — no Video transcoding entry so Jellyfin
// doesn't try to treat an audio-only MPEG-TS stream as a video source.
const RADIO_DEVICE_PROFILE = {
  DirectPlayProfiles: [],
  TranscodingProfiles: [
    {
      Container: 'ts',
      Type: 'Audio',
      AudioCodec: 'aac',
      Protocol: 'hls',
      Context: 'Streaming',
      MaxAudioChannels: '2',
    },
  ],
  ResponseProfiles: [],
  SubtitleProfiles: [],
  CodecProfiles: [],
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface LiveTVPlayerProps {
  channel: LiveTVChannel
  serverUrl: string
  accessToken: string
  userId: string
  currentProgram: EPGProgram | null
  onOpenGuide: () => void
  onChannelUp: () => void
  onChannelDown: () => void
  onStop?: () => void
  /** 'fullscreen' fills the parent; 'pip' floats as a fixed corner widget */
  mode?: 'fullscreen' | 'pip'
}

// ─── LiveTVPlayer ─────────────────────────────────────────────────────────────
export function LiveTVPlayer({
  channel,
  serverUrl,
  accessToken,
  userId,
  currentProgram,
  onOpenGuide,
  onChannelUp,
  onChannelDown,
  onStop,
  mode = 'fullscreen',
}: LiveTVPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const isPhone = useIsPhone()
  // Touch-gesture tracking for the phone immersive player
  const gestureStartRef = useRef<{ x: number; y: number; edge: boolean } | null>(null)
  const lastTapRef = useRef(0)
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // One medium at a time: pause background music/audiobook when live TV starts
  useEffect(() => {
    useMusicPlayer.getState().pause()
    useAudiobookPlayer.getState().pause()
  }, [])

  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const isPip = mode === 'pip'
  const isRadio = channel.channelType === 'Radio'

  // Returns the active HTMLMediaElement (audio for radio, video for TV)
  const getMedia = useCallback(
    () => (isRadio ? audioRef.current : videoRef.current),
    [isRadio],
  )

  // Route audio to the output device chosen in Settings → Advanced (Live TV device).
  // The <video> only exists for TV channels, so re-apply when the stream loads.
  useAudioOutputDevice(audioRef, 'livetv')
  useAudioOutputDevice(videoRef, 'livetv', streamUrl)

  // ── Fetch stream URL ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setStreamUrl(null)

    const profile = isRadio ? RADIO_DEVICE_PROFILE : TV_DEVICE_PROFILE

    const fetchStream = async () => {
      try {
        console.log(`[LiveTV] Fetching stream for ${isRadio ? 'radio' : 'TV'} channel: ${channel.name}`)

        // Step 1: PlaybackInfo
        const res = await appApi.request({
          method: 'POST',
          url: `${serverUrl}/Items/${channel.id}/PlaybackInfo?userId=${userId}&IsPlayback=true`,
          headers: {
            'Authorization': `MediaBrowser Token="${accessToken}"`,
            'Content-Type': 'application/json',
          },
          data: { DeviceProfile: profile },
        })

        if (cancelled) return

        if (!res.success || !res.data) {
          setError('Could not load channel')
          setIsLoading(false)
          return
        }

        console.log('[LiveTV] PlaybackInfo received, sources:', res.data?.MediaSources?.length ?? 0)

        let source = (res.data.MediaSources || [])[0]
        if (!source) {
          setError('No stream available for this channel')
          setIsLoading(false)
          return
        }

        // Step 2: Open live stream if required (TVHeadend uses this)
        if (source.RequiresOpening && source.OpenToken) {
          console.log('[LiveTV] Opening live stream (RequiresOpening)')
          const openRes = await appApi.request({
            method: 'POST',
            url: `${serverUrl}/LiveStreams/Open`,
            headers: {
              'Authorization': `MediaBrowser Token="${accessToken}"`,
              'Content-Type': 'application/json',
            },
            data: {
              OpenToken: source.OpenToken,
              UserId: userId,
              DeviceProfile: profile,
            },
          })

          if (cancelled) return

          console.log('[LiveTV] LiveStreams/Open completed, status:', openRes.status)

          if (openRes.success && openRes.data?.MediaSource) {
            source = openRes.data.MediaSource
          } else if (openRes.success && openRes.data) {
            source = openRes.data
          }
        }

        // Step 3: Resolve stream URL
        if (source.TranscodingUrl) {
          const url = source.TranscodingUrl.startsWith('http')
            ? source.TranscodingUrl
            : `${serverUrl}${source.TranscodingUrl}`
          console.log('[LiveTV] Using TranscodingUrl:', url)
          setStreamUrl(url)
        } else if (source.DirectStreamUrl) {
          const url = source.DirectStreamUrl.startsWith('http')
            ? source.DirectStreamUrl
            : `${serverUrl}${source.DirectStreamUrl}`
          console.log('[LiveTV] Using DirectStreamUrl:', url)
          setStreamUrl(url)
        } else if (source.Path && (source.Protocol === 'Http' || source.Protocol === 'Rtmp')) {
          console.log('[LiveTV] Using direct Path:', source.Path)
          setStreamUrl(source.Path)
        } else {
          // Last resort: use Audio endpoint for radio, Video for TV
          const fallback = isRadio
            ? `${serverUrl}/Audio/${source.Id}/universal?audioCodec=aac&ApiKey=${accessToken}`
            : `${serverUrl}/Videos/${source.Id}/stream?Static=true&mediaSourceId=${source.Id}&ApiKey=${accessToken}`
          console.log('[LiveTV] Using fallback URL:', fallback)
          setStreamUrl(fallback)
        }
      } catch (e: any) {
        if (!cancelled) {
          console.error('[LiveTV] Stream fetch failed:', e)
          setError(`Failed to connect: ${e?.message || 'unknown error'}`)
        }
      }
      if (!cancelled) setIsLoading(false)
    }

    fetchStream()
    return () => { cancelled = true }
  }, [channel.id, serverUrl, accessToken, userId, isRadio])

  // ── Attach stream to media element ─────────────────────────────────────────
  useEffect(() => {
    const media = getMedia()
    if (!media || !streamUrl) return
    media.src = streamUrl
    media.load()
    media.play().catch(() => {/* autoplay blocked */})
  }, [streamUrl, getMedia])

  // ── Sync volume/mute ────────────────────────────────────────────────────────
  useEffect(() => {
    const media = getMedia()
    if (!media) return
    media.volume = volume
    media.muted = isMuted
  }, [volume, isMuted, getMedia])

  // ── Controls auto-hide ──────────────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true)
    clearTimeout(controlsTimerRef.current)
    if (!isPip) {
      controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000)
    }
  }, [isPip])

  useEffect(() => {
    if (isPip) { setShowControls(true); return }
    resetControlsTimer()
    return () => clearTimeout(controlsTimerRef.current)
  }, [isPip, resetControlsTimer])

  // ── Fullscreen ──────────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  }, [])

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isPip) return
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return
      switch (e.key) {
        case 'm': case 'M': setIsMuted(m => !m); break
        case 'f': case 'F': toggleFullscreen(); break
        case 'ArrowUp':   e.preventDefault(); onChannelUp();   break
        case 'ArrowDown': e.preventDefault(); onChannelDown(); break
        case 'g': case 'G': onOpenGuide(); break
        case 'Escape': onStop?.(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isPip, toggleFullscreen, onChannelUp, onChannelDown, onOpenGuide, onStop])

  // ── Best-effort landscape lock (phone immersive only) ───────────────────────
  // Real fullscreen + orientation lock work on Android WebView; on iOS WKWebView
  // both reject and we simply rely on the CSS full-viewport overlay + the user
  // rotating their device. Everything is wrapped so failures are silent.
  useEffect(() => {
    if (!isPhone || isPip) return
    let didLock = false
    const el = containerRef.current
    const enter = async () => {
      try {
        if (el?.requestFullscreen) await el.requestFullscreen()
        const orientation = (screen as any).orientation
        if (orientation?.lock) {
          await orientation.lock('landscape')
          didLock = true
        }
      } catch {
        /* unsupported (iOS) or requires-gesture — CSS overlay still fills the screen */
      }
    }
    enter()
    return () => {
      try {
        const orientation = (screen as any).orientation
        if (didLock && orientation?.unlock) orientation.unlock()
      } catch { /* ignore */ }
      try {
        if (document.fullscreenElement) document.exitFullscreen()
      } catch { /* ignore */ }
    }
  }, [isPhone, isPip])

  // ── Phone touch gestures (immersive player only) ────────────────────────────
  // Tap = toggle controls, double-tap = mute, horizontal swipe = channel flip,
  // swipe down = minimize to picture-in-picture. Taps on actual controls are
  // left to the controls themselves. The left 24px edge is reserved for the
  // app-wide swipe-back gesture.
  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    gestureStartRef.current = { x: t.clientX, y: t.clientY, edge: t.clientX < 24 }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = gestureStartRef.current
    gestureStartRef.current = null
    if (!start) return
    // Let real controls (buttons / volume slider) handle their own taps.
    if ((e.target as HTMLElement).closest('button, input, a')) return

    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)

    // Swipe (skip if it started in the left-edge back-gesture zone)
    if (!start.edge && Math.max(absX, absY) > 50) {
      if (absX > absY) {
        if (dx < 0) onChannelDown()
        else onChannelUp()
        resetControlsTimer()
      } else if (dy > 0) {
        onOpenGuide() // swipe down → minimize to PiP
      }
      return
    }

    // Tap (little movement): single = toggle controls, double = mute
    if (absX < 12 && absY < 12) {
      const now = Date.now()
      if (now - lastTapRef.current < 280) {
        clearTimeout(tapTimeoutRef.current)
        lastTapRef.current = 0
        setIsMuted(m => !m)
        resetControlsTimer()
      } else {
        lastTapRef.current = now
        const shownAtTap = showControls
        tapTimeoutRef.current = setTimeout(() => {
          if (shownAtTap) {
            clearTimeout(controlsTimerRef.current)
            setShowControls(false)
          } else {
            resetControlsTimer()
          }
        }, 280)
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className={isPip
        ? 'fixed bottom-4 right-4 phone:right-2 phone:w-64 phone:bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-50 w-80 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/20 flex flex-col bg-black'
        : isPhone
          ? 'fixed inset-0 z-[70] w-screen h-dvh bg-black select-none touch-none'
          : 'relative w-full h-full bg-black select-none'
      }
      style={isPip ? { height: isRadio ? '130px' : (IS_PHONE ? '172px' : '220px') } : undefined}
      onMouseMove={!isPip && !isPhone ? resetControlsTimer : undefined}
      onMouseLeave={!isPip && !isPhone ? () => { clearTimeout(controlsTimerRef.current); setShowControls(false) } : undefined}
      onMouseEnter={!isPip && !isPhone ? resetControlsTimer : undefined}
      onTouchStart={!isPip && isPhone ? handleTouchStart : undefined}
      onTouchEnd={!isPip && isPhone ? handleTouchEnd : undefined}
    >
      {/* Hidden audio element for radio — always rendered so the ref is stable */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {/* ── PiP header ────────────────────────────────────────────────────── */}
      {isPip && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-black/80 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {isRadio
              ? <RadioIcon size={12} className="text-blue-400 flex-shrink-0" />
              : <Tv2 size={12} className="text-theme-400 flex-shrink-0" />}
            <span className="text-xs text-white/80 truncate">{channel.name}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={onChannelUp} className="p-1 hover:bg-white/10 rounded" title="Channel up">
              <ChevronUp size={12} className="text-white/60" />
            </button>
            <button onClick={onChannelDown} className="p-1 hover:bg-white/10 rounded" title="Channel down">
              <ChevronDown size={12} className="text-white/60" />
            </button>
            <button onClick={onOpenGuide} className="p-1 hover:bg-white/10 rounded" title="Expand player">
              <Maximize size={12} className="text-white/60" />
            </button>
            {onStop && (
              <button onClick={onStop} className="p-1 hover:bg-red-500/30 rounded" title="Stop playback">
                <X size={12} className="text-white/60" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Video area (TV only) ──────────────────────────────────────────── */}
      {!isRadio && (
        <div className={`relative bg-black ${isPip ? 'flex-1' : 'w-full h-full'}`}>
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            autoPlay
            playsInline
          />

          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3">
              {isPip
                ? <Loader2 size={20} className="animate-spin text-theme-400" />
                : <>
                    <Loader2 size={40} className="animate-spin text-theme-400" />
                    <p className="text-white/60 text-sm">Loading {channel.name}…</p>
                  </>
              }
            </div>
          )}

          {error && !isLoading && <ErrorOverlay error={error} pip={isPip} onRetry={isPip ? undefined : () => { setError(null); setIsLoading(true); setStreamUrl(null) }} />}

          {/* Fullscreen controls overlay for TV */}
          {!isPip && (
            <FullscreenControls
              channel={channel}
              currentProgram={currentProgram}
              showControls={showControls}
              isMuted={isMuted}
              volume={volume}
              isFullscreen={isFullscreen}
              onMuteToggle={() => setIsMuted(m => !m)}
              onVolumeChange={(v) => { setVolume(v); setIsMuted(v === 0) }}
              onChannelUp={onChannelUp}
              onChannelDown={onChannelDown}
              onOpenGuide={onOpenGuide}
              onToggleFullscreen={toggleFullscreen}
              onStop={onStop}
              isPhone={isPhone}
            />
          )}
        </div>
      )}

      {/* ── Radio area ───────────────────────────────────────────────────── */}
      {isRadio && (
        <div className={`relative bg-gradient-to-br from-gray-900 via-blue-950/40 to-gray-900 flex flex-col items-center justify-center ${isPip ? 'flex-1 py-3' : 'w-full h-full'}`}>
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <Loader2 size={isPip ? 20 : 40} className="animate-spin text-blue-400" />
              {!isPip && <p className="text-white/60 text-sm">Tuning in to {channel.name}…</p>}
            </div>
          )}

          {error && !isLoading && <ErrorOverlay error={error} pip={isPip} onRetry={isPip ? undefined : () => { setError(null); setIsLoading(true); setStreamUrl(null) }} />}

          {!isLoading && !error && (
            <>
              {/* Channel icon */}
              <div className={`${isPip ? 'w-8 h-8' : 'w-20 h-20'} rounded-full bg-blue-900/60 ring-2 ring-blue-500/30 flex items-center justify-center mb-3 flex-shrink-0`}>
                {channel.imageUrl
                  ? <img src={channel.imageUrl} className="w-full h-full object-contain rounded-full" alt="" />
                  : <Music2 size={isPip ? 16 : 36} className="text-blue-400" />
                }
              </div>

              {/* Pulsing live indicator */}
              {!isPip && (
                <div className="flex items-center gap-1.5 mb-4">
                  {[0, 1, 2, 3, 4].map(i => (
                    <div
                      key={i}
                      className="w-1 bg-blue-400 rounded-full animate-pulse"
                      style={{
                        height: `${8 + Math.sin(i * 1.2) * 6 + 6}px`,
                        animationDelay: `${i * 0.15}s`,
                        animationDuration: '0.8s',
                      }}
                    />
                  ))}
                </div>
              )}

              {!isPip && (
                <>
                  <h2 className="text-white font-semibold text-xl mb-1">{channel.name}</h2>
                  {currentProgram && (
                    <p className="text-white/50 text-sm text-center px-6">{currentProgram.name}</p>
                  )}
                </>
              )}
            </>
          )}

          {/* Fullscreen controls overlay for radio */}
          {!isPip && (
            <FullscreenControls
              channel={channel}
              currentProgram={currentProgram}
              showControls={showControls}
              isMuted={isMuted}
              volume={volume}
              isFullscreen={isFullscreen}
              onMuteToggle={() => setIsMuted(m => !m)}
              onVolumeChange={(v) => { setVolume(v); setIsMuted(v === 0) }}
              onChannelUp={onChannelUp}
              onChannelDown={onChannelDown}
              onOpenGuide={onOpenGuide}
              onToggleFullscreen={toggleFullscreen}
              onStop={onStop}
              isPhone={isPhone}
            />
          )}
        </div>
      )}

      {/* ── PiP program footer ─────────────────────────────────────────────── */}
      {isPip && currentProgram && (
        <div className="px-2 py-1 bg-black/80 border-t border-white/10 flex-shrink-0">
          <p className="text-[10px] text-white/60 truncate">{currentProgram.name}</p>
        </div>
      )}
    </div>
  )
}

// ─── Fullscreen controls overlay ──────────────────────────────────────────────
function FullscreenControls({
  channel,
  currentProgram,
  showControls,
  isMuted,
  volume,
  isFullscreen,
  onMuteToggle,
  onVolumeChange,
  onChannelUp,
  onChannelDown,
  onOpenGuide,
  onToggleFullscreen,
  onStop,
  isPhone = false,
}: {
  channel: LiveTVChannel
  currentProgram: EPGProgram | null
  showControls: boolean
  isMuted: boolean
  volume: number
  isFullscreen: boolean
  onMuteToggle: () => void
  onVolumeChange: (v: number) => void
  onChannelUp: () => void
  onChannelDown: () => void
  onOpenGuide: () => void
  onToggleFullscreen: () => void
  onStop?: () => void
  isPhone?: boolean
}) {
  const isRadio = channel.channelType === 'Radio'
  return (
    <div
      className={`absolute inset-0 flex flex-col justify-between pointer-events-none transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Top bar (non-interactive while hidden so taps reach the gesture layer) */}
      <div className={`${showControls ? 'pointer-events-auto' : 'pointer-events-none'} bg-gradient-to-b from-black/80 to-transparent p-4 phone:px-4 phone:pt-safe phone:pl-safe phone:pr-safe`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isRadio
              ? <RadioIcon size={18} className="text-blue-400 flex-shrink-0" />
              : <Tv2 size={18} className="text-theme-400 flex-shrink-0" />}
            <div>
              <h2 className="text-white font-semibold text-base leading-tight">{channel.name}</h2>
              {currentProgram && (
                <p className="text-white/60 text-sm leading-tight">
                  {currentProgram.name} · {formatTime(currentProgram.startDate)} – {formatTime(currentProgram.endDate)}
                </p>
              )}
            </div>
          </div>
          {onStop && (
            <button
              onClick={onStop}
              className="p-2 bg-white/10 hover:bg-red-600/40 rounded-full transition-colors"
              title="Stop playback (Esc)"
            >
              <Square size={16} className="text-white/70" />
            </button>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className={`${showControls ? 'pointer-events-auto' : 'pointer-events-none'} bg-gradient-to-t from-black/80 to-transparent p-4 phone:px-4 phone:pb-safe phone:pl-safe phone:pr-safe`}>
        <div className="flex items-center gap-2 mb-3">
          <span className="flex items-center gap-1.5 text-xs font-bold text-white bg-red-600 px-2 py-0.5 rounded">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            LIVE
          </span>
          {currentProgram && (
            <ProgressBar startDate={currentProgram.startDate} endDate={currentProgram.endDate} />
          )}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={onChannelDown} className="p-2 phone:p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors" title="Previous channel (↑)">
            <ChevronUp size={20} className="text-white" />
          </button>
          <button onClick={onChannelUp} className="p-2 phone:p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors" title="Next channel (↓)">
            <ChevronDown size={20} className="text-white" />
          </button>
          <button onClick={onMuteToggle} className="p-2 phone:p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors" title="Mute (M)">
            {isMuted ? <VolumeX size={20} className="text-white" /> : <Volume2 size={20} className="text-white" />}
          </button>
          {/* Volume slider is fiddly on touch; system volume is used on phones */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="w-24 accent-theme-500 phone:hidden"
          />
          <div className="flex-1" />
          <button
            onClick={onOpenGuide}
            className="flex items-center gap-2 px-3 py-2 phone:px-4 phone:py-3 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm font-medium"
            title={isPhone ? 'Minimize to guide' : 'Open guide (G)'}
          >
            <LayoutGrid size={16} className="text-white" />
            <span className="text-white">Guide</span>
          </button>
          {/* On phone the whole overlay is already fullscreen; Guide minimizes. */}
          <button onClick={onToggleFullscreen} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors phone:hidden" title="Fullscreen (F)">
            {isFullscreen ? <Minimize size={20} className="text-white" /> : <Maximize size={20} className="text-white" />}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Error overlay ────────────────────────────────────────────────────────────
function ErrorOverlay({ error, pip, onRetry }: { error: string; pip: boolean; onRetry?: () => void }) {
  if (pip) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-2">
        <p className="text-red-400 text-[10px] text-center">{error}</p>
      </div>
    )
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3">
      <AlertCircle size={40} className="text-red-400" />
      <p className="text-red-300 text-sm text-center max-w-sm px-4">{error}</p>
      {onRetry && (
        <button onClick={onRetry} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors">
          Retry
        </button>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function ProgressBar({ startDate, endDate }: { startDate: Date; endDate: Date }) {
  const now = Date.now()
  const total = endDate.getTime() - startDate.getTime()
  const elapsed = now - startDate.getTime()
  const pct = Math.min(100, Math.max(0, (elapsed / total) * 100))
  return (
    <div className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden max-w-xs">
      <div className="h-full bg-red-500 rounded-full" style={{ width: `${pct}%` }} />
    </div>
  )
}
