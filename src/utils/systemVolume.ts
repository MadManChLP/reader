// System media volume — JS wrapper for the in-repo tauri-plugin-system-volume
// (mobile only). The WebView cannot control the OS volume itself: iOS ignores
// HTMLMediaElement.volume entirely and Android element volume only attenuates
// within the app. The native plugin drives the real system volume instead:
//   iOS      MPVolumeView slider + AVAudioSession outputVolume KVO
//   Android  AudioManager STREAM_MUSIC + settings ContentObserver
//
// Everything here is safe to call anywhere — outside a mobile Tauri build the
// support flag is false and callers hide their UI.

import { invoke, Channel } from '@tauri-apps/api/core'
import { IS_IOS } from './api'

const IS_ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
const IS_TAURI = typeof window !== 'undefined' && '__TAURI__' in window

/** True when the native system-volume plugin is expected to be available. */
export const SYSTEM_VOLUME_SUPPORTED = IS_TAURI && (IS_IOS || IS_ANDROID)

/** Current system media volume 0..1, or null when unavailable. */
export async function getSystemVolume(): Promise<number | null> {
  if (!SYSTEM_VOLUME_SUPPORTED) return null
  try {
    const res = await invoke<{ volume: number }>('plugin:system-volume|get_volume')
    return typeof res?.volume === 'number' ? res.volume : null
  } catch (e) {
    console.warn('[SystemVolume] get failed', e)
    return null
  }
}

/** Set the system media volume (0..1). Fire-and-forget. */
export function setSystemVolume(volume: number): void {
  if (!SYSTEM_VOLUME_SUPPORTED) return
  invoke('plugin:system-volume|set_volume', {
    volume: Math.max(0, Math.min(1, volume)),
  }).catch((e) => console.warn('[SystemVolume] set failed', e))
}

// One app-lifetime native watcher fanning out to local subscribers — the
// native side has no unwatch, so components subscribe/unsubscribe here.
const listeners = new Set<(volume: number) => void>()
let watchStarted = false

function ensureWatch(): void {
  if (watchStarted || !SYSTEM_VOLUME_SUPPORTED) return
  watchStarted = true
  const channel = new Channel<{ volume: number }>()
  channel.onmessage = (msg) => {
    if (typeof msg?.volume !== 'number') return
    for (const listener of listeners) listener(msg.volume)
  }
  invoke('plugin:system-volume|watch_volume', { channel }).catch((e) => {
    console.warn('[SystemVolume] watch failed', e)
    watchStarted = false
  })
}

/**
 * Subscribe to system volume changes (hardware buttons, control center…).
 * Returns an unsubscribe function.
 */
export function subscribeSystemVolume(listener: (volume: number) => void): () => void {
  listeners.add(listener)
  ensureWatch()
  return () => {
    listeners.delete(listener)
  }
}
