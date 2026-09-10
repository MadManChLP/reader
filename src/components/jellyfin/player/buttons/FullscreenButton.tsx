import React from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'

interface FullscreenButtonProps {
  isFullscreen: boolean
  onToggle: () => void
}

const FullscreenButton: React.FC<FullscreenButtonProps> = ({ isFullscreen, onToggle }) => (
  <button
    onClick={onToggle}
    className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200"
  >
    {isFullscreen ? (
      <Minimize2 size={22} className="text-white" />
    ) : (
      <Maximize2 size={22} className="text-white" />
    )}
  </button>
)

export default React.memo(FullscreenButton)
