import React, { memo, useEffect, useRef, useState } from 'react'
import {
  Play, Pause, RotateCcw, RotateCw, SkipBack, SkipForward,
  Volume2, VolumeX, Gauge, Moon, X, BookAudio,
} from 'lucide-react'
import { useAudiobookPlayer } from '../../stores/audiobookPlayerStore'
import { formatAbsTime } from './absHelpers'
import { useIsPhone } from '../../hooks/useIsPhone'

// Bottom player bar for audiobooks/podcasts.
// PERFORMANCE: the bar itself must NOT subscribe to currentTime — only the
// small scrubber/chapter-label child components below do.

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const SLEEP_OPTIONS: { label: string; minutes: number | 'chapter' | null }[] = [
  { label: 'Off', minutes: null },
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '60 minutes', minutes: 60 },
  { label: 'End of chapter', minutes: 'chapter' },
]

// Scrubber — the only component allowed to subscribe to currentTime broadly
// (exported for reuse in the Reader's audiobook controls menu)
export const AbsScrubber = memo(function AbsScrubber() {
  const currentTime = useAudiobookPlayer((s) => s.currentTime)
  const duration = useAudiobookPlayer((s) => s.duration)
  const seek = useAudiobookPlayer((s) => s.seek)
  const chapters = useAudiobookPlayer((s) => s.chapters)

  const [dragValue, setDragValue] = useState<number | null>(null)
  const value = dragValue ?? currentTime

  return (
    <div className="flex items-center gap-3 w-full">
      <span className="text-[11px] text-white/50 tabular-nums w-16 text-right">{formatAbsTime(value)}</span>
      <div className="relative flex-1 h-4 flex items-center group">
        {/* Chapter tick marks */}
        {duration > 0 &&
          chapters.slice(1).map((chapter) => (
            <div
              key={chapter.id}
              className="absolute top-1/2 -translate-y-1/2 w-px h-1.5 bg-white/30 pointer-events-none"
              style={{ left: `${(chapter.start / duration) * 100}%` }}
            />
          ))}
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={1}
          value={value}
          onChange={(e) => setDragValue(parseFloat(e.target.value))}
          onPointerUp={() => {
            if (dragValue !== null) {
              seek(dragValue)
              setDragValue(null)
            }
          }}
          onKeyUp={() => {
            if (dragValue !== null) {
              seek(dragValue)
              setDragValue(null)
            }
          }}
          className="w-full h-1 accent-theme-500 cursor-pointer"
        />
      </div>
      <span className="text-[11px] text-white/50 tabular-nums w-16">{formatAbsTime(duration)}</span>
    </div>
  )
})

// Current chapter label — isolated because it derives from currentTime
export const AbsChapterLabel = memo(function AbsChapterLabel() {
  const chapterTitle = useAudiobookPlayer((s) => {
    const { chapters, currentTime } = s
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (currentTime >= chapters[i].start) return chapters[i].title
    }
    return null
  })
  if (!chapterTitle) return null
  return <p className="text-xs text-white/40 truncate">{chapterTitle}</p>
})

