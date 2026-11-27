// Tap guard — stops sloppy swipes from being taken as taps (touch only).
//
// Browsers synthesize a click after any touch whose finger stayed "close
// enough", which is generous: a short, slow or diagonal swipe on a card grid
// often never starts a native scroll and so ends as a click that opens the
// album/book/playlist under the finger. Native apps are stricter, and so is
// this guard. The click that follows a touch is swallowed when:
//
//   1. the finger travelled more than TAP_SLOP px in total (any direction);
//   2. a container scrolled while the finger was down (and the finger moved
//      at least a little — programmatic scrolls such as auto-scrolling lyrics
//      must not eat genuine taps);
//   3. the touch began while a scroller the user had just flung was still
//      gliding — tapping to stop momentum must never activate what slides
//      under the finger (native iOS/Android behaviour);
//   4. a second finger joined (pinch/zoom).
//
// Listeners are window-level, capture phase and passive (except click), so
// they run before any React handler and never cost scroll performance. Mouse
// and pen clicks are untouched: only the click that directly follows a guarded
// touch is affected. Opt out a subtree with data-tap-guard="off" (for UI whose
// click legitimately follows a drag); inputs and sliders are always exempt.

const TAP_SLOP = 10          // px of total finger travel before a touch is no longer a tap
const SCROLL_MOVE_MIN = 3    // px the finger must move before a scroll during the touch counts
const MOMENTUM_GAP_MS = 100  // scroll events closer than this = the fling is still running
const MOMENTUM_MAX_MS = 2500 // after this long post-release, stop treating scrolls as the user's fling
const CLICK_WINDOW_MS = 700  // a click this soon after touchend belongs to that touch

let installed = false

function isExempt(target: EventTarget | null): boolean {
  const el = target as Element | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest(
    'input, textarea, select, [contenteditable="true"], [role="slider"], [data-tap-guard="off"]',
  )
}

export function installTapGuard(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  // Current gesture
  let active = false
  let startX = 0
  let startY = 0
  let maxDist = 0
  let scrolledDuringTouch = false
  let startedDuringFling = false
  let multiTouch = false
  let exempt = false
  let touchScroller: EventTarget | null = null

  // Momentum tracking for the scroller the last gesture dragged
  let momentumTarget: EventTarget | null = null
  let momentumReleasedAt = 0
  let lastMomentumScrollAt = 0

  // Pending click suppression
  let suppressClickUntil = 0

  const onTouchStart = (e: TouchEvent) => {
    if (active && e.touches.length > 1) {
      multiTouch = true
      return
    }
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    const now = performance.now()
    active = true
    startX = t.clientX
    startY = t.clientY
    maxDist = 0
    scrolledDuringTouch = false
    multiTouch = false
    touchScroller = null
    exempt = isExempt(e.target)
    suppressClickUntil = 0
    startedDuringFling =
      momentumTarget !== null &&
      now - lastMomentumScrollAt < MOMENTUM_GAP_MS &&
      now - momentumReleasedAt < MOMENTUM_MAX_MS
  }

  const onTouchMove = (e: TouchEvent) => {
    if (!active) return
    if (e.touches.length > 1) { multiTouch = true; return }
    const t = e.touches[0]
    if (!t) return
    const d = Math.hypot(t.clientX - startX, t.clientY - startY)
    if (d > maxDist) maxDist = d
  }

  const onTouchEnd = (e: TouchEvent) => {
    if (!active || e.touches.length > 0) return
    active = false
    const wasScroll = maxDist > TAP_SLOP || (scrolledDuringTouch && maxDist >= SCROLL_MOVE_MIN)
    // A drag that moved a scroller may leave it gliding — remember which one
    if (scrolledDuringTouch && maxDist >= SCROLL_MOVE_MIN) {
      momentumTarget = touchScroller
      momentumReleasedAt = performance.now()
    }
    if (!exempt && (wasScroll || startedDuringFling || multiTouch)) {
      suppressClickUntil = performance.now() + CLICK_WINDOW_MS
    }
  }

  const onTouchCancel = () => {
    active = false
    suppressClickUntil = 0
  }

  const onScroll = (e: Event) => {
    const now = performance.now()
    if (active) {
      scrolledDuringTouch = true
      touchScroller = e.target
    } else if (momentumTarget !== null && e.target === momentumTarget) {
      lastMomentumScrollAt = now
    }
  }

  const onClick = (e: MouseEvent) => {
    if (suppressClickUntil === 0) return
    const now = performance.now()
    const pending = now <= suppressClickUntil
    suppressClickUntil = 0 // one click per touch at most
    if (!pending || isExempt(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }

  const passiveCapture = { capture: true, passive: true } as const
  window.addEventListener('touchstart', onTouchStart, passiveCapture)
  window.addEventListener('touchmove', onTouchMove, passiveCapture)
  window.addEventListener('touchend', onTouchEnd, passiveCapture)
  window.addEventListener('touchcancel', onTouchCancel, passiveCapture)
  // scroll doesn't bubble, but capture on window sees every element's scroll
  window.addEventListener('scroll', onScroll, passiveCapture)
  window.addEventListener('click', onClick, { capture: true })
  // WebKit only applies :active styles on touch when a touchstart listener
  // exists on the element or an ancestor of it — window doesn't count
  document.addEventListener('touchstart', () => {}, { passive: true })
}
