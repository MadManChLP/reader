import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/shallow'
import { Download } from 'lucide-react'
import CircularProgress from '../CircularProgress'
import { useDownloadCenter, wireDownloadCenter } from './downloadCenterStore'
import { DownloadPanel } from './DownloadPanel'

// Global download button for the top bar of every tab. Idle: plain icon.
// While anything is downloading: progress ring + count badge. Failed
// downloads waiting for a retry show a red dot.
//
// Clicking toggles the unified slide-over panel, rendered via portal (the
// top bars use backdrop-blur, which would trap fixed-position descendants).
export const DownloadCenter = React.memo(function DownloadCenter() {
  const { isOpen, setOpen, toggleOpen } = useDownloadCenter(
    useShallow((s) => ({ isOpen: s.isOpen, setOpen: s.setOpen, toggleOpen: s.toggleOpen })),
  )
  const { activeCount, fraction, hasFailed } = useDownloadCenter(
    useShallow((s) => {
      let count = 0
      let sum = 0
      let known = 0
      let failed = false
      for (const item of s.items) {
        if (item.status === 'failed') {
          failed = true
          continue
        }
        count++
        if (item.fraction !== null) {
          sum += item.fraction
          known++
        }
      }
      return {
        activeCount: count,
        // Round to whole percent so byte events don't re-render every ~512KB
        fraction: known > 0 ? Math.round((sum / known) * 100) / 100 : null,
        hasFailed: failed,
      }
    }),
  )

  // Attach the manager listeners as soon as any top bar renders the button
  useEffect(() => {
    wireDownloadCenter()
  }, [])

  return (
    <>
      <button
        onClick={toggleOpen}
        className={`relative p-2 hover:bg-white/10 rounded-full transition-colors ${isOpen ? 'bg-white/10' : ''}`}
        title="Downloads"
      >
        {activeCount > 0 ? (
          <span className="relative flex items-center justify-center w-5 h-5">
            <CircularProgress
              fraction={fraction}
              size={20}
              strokeWidth={2}
              className="absolute inset-0 text-theme-400"
            />
            <Download size={10} className="text-theme-400" />
          </span>
        ) : (
          <Download size={20} className="text-white/60" />
        )}

        {/* Count badge while anything is queued/downloading */}
        {activeCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-theme-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
            {activeCount}
          </span>
        )}

        {/* Failed indicator when idle */}
        {activeCount === 0 && hasFailed && (
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        )}
      </button>

      {isOpen && createPortal(<DownloadPanel onClose={() => setOpen(false)} />, document.body)}
    </>
  )
})
