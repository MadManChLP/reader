import React, { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsPhone } from '../hooks/useIsPhone'
import { hapticSelection } from '../utils/haptics'

// A–Z fast-scroll rail (phone-only) for long alphabetical lists — the iOS
// contacts idiom. The parent passes the labels of the CURRENTLY LOADED items
// (already sorted alphabetically) plus an onJump(index) that scrolls its list.
//
// Because the app's grids are server-paginated, the rail indexes only what is
// loaded: buckets with no loaded item yet are dimmed, and dragging to one snaps
// to the nearest loaded letter. As the user scrolls and more pages load, more
// letters light up. It only makes sense while the list is sorted by name — the
// parent is responsible for that gate (plus a sensible minimum length).

const BUCKETS = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']

function bucketOf(label: string): string {
  const c = (label || '').trim().charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

interface AlphabetScrollRailProps {
  /** Labels of the loaded items, in the same order as the list. */
  labels: string[]
  /** Scroll so the item at `index` is at the top of the list. */
  onJump: (index: number) => void
  /** Parent gate (sort===name, enough items). Rail also self-gates to phone. */
  enabled?: boolean
}

export const AlphabetScrollRail: React.FC<AlphabetScrollRailProps> = ({ labels, onJump, enabled = true }) => {
  const isPhone = useIsPhone()
  const railRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string | null>(null)
  const lastLetterRef = useRef<string | null>(null)

  // First loaded index per bucket (labels are pre-sorted, so first occurrence
  // is the section start), and the ordered list of buckets that have content.
  const { firstIndex, present } = useMemo(() => {
    const firstIndex = new Map<string, number>()
    for (let i = 0; i < labels.length; i++) {
      const b = bucketOf(labels[i])
      if (!firstIndex.has(b)) firstIndex.set(b, i)
    }
    return { firstIndex, present: BUCKETS.filter(b => firstIndex.has(b)) }
  }, [labels])

  if (!isPhone || !enabled || present.length < 2) return null

  // Snap a tapped bucket to the nearest one that actually has loaded items.
  const nearestPresent = (bucket: string): string => {
    if (firstIndex.has(bucket)) return bucket
    const target = BUCKETS.indexOf(bucket)
    let best = present[0]
    let bestDist = Infinity
    for (const b of present) {
      const d = Math.abs(BUCKETS.indexOf(b) - target)
      if (d < bestDist) { bestDist = d; best = b }
    }
    return best
  }

  const jumpToPoint = (clientY: number) => {
    const rail = railRef.current
    if (!rail) return
    const rect = rail.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    const bucket = BUCKETS[Math.min(BUCKETS.length - 1, Math.floor(frac * BUCKETS.length))]
    const snapped = nearestPresent(bucket)
    setActive(bucket)
    if (snapped !== lastLetterRef.current) {
      lastLetterRef.current = snapped
      hapticSelection()
      onJump(firstIndex.get(snapped)!)
    }
  }

  const onStart = (e: React.TouchEvent) => {
    lastLetterRef.current = null
    jumpToPoint(e.touches[0].clientY)
  }
  const onMove = (e: React.TouchEvent) => {
    e.preventDefault() // own the drag: don't scroll the list under the rail
    jumpToPoint(e.touches[0].clientY)
  }
  const onEnd = () => { setActive(null); lastLetterRef.current = null }

  return (
    <>
      {/* Right-edge letter rail */}
      <div
        ref={railRef}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center justify-center py-2 pr-1 pl-2 select-none touch-none"
        style={{ paddingRight: 'max(0.25rem, env(safe-area-inset-right))' }}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onTouchCancel={onEnd}
      >
        {BUCKETS.map((b) => {
          const has = firstIndex.has(b)
          return (
            <span
              key={b}
              className={`text-[10px] leading-[1.05] font-semibold tabular-nums ${
                has ? 'text-white/70' : 'text-white/20'
              }`}
            >
              {b}
            </span>
          )
        })}
      </div>

      {/* Big letter bubble near the finger */}
      {active && createPortal(
        <div className="fixed right-16 top-1/2 -translate-y-1/2 z-40 pointer-events-none flex items-center justify-center w-20 h-20 rounded-2xl bg-black/70 backdrop-blur-md border border-white/10">
          <span className="text-4xl font-bold text-theme-400">{active}</span>
        </div>,
        document.body,
      )}
    </>
  )
}

export default AlphabetScrollRail