export const AbsPlayerBar = memo(function AbsPlayerBar() {
  const currentItem = useAudiobookPlayer((s) => s.currentItem)
  const displayTitle = useAudiobookPlayer((s) => s.displayTitle)
  const displayAuthor = useAudiobookPlayer((s) => s.displayAuthor)
  const coverUrl = useAudiobookPlayer((s) => s.coverUrl)
  const isPlaying = useAudiobookPlayer((s) => s.isPlaying)
  const hasChapters = useAudiobookPlayer((s) => s.chapters.length > 0)
  const volume = useAudiobookPlayer((s) => s.volume)
  const isMuted = useAudiobookPlayer((s) => s.isMuted)
  const playbackRate = useAudiobookPlayer((s) => s.playbackRate)
  const sleepTimer = useAudiobookPlayer((s) => s.sleepTimer)

  const toggle = useAudiobookPlayer((s) => s.toggle)
  const seekRelative = useAudiobookPlayer((s) => s.seekRelative)
  const nextChapter = useAudiobookPlayer((s) => s.nextChapter)
  const prevChapter = useAudiobookPlayer((s) => s.prevChapter)
  const setVolume = useAudiobookPlayer((s) => s.setVolume)
  const toggleMute = useAudiobookPlayer((s) => s.toggleMute)
  const setPlaybackRate = useAudiobookPlayer((s) => s.setPlaybackRate)
  const setSleepTimer = useAudiobookPlayer((s) => s.setSleepTimer)
  const stop = useAudiobookPlayer((s) => s.stop)

  const isPhone = useIsPhone()
  const [openMenu, setOpenMenu] = useState<'speed' | 'sleep' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openMenu) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [openMenu])

  const handleSleepSelect = (minutes: number | 'chapter' | null) => {
    if (minutes === null) {
      setSleepTimer(null)
    } else if (minutes === 'chapter') {
      const state = useAudiobookPlayer.getState()
      const idx = state.getCurrentChapterIndex()
      const end = idx >= 0 ? state.chapters[idx].end : state.duration
      setSleepTimer({ kind: 'chapter', endsAtMediaTime: end })
    } else {
      setSleepTimer({ kind: 'time', endsAtMs: Date.now() + minutes * 60 * 1000 })
    }
    setOpenMenu(null)
  }

  if (!currentItem) return null

  // PHONE: compact two-row bar (info + transport, then scrubber); desktop JSX below unchanged
  if (isPhone) {
    return (
      <div ref={menuRef} className="flex-shrink-0 px-3 pt-2 pb-1 flex flex-col gap-1 bg-black/60 backdrop-blur-md border-t border-white/5 relative">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <BookAudio size={18} className="text-white/30" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{displayTitle}</p>
            <AbsChapterLabel />
          </div>
          <button
            onClick={() => setOpenMenu(openMenu === 'speed' ? null : 'speed')}
            className={`px-1.5 py-1 rounded-full text-xs font-medium transition-colors ${
              playbackRate !== 1 ? 'text-theme-400 bg-theme-500/10' : 'text-white/60'
            }`}
            title="Playback speed"
          >
            {playbackRate}x
          </button>
          <button
            onClick={() => setOpenMenu(openMenu === 'sleep' ? null : 'sleep')}
            className={`p-1.5 rounded-full transition-colors ${
              sleepTimer ? 'text-theme-400 bg-theme-500/10' : 'text-white/60'
            }`}
            title="Sleep timer"
          >
            <Moon size={16} />
          </button>
          <button onClick={() => seekRelative(-30)} className="p-1.5 text-white/70 active:text-white transition-colors" title="Back 30 seconds">
            <RotateCcw size={20} />
          </button>
          <button
            onClick={toggle}
            className="p-2.5 bg-white text-gray-900 rounded-full active:scale-95 transition-transform"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <button onClick={() => seekRelative(30)} className="p-1.5 text-white/70 active:text-white transition-colors" title="Forward 30 seconds">
            <RotateCw size={20} />
          </button>
          <button onClick={stop} className="p-1.5 text-white/40 active:text-white transition-colors" title="Stop and close player">
            <X size={16} />
          </button>
        </div>
        <AbsScrubber />

        {openMenu === 'speed' && (
          <div className="absolute bottom-full mb-2 right-2 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl py-2 w-36 z-50">
            {SPEED_OPTIONS.map((speed) => (
              <button
                key={speed}
                onClick={() => {
                  setPlaybackRate(speed)
                  setOpenMenu(null)
                }}
                className={`w-full px-4 py-1.5 text-left text-sm transition-colors ${
                  playbackRate === speed ? 'text-theme-400 font-medium' : 'text-white/70 active:text-white'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
        )}
        {openMenu === 'sleep' && (
          <div className="absolute bottom-full mb-2 right-2 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl py-2 w-44 z-50">
            {SLEEP_OPTIONS.map((option) => (
              <button
                key={option.label}
                onClick={() => handleSleepSelect(option.minutes)}
                className="w-full px-4 py-1.5 text-left text-sm text-white/70 active:text-white transition-colors"
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-shrink-0 h-[84px] px-4 flex items-center gap-4 bg-black/60 backdrop-blur-md border-t border-white/5 relative">
      {/* Now playing */}
      <div className="flex items-center gap-3 w-72 min-w-0">
        <div className="w-14 h-14 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <BookAudio size={24} className="text-white/30" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{displayTitle}</p>
          {displayAuthor && <p className="text-xs text-white/50 truncate">{displayAuthor}</p>}
          <AbsChapterLabel />
        </div>
      </div>

      {/* Center: controls + scrubber */}
      <div className="flex-1 flex flex-col items-center gap-1 min-w-0">
        <div className="flex items-center gap-2">
          {hasChapters && (
            <button onClick={prevChapter} className="p-2 text-white/60 hover:text-white transition-colors" title="Previous chapter">
              <SkipBack size={16} />
            </button>
          )}
          <button onClick={() => seekRelative(-30)} className="p-2 text-white/60 hover:text-white transition-colors" title="Back 30 seconds">
            <RotateCcw size={18} />
          </button>
          <button
            onClick={toggle}
            className="p-3 bg-white text-gray-900 rounded-full hover:scale-105 transition-transform"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button onClick={() => seekRelative(30)} className="p-2 text-white/60 hover:text-white transition-colors" title="Forward 30 seconds">
            <RotateCw size={18} />
          </button>
          {hasChapters && (
            <button onClick={nextChapter} className="p-2 text-white/60 hover:text-white transition-colors" title="Next chapter">
              <SkipForward size={16} />
            </button>
          )}
        </div>
        <AbsScrubber />
      </div>

      {/* Right: speed, sleep, volume, close */}
      <div className="flex items-center gap-1 w-72 justify-end" ref={menuRef}>
        <button
          onClick={() => setOpenMenu(openMenu === 'speed' ? null : 'speed')}
          className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-medium transition-colors ${
            playbackRate !== 1 ? 'text-theme-400 bg-theme-500/10' : 'text-white/60 hover:text-white hover:bg-white/10'
          }`}
          title="Playback speed"
        >
          <Gauge size={16} />
          {playbackRate}x
        </button>

        <button
          onClick={() => setOpenMenu(openMenu === 'sleep' ? null : 'sleep')}
          className={`p-2 rounded-full transition-colors ${
            sleepTimer ? 'text-theme-400 bg-theme-500/10' : 'text-white/60 hover:text-white hover:bg-white/10'
          }`}
          title="Sleep timer"
        >
          <Moon size={16} />
        </button>

        <button onClick={toggleMute} className="p-2 text-white/60 hover:text-white transition-colors" title={isMuted ? 'Unmute' : 'Mute'}>
          {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={isMuted ? 0 : volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-20 h-1 accent-theme-500 cursor-pointer"
        />

        <button onClick={stop} className="p-2 text-white/40 hover:text-white transition-colors ml-1" title="Stop and close player">
          <X size={16} />
        </button>

        {/* Menus */}
        {openMenu === 'speed' && (
          <div className="absolute bottom-[92px] right-24 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl py-2 w-36 z-50">
            {SPEED_OPTIONS.map((speed) => (
              <button
                key={speed}
                onClick={() => {
                  setPlaybackRate(speed)
                  setOpenMenu(null)
                }}
                className={`w-full px-4 py-1.5 text-left text-sm transition-colors ${
                  playbackRate === speed ? 'text-theme-400 font-medium' : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
        )}
        {openMenu === 'sleep' && (
          <div className="absolute bottom-[92px] right-16 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl py-2 w-44 z-50">
            {SLEEP_OPTIONS.map((option) => (
              <button
                key={option.label}
                onClick={() => handleSleepSelect(option.minutes)}
                className="w-full px-4 py-1.5 text-left text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
