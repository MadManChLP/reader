// Subtitle appearance controls for the Jellyfin video player.
// Lives in Settings → Jellyfin. Edits the shared SubtitleStyle in the settings
// store; the player's libass renderer (useSubtitleRenderer) picks up changes
// live for text subtitles. A CSS preview approximates the on-video look.

import type { CSSProperties } from 'react'
import { useSubtitleStyle, useSettingsStore } from '../stores/settingsStore'
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleEdgeStyle,
  type SubtitlePosition,
} from '../types/settings'
import { RotateCcw, Type } from 'lucide-react'

// libass font name → a real CSS font stack for the preview. The libass side
// falls back to the bundled font when a name isn't installed; the preview just
// shows the closest web equivalent.
const FONT_OPTIONS: { label: string; value: string; css: string }[] = [
  { label: 'Default (Sans)', value: 'Default', css: 'system-ui, "Segoe UI", Roboto, sans-serif' },
  { label: 'Arial', value: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma', css: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: 'Trebuchet MS', css: '"Trebuchet MS", sans-serif' },
  { label: 'Georgia (Serif)', value: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { label: 'Comic Sans MS', value: 'Comic Sans MS', css: '"Comic Sans MS", cursive' },
]

const EDGE_OPTIONS: { label: string; value: SubtitleEdgeStyle }[] = [
  { label: 'None', value: 'none' },
  { label: 'Thin', value: 'thin' },
  { label: 'Medium', value: 'medium' },
  { label: 'Heavy', value: 'heavy' },
  { label: 'Shadow', value: 'shadow' },
]

const POSITION_OPTIONS: { label: string; value: SubtitlePosition }[] = [
  { label: 'Top', value: 'top' },
  { label: 'Middle', value: 'middle' },
  { label: 'Bottom', value: 'bottom' },
]

// Build a CSS text-shadow that approximates the libass outline/shadow.
function edgePreviewShadow(edge: SubtitleEdgeStyle, color: string): string {
  if (edge === 'none') return 'none'
  if (edge === 'shadow') return `2px 2px 3px ${color}`
  const radius = edge === 'thin' ? 1 : edge === 'medium' ? 1.75 : 2.75
  const steps = 12
  const parts: string[] = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    parts.push(`${(Math.cos(a) * radius).toFixed(2)}px ${(Math.sin(a) * radius).toFixed(2)}px 0 ${color}`)
  }
  return parts.join(', ')
}

function cssFontFor(family: string): string {
  return FONT_OPTIONS.find((f) => f.value === family)?.css ?? FONT_OPTIONS[0].css
}

export function SubtitleStyleSettings() {
  const style = useSubtitleStyle()
  const setSubtitleStyle = useSettingsStore((s) => s.setSubtitleStyle)

  const previewJustify =
    style.position === 'top' ? 'flex-start' : style.position === 'middle' ? 'center' : 'flex-end'

  const previewTextStyle: CSSProperties = {
    fontFamily: cssFontFor(style.fontFamily),
    fontSize: `${Math.round(26 * (style.fontScale / 100))}px`,
    fontWeight: style.bold ? 700 : 400,
    color: style.color,
    textShadow: edgePreviewShadow(style.edgeStyle, style.outlineColor),
    lineHeight: 1.3,
    padding: style.backgroundOpacity > 0 ? '0.1em 0.4em' : 0,
    backgroundColor:
      style.backgroundOpacity > 0
        ? hexWithAlpha(style.outlineColor, style.backgroundOpacity)
        : 'transparent',
    borderRadius: 4,
  }

  return (
    <div className="pt-4 mt-2 border-t border-white/10 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Type size={16} className="text-white/70" />
          <h3 className="text-sm font-medium text-white/80">Subtitles</h3>
        </div>
        <button
          onClick={() => setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE })}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:bg-white/10 rounded-md transition-colors"
          title="Reset subtitle style to defaults"
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>
      <p className="text-xs text-white/50 -mt-2">
        Styling applies to text subtitles (SRT/VTT). ASS/SSA subtitles keep their own
        authored fonts, colors and positioning.
      </p>

      {/* Live preview */}
      <div
        className="relative h-28 rounded-xl overflow-hidden flex flex-col px-3 py-2"
        style={{
          justifyContent: previewJustify,
          background:
            'linear-gradient(135deg, #1e3a5f 0%, #2d5a8c 45%, #3b82a6 100%)',
        }}
      >
        <div className="w-full text-center">
          <span style={previewTextStyle}>The quick brown fox jumps</span>
        </div>
      </div>

      {/* Font + size */}
      <div className="grid grid-cols-2 phone:grid-cols-1 gap-4">
        <div className="space-y-2">
          <label className="text-xs text-white/60">Font</label>
          <select
            value={style.fontFamily}
            onChange={(e) => setSubtitleStyle({ fontFamily: e.target.value })}
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white/90 focus:outline-none focus:border-theme-500"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value} className="bg-gray-900">
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-white/60">Text Size</label>
            <span className="text-xs text-white/40 tabular-nums">{style.fontScale}%</span>
          </div>
          <input
            type="range" min={50} max={200} step={5} value={style.fontScale}
            onChange={(e) => setSubtitleStyle({ fontScale: Number(e.target.value) })}
            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-theme-500
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-theme-500 [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </div>
      </div>

      {/* Colors */}
      <div className="grid grid-cols-2 phone:grid-cols-1 gap-4">
        <ColorField
          label="Text Color"
          value={style.color}
          onChange={(v) => setSubtitleStyle({ color: v })}
        />
        <ColorField
          label="Outline / Shadow Color"
          value={style.outlineColor}
          onChange={(v) => setSubtitleStyle({ outlineColor: v })}
        />
      </div>

      {/* Edge style */}
      <div className="space-y-2">
        <label className="text-xs text-white/60">Edge Style</label>
        <div className="flex gap-1">
          {EDGE_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setSubtitleStyle({ edgeStyle: o.value })}
              className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                style.edgeStyle === o.value
                  ? 'bg-theme-500 text-white'
                  : 'bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Background box */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-white/60">Background Box</label>
          <span className="text-xs text-white/40 tabular-nums">
            {style.backgroundOpacity === 0 ? 'Off' : `${style.backgroundOpacity}%`}
          </span>
        </div>
        <input
          type="range" min={0} max={100} step={5} value={style.backgroundOpacity}
          onChange={(e) => setSubtitleStyle({ backgroundOpacity: Number(e.target.value) })}
          className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-theme-500
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-theme-500 [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </div>

      {/* Position + bold */}
      <div className="grid grid-cols-2 phone:grid-cols-1 gap-4">
        <div className="space-y-2">
          <label className="text-xs text-white/60">Position</label>
          <div className="flex gap-1">
            {POSITION_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setSubtitleStyle({ position: o.value })}
                className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                  style.position === o.value
                    ? 'bg-theme-500 text-white'
                    : 'bg-white/5 text-white/70 hover:bg-white/10'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-white/60">Weight</label>
          <button
            onClick={() => setSubtitleStyle({ bold: !style.bold })}
            className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              style.bold ? 'bg-theme-500 text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            {style.bold ? 'Bold' : 'Regular'}
          </button>
        </div>
      </div>
    </div>
  )
}

// #rrggbb + 0..100 opacity → rgba() string for the preview box.
function hexWithAlpha(hex: string, opacityPct: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const rgb = m ? m[1] : '000000'
  const r = parseInt(rgb.slice(0, 2), 16)
  const g = parseInt(rgb.slice(2, 4), 16)
  const b = parseInt(rgb.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${(opacityPct / 100).toFixed(2)})`
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-white/60">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-9 rounded-lg bg-transparent border border-white/10 cursor-pointer p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v)
          }}
          className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white/90 uppercase focus:outline-none focus:border-theme-500"
        />
      </div>
    </div>
  )
}
