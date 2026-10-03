import React, { useCallback, useEffect, useState, memo } from 'react'
import { useShallow } from 'zustand/shallow'
import LocalOrRemoteImage from '../../LocalOrRemoteImage'
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Volume1,
  Shuffle, Repeat, Repeat1,
  ListMusic, Mic2, Download, Check, Loader2, Moon
} from 'lucide-react'
import { useJellyfin } from '../JellyfinContext'
import { api as appApi } from '../../../utils/api'
import { useIsPhone } from '../../../hooks/useIsPhone'
import { MusicNowPlaying } from './MusicNowPlaying'
import { useMusicPlayer, formatTime, getLocalTrackImage, type LyricLine } from '../../../stores/musicPlayerStore'
import { useSleepTimer } from '../../../stores/sleepTimerStore'
import SleepTimerPanel, { SleepTimerCountdown } from '../player/SleepTimerPanel'
import {
  addTrackToQueue,
  isTrackDownloaded,
  isTrackInQueue,
  subscribeToMusicDownloadUpdates,
  type MusicDownloadQueueItem
} from '../../../utils/musicDownloadManager'

interface MusicPlayerBarProps {
  // Spotify-style navigation: click title → album, click artist → artist page
  onNavigateToAlbum?: (albumId: string, albumName?: string) => void
  onNavigateToArtist?: (artistId: string, artistName?: string) => void
}

