import React, { useRef, useEffect } from 'react'
import { Moon, Settings } from 'lucide-react'
import type { MediaStream } from './types'
import { getTrackDisplayName } from './types'
import SleepTimerPanel from './SleepTimerPanel'
import { IS_PHONE } from '../../../utils/api'
import { BottomSheet } from '../../BottomSheet'

interface SettingsMenuProps {
  visible: boolean
  onClose: () => void
  /** Local/offline playback: track switching is unavailable (no server session) */
  isPlayingLocally?: boolean
  /** Sleep timer end-of-item wording: "episode" for series, "movie" otherwise */
  endOfItemLabel?: string
  audioTracks: MediaStream[]
  subtitleTracks: MediaStream[]
  selectedAudioIndex: number | null
  selectedSubtitleIndex: number
  onAudioTrackChange: (index: number) => void
  onSubtitleTrackChange: (index: number) => void
  showStats: boolean
  onToggleStats: () => void
}

const SettingsMenu: React.FC<SettingsMenuProps> = ({
  visible,
  onClose,
  isPlayingLocally = false,
  endOfItemLabel = 'episode',
  audioTracks,
  subtitleTracks,
  selectedAudioIndex,
  selectedSubtitleIndex,
  onAudioTrackChange,
  onSubtitleTrackChange,
  showStats,
  onToggleStats,
}) => {
  const ref = useRef<HTMLDivElement>(null)

  // Click outside to close (desktop popover only — the phone sheet has its
  // own backdrop, and this listener would misfire on the portal content)
  useEffect(() => {
    if (!visible || IS_PHONE) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [visible, onClose])

  if (!visible) return null

  // Shared between the desktop popover and the phone bottom sheet — only the
  // container differs
  const content = (
      <div className="flex flex-col gap-4">
        {/* Audio Track Select */}
        {!isPlayingLocally && audioTracks.length > 1 && (
          <div>
            <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 block">Audio</label>
            <select
              value={selectedAudioIndex ?? ''}
              onChange={(e) => onAudioTrackChange(parseInt(e.target.value))}
              className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 border border-white/10 outline-none focus:border-theme-500 transition-colors"
            >
              {audioTracks.map(track => (
                <option key={track.Index} value={track.Index} className="bg-gray-900">
                  {getTrackDisplayName(track)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Subtitle Track Select */}
        {!isPlayingLocally && subtitleTracks.length > 0 && (
          <div>
            <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 block">Subtitles</label>
            <select
              value={selectedSubtitleIndex}
              onChange={(e) => onSubtitleTrackChange(parseInt(e.target.value))}
              className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 border border-white/10 outline-none focus:border-theme-500 transition-colors"
            >
              <option value={-1} className="bg-gray-900">No Subtitle</option>
              {subtitleTracks.map(track => (
                <option key={track.Index} value={track.Index} className="bg-gray-900">
                  {getTrackDisplayName(track)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Sleep Timer */}
        <div>
          <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Moon size={12} />
            Sleep Timer
          </label>
          <SleepTimerPanel target="video" endOfItemLabel={endOfItemLabel} />
        </div>

        {/* Stats for Nerds Toggle */}
        <div
          className="flex items-center justify-between py-2 px-1 cursor-pointer hover:bg-white/5 rounded-lg transition-colors"
          onClick={onToggleStats}
        >
          <span className="text-white text-sm font-medium">Stats for Nerds</span>
          <div className={`w-10 h-5 rounded-full transition-colors duration-200 ${showStats ? 'bg-theme-500' : 'bg-white/20'} relative`}>
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${showStats ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </div>
        </div>
      </div>
  )

  // Phone: same options in a bottom sheet
  if (IS_PHONE) {
    return (
      <BottomSheet
        title={<><Settings size={16} />Settings</>}
        onClose={onClose}
      >
        <div className="px-3 pb-2">{content}</div>
      </BottomSheet>
    )
  }

  return (
    <div
      ref={ref}
      className="absolute top-16 right-8 z-30 w-80 overflow-hidden"
      style={{
        background: 'rgba(20, 20, 20, 0.6)',
        backdropFilter: 'blur(16px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        padding: '1em',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </div>
  )
}

export default React.memo(SettingsMenu)
