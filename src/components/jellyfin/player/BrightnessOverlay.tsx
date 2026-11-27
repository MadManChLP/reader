import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sun, SunDim } from 'lucide-react'

interface BrightnessOverlayProps {
  visible: boolean
  /** 0 = fully dimmed, 1 = no dim (full brightness) */
  brightness: number
}

// Center-screen glassmorphic indicator for the phone left-zone vertical swipe.
// Mirrors VolumeOverlay; "brightness" is an in-app dim overlay (no real HW
// brightness — that needs an iOS entitlement Sideloadly can't provide).
const BrightnessOverlay: React.FC<BrightnessOverlayProps> = ({ visible, brightness }) => (
  <AnimatePresence>
    {visible && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none flex flex-col items-center gap-3 px-6 py-4 rounded-2xl"
        style={{
          background: 'rgba(20, 20, 20, 0.6)',
          backdropFilter: 'blur(16px) saturate(180%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          minWidth: '140px',
        }}
      >
        {brightness < 0.4 ? (
          <SunDim size={28} className="text-white" />
        ) : (
          <Sun size={28} className="text-white" />
        )}
        <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-theme-500 rounded-full transition-all duration-100"
            style={{ width: `${brightness * 100}%` }}
          />
        </div>
        <span className="text-white/80 text-xs font-medium tabular-nums">
          {Math.round(brightness * 100)}%
        </span>
      </motion.div>
    )}
  </AnimatePresence>
)

export default React.memo(BrightnessOverlay)
