import { useEffect, useRef, useState } from 'react'

interface UseInfiniteScrollOptions {
  /** Whether more items are available to load */
  hasMore: boolean
  /** Whether an initial/full reload is in progress (pauses the observer) */
  isLoading: boolean
  /** Called to fetch the next page. May return a promise to track completion. */
  onLoadMore: () => Promise<unknown> | void
  /** How far before the sentinel enters the viewport to trigger loading */
  rootMargin?: string
}

/**
 * Infinite scroll via IntersectionObserver. Attach `sentinelRef` to an element
 * rendered after the list (only while `hasMore` is true); when it scrolls
 * within `rootMargin` of the viewport, `onLoadMore` fires. Re-fires
 * automatically until the sentinel leaves the viewport, so short pages keep
 * filling until the content overflows.
 */
export function useInfiniteScroll({
  hasMore,
  isLoading,
  onLoadMore,
  rootMargin = '600px',
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  // Synchronous guard: the observer callback can fire again before the
  // isLoadingMore state update re-runs the effect
  const inFlightRef = useRef(false)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || isLoading || isLoadingMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || inFlightRef.current) return
        inFlightRef.current = true
        setIsLoadingMore(true)
        Promise.resolve(onLoadMore()).finally(() => {
          inFlightRef.current = false
          setIsLoadingMore(false)
        })
      },
      { rootMargin }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, isLoading, isLoadingMore, onLoadMore, rootMargin])

  return { sentinelRef, isLoadingMore }
}