export const MusicPlayerBar = memo(function MusicPlayerBar({ onNavigateToAlbum, onNavigateToArtist }: MusicPlayerBarProps) {
  const { serverUrl, api, getImageUrl, serverId, accessToken } = useJellyfin()
  // The bar shows the progress slider, so currentTime is needed here (4x/sec
  // re-render while playing is inherent); useShallow still skips queue churn.
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    shuffleMode,
    repeatMode,
    isQueueOpen,
    isLyricsOpen,
    lyrics,
    lyricsLoading,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    toggleQueueOpen,
    toggleLyricsOpen,
    setLyrics,
    setLyricsLoading,
    setLyricsError,
    clearLyrics
  } = useMusicPlayer(useShallow(s => ({
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    currentTime: s.currentTime,
    duration: s.duration,
    volume: s.volume,
    isMuted: s.isMuted,
    shuffleMode: s.shuffleMode,
    repeatMode: s.repeatMode,
    isQueueOpen: s.isQueueOpen,
    isLyricsOpen: s.isLyricsOpen,
    lyrics: s.lyrics,
    lyricsLoading: s.lyricsLoading,
    toggle: s.toggle,
    next: s.next,
    previous: s.previous,
    seek: s.seek,
    setVolume: s.setVolume,
    toggleMute: s.toggleMute,
    toggleShuffle: s.toggleShuffle,
    cycleRepeat: s.cycleRepeat,
    toggleQueueOpen: s.toggleQueueOpen,
    toggleLyricsOpen: s.toggleLyricsOpen,
    setLyrics: s.setLyrics,
    setLyricsLoading: s.setLyricsLoading,
    setLyricsError: s.setLyricsError,
    clearLyrics: s.clearLyrics,
  })))

  // Phone: compact bar + tap-to-expand fullscreen Now Playing view
  const isPhone = useIsPhone()
  const [isExpanded, setIsExpanded] = useState(false)

  // Sleep timer popover (desktop right cluster)
  const [isSleepOpen, setIsSleepOpen] = useState(false)
  const sleepPopoverRef = React.useRef<HTMLDivElement>(null)
  // Narrow selector: 'minutes' | 'endOfItem' | null for the music target
  const sleepKind = useSleepTimer(s => (s.target === 'music' ? s.mode?.kind ?? null : null))

  // Close the sleep popover on outside click
  useEffect(() => {
    if (!isSleepOpen) return
    const handleClick = (e: MouseEvent) => {
      if (sleepPopoverRef.current && !sleepPopoverRef.current.contains(e.target as Node)) {
        setIsSleepOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isSleepOpen])

  // Download state for current track
  const [isCurrentDownloaded, setIsCurrentDownloaded] = useState(false)
  const [currentDownloadItem, setCurrentDownloadItem] = useState<MusicDownloadQueueItem | null>(null)

  useEffect(() => {
    if (!currentTrack?.id) {
      setIsCurrentDownloaded(false)
      setCurrentDownloadItem(null)
      return
    }
    setIsCurrentDownloaded(isTrackDownloaded(currentTrack.id))
    setCurrentDownloadItem(isTrackInQueue(currentTrack.id))
    const unsub = subscribeToMusicDownloadUpdates((queue) => {
      if (!currentTrack?.id) return
      const item = queue.find(q => q.id === currentTrack.id)
      setCurrentDownloadItem(item || null)
      if (!item) setIsCurrentDownloaded(isTrackDownloaded(currentTrack.id))
    })
    return unsub
  }, [currentTrack?.id])

  const handleDownloadCurrentTrack = useCallback(() => {
    if (!currentTrack || !serverUrl || !serverId || !accessToken) return
    addTrackToQueue(currentTrack, serverUrl, serverId, accessToken)
  }, [currentTrack, serverUrl, serverId, accessToken])

  // Track playback for scrobbling
  const lastReportedTime = React.useRef<number>(0)
  const isStarted = React.useRef<boolean>(false)
  const currentTrackId = React.useRef<string | null>(null)
  const currentTimeRef = React.useRef<number>(0)
  currentTimeRef.current = currentTime

  // Report playback start
  useEffect(() => {
    if (!currentTrack || !serverUrl || !api) {
      isStarted.current = false
      currentTrackId.current = null
      return
    }

    if (currentTrack.id !== currentTrackId.current) {
      // New track started
      currentTrackId.current = currentTrack.id
      isStarted.current = false
      lastReportedTime.current = 0
    }

    if (isPlaying && !isStarted.current) {
      const reportStart = async () => {
        try {
          await appApi.request({
            method: 'POST',
            url: `${serverUrl}/Sessions/Playing`,
            headers: {
              'Authorization': `MediaBrowser Token="${api.accessToken}"`,
              'Content-Type': 'application/json'
            },
            data: {
              ItemId: currentTrack.id,
              PositionTicks: Math.round(currentTime * 10000000)
            }
          })
          isStarted.current = true
        } catch (e) {
          console.error('Failed to report playback start:', e)
        }
      }
      reportStart()
    }
  }, [currentTrack?.id, isPlaying, serverUrl, api])

  // Report playback progress
  useEffect(() => {
    if (!isPlaying || !currentTrack || !serverUrl || !api || !isStarted.current) return

    const interval = setInterval(async () => {
      // Report every 15 seconds if time changed significantly
      const ct = currentTimeRef.current
      if (Math.abs(ct - lastReportedTime.current) >= 15) {
        try {
          await appApi.request({
            method: 'POST',
            url: `${serverUrl}/Sessions/Playing/Progress`,
            headers: {
              'Authorization': `MediaBrowser Token="${api.accessToken}"`,
              'Content-Type': 'application/json'
            },
            data: {
              ItemId: currentTrack.id,
              PositionTicks: Math.round(ct * 10000000),
              IsPaused: !isPlaying
            }
          })
          lastReportedTime.current = ct
        } catch (e) {
          console.error('Failed to report playback progress:', e)
        }
      }
    }, 15000)

    return () => clearInterval(interval)
  }, [isPlaying, currentTrack, serverUrl, api])

  // Report playback stopped/finished
  useEffect(() => {
    return () => {
      // This is tricky in a hook, but we want to report stopped when track changes or component unmounts
      // However, usually "Stopped" is reported when reaching the end or manually stopping.
      // Jellyfin automatically marks as played if progress > 90%
    }
  }, [])

  // Report finished when track ends (handled in next() or when progress is high)
  useEffect(() => {
    if (currentTrack && duration > 0 && currentTime / duration > 0.9 && isStarted.current) {
      // We don't report "Stopped" here because Jellyfin usually handles "Finished" 
      // when progress is reported at the very end.
    }
  }, [currentTime, duration, currentTrack])

  // Fetch lyrics when track changes
  // Priority: 1) Jellyfin embedded lyrics  2) LRCLIB.net synced  3) LRCLIB.net plain
  useEffect(() => {
    if (!currentTrack || !serverUrl || !api) {
      clearLyrics()
      return
    }

    let mounted = true

    // Parse LRC format → LyricLine[] with start in ticks (100ns).
    // Matches [mm:ss.SSS], [mm:ss.SS] (centiseconds), and [mm:ss] (no decimal).
    // Matches Feishin's regex: /\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?]([^\n]+)/g
    const parseLrc = (lrc: string): LyricLine[] => {
      const re = /\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?\]([^\n]+)/g
      const lines: LyricLine[] = []
      let m: RegExpExecArray | null
      while ((m = re.exec(lrc)) !== null) {
        const mins = parseInt(m[1], 10)
        const secs = parseInt(m[2], 10)
        const msRaw = m[3]
        // 2-digit = centiseconds → multiply by 10; 3-digit = milliseconds as-is
        const ms = msRaw == null ? 0 : msRaw.length === 3 ? parseInt(msRaw, 10) : parseInt(msRaw, 10) * 10
        const totalMs = (mins * 60 + secs) * 1000 + ms
        const text = m[4].trim()
        if (text) lines.push({ text, start: Math.round(totalMs * 10000) }) // ms → 100ns ticks
      }
      return lines
    }

    // Fetch from LRCLIB.net — must use appApi (routes through Rust HTTP client,
    // bypasses Tauri WebView CSP that blocks direct external fetch calls).
    const fetchLrclib = async (): Promise<LyricLine[] | null> => {
      try {
        const artist = currentTrack.artists[0] || ''
        const durationSecs = Math.floor(currentTrack.duration / 10000000)

        const params = new URLSearchParams({
          artist_name: artist,
          track_name: currentTrack.name,
          album_name: currentTrack.albumName || '',
          duration: String(durationSecs),
        })

        const res = await appApi.request({
          method: 'GET',
          url: `https://lrclib.net/api/get?${params}`,
          headers: {
            'User-Agent': 'Reader App (https://github.com/reader)',
          },
        })

        if (!res.success || !res.data) return null

        const data = res.data

        // Prefer synced LRC over plain text
        if (data.syncedLyrics) {
          const lines = parseLrc(data.syncedLyrics)
          if (lines.length > 0) return lines
        }
        if (data.plainLyrics && typeof data.plainLyrics === 'string' && data.plainLyrics.trim()) {
          return data.plainLyrics
            .split('\n')
            .filter((t: string) => t.trim() !== '')
            .map((t: string) => ({ text: t.trim() }))
        }
        return null
      } catch {
        return null
      }
    }

    const fetchLyrics = async () => {
      setLyricsLoading(true)

      try {
        // 1. Try Jellyfin embedded lyrics
        const res = await appApi.request({
          method: 'GET',
          url: `${serverUrl}/Items/${currentTrack.id}/Lyrics`,
          headers: {
            'Authorization': `MediaBrowser Token="${api.accessToken}"`,
          },
        })

        if (!mounted) return

        if (res.success && res.data?.Lyrics && Array.isArray(res.data.Lyrics) && res.data.Lyrics.length > 0) {
          const raw: Array<{ Text: string; Start?: number }> = res.data.Lyrics
          // Feishin detection: if first lyric has no Start → unsynced (plain text lines)
          if (raw[0].Start === undefined) {
            setLyrics(raw.map(l => ({ text: l.Text })))
          } else {
            setLyrics(raw.map(l => ({ text: l.Text, start: l.Start })))
          }
          return
        }

        // 2. Fallback: LRCLIB.net
        const lrclibLines = await fetchLrclib()
        if (!mounted) return

        setLyrics(lrclibLines && lrclibLines.length > 0 ? lrclibLines : null)
      } catch (error) {
        if (!mounted) return
        console.error('Error fetching lyrics:', error)
        setLyricsError(error instanceof Error ? error.message : 'Failed to load lyrics')
      }
    }

    fetchLyrics()
    return () => {
      mounted = false
      setLyricsLoading(false)
    }
  }, [currentTrack?.id, serverUrl, api?.accessToken])

  // Pointer-based seeking: works for mouse AND touch, supports dragging
  const handleProgressPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    e.preventDefault()
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

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value))
  }, [setVolume])

  // Don't render if no track
  if (!currentTrack) {
    return null
  }

  // Prefer local cover (downloaded tracks) — falls back to Jellyfin API URL (streaming)
  const remoteImageUrl = currentTrack.albumId
    ? getImageUrl(currentTrack.albumId, 'Primary', 120)
    : null
  const localImagePath = getLocalTrackImage(currentTrack)

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  const VolumeIcon = isMuted || volume === 0
    ? VolumeX
    : volume < 0.5
    ? Volume1
    : Volume2

  // PHONE: compact single-row bar (tap info to expand); desktop JSX below unchanged
  if (isPhone) {
    return (
      <>
        <div className="flex-shrink-0 h-14 bg-black/60 backdrop-blur-md border-t border-white/5 relative flex items-center gap-2 px-3">
          {/* Thin progress line across the top */}
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/10">
            <div className="h-full bg-theme-400" style={{ width: `${progressPercent}%` }} />
          </div>
          <button
            onClick={() => setIsExpanded(true)}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
            title="Now Playing"
          >
            {(localImagePath || remoteImageUrl) && (
              <LocalOrRemoteImage
                localPath={localImagePath}
                remoteUrl={remoteImageUrl}
                alt={currentTrack.albumName}
                className="w-10 h-10 rounded object-cover shadow flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{currentTrack.name}</p>
              <p className="text-xs text-white/60 truncate">{currentTrack.artists.join(', ')}</p>
            </div>
          </button>
          <button
            onClick={toggle}
            className="p-2.5 text-white active:scale-95 transition-transform"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
          </button>
          <button
            onClick={next}
            className="p-2.5 text-white/80 active:text-white transition-colors"
            title="Next"
          >
            <SkipForward size={20} fill="currentColor" />
          </button>
        </div>
        {isExpanded && <MusicNowPlaying onClose={() => setIsExpanded(false)} />}
      </>
    )
  }

  return (
    <div className="flex-shrink-0 h-[72px] bg-black/60 backdrop-blur-md border-t border-white/5 px-4 flex items-center gap-4">
      {/* Left: Track info */}
      <div className="flex items-center gap-3 w-1/4 min-w-[180px]">
        {(localImagePath || remoteImageUrl) && (
          <LocalOrRemoteImage
            localPath={localImagePath}
            remoteUrl={remoteImageUrl}
            alt={currentTrack.albumName}
            className="w-14 h-14 rounded-md object-cover shadow-lg"
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {onNavigateToAlbum && currentTrack.albumId ? (
              <button
                onClick={() => onNavigateToAlbum(currentTrack.albumId, currentTrack.albumName)}
                className="hover:underline text-left"
                title={`Go to album: ${currentTrack.albumName}`}
              >
                {currentTrack.name}
              </button>
            ) : (
              currentTrack.name
            )}
          </p>
          <p className="text-xs text-white/60 truncate">
            {currentTrack.artists.map((artistName, i) => (
              <React.Fragment key={`${artistName}-${i}`}>
                {i > 0 && ', '}
                {onNavigateToArtist && currentTrack.artistIds[i] ? (
                  <button
                    onClick={() => onNavigateToArtist(currentTrack.artistIds[i], artistName)}
                    className="hover:underline hover:text-white transition-colors"
                    title={`Go to artist: ${artistName}`}
                  >
                    {artistName}
                  </button>
                ) : (
                  artistName
                )}
              </React.Fragment>
            ))}
          </p>
        </div>
      </div>

      {/* Center: Controls */}
      <div className="w-1/2 flex flex-col items-center justify-center">
        {/* Playback controls */}
        <div className="flex items-center gap-4 mb-1">
          <button
            onClick={toggleShuffle}
            className={`p-2.5 -m-1 rounded-full transition-colors ${
              shuffleMode
                ? 'text-theme-400 hover:text-theme-300'
                : 'text-white/60 hover:text-white'
            }`}
            title="Shuffle"
          >
            <Shuffle size={18} />
          </button>

          <button
            onClick={previous}
            className="p-2.5 -m-1 text-white/80 hover:text-white transition-colors"
            title="Previous"
          >
            <SkipBack size={20} fill="currentColor" />
          </button>

          <button
            onClick={toggle}
            className="p-2.5 bg-white rounded-full text-black hover:scale-105 active:scale-95 transition-transform"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause size={20} fill="currentColor" />
            ) : (
              <Play size={20} fill="currentColor" className="ml-0.5" />
            )}
          </button>

          <button
            onClick={next}
            className="p-2.5 -m-1 text-white/80 hover:text-white transition-colors"
            title="Next"
          >
            <SkipForward size={20} fill="currentColor" />
          </button>

          <button
            onClick={cycleRepeat}
            className={`p-2.5 -m-1 rounded-full transition-colors ${
              repeatMode !== 'off'
                ? 'text-theme-400 hover:text-theme-300'
                : 'text-white/60 hover:text-white'
            }`}
            title={`Repeat: ${repeatMode}`}
          >
            {repeatMode === 'one' ? (
              <Repeat1 size={18} />
            ) : (
              <Repeat size={18} />
            )}
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full flex items-center gap-2">
          <span className="text-[11px] text-white/60 w-10 text-right tabular-nums">
            {formatTime(currentTime)}
          </span>

          {/* Tall touch-friendly hit area (py-2) around the visually thin bar */}
          <div
            className="flex-1 py-2 -my-2 cursor-pointer group relative touch-none"
            onPointerDown={handleProgressPointerDown}
          >
            <div className="h-1 bg-white/20 rounded-full relative">
              <div
                className="h-full bg-white group-hover:bg-theme-400 rounded-full transition-colors"
                style={{ width: `${progressPercent}%` }}
              />
              <div
                className="absolute w-3 h-3 bg-white rounded-full -top-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                style={{ left: `calc(${progressPercent}% - 6px)` }}
              />
            </div>
          </div>

          <span className="text-[11px] text-white/60 w-10 tabular-nums">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Right: Lyrics, Queue & Volume */}
      <div className="flex items-center gap-3 w-1/4 min-w-[180px] justify-end">
        <button
          onClick={toggleLyricsOpen}
          className={`p-1.5 rounded-full transition-colors relative ${
            isLyricsOpen
              ? 'text-theme-400 hover:text-theme-300'
              : lyrics
              ? 'text-white/60 hover:text-white'
              : 'text-white/30 hover:text-white/50'
          }`}
          title={lyrics ? 'Show lyrics' : lyricsLoading ? 'Loading lyrics...' : 'No lyrics available'}
          disabled={lyricsLoading}
        >
          <Mic2 size={18} />
          {lyricsLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-4 h-4 border border-white/30 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </button>

        {/* Download current track */}
        {isCurrentDownloaded ? (
          <span className="p-1.5 text-green-400" title="Downloaded">
            <Check size={18} />
          </span>
        ) : currentDownloadItem ? (
          <span className="p-1.5 text-theme-400" title="Downloading...">
            <Loader2 size={18} className={currentDownloadItem.status === 'downloading' ? 'animate-spin' : ''} />
          </span>
        ) : (
          <button
            onClick={handleDownloadCurrentTrack}
            disabled={!serverUrl || !serverId || !accessToken}
            className="p-1.5 rounded-full transition-colors text-white/60 hover:text-white disabled:text-white/20"
            title="Download track"
          >
            <Download size={18} />
          </button>
        )}

        {/* Sleep timer */}
        <div className="relative" ref={sleepPopoverRef}>
          <button
            onClick={() => setIsSleepOpen(prev => !prev)}
            className={`p-1.5 rounded-full transition-colors flex items-center gap-1 ${
              sleepKind
                ? 'text-theme-400 hover:text-theme-300'
                : 'text-white/60 hover:text-white'
            }`}
            title={sleepKind ? 'Sleep timer active' : 'Sleep timer'}
          >
            <Moon size={18} />
            {sleepKind === 'minutes' && (
              <SleepTimerCountdown className="text-[11px] font-medium tabular-nums" />
            )}
          </button>
          {isSleepOpen && (
            <div
              className="absolute bottom-full right-0 mb-3 w-64 z-40"
              style={{
                background: 'rgba(20, 20, 20, 0.85)',
                backdropFilter: 'blur(16px) saturate(180%)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                padding: '0.875em',
              }}
            >
              <p className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Moon size={12} />
                Sleep Timer
              </p>
              <SleepTimerPanel target="music" endOfItemLabel="track" />
            </div>
          )}
        </div>

        <button
          onClick={toggleQueueOpen}
          className={`p-1.5 rounded-full transition-colors ${
            isQueueOpen
              ? 'text-theme-400 hover:text-theme-300'
              : 'text-white/60 hover:text-white'
          }`}
          title="Queue"
        >
          <ListMusic size={18} />
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            className="p-1.5 text-white/60 hover:text-white transition-colors"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            <VolumeIcon size={18} />
          </button>

          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-24 h-4 accent-theme-500 cursor-pointer"
          />
        </div>
      </div>
    </div>
  )
})
