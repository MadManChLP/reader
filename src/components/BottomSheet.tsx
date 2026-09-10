import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useDragControls, type PanInfo } from 'framer-motion'
import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import { blockGlobalEsc, registerBackHandler } from '../utils/navigationBus'
import { hapticLight, hapticSelection } from '../utils/haptics'

// Reusable phone bottom sheet. Portal-rendered into document.body (top bars
// use backdrop-blur, which traps fixed-position descendants — same reason as
// the DownloadCenter panel). Slides up on mount, slides down before calling
// onClose (backdrop tap, Escape, back gesture, or dragging the handle down).
//
// z-[70]: above the phone fullscreen players (MusicNowPlaying is z-50, its
// queue/lyrics panels are z-[60]) so sheets opened from those still stack on top.

interface BottomSheetProps {
  /** Optional header shown under the drag handle */
  title?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}

// Lets BottomSheetAction trigger the animated close without every caller
// having to wire it through props
const BottomSheetCloseContext = createContext<(() => void) | null>(null)

export function BottomSheet({ title, onClose, children }: BottomSheetProps) {
  // Closing plays the slide-down animation first; onClose (which unmounts us)
  // only fires once the sheet is off-screen
  const [closing, setClosing] = useState(false)
  const dragControls = useDragControls()

  const requestClose = useCallback(() => setClosing(true), [])

  // Subtle feedback when the sheet appears
  useEffect(() => {
    hapticLight()
  }, [])

  // Escape closes (while keeping the global Esc=back dispatcher silent), and
  // the phone back gesture / mouse-back closes via the back-handler stack
  useEffect(() => {
    const unblock = blockGlobalEsc()
    const unregister = registerBackHandler(() => {
      requestClose()
      return true
    })
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      unblock()
      unregister()
    }
  }, [requestClose])

  // Dismiss when dragged far enough down or flicked
  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) requestClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      {/* Backdrop — catches outside taps. stopPropagation: portal events
          bubble through the React tree into the element that opened us. */}
      <motion.div
        className="absolute inset-0 bg-black/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => {
          e.stopPropagation()
          requestClose()
        }}
      />

      {/* Sheet */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 max-h-[85vh] flex flex-col bg-gray-900 border-t border-white/10 rounded-t-2xl shadow-2xl shadow-black/60 pb-safe"
        initial={{ y: '100%' }}
        animate={{ y: closing ? '100%' : 0 }}
        transition={{ type: 'spring', damping: 32, stiffness: 380 }}
        onAnimationComplete={() => {
          if (closing) onClose()
        }}
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0 }}
        dragElastic={0}
        dragMomentum={false}
        dragSnapToOrigin
        onDragEnd={handleDragEnd}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle + optional title (the drag hot zone — dragging the
            content area must keep scrolling it instead) */}
        <div
          className="flex-shrink-0 touch-none"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="mx-auto mt-2.5 mb-1 w-9 h-1 rounded-full bg-white/25" />
          {title && (
            <div className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white/80">
              {title}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pt-1 pb-2">
          <BottomSheetCloseContext.Provider value={requestClose}>
            {children}
          </BottomSheetCloseContext.Provider>
        </div>
      </motion.div>
    </div>,
    document.body
  )
}

export interface BottomSheetActionProps {
  icon?: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  /** Red styling for destructive actions */
  destructive?: boolean
  /** Draw a separator line above this row */
  separator?: boolean
  /** Radio-style row: show a check mark when active */
  selected?: boolean
}

/**
 * Touch-sized action row for menu-style sheets. Runs onClick, then closes the
 * surrounding sheet (animated) via context.
 */
export function BottomSheetAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  destructive,
  separator,
  selected,
}: BottomSheetActionProps) {
  const requestClose = useContext(BottomSheetCloseContext)

  return (
    <>
      {separator && <div className="my-1.5 border-t border-white/10" />}
      <button
        onClick={() => {
          if (disabled) return
          hapticSelection()
          onClick()
          requestClose?.()
        }}
        disabled={disabled}
        className={`w-full flex items-center gap-3 px-4 py-3 min-h-[48px] rounded-lg text-left text-[15px] transition-colors
          ${disabled
            ? 'text-white/30'
            : destructive
              ? 'text-red-400 active:bg-red-500/10'
              : 'text-white/90 active:bg-white/10'}`}
      >
        {Icon && <Icon size={20} className="flex-shrink-0" />}
        <span className="flex-1 truncate">{label}</span>
        {selected && <Check size={18} className="flex-shrink-0 text-theme-400" />}
      </button>
    </>
  )
}

interface BottomSheetSelectProps<T extends string> {
  /** Sheet header, e.g. "Sort by" */
  title?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  /** Trigger button styling override (default mimics the desktop selects) */
  className?: string
}

/**
 * Phone replacement for a `<select>`: a trigger button that opens a
 * BottomSheet of radio-style rows with a check on the active option.
 */
export function BottomSheetSelect<T extends string>({
  title,
  value,
  options,
  onChange,
  className,
}: BottomSheetSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={className ?? `flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown size={16} className="text-white/50 flex-shrink-0" />
      </button>

      {open && (
        <BottomSheet title={title} onClose={() => setOpen(false)}>
          {options.map((opt) => (
            <BottomSheetAction
              key={opt.value}
              label={opt.label}
              selected={opt.value === value}
              onClick={() => onChange(opt.value)}
            />
          ))}
        </BottomSheet>
      )}
    </>
  )
}
