import React from 'react'
import { IS_PHONE } from '../utils/api'
import { PULL_ARM_THRESHOLD, type PullToRefreshState } from '../hooks/usePullToRefresh'

// Circular spinner puck for the pull-to-refresh gesture (phone only).
//
// Descends from under the top bar while the user pulls, rotating with the
// pull distance; crossing the threshold arms it (subtle fill + scale) and a
// released pull keeps it spinning until the refresh settles. Mount it as a
// sibling of the scroll container inside a `relative` wrapper — and OUTSIDE
// any refreshKey-keyed subtree, so the remount can't kill it mid-animation.

const ARC_CIRCUMFERENCE = 2 * Math.PI * 8 // r=8 circle in a 20x20 viewBox

export const PullToRefreshIndicator = React.memo(function PullToRefreshIndicator({
  pull,
  armed,
  refreshing,
  dragging,
}: PullToRefreshState) {
  if (!IS_PHONE) return null // desktop stays untouched

  const visible = refreshing || pull > 0
  const travel = refreshing ? PULL_ARM_THRESHOLD : pull
  const progress = Math.min(pull / PULL_ARM_THRESHOLD, 1)
  // Arc grows with the pull (15% → 75% of the circle); fixed while spinning
  const arcFraction = refreshing ? 0.75 : 0.15 + progress * 0.6

  return (
    <div className="absolute inset-x-0 top-0 z-30 flex justify-center pointer-events-none" aria-hidden>
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-md border border-white/10 shadow-lg
          ${armed || refreshing ? 'bg-black/80' : 'bg-black/60'}
          ${dragging ? '' : 'transition-[transform,opacity] duration-300 ease-out'}`}
        style={{
          // Rests 48px above the container edge; the pull drags it into view
          transform: `translateY(${travel - 48}px) scale(${armed || refreshing ? 1.08 : 1})`,
          opacity: visible ? 1 : 0,
        }}
      >
        <svg
          viewBox="0 0 20 20"
          className={`h-5 w-5 text-theme-400 ${refreshing ? 'animate-spin' : ''}`}
          style={refreshing ? undefined : { transform: `rotate(${pull * 2.2}deg)` }}
        >
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${arcFraction * ARC_CIRCUMFERENCE} ${ARC_CIRCUMFERENCE}`}
          />
        </svg>
      </div>
    </div>
  )
})
