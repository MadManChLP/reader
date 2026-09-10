import React from 'react'
import { Captions, CaptionsOff } from 'lucide-react'

interface CaptionsButtonProps {
  hasSubtitles: boolean
  isEnabled: boolean // selectedSubtitleIndex !== -1
  onToggle: () => void
  isPlayingLocally: boolean
}

const CaptionsButton: React.FC<CaptionsButtonProps> = ({
  hasSubtitles,
  isEnabled,
  onToggle,
  isPlayingLocally,
}) => {
  if (!hasSubtitles || isPlayingLocally) return null

  return (
    <button
      onClick={onToggle}
      className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200"
      title={isEnabled ? 'Disable Subtitles' : 'Enable Subtitles'}
    >
      {isEnabled ? (
        <Captions size={22} className="text-white" />
      ) : (
        <CaptionsOff size={22} className="text-white/50" />
      )}
    </button>
  )
}

export default React.memo(CaptionsButton)
