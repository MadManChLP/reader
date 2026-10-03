// Sleep Timer Store — one global sleep timer shared by the video player and
// the music player (the audiobook player has its OWN independent timer in
// audiobookPlayerStore; do not wire it up here).
//
// Design:
// - One timer at a time with a target ('video' | 'music'); starting a timer
//   for one target cancels any timer on the other.
// - Minute timers store endsAtMs; the store manages a single interval that
//   updates remainingMs (for countdown UIs), fades volume over the last
//   ~5 seconds, and pauses the target player on expiry.
// - "End of current item" timers hold no countdown; the players call
//   consumeEndOfItem() in their ended paths — if it returns true they must
//   stop instead of auto-advancing (the timer is cleared by the call).
// - The store never touches media elements directly. Players register
//   pause/fade handlers (PersistentMusicPlayer for 'music' — always mounted;
//   JellyfinPlayer for 'video' — only while the player is open). This avoids
//   circular store imports and keeps the countdown alive across view switches.

import { create } from 'zustand'

export type SleepTimerTarget = 'video' | 'music'

export type SleepTimerMode =
  | { kind: 'minutes'; endsAtMs: number; totalMinutes: number }
  | { kind: 'endOfItem' }

export interface SleepTimerHandlers {
  /** Pause the target player */
  pause: () => void
  /**
   * Apply a temporary volume scale (0..1) on top of the player's base volume
   * for the pre-pause fade. Called with 1 to restore the base volume.
   */
  setFade?: (scale: number) => void
}

export const SLEEP_TIMER_PRESETS = [15, 30, 45, 60, 90] as const

const TICK_MS = 500
const FADE_MS = 5000

// Module-level (not reactive): registered player handlers + interval bookkeeping
const handlersMap: Record<SleepTimerTarget, SleepTimerHandlers | null> = {
  video: null,
  music: null,
}
let tickInterval: ReturnType<typeof setInterval> | null = null
let fadeApplied = false

interface SleepTimerState {
  target: SleepTimerTarget | null
  mode: SleepTimerMode | null
  /** Live countdown in ms — only meaningful for minute timers */
  remainingMs: number

  /** Start a minutes-based timer (presets or custom). Cancels any existing timer. */
  startMinutes: (target: SleepTimerTarget, minutes: number) => void
  /** Stop after the current episode/track finishes. Cancels any existing timer. */
  startEndOfItem: (target: SleepTimerTarget) => void
  /** Cancel the active timer (restores any in-progress volume fade). */
  cancel: () => void
  /**
   * Called by players when the current item ends. Returns true when an
   * end-of-item timer for this target was active — the caller must stop
   * (suppress auto-advance) once; the timer is cleared by this call.
   */
  consumeEndOfItem: (target: SleepTimerTarget) => boolean

  /** Register pause/fade handlers for a target (players call this on mount). */
  registerHandlers: (target: SleepTimerTarget, handlers: SleepTimerHandlers) => void
  /** Unregister — only removes if the currently registered handlers match. */
  unregisterHandlers: (target: SleepTimerTarget, handlers: SleepTimerHandlers) => void
}

function stopTicking() {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
}

function restoreFade(target: SleepTimerTarget | null) {
  if (fadeApplied && target) {
    handlersMap[target]?.setFade?.(1)
  }
  fadeApplied = false
}

export const useSleepTimer = create<SleepTimerState>((set, get) => {
  const clearTimer = () => {
    stopTicking()
    restoreFade(get().target)
    set({ target: null, mode: null, remainingMs: 0 })
  }

  const tick = () => {
    const { target, mode } = get()
    if (!target || !mode || mode.kind !== 'minutes') {
      stopTicking()
      return
    }
    const remaining = mode.endsAtMs - Date.now()
    if (remaining <= 0) {
      // Expired: pause the target, restore any fade, clear the timer
      stopTicking()
      const handlers = handlersMap[target]
      handlers?.pause()
      restoreFade(target)
      set({ target: null, mode: null, remainingMs: 0 })
      return
    }
    // Fade the volume down over the final seconds (restored after pause)
    if (remaining <= FADE_MS) {
      const handlers = handlersMap[target]
      if (handlers?.setFade) {
        handlers.setFade(Math.max(0.05, remaining / FADE_MS))
        fadeApplied = true
      }
    }
    set({ remainingMs: remaining })
  }

  return {
    target: null,
    mode: null,
    remainingMs: 0,

    startMinutes: (target, minutes) => {
      if (!Number.isFinite(minutes) || minutes <= 0) return
      clearTimer()
      const ms = Math.round(minutes * 60_000)
      set({
        target,
        mode: { kind: 'minutes', endsAtMs: Date.now() + ms, totalMinutes: minutes },
        remainingMs: ms,
      })
      tickInterval = setInterval(tick, TICK_MS)
    },

    startEndOfItem: (target) => {
      clearTimer()
      set({ target, mode: { kind: 'endOfItem' }, remainingMs: 0 })
    },

    cancel: () => clearTimer(),

    consumeEndOfItem: (target) => {
      const { target: activeTarget, mode } = get()
      if (activeTarget === target && mode?.kind === 'endOfItem') {
        set({ target: null, mode: null, remainingMs: 0 })
        return true
      }
      return false
    },

    registerHandlers: (target, handlers) => {
      handlersMap[target] = handlers
    },

    unregisterHandlers: (target, handlers) => {
      if (handlersMap[target] === handlers) handlersMap[target] = null
    },
  }
})

/** Format remaining ms as "12:34" or "1:02:34" for countdown displays */
export function formatSleepRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
