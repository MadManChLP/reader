import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft } from 'lucide-react'
import { useIsPhone } from '../hooks/useIsPhone'
import { dispatchBack, isEditableTarget } from '../utils/navigationBus'
import { hapticMedium } from '../utils/haptics'

// SwipeBackOverlay — iOS-style edge-swipe back gesture (phone only).
//
// A single touch starting within EDGE_WIDTH px of the LEFT screen edge is
// tracked; once the drag is clearly horizontal it is recognized as a back
// gesture and a glassmorphic chevron puck (à la iOS Safari) slides out from
// the edge, following the finger with resistance — the page content itself
// never moves. Crossing COMMIT_TRAVEL arms the puck (theme-accent fill,
// slight scale-up, one medium haptic); releasing while armed dispatches
// 'swipe' through the navigationBus back-handler stack — same semantics as
// the mouse back button (closes overlays/readers/players before popping view
// history). Releasing early slides the puck back into the edge.
//
// Touch events are intercepted on window in the CAPTURE phase: before
// recognition nothing is prevented (taps and vertical scrolls pass through
// untouched), but once recognized every touchmove/touchend gets
// preventDefault + stopPropagation so underlying swipe consumers — the manga
// reader's page-turn detection (touchend on its container, bubble phase),
// carousels — never see the gesture. Rendered as null on desktop; the puck is
// portal-rendered into document.body above players/readers (z-[100]).

const EDGE_WIDTH = 24 // px from the left edge that can start the gesture
const RECOGNIZE_DX = 10 // min horizontal delta before recognition
const HORIZONTAL_RATIO = 1.5 // dx must exceed |dy| * ratio to recognize
const LINEAR_TRAVEL = 60 // finger tracks 1:1 up to here…
const OVERDRAG_FACTOR = 0.3 // …then damped beyond (rubber-band resistance)
const MAX_TRAVEL = 88 // hard cap on effective puck travel
const COMMIT_TRAVEL = 70 // effective travel that arms the gesture
const PUCK_SIZE = 40 // puck diameter in px
const EXIT_MS = 200 // release animation duration

// Inline transitions (className transitions would be overridden by these):
// while tracking only colors animate — transform must follow the finger raw
const TRACK_TRANSITION = 'background-color 150ms ease, border-color 150ms ease'
const EXIT_TRANSITION = `${TRACK_TRANSITION}, transform ${EXIT_MS}ms ease-out, opacity ${EXIT_MS}ms ease-out`

/** Map raw finger dx to effective puck travel with overdrag resistance. */
function dampedTravel(dx: number): number {
  if (dx <= 0) return 0
  const t = dx <= LINEAR_TRAVEL ? dx : LINEAR_TRAVEL + (dx - LINEAR_TRAVEL) * OVERDRAG_FACTOR
  return Math.min(t, MAX_TRAVEL)
}

