import React, { memo } from 'react'
import { Play, Pause, RotateCcw, RotateCw, SkipBack, SkipForward, BookAudio } from 'lucide-react'
import { useAudiobookPlayer } from '../../stores/audiobookPlayerStore'
import { AbsScrubber, AbsChapterLabel } from '../audiobookshelf/AbsPlayerBar'

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2]

// Dropdown with audiobook playback controls, shown from the Reader header
// (EPUB/PDF) so listening can be controlled without leaving the book.
// Styled to match the reader's other dropdowns (PDF settings, EPUB settings).
export const AudiobookControlsMenu = memo(function AudiobookControlsMenu() {
  const displayTitle = useAudiobookPlayer((s) => s.displayTitle)
  const displayAuthor = useAudiobookPlayer((s) => s.displayAuthor)
  const coverUrl = useAudiobookPlayer((s) => s.coverUrl)
  const isPlaying = useAudiobookPlayer((s) => s.isPlaying)
  const hasChapters = useAudiobookPlayer((s) => s.chapters.length > 0)
  const playbackRate = useAudiobookPlayer((s) => s.playbackRate)

  const toggle = useAudiobookPlayer((s) => s.toggle)
  const seekRelative = useAudiobookPlayer((s) => s.seekRelative)
  const nextChapter = useAudiobookPlayer((s) => s.nextChapter)
  const prevChapter = useAudiobookPlayer((s) => s.prevChapter)
  const setPlaybackRate = useAudiobookPlayer((s) => s.setPlaybackRate)

  return (
    <div className="absolute top-full right-0 mt-4 w-80 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4 text-white animate-in slide-in-from-top-5 fade-in duration-200">
      {/* Now playing */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <BookAudio size={20} className="text-white/30" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{displayTitle}</p>
          {displayAuthor && <p className="text-xs text-white/50 truncate">{displayAuthor}</p>}
          <AbsChapterLabel />
        </div>
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-2">
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

      {/* Scrubber */}
      <AbsScrubber />

      {/* Speed */}
      <div>
        <div className="text-[10px] uppercase tracking-wider font-bold text-white/50 mb-2">Speed</div>
        <div className="grid grid-cols-6 gap-1">
          {SPEED_OPTIONS.map((speed) => (
            <button
              key={speed}
              onClick={() => setPlaybackRate(speed)}
              className={`py-1.5 text-xs rounded-lg transition-colors ${
                playbackRate === speed ? 'bg-theme-500 text-white' : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  )
})
