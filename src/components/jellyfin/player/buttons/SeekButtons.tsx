import React from 'react'
import { Rewind, FastForward } from 'lucide-react'

interface SeekButtonsProps {
  seekBackSeconds: number
  seekForwardSeconds: number
  onSeekBack: () => void
  onSeekForward: () => void
}

const SeekButtons: React.FC<SeekButtonsProps> = ({
  seekBackSeconds,
  seekForwardSeconds,
  onSeekBack,
  onSeekForward,
}) => (
  <>
    <button
      onClick={onSeekBack}
      className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
      title={`Skip back ${seekBackSeconds} seconds`}
    >
      <Rewind size={22} className="text-white" />
    </button>
    <button
      onClick={onSeekForward}
      className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
      title={`Skip forward ${seekForwardSeconds} seconds`}
    >
      <FastForward size={22} className="text-white" />
    </button>
  </>
)

export default React.memo(SeekButtons)
