// Real screen brightness — served by the same native plugin as systemVolume
// (tauri-plugin-system-volume). Mobile only; desktop keeps the CSS dim layer.
//
// Platform semantics differ, and callers should use the restore helper:
//   iOS      UIScreen.brightness — app-wide AND persists after the app exits,
//            so the original value must be captured and re-set on player exit.
//   Android  window.attributes.screenBrightness — scoped to our window;
//            restore sets BRIGHTNESS_OVERRIDE_NONE (follow system again).

import { invoke } from '@tauri-apps/api/core'
import { IS_IOS } from './api'
import { SYSTEM_VOLUME_SUPPORTED } from './systemVolume'

/** True when real brightness control is available (same gate as the plugin). */
export const SCREEN_BRIGHTNESS_SUPPORTED = SYSTEM_VOLUME_SUPPORTED

/** Current screen brightness 0..1, or null when unavailable. */
export async function getScreenBrightness(): Promise<number | null> {
  if (!SCREEN_BRIGHTNESS_SUPPORTED) return null
  try {
    const res = await invoke<{ brightness: number }>('plugin:system-volume|get_brightness')
    return typeof res?.brightness === 'number' ? res.brightness : null
  } catch (e) {
    console.warn('[Brightness] get failed', e)
    return null
  }
}

/** Set the screen brightness (0..1). Fire-and-forget. */
export function setScreenBrightness(brightness: number): void {
  if (!SCREEN_BRIGHTNESS_SUPPORTED) return
  invoke('plugin:system-volume|set_brightness', {
    brightness: Math.max(0, Math.min(1, brightness)),
  }).catch((e) => console.warn('[Brightness] set failed', e))
}

/**
 * Give brightness control back after a player session.
 * `original` is the value captured by getScreenBrightness() before the first
 * change — required on iOS (where our writes persist system-wide); Android
 * ignores it and simply drops the window override.
 */
export function restoreScreenBrightness(original: number | null): void {
  if (!SCREEN_BRIGHTNESS_SUPPORTED) return
  if (IS_IOS) {
    if (original !== null) setScreenBrightness(original)
    return
  }
  invoke('plugin:system-volume|restore_brightness').catch((e) =>
    console.warn('[Brightness] restore failed', e),
  )
}
