import React, { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Volume2, Volume1, VolumeX } from 'lucide-react'

interface VolumeControlProps {
  volume: number
  isMuted: boolean
  onVolumeChange: (value: number) => void
  onToggleMute: () => void
}

const VolumeControl: React.FC<VolumeControlProps> = ({
  volume,
  isMuted,
  onVolumeChange,
  onToggleMute,
}) => {
  const [showSlider, setShowSlider] = useState(false)

  return (
    <>
      <AnimatePresence>
        {showSlider && (
          <motion.div
            initial={{ width: 0, opacity: 0, marginRight: 0 }}
            animate={{ width: 100, opacity: 1, marginRight: 10 }}
            exit={{ width: 0, opacity: 0, marginRight: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="w-full h-1 accent-theme-500 cursor-pointer"
            />
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={onToggleMute}
        onMouseEnter={() => setShowSlider(true)}
        className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200"
      >
        {isMuted || volume === 0 ? (
          <VolumeX size={20} className="text-white" />
        ) : volume < 0.4 ? (
          <Volume1 size={20} className="text-white" />
        ) : (
          <Volume2 size={20} className="text-white" />
        )}
      </button>
    </>
  )
}

export default React.memo(VolumeControl)