export function SwipeBackOverlay() {
  const isPhone = useIsPhone()
  // Puck mounts only while a recognized gesture is in flight (y = anchor row)
  const [gesture, setGesture] = useState<{ y: number } | null>(null)
  const [armed, setArmed] = useState(false)
  const puckRef = useRef<HTMLDivElement | null>(null)
  // Latest effective travel — read by the puck's mount callback so the first
  // painted frame matches the finger (React state is only mount/arm)
  const travelRef = useRef(0)

  useEffect(() => {
    if (!isPhone) return

    // Per-gesture tracking state (plain vars — zero re-renders per move)
    let touchId: number | null = null
    let startX = 0
    let startY = 0
    let recognized = false
    let isArmed = false
    let hapticFired = false
    let exitTimer: ReturnType<typeof setTimeout> | null = null

    // Imperative puck styling: transform/opacity are NEVER in the JSX style
    // prop, so React re-renders (arm/disarm) can't clobber mid-drag values
    const stylePuck = (travel: number, scaled: boolean, transition: string, opacity?: number) => {
      const el = puckRef.current
      if (!el) return
      el.style.transition = transition
      el.style.transform = `translateX(${travel - PUCK_SIZE - 8}px)${scaled ? ' scale(1.12)' : ''}`
      el.style.opacity = String(opacity ?? Math.min(1, travel / EDGE_WIDTH))
    }

    const resetTracking = () => {
      touchId = null
      recognized = false
      isArmed = false
      hapticFired = false
    }

    /** Animate the puck out (committed → onward+fade, cancelled → back into edge) and unmount. */
    const finish = (commit: boolean) => {
      resetTracking()
      stylePuck(commit ? MAX_TRAVEL + 12 : 0, commit, EXIT_TRANSITION, 0)
      if (commit) dispatchBack('swipe')
      exitTimer = setTimeout(() => {
        exitTimer = null
        travelRef.current = 0
        setGesture(null)
        setArmed(false)
      }, EXIT_MS)
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        // Multi-touch — abandon any in-flight gesture (first touch only)
        if (touchId !== null && recognized) finish(false)
        else resetTracking()
        return
      }
      const t = e.touches[0]
      if (t.clientX > EDGE_WIDTH) return
      if (isEditableTarget(e.target)) return
      if (exitTimer !== null) {
        // New gesture while the previous puck is animating out — reclaim it
        clearTimeout(exitTimer)
        exitTimer = null
        setGesture(null)
        setArmed(false)
      }
      touchId = t.identifier
      startX = t.clientX
      startY = t.clientY
    }

    const onTouchMove = (e: TouchEvent) => {
      if (touchId === null) return
      const t = Array.from(e.touches).find((touch) => touch.identifier === touchId)
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY

      if (!recognized) {
        if (dx > RECOGNIZE_DX && dx > Math.abs(dy) * HORIZONTAL_RATIO) {
          recognized = true
          travelRef.current = dampedTravel(dx)
          // Anchor the puck at the touch row, clear of notch / home indicator
          setGesture({ y: Math.min(Math.max(startY, 90), window.innerHeight - 140) })
        } else if (dx < -RECOGNIZE_DX || Math.abs(dy) > RECOGNIZE_DX) {
          // Clearly vertical (or backwards) — release, normal scrolling wins
          resetTracking()
          return
        } else {
          return // ambiguous so far — keep watching, don't prevent anything
        }
      }

      // Recognized: the gesture owns this touch — underlying swipe consumers
      // (manga page turns, carousels) must not also fire
      e.preventDefault()
      e.stopPropagation()

      const travel = dampedTravel(dx)
      travelRef.current = travel
      const nowArmed = travel >= COMMIT_TRAVEL
      if (nowArmed !== isArmed) {
        isArmed = nowArmed
        setArmed(nowArmed)
        if (nowArmed && !hapticFired) {
          hapticFired = true // exactly once per gesture
          hapticMedium()
        }
      }
      stylePuck(travel, nowArmed, TRACK_TRANSITION)
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (touchId === null) return
      if (!Array.from(e.changedTouches).some((t) => t.identifier === touchId)) return
      if (!recognized) {
        resetTracking()
        return
      }
      // Swallow the touch end too (no synthetic click on whatever is beneath)
      e.preventDefault()
      e.stopPropagation()
      finish(isArmed)
    }

    const onTouchCancel = (e: TouchEvent) => {
      if (touchId === null) return
      if (!Array.from(e.changedTouches).some((t) => t.identifier === touchId)) return
      if (recognized) finish(false)
      else resetTracking()
    }

    // Capture phase so we run before every in-page listener; touchmove is
    // non-passive because recognized gestures must preventDefault scrolling
    window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    window.addEventListener('touchend', onTouchEnd, { capture: true })
    window.addEventListener('touchcancel', onTouchCancel, { capture: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart, { capture: true })
      window.removeEventListener('touchmove', onTouchMove, { capture: true })
      window.removeEventListener('touchend', onTouchEnd, { capture: true })
      window.removeEventListener('touchcancel', onTouchCancel, { capture: true })
      if (exitTimer !== null) clearTimeout(exitTimer)
    }
  }, [isPhone])

  if (!isPhone || !gesture) return null

  return createPortal(
    <div
      ref={(el) => {
        puckRef.current = el
        if (el) {
          // First frame: place the puck at the current finger travel directly
          // (transform/opacity live outside React — see stylePuck)
          el.style.transform = `translateX(${travelRef.current - PUCK_SIZE - 8}px)`
          el.style.opacity = String(Math.min(1, travelRef.current / EDGE_WIDTH))
          el.style.transition = TRACK_TRANSITION
        }
      }}
      className={`fixed left-0 z-[100] pointer-events-none flex items-center justify-center rounded-full border shadow-lg backdrop-blur-md ${
        armed ? 'bg-theme-500 border-theme-400 text-white' : 'bg-black/60 border-white/20 text-white/90'
      }`}
      style={{
        top: gesture.y - PUCK_SIZE / 2,
        width: PUCK_SIZE,
        height: PUCK_SIZE,
        willChange: 'transform, opacity',
      }}
    >
      <ChevronLeft size={22} strokeWidth={2.5} />
    </div>,
    document.body,
  )
}
