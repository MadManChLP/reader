import React, { useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { Moon, X } from 'lucide-react'
import {
  useSleepTimer,
  formatSleepRemaining,
  SLEEP_TIMER_PRESETS,
  type SleepTimerTarget,
} from '../../../stores/sleepTimerStore'

// Live countdown text — isolated so the 2x/sec remainingMs updates only
// re-render this tiny component, not the panel/bar around it.
export const SleepTimerCountdown: React.FC<{ className?: string }> = ({ className }) => {
  const remainingMs = useSleepTimer(s => s.remainingMs)
  return <span className={className}>{formatSleepRemaining(remainingMs)}</span>
}

// Small moon chip shown in player controls while a timer is active for the
// given target. Renders nothing when inactive.
export const SleepTimerChip: React.FC<{ target: SleepTimerTarget; onClick?: () => void }> = ({ target, onClick }) => {
  const activeKind = useSleepTimer(s => (s.target === target ? s.mode?.kind ?? null : null))
  if (!activeKind) return null
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/40 hover:bg-black/60 transition-colors"
      title="Sleep timer active"
    >
      <Moon size={14} className="text-theme-400" />
      {activeKind === 'minutes' ? (
        <SleepTimerCountdown className="text-theme-400 text-xs font-medium tabular-nums" />
      ) : (
        <span className="text-theme-400 text-xs font-medium">
          {target === 'video' ? 'End of episode' : 'End of track'}
        </span>
      )}
    </button>
  )
}

interface SleepTimerPanelProps {
  target: SleepTimerTarget
  /** Label for the end-of-item option, e.g. "episode" or "track" */
  endOfItemLabel: string
  /** Called after the user starts or cancels a timer (e.g. to close a popover) */
  onAction?: () => void
}

// Sleep timer options: presets, custom minutes, end-of-item — plus the
// active-timer state with a cancel button.
const SleepTimerPanel: React.FC<SleepTimerPanelProps> = ({ target, endOfItemLabel, onAction }) => {
  const { activeTarget, modeKind, startMinutes, startEndOfItem, cancel } = useSleepTimer(
    useShallow(s => ({
      activeTarget: s.target,
      modeKind: s.mode?.kind ?? null,
      startMinutes: s.startMinutes,
      startEndOfItem: s.startEndOfItem,
      cancel: s.cancel,
    }))
  )
  const [customMinutes, setCustomMinutes] = useState('')

  const isActiveForTarget = activeTarget === target && modeKind !== null

  const handleStartMinutes = (minutes: number) => {
    startMinutes(target, minutes)
    onAction?.()
  }

  const handleStartCustom = () => {
    const minutes = parseInt(customMinutes, 10)
    if (!Number.isFinite(minutes) || minutes <= 0) return
    setCustomMinutes('')
    handleStartMinutes(minutes)
  }

  if (isActiveForTarget) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Moon size={16} className="text-theme-400" />
            {modeKind === 'minutes' ? (
              <span className="text-white text-sm">
                Sleeping in <SleepTimerCountdown className="text-theme-400 font-medium tabular-nums" />
              </span>
            ) : (
              <span className="text-white text-sm">
                After this {endOfItemLabel}
              </span>
            )}
          </div>
          <button
            onClick={() => { cancel(); onAction?.() }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X size={12} />
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Presets */}
      <div className="flex flex-wrap gap-1.5">
        {SLEEP_TIMER_PRESETS.map(minutes => (
          <button
            key={minutes}
            onClick={() => handleStartMinutes(minutes)}
            className="px-2.5 py-1.5 text-xs text-white bg-white/10 hover:bg-theme-500/40 rounded-lg transition-colors"
          >
            {minutes} min
          </button>
        ))}
      </div>

      {/* End of current item */}
      <button
        onClick={() => { startEndOfItem(target); onAction?.() }}
        className="px-2.5 py-1.5 text-xs text-white text-left bg-white/10 hover:bg-theme-500/40 rounded-lg transition-colors"
      >
        End of current {endOfItemLabel}
      </button>

      {/* Custom minutes */}
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          max={600}
          value={customMinutes}
          onChange={(e) => setCustomMinutes(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleStartCustom() }}
          placeholder="Custom"
          className="w-20 bg-white/10 text-white text-xs rounded-lg px-2.5 py-1.5 border border-white/10 outline-none focus:border-theme-500 transition-colors placeholder:text-white/40"
        />
        <span className="text-white/50 text-xs">min</span>
        <button
          onClick={handleStartCustom}
          disabled={!customMinutes || parseInt(customMinutes, 10) <= 0}
          className="px-2.5 py-1.5 text-xs text-white bg-theme-500/60 hover:bg-theme-500 disabled:opacity-40 disabled:hover:bg-theme-500/60 rounded-lg transition-colors"
        >
          Start
        </button>
      </div>
    </div>
  )
}

export default React.memo(SleepTimerPanel)
