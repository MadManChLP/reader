import { useEffect } from 'react'

/**
 * Keep the screen on while `active` (Screen Wake Lock API). The OS drops the
 * lock whenever the app goes to the background, so it is re-requested when the
 * page becomes visible again. Best effort: engines without the API (older
 * WebViews) simply keep their normal screen timeout.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock
    if (!wl) return

    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return
      try {
        const s = await wl.request('screen')
        if (cancelled) { void s.release().catch(() => {}); return }
        sentinel = s
      } catch {
        // Denied (battery saver, not focused, unsupported in this WebView) — ignore
      }
    }

    const onVisible = () => { if (document.visibilityState === 'visible') void acquire() }
    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {})
      sentinel = null
    }
  }, [active])
}

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
}
