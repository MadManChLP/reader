// Sleep Timer Store — one global sleep timer shared by the video, music and
// audiobook players. For audiobooks "end of item" means end of the current
// chapter (PersistentAudiobookPlayer detects the boundary from the live
// position, so a seek simply moves the stop point along).
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
import { IS_PHONE } from '../utils/api'
import { hapticSuccess } from '../utils/haptics'

export type SleepTimerTarget = 'video' | 'music' | 'audiobook'

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
  audiobook: null,
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
  /** Restart a running minutes timer from its full length (shake-to-extend). */
  extend: () => void
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

// ── Shake to extend (phones) ─────────────────────────────────────────────
// Half asleep, the timer is about to stop the book: a shake restarts it with
// its full length instead of fumbling for the screen.

const SHAKE_THRESHOLD = 18 // m/s² of acceleration beyond gravity
let shakeListener: ((e: DeviceMotionEvent) => void) | null = null
let lastShake = 0

function startShakeWatch(onShake: () => void) {
  if (!IS_PHONE || shakeListener || typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return
  // iOS needs permission, requested inside the tap that started the timer
  const req = (DeviceMotionEvent as any).requestPermission
  if (typeof req === 'function') { try { void req().catch(() => {}) } catch { /* not in a gesture */ } }
  shakeListener = (e: DeviceMotionEvent) => {
    const a = e.acceleration
    let mag = 0
    if (a && a.x != null && a.y != null && a.z != null) mag = Math.hypot(a.x, a.y, a.z)
    else {
      const g = e.accelerationIncludingGravity
      if (!g || g.x == null || g.y == null || g.z == null) return
      mag = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81)
    }
    const now = Date.now()
    if (mag > SHAKE_THRESHOLD && now - lastShake > 1500) {
      lastShake = now
      onShake()
    }
  }
  window.addEventListener('devicemotion', shakeListener)
}

function stopShakeWatch() {
  if (shakeListener) window.removeEventListener('devicemotion', shakeListener)
  shakeListener = null
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
    stopShakeWatch()
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
      stopShakeWatch()
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
      startShakeWatch(() => get().extend())
    },

    extend: () => {
      const { mode, target } = get()
      if (!target || mode?.kind !== 'minutes') return
      restoreFade(target)
      const ms = Math.round(mode.totalMinutes * 60_000)
      set({ mode: { ...mode, endsAtMs: Date.now() + ms }, remainingMs: ms })
      hapticSuccess()
    },

    startEndOfItem: (target) => {
      clearTimer()
      set({ target, mode: { kind: 'endOfItem' }, remainingMs: 0 })
    },

    cancel: () => clearTimer(),

    consumeEndOfItem: (target) => {
      const { target: activeTarget, mode } = get()
      if (activeTarget === target && mode?.kind === 'endOfItem') {
        stopShakeWatch()
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
