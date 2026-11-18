import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Lock, Unlock } from 'lucide-react'

interface PhoneLockOverlayProps {
  visible: boolean
  onUnlock: () => void
}

const ICON_HIDE_MS = 3000
const CONFIRM_WINDOW_MS = 2500

// Phone player lock: a full-screen layer that swallows all touch input while
// locked. Only a small semi-transparent lock button is interactive; the first
// tap on it arms a confirm state ("tap again to unlock"), the second tap
// within the window unlocks. Tapping anywhere else just (re)shows the button.
const PhoneLockOverlay: React.FC<PhoneLockOverlayProps> = ({ visible, onUnlock }) => {
  const [iconVisible, setIconVisible] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = () => {
    if (hideTimeoutRef.current) { clearTimeout(hideTimeoutRef.current); hideTimeoutRef.current = null }
    if (confirmTimeoutRef.current) { clearTimeout(confirmTimeoutRef.current); confirmTimeoutRef.current = null }
  }

  const scheduleHide = () => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    hideTimeoutRef.current = setTimeout(() => {
      setIconVisible(false)
      setConfirming(false)
    }, ICON_HIDE_MS)
  }

  // Reset state whenever the lock engages/disengages
  useEffect(() => {
    if (visible) {
      setIconVisible(true)
      setConfirming(false)
      scheduleHide()
    }
    return clearTimers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  if (!visible) return null

  const handleOverlayTap = (e: React.MouseEvent) => {
    // Swallow everything — this is the whole point of the lock
    e.stopPropagation()
    e.preventDefault()
    setIconVisible(true)
    scheduleHide()
  }

  const handleLockButtonTap = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (confirming) {
      clearTimers()
      onUnlock()
      return
    }
    setConfirming(true)
    scheduleHide()
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    confirmTimeoutRef.current = setTimeout(() => setConfirming(false), CONFIRM_WINDOW_MS)
  }

  return (
    <div
      className="absolute inset-0 z-[90] select-none"
      onClick={handleOverlayTap}
      onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault() }}
      style={{ touchAction: 'none' }}
    >
      <AnimatePresence>
        {iconVisible && (
          <motion.div
            className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
            style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <button
              onClick={handleLockButtonTap}
              className={`p-3.5 rounded-full backdrop-blur-sm transition-colors ${
                confirming ? 'bg-theme-500/80' : 'bg-black/50'
              }`}
              aria-label={confirming ? 'Tap again to unlock' : 'Player locked'}
            >
              {confirming
                ? <Unlock size={22} className="text-white" />
                : <Lock size={22} className="text-white/80" />}
            </button>
            {confirming && (
              <span className="text-white text-xs font-medium px-2.5 py-1 rounded-full bg-black/60">
                Tap again to unlock
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default React.memo(PhoneLockOverlay)
