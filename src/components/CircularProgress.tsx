import React from 'react'

/**
 * Circular download-progress indicator.
 *   fraction 0..1  — determinate ring filling clockwise
 *   fraction null  — indeterminate spinner (size unknown / Electron)
 * Colors follow `currentColor`, so tint via text-* classes on the parent.
 */
const CircularProgress: React.FC<{
  fraction: number | null
  size?: number
  strokeWidth?: number
  className?: string
}> = ({ fraction, size = 18, strokeWidth = 2, className = '' }) => {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  if (fraction === null) {
    // Indeterminate: quarter arc spinning around the track
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`animate-spin ${className}`}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={`${circumference * 0.25} ${circumference * 0.75}`}
        />
      </svg>
    )
  }

  const clamped = Math.max(0, Math.min(1, fraction))
  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      className={`-rotate-90 ${className}`}
    >
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
        style={{ transition: 'stroke-dashoffset 0.3s ease' }}
      />
    </svg>
  )
}

export default React.memo(CircularProgress)
