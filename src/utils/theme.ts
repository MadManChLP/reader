// Per-tab accent theming.
//
// Components use Tailwind classes on the `theme` palette (bg-theme-500,
// text-theme-400, …) which resolve to the CSS variables --theme-200..900 on
// <html>. When the active tab changes (or the user picks a custom color in
// settings), applyTabAccent() rewrites those variables, recoloring the whole
// tab at once. Shades are derived from a single base hex in HSL space, so a
// custom color produces a full consistent palette.

import type { ThemeTab, ThemeColors } from '../types/settings'

// Built-in accents = each tab's Tailwind *-500 color
export const TAB_ACCENT_DEFAULTS: Record<ThemeTab, string> = {
  calibre: '#a855f7',        // purple-500
  jellyfin: '#3b82f6',       // blue-500
  jellymusic: '#ec4899',     // pink-500
  requester: '#10b981',      // emerald-500
  livetv: '#ef4444',         // red-500
  audiobookshelf: '#f97316', // orange-500
}

export type ThemeShade = 200 | 300 | 400 | 500 | 600 | 700 | 900

// ── Color math ────────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h, s, l }
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  }
}

// Derive a Tailwind-like shade ladder from a base (≈500) color.
// Values are "r g b" strings ready for `rgb(var(--x) / alpha)`.
export function computeShades(baseHex: string): Record<ThemeShade, string> {
  const { r, g, b } = hexToRgb(baseHex)
  const { h, s, l } = rgbToHsl(r, g, b)

  const at = (lightness: number): string => {
    const c = hslToRgb(h, s, Math.max(0.05, Math.min(0.95, lightness)))
    return `${c.r} ${c.g} ${c.b}`
  }

  return {
    200: at(l + 0.28),
    300: at(l + 0.19),
    400: at(l + 0.10),
    500: `${r} ${g} ${b}`,
    600: at(l - 0.09),
    700: at(l - 0.17),
    900: at(Math.max(0.10, l * 0.45)),
  }
}

// Lighter variant of a hex color (for e.g. active-tab text on dark chips)
export function lightenHex(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const { h, s, l } = rgbToHsl(r, g, b)
  const c = hslToRgb(h, s, Math.min(0.95, l + amount))
  return rgbToHex(c.r, c.g, c.b)
}

// ── Accent resolution / application ──────────────────────────────────────────

export function getTabAccent(tab: ThemeTab, overrides: ThemeColors): string {
  return overrides[tab] ?? TAB_ACCENT_DEFAULTS[tab]
}

// Write the shade variables for a tab to <html>. Call whenever the active tab
// or the color overrides change.
export function applyTabAccent(tab: ThemeTab, overrides: ThemeColors): void {
  const shades = computeShades(getTabAccent(tab, overrides))
  const root = document.documentElement
  for (const [shade, rgb] of Object.entries(shades)) {
    root.style.setProperty(`--theme-${shade}`, rgb)
  }
}
