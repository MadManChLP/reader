// haptics — subtle haptic feedback for phone builds (Wave 2).
//
// Policy: SUBTLE. Haptics fire only on meaningful moments — tab-bar switch,
// long-press menu open, pull-to-refresh trigger, swipe-back threshold,
// sleep-timer set. Do NOT add ticks to continuous interactions (slider
// scrubbing, scrolling) without an explicit product decision.
//
// Every function is a safe no-op outside a phone-class Tauri build: the Rust
// plugin is only registered on mobile (see src-tauri/src/lib.rs), calls are
// IS_PHONE-gated, and failures are swallowed — a missing plugin must never
// break the gesture that triggered it.

import { IS_PHONE } from './api'

type HapticsModule = typeof import('@tauri-apps/plugin-haptics')

let modPromise: Promise<HapticsModule | null> | null = null

function loadHaptics(): Promise<HapticsModule | null> {
  if (!modPromise) {
    modPromise = import('@tauri-apps/plugin-haptics').catch(() => null)
  }
  return modPromise
}

function run(fn: (m: HapticsModule) => Promise<unknown>): void {
  if (!IS_PHONE) return
  loadHaptics()
    .then((m) => (m ? fn(m) : undefined))
    .catch(() => {
      /* haptics unavailable — ignore */
    })
}

/** Light tap — menu/bottom-sheet opens, pull-to-refresh arms, chip taps. */
export function hapticLight(): void {
  run((m) => m.impactFeedback('light'))
}

/** Medium tap — tab-bar switch, swipe-back commit threshold crossed. */
export function hapticMedium(): void {
  run((m) => m.impactFeedback('medium'))
}

/** Selection tick — discrete picker changes (e.g. sleep-timer preset chosen). */
export function hapticSelection(): void {
  run((m) => m.selectionFeedback())
}

/** Success notification — an action completed (download finished, timer set). */
export function hapticSuccess(): void {
  run((m) => m.notificationFeedback('success'))
}

/** Warning notification — destructive confirm, error toast. */
export function hapticWarning(): void {
  run((m) => m.notificationFeedback('warning'))
}
