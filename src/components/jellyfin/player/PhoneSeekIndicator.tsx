import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'

export interface SeekIndicatorState {
  side: 'left' | 'right'
  /** Accumulated seek amount in seconds (positive number, sign implied by side) */
  amount: number
  /** Changes on every tap so the ripple re-triggers while accumulating */
  tapId: number
}

interface PhoneSeekIndicatorProps {
  indicator: SeekIndicatorState | null
}

// YouTube-style double-tap seek feedback (phone only): a semicircular flash
// on the tapped half of the screen with chevrons and the accumulated amount.
const PhoneSeekIndicator: React.FC<PhoneSeekIndicatorProps> = ({ indicator }) => {
  return (
    <AnimatePresence>
      {indicator && (
        <motion.div
          key={indicator.side}
          className={`absolute top-0 bottom-0 w-1/3 flex items-center justify-center pointer-events-none ${
            indicator.side === 'left' ? 'left-0' : 'right-0'
          }`}
          style={{
            zIndex: 3,
            background: 'rgba(255,255,255,0.12)',
            borderRadius: indicator.side === 'left'
              ? '0 50% 50% 0 / 0 50% 50% 0'
              : '50% 0 0 50% / 50% 0 0 50%',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="flex flex-col items-center gap-1">
            {/* Re-mount on every tap so the chevron pulse replays */}
            <motion.div
              key={indicator.tapId}
              initial={{ scale: 0.7, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              {indicator.side === 'left'
                ? <ChevronsLeft size={36} className="text-white drop-shadow-lg" />
                : <ChevronsRight size={36} className="text-white drop-shadow-lg" />}
            </motion.div>
            <span className="text-white text-sm font-semibold drop-shadow-lg tabular-nums">
              {indicator.side === 'left' ? '-' : '+'}{indicator.amount}s
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default React.memo(PhoneSeekIndicator)
