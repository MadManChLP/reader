import { useEffect, useRef, useState } from 'react'
import { IS_PHONE } from '../utils/api'
import { hapticLight } from '../utils/haptics'

// Pull-to-refresh gesture for phone builds (Wave 2).
//
// Attach to a vertical scroll container: when the container sits at the top
// and the user drags clearly DOWNWARDS, the pull is tracked with resistance;
// past the arm threshold (one hapticLight tick) releasing runs onRefresh.
// Releasing earlier just retracts. Desktop attaches nothing.
//
// The listeners live on window and resolve the container at touch time, so
// the hook keeps working when the scroller element only appears later or gets
// swapped (e.g. react-virtuoso's internal scroller, refreshKey remounts).
// Render the returned state through <PullToRefreshIndicator /> — mounted
// OUTSIDE any refreshKey-keyed subtree so a remount can't kill it mid-spin.

export const PULL_ARM_THRESHOLD = 70 // px of indicator travel that arms the refresh
const PULL_RESISTANCE = 0.4          // indicator travel = finger travel * resistance
const PULL_MAX_TRAVEL = 110          // px cap for the indicator travel
const DIRECTION_SLOP = 10            // px of finger travel before committing to a direction
const LEFT_EDGE_EXCLUDE = 24         // px strip owned by the swipe-back gesture (SwipeBackOverlay)
const MIN_REFRESH_MS = 600           // spinner stays at least this long so a fast refresh doesn't flash

export interface PullToRefreshState {
  pull: number        // current indicator travel in px (0 when idle)
  armed: boolean      // past the threshold — releasing will refresh
  refreshing: boolean // onRefresh running (including the minimum spin time)
  dragging: boolean   // finger down and pull engaged (indicator disables its transition)
}

const IDLE: PullToRefreshState = { pull: 0, armed: false, refreshing: false, dragging: false }

// Ref for the common case; a getter for scrollers that move between elements
// (e.g. JellyfinView: shared content div on home, VirtuosoGrid scroller in
// the library view)
type ScrollTarget = React.RefObject<HTMLElement | null> | (() => HTMLElement | null)

export function usePullToRefresh(
  scrollTarget: ScrollTarget,
  onRefresh: () => void | Promise<void>,
  enabled: boolean = true,
): PullToRefreshState {
  const [state, setState] = useState<PullToRefreshState>(IDLE)

  // Read everything through refs so the window listeners never go stale
  const getElRef = useRef<() => HTMLElement | null>(() => null)
  getElRef.current = typeof scrollTarget === 'function' ? scrollTarget : () => scrollTarget.current
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const refreshingRef = useRef(false)

  useEffect(() => {
    if (!IS_PHONE) return // desktop: attach nothing

    let tracking = false // touch started at the top, inside the container
    let engaged = false  // committed to the pull — we own the touch from here
    let isArmed = false
    let startX = 0
    let startY = 0
    let scroller: HTMLElement | null = null
    let prevOverscroll = ''

    // Tear down the per-gesture listeners and restore the scroller
    function endGesture() {
      tracking = false
      engaged = false
      isArmed = false
      if (scroller) {
        scroller.style.overscrollBehaviorY = prevOverscroll
        scroller = null
      }
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchCancel)
    }

    function retract() {
      endGesture()
      setState(IDLE)
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) {
        // Second finger down — cancel a pull in progress cleanly
        if (tracking) retract()
        return
      }
      if (!enabledRef.current || refreshingRef.current) return
      const el = getElRef.current()
      if (!el) return
      const t = e.touches[0]
      if (!(t.target instanceof Node) || !el.contains(t.target)) return
      if (el.scrollTop > 0) return
      if (t.clientX < LEFT_EDGE_EXCLUDE) return // left strip belongs to swipe-back
      tracking = true
      startX = t.clientX
      startY = t.clientY
      // Non-passive touchmove only while a candidate gesture is live, so
      // normal scrolling keeps its composited fast path
      window.addEventListener('touchmove', onTouchMove, { passive: false })
      window.addEventListener('touchend', onTouchEnd)
      window.addEventListener('touchcancel', onTouchCancel)
    }

    function onTouchMove(e: TouchEvent) {
      if (!tracking) return
      if (e.touches.length !== 1 || !enabledRef.current) {
        retract()
        return
      }
      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY

      if (!engaged) {
        // Decide the direction once the finger clears the slop. Anything not
        // clearly a downward drag hands the touch back to native scrolling.
        if (dy < -DIRECTION_SLOP || (Math.abs(dx) > DIRECTION_SLOP && Math.abs(dx) >= dy)) {
          endGesture()
          return
        }
        if (!(dy > DIRECTION_SLOP && dy > Math.abs(dx) * 1.5)) return // still deciding
        const el = getElRef.current()
        if (!el || el.scrollTop > 0) {
          endGesture()
          return
        }
        engaged = true
        scroller = el
        prevOverscroll = el.style.overscrollBehaviorY
        el.style.overscrollBehaviorY = 'contain' // keep native overscroll out of the pull
      }

      // Engaged: the pull owns the touch — no native scroll/rubber-banding
      e.preventDefault()
      const travel = Math.min(Math.max(dy - DIRECTION_SLOP, 0) * PULL_RESISTANCE, PULL_MAX_TRAVEL)
      if (travel >= PULL_ARM_THRESHOLD && !isArmed) {
        isArmed = true
        hapticLight() // fires exactly once, when the pull crosses the threshold
      } else if (travel < PULL_ARM_THRESHOLD && isArmed) {
        isArmed = false // dragged back above the threshold — disarm silently
      }
      setState({ pull: travel, armed: isArmed, refreshing: false, dragging: true })
    }

    function onTouchEnd() {
      const shouldRefresh = engaged && isArmed
      endGesture()
      if (!shouldRefresh) {
        setState(IDLE) // released early — retract
        return
      }
      refreshingRef.current = true
      setState({ pull: PULL_ARM_THRESHOLD, armed: true, refreshing: true, dragging: false })
      // Run the tab's existing refresh; keep spinning at least MIN_REFRESH_MS
      // so an instant refreshKey remount doesn't make the indicator flash
      const refresh = Promise.resolve().then(() => onRefreshRef.current())
      const minSpin = new Promise((resolve) => setTimeout(resolve, MIN_REFRESH_MS))
      Promise.allSettled([refresh, minSpin]).then(() => {
        refreshingRef.current = false
        setState(IDLE)
      })
    }

    function onTouchCancel() {
      retract()
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      endGesture()
    }
  }, [])

  return state
}
