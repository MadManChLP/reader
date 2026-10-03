import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Palette, ChevronDown, RotateCcw } from 'lucide-react'
import { useSettingsStore, useThemeColors } from '../stores/settingsStore'
import { TAB_ACCENT_DEFAULTS, getTabAccent, hexToRgb, rgbToHex } from '../utils/theme'
import type { ThemeTab } from '../types/settings'

const TAB_ROWS: { id: ThemeTab; label: string }[] = [
  { id: 'calibre', label: 'Calibre' },
  { id: 'jellyfin', label: 'Jellyfin' },
  { id: 'jellymusic', label: 'JellyMusic' },
  { id: 'requester', label: 'Requester' },
  { id: 'livetv', label: 'Live TV' },
  { id: 'audiobookshelf', label: 'Audiobooks' },
]

// ── HSV helpers (pickers use HSV: square = saturation/value, slider = hue) ────

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHsv(r, g, b)
}

function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v)
  return rgbToHex(r, g, b)
}

// ── Picker: hue slider + saturation/value drag area ──────────────────────────

function AccentPicker({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(color))
  // Track the last hex we emitted so external changes (reset button) re-sync
  // the picker without fighting the user's drag
  const lastEmittedRef = useRef(color.toLowerCase())
  const throttleRef = useRef<number | null>(null)
  const pendingHexRef = useRef<string | null>(null)

  useEffect(() => {
    if (color.toLowerCase() !== lastEmittedRef.current) {
      setHsv(hexToHsv(color))
      lastEmittedRef.current = color.toLowerCase()
    }
  }, [color])

  useEffect(() => () => {
    if (throttleRef.current !== null) window.clearTimeout(throttleRef.current)
  }, [])

  // Commit at most every 100ms while dragging (settings persist to localStorage)
  const emit = useCallback((hex: string) => {
    lastEmittedRef.current = hex.toLowerCase()
    pendingHexRef.current = hex
    if (throttleRef.current !== null) return
    throttleRef.current = window.setTimeout(() => {
      throttleRef.current = null
      if (pendingHexRef.current) {
        onChange(pendingHexRef.current)
        pendingHexRef.current = null
      }
    }, 100)
  }, [onChange])

  const update = useCallback((next: { h: number; s: number; v: number }) => {
    setHsv(next)
    emit(hsvToHex(next.h, next.s, next.v))
  }, [emit])

  // Saturation/value square: drag & drop fine-grain selection
  const svRef = useRef<HTMLDivElement>(null)
  const handleSvPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    e.preventDefault()
    el.setPointerCapture(e.pointerId)

    const apply = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()
      const s = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const v = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
      setHsv(prev => {
        const next = { h: prev.h, s, v }
        emit(hsvToHex(next.h, next.s, next.v))
        return next
      })
    }
    apply(e.clientX, e.clientY)

    const move = (ev: PointerEvent) => apply(ev.clientX, ev.clientY)
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }, [emit])

  const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v)
  const hueColor = hsvToHex(hsv.h, 1, 1)

  return (
    <div className="space-y-3">
      {/* Saturation / value area */}
      <div
        ref={svRef}
        onPointerDown={handleSvPointerDown}
        className="relative w-full h-36 rounded-lg cursor-crosshair touch-none border border-white/10"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
        }}
      >
        <div
          className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: currentHex,
          }}
        />
      </div>

      {/* Hue slider */}
      <input
        type="range"
        min={0}
        max={360}
        step={1}
        value={Math.round(hsv.h)}
        onChange={(e) => update({ ...hsv, h: parseInt(e.target.value, 10) })}
        className="hue-slider w-full h-3 rounded-full appearance-none cursor-pointer"
        style={{
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}
      />

      {/* Preview + hex */}
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg border border-white/20 shadow-inner"
          style={{ backgroundColor: currentHex }}
        />
        <span className="text-sm font-mono text-white/70 uppercase">{currentHex}</span>
      </div>
    </div>
  )
}

// ── Settings section ──────────────────────────────────────────────────────────

export function ThemeColorSettings() {
  const themeColors = useThemeColors()
  const setThemeColor = useSettingsStore(s => s.setThemeColor)
  const resetThemeColors = useSettingsStore(s => s.resetThemeColors)
  const [isOpen, setIsOpen] = useState(false)
  const [openTab, setOpenTab] = useState<ThemeTab | null>(null)

  const hasOverrides = Object.keys(themeColors).length > 0

  return (
    <div className="space-y-4">
      <button
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center gap-3 text-left group"
      >
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-600 flex items-center justify-center">
          <Palette size={20} className="text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Theme Colors</h2>
          <p className="text-xs text-white/50">Pick a custom accent color for each tab</p>
        </div>
        <ChevronDown
          size={20}
          className={`text-white/40 group-hover:text-white/70 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="bg-white/5 rounded-xl p-6 border border-white/10 space-y-3">
          <p className="text-xs text-white/50">
            The accent color of the current tab is applied when you switch to it.
            Reset returns a tab to its built-in color.
          </p>

          {TAB_ROWS.map(({ id, label }) => {
            const hex = getTabAccent(id, themeColors)
            const isCustom = !!themeColors[id]
            const expanded = openTab === id
            return (
              <div key={id} className="rounded-lg border border-white/10 overflow-hidden">
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${expanded ? 'bg-white/10' : 'hover:bg-white/5'}`}
                  onClick={() => setOpenTab(expanded ? null : id)}
                >
                  <div
                    className="w-6 h-6 rounded-md border border-white/20 flex-shrink-0"
                    style={{ backgroundColor: hex }}
                  />
                  <span className="flex-1 text-sm font-medium text-white/90">{label}</span>
                  {isCustom && (
                    <span className="text-[10px] uppercase tracking-wider text-white/40">Custom</span>
                  )}
                  {isCustom && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setThemeColor(id, null)
                      }}
                      className="p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                      title={`Reset ${label} to default`}
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                  <ChevronDown
                    size={16}
                    className={`text-white/40 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  />
                </div>
                {expanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-white/10">
                    <AccentPicker
                      color={hex}
                      onChange={(newHex) => {
                        // Picking the default color exactly counts as "no override"
                        setThemeColor(id, newHex.toLowerCase() === TAB_ACCENT_DEFAULTS[id].toLowerCase() ? null : newHex)
                      }}
                    />
                    <button
                      onClick={() => setThemeColor(id, null)}
                      disabled={!isCustom}
                      className="w-full mt-3 px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10
                        rounded-lg text-xs text-white/80 font-medium transition-colors flex items-center justify-center gap-1.5"
                    >
                      <RotateCcw size={12} />
                      {isCustom ? `Reset ${label} to default` : `${label} is using the default color`}
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          <button
            onClick={resetThemeColors}
            disabled={!hasOverrides}
            className="w-full mt-2 px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10
              rounded-lg text-sm text-white/80 font-medium transition-colors flex items-center justify-center gap-2"
          >
            <RotateCcw size={14} />
            Reset all to default colors
          </button>
        </div>
      )}
    </div>
  )
}
