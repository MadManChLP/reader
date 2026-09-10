import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SkipForward } from 'lucide-react'

interface SkipIntroButtonProps {
  visible: boolean
  onSkip: () => void
  controlsVisible: boolean
}

const SkipIntroButton: React.FC<SkipIntroButtonProps> = ({ visible, onSkip, controlsVisible }) => (
  <AnimatePresence>
    {visible && (
      <motion.div
        initial={{ opacity: 0, x: 20, scale: 0.9 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: 20, scale: 0.9 }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 30,
        }}
        className="absolute right-6 z-20"
        style={{
          bottom: controlsVisible ? '20vh' : '6em',
          transition: 'bottom 0.3s ease-in-out',
        }}
      >
        <button
          onClick={onSkip}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white text-base transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: 'rgba(20, 20, 20, 0.6)',
            backdropFilter: 'blur(16px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
          }}
        >
          <SkipForward size={20} />
          Skip Intro
        </button>
      </motion.div>
    )}
  </AnimatePresence>
)

export default React.memo(SkipIntroButton)
