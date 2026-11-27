import React, { useCallback, useEffect, useRef, useState, memo } from 'react'
import { Volume1, Volume2 } from 'lucide-react'
import {
  SYSTEM_VOLUME_SUPPORTED,
  getSystemVolume,
  setSystemVolume,
  subscribeSystemVolume,
} from '../utils/systemVolume'

// System-volume slider for mobile Now Playing views. Drives the REAL OS media
// volume through the native plugin (the WebView can't — iOS ignores element
// volume entirely), and follows external changes (hardware buttons, control
// center) live. Renders nothing where the plugin isn't available (desktop,
// dev-in-browser), so it's safe to drop in unconditionally.
export const SystemVolumeSlider = memo(function SystemVolumeSlider({
  className,
}: {
  className?: string
}) {
  const [volume, setVolumeState] = useState<number | null>(null)
  const draggingRef = useRef(false)
  const lastSentRef = useRef(0)

  useEffect(() => {
    if (!SYSTEM_VOLUME_SUPPORTED) return
    let mounted = true
    getSystemVolume().then((v) => {
      if (mounted && v !== null && !draggingRef.current) setVolumeState(v)
    })
    const unsubscribe = subscribeSystemVolume((v) => {
      // Ignore echoes of our own writes while the user is dragging.
      if (!draggingRef.current) setVolumeState(v)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    draggingRef.current = true
    const update = (clientX: number, final = false) => {
      const rect = el.getBoundingClientRect()
      const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      setVolumeState(pos)
      const now = Date.now()
      if (final || now - lastSentRef.current > 80) {
        lastSentRef.current = now
        setSystemVolume(pos)
      }
    }
    update(e.clientX)
    const move = (ev: PointerEvent) => update(ev.clientX)
    const up = (ev: PointerEvent) => {
      update(ev.clientX, true)
      draggingRef.current = false
      el.releasePointerCapture(ev.pointerId)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }, [])

  if (!SYSTEM_VOLUME_SUPPORTED || volume === null) return null

  const pct = volume * 100
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ''}`}>
      <Volume1 size={16} className="text-white/50 flex-shrink-0" />
      <div
        className="relative flex-1 h-8 flex items-center cursor-pointer touch-none"
        onPointerDown={handlePointerDown}
      >
        <div className="w-full h-1 bg-white/15 rounded-full overflow-hidden">
          <div className="h-full bg-white/80 rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <div
          className="absolute w-3 h-3 bg-white rounded-full shadow -translate-x-1/2"
          style={{ left: `${pct}%` }}
        />
      </div>
      <Volume2 size={16} className="text-white/50 flex-shrink-0" />
    </div>
  )
})
