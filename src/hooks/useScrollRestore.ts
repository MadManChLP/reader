import { useEffect, useRef } from 'react'
import { getScrollPos, setScrollPos } from '../utils/viewStateCache'

// Most list views render inside a shared scrollable ancestor (e.g. the <main>
// element of the client layout) rather than owning their own scroller, so the
// scroll position must be found by walking up from an element inside the view.
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node
    node = node.parentElement
  }
  return null
}

/**
 * Restores the scroll position saved under `key` whenever `ready` turns true
 * (i.e. the list content is rendered at its full height), and keeps recording
 * the position while the user scrolls. Attach the returned ref to any element
 * inside the scrollable area.
 *
 * Views that reset their content (new query, new page) should call
 * `setScrollPos(key, 0)` so the next restore starts at the top.
 */
export function useScrollRestore(key: string, ready: boolean) {
  const anchorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!ready) return
    const scroller = findScrollParent(anchorRef.current)
    if (!scroller) return

    scroller.scrollTop = getScrollPos(key)

    const onScroll = () => {
      // When the view unmounts, the swapped-in content can clamp the
      // scroller's position and fire a late scroll event — ignore it so it
      // doesn't overwrite the position we just saved (the anchor is already
      // detached at that point).
      if (!anchorRef.current?.isConnected) return
      setScrollPos(key, scroller.scrollTop)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [key, ready])

  return anchorRef
}

/**
 * Scrolls the nearest scrollable ancestor to the top when the component
 * mounts. Details views share their scroller with the grid they were opened
 * from, so without this they appear mid-scroll. Attach the returned ref to
 * any element inside the view.
 */
export function useScrollToTopOnMount() {
  const anchorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const scroller = findScrollParent(anchorRef.current)
    if (scroller) scroller.scrollTop = 0
  }, [])

  return anchorRef
}
