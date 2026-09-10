import { useEffect, type RefObject } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import type { AudioOutputTarget } from '../types/settings'

// Routes an <audio>/<video> element to the output device chosen in
// Settings → Advanced for the given target tab. Each tab has its own device
// (e.g. music → virtual cable 1, video → cable 2 for Voicemeeter setups).
//
// `reapplyKey` re-runs the effect when the media element is (re)mounted
// conditionally (e.g. Live TV renders its <video> only for TV channels) —
// pass something that changes when the element appears, like the stream URL.
export function useAudioOutputDevice(
  mediaRef: RefObject<HTMLMediaElement | null>,
  target: AudioOutputTarget,
  reapplyKey?: unknown,
) {
  const deviceId = useSettingsStore(state => state.audioOutputDevices[target])

  useEffect(() => {
    const media = mediaRef.current
    if (!media || !('setSinkId' in media)) return
    // Nothing configured and already on the default output → don't call at
    // all. iOS WebKit exposes setSinkId but rejects every call, so this
    // no-op case must not reach it. ('' = reset to default system output.)
    if (!deviceId && !(media as any).sinkId) return
    ;(media as any).setSinkId(deviceId || '').catch((e: unknown) =>
      console.warn('[AudioOutput] setSinkId failed', e),
    )
  }, [deviceId, reapplyKey, mediaRef])
}
