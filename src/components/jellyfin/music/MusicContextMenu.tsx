import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { blockGlobalEsc } from '../../../utils/navigationBus'
import { IS_PHONE } from '../../../utils/api'
import { BottomSheet, BottomSheetAction } from '../../BottomSheet'

export interface ContextMenuItem {
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  /** Draw a separator line above this item */
  separator?: boolean
}

interface MusicContextMenuProps {
  items: ContextMenuItem[]
  position: { x: number; y: number }
  onClose: () => void
}

/**
 * Portal-based context menu for tracks, albums and playlists.
 * Opened from the ⋯ button or right-click/long-press. Desktop gets a floating
 * menu at the pointer; phones get the same actions in a bottom sheet.
 */
export function MusicContextMenu(props: MusicContextMenuProps) {
  if (IS_PHONE) return <MusicContextSheet {...props} />
  return <MusicContextMenuDesktop {...props} />
}

/** Phone presentation: same actions as a bottom sheet (position is irrelevant). */
function MusicContextSheet({ items, onClose }: MusicContextMenuProps) {
  return (
    <BottomSheet onClose={onClose}>
      {items.map((item, i) => (
        <BottomSheetAction
          key={i}
          icon={item.icon}
          label={item.label}
          onClick={item.onClick}
          disabled={item.disabled}
          destructive={item.danger}
          separator={item.separator}
        />
      ))}
    </BottomSheet>
  )
}

function MusicContextMenuDesktop({ items, position, onClose }: MusicContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState(position)

  // Clamp to viewport once rendered
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    let { x, y } = position
    if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8
    if (y + rect.height > window.innerHeight - 8) y = y - rect.height
    setCoords({ x: Math.max(8, x), y: Math.max(8, y) })
  }, [position])

  // Close on Escape (and keep the global Esc=back handler from also firing)
  useEffect(() => {
    const unblock = blockGlobalEsc()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      unblock()
    }
  }, [onClose])

  return createPortal(
    <>
      {/* Backdrop — catches outside clicks/taps.
          stopPropagation everywhere: portal events bubble through the React
          tree into the row that opened the menu (would trigger play). */}
      <div
        className="fixed inset-0 z-[90]"
        onClick={(e) => { e.stopPropagation(); onClose() }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onClose() }}
      />
      <div
        ref={menuRef}
        className="fixed z-[91] min-w-[220px] py-1.5 bg-gray-800 border border-white/10 rounded-xl shadow-2xl shadow-black/60"
        style={{ left: coords.x, top: coords.y }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        {items.map((item, i) => (
          <React.Fragment key={i}>
            {item.separator && <div className="my-1.5 border-t border-white/10" />}
            <button
              onClick={() => {
                if (item.disabled) return
                onClose()
                item.onClick()
              }}
              disabled={item.disabled}
              className={`w-full flex items-center gap-3 px-4 py-2.5 min-h-[44px] text-left text-sm transition-colors
                ${item.disabled
                  ? 'text-white/30 cursor-default'
                  : item.danger
                    ? 'text-red-400 hover:bg-red-500/10 active:bg-red-500/20'
                    : 'text-white/90 hover:bg-white/10 active:bg-white/15'}`}
            >
              <item.icon size={18} className="flex-shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          </React.Fragment>
        ))}
      </div>
    </>,
    document.body
  )
}

/**
 * Small hook that manages open/close + position for a context menu.
 * Use openAt(e) in onClick of a ⋯ button or in onContextMenu.
 */
export function useContextMenu() {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

  const openAt = (e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }) => {
    e.preventDefault?.()
    e.stopPropagation?.()
    setMenuPosition({ x: e.clientX, y: e.clientY })
  }

  const close = () => setMenuPosition(null)

  // Phone-only long-press detector (500ms hold, cancelled by >10px movement)
  // for elements whose ⋯ trigger is hover-revealed and thus unreachable on
  // touch. Spread onto the element root; empty on desktop (right-click keeps
  // working through onContextMenu there).
  const pressRef = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null)
  const longPressHandlers = useMemo<React.HTMLAttributes<HTMLElement>>(() => {
    if (!IS_PHONE) return {}
    const cancel = () => {
      const s = pressRef.current
      if (s && !s.fired) {
        clearTimeout(s.timer)
        pressRef.current = null
      }
    }
    return {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType !== 'touch') return
        const { clientX: x, clientY: y } = e
        const state = { timer: 0, x, y, fired: false }
        state.timer = window.setTimeout(() => {
          state.fired = true
          setMenuPosition({ x, y })
        }, 500)
        pressRef.current = state
      },
      onPointerMove: (e: React.PointerEvent) => {
        const s = pressRef.current
        if (s && !s.fired && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel()
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      // Swallow the synthetic click that follows a fired long-press (would
      // otherwise also trigger the row/card's own onClick)
      onClickCapture: (e: React.MouseEvent) => {
        if (pressRef.current?.fired) {
          e.preventDefault()
          e.stopPropagation()
          pressRef.current = null
        }
      },
    }
  }, [])

  return { menuPosition, openAt, close, isOpen: menuPosition !== null, longPressHandlers }
}
