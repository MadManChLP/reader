// Turns a user SubtitleStyle + WebVTT text into an ASS document that libass
// (JASSUB) can render. Used for TEXT subtitles (SRT/VTT) so they get the same
// high-quality outline rendering — and the user's font/size/color/outline/
// position choices — as authored ASS subtitles. Authored ASS/SSA is fed to
// libass directly and never passes through here.

import type { SubtitleStyle } from '../../../../types/settings'

// The canvas libass lays out against. 720p keeps font math simple and scales
// to any real video size (libass scales the whole PlayRes box to the frame).
const PLAY_RES_X = 1280
const PLAY_RES_Y = 720

// Base font height at 100% scale, in PlayResY units. ~46px at 720p is a
// comfortable streaming-caption size.
const BASE_FONT_SIZE = 46

interface Cue {
  start: number // seconds
  end: number   // seconds
  text: string  // already newline-joined with real "\n"
}

/** "#rrggbb" (+ optional alpha 0..255 where 0 = opaque) → ASS "&HAABBGGRR". */
function hexToAssColour(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const rgb = m ? m[1] : 'ffffff'
  const r = rgb.slice(0, 2)
  const g = rgb.slice(2, 4)
  const b = rgb.slice(4, 6)
  const a = clampByte(alpha).toString(16).padStart(2, '0')
  return `&H${a}${b}${g}${r}`.toUpperCase()
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

// Edge style → libass Outline/Shadow widths + BorderStyle.
function edgeMetrics(style: SubtitleStyle): { outline: number; shadow: number } {
  switch (style.edgeStyle) {
    case 'none': return { outline: 0, shadow: 0 }
    case 'thin': return { outline: 1, shadow: 0 }
    case 'medium': return { outline: 2, shadow: 0 }
    case 'heavy': return { outline: 3.2, shadow: 0 }
    case 'shadow': return { outline: 0.6, shadow: 2.4 }
    default: return { outline: 3.2, shadow: 0 }
  }
}

// libass \an numpad alignment: 2 = bottom-center, 5 = middle-center, 8 = top.
function alignment(style: SubtitleStyle): number {
  switch (style.position) {
    case 'top': return 8
    case 'middle': return 5
    case 'bottom':
    default: return 2
  }
}

function fontName(style: SubtitleStyle): string {
  return style.fontFamily && style.fontFamily !== 'Default'
    ? style.fontFamily
    : 'Liberation Sans'
}

/** Build the single "Style: Default,..." line from the user's settings. */
export function buildStyleLine(style: SubtitleStyle): string {
  const { outline, shadow } = edgeMetrics(style)
  const hasBox = style.backgroundOpacity > 0
  // BorderStyle 3 = opaque box behind text; 1 = outline + drop shadow.
  const borderStyle = hasBox ? 3 : 1
  const primary = hexToAssColour(style.color)
  const outlineCol = hexToAssColour(style.outlineColor)
  // BackColour doubles as the box fill (BorderStyle 3) and the shadow color.
  // ASS alpha is inverted: 0 = opaque, 255 = fully transparent.
  const backAlpha = hasBox ? 255 - Math.round((style.backgroundOpacity / 100) * 255) : 0
  const back = hexToAssColour(style.outlineColor, backAlpha)
  const fontSize = Math.round(BASE_FONT_SIZE * (style.fontScale / 100))
  const bold = style.bold ? -1 : 0
  const align = alignment(style)
  const marginV = style.position === 'middle' ? 0 : 55

  // Fields: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,
  // BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,
  // BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
  return [
    'Style: Default',
    fontName(style),
    fontSize,
    primary,
    primary,
    outlineCol,
    back,
    bold,
    0, 0, 0,
    100, 100, 0, 0,
    borderStyle,
    outline,
    shadow,
    align,
    40, 40, marginV,
    1,
  ].join(',')
}

function two(n: number): string { return n.toString().padStart(2, '0') }

/** seconds → ASS time "H:MM:SS.cc" (centiseconds). */
function assTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.round((s - Math.floor(s)) * 100)
  // Handle rounding that pushes cs to 100.
  if (cs >= 100) return `${h}:${two(m)}:${two(sec + 1)}.00`
  return `${h}:${two(m)}:${two(sec)}.${two(cs)}`
}

// "MM:SS.mmm" or "HH:MM:SS.mmm" (also accepts ',' as the ms separator) → seconds.
function parseTimestamp(ts: string): number {
  const clean = ts.trim().replace(',', '.')
  const parts = clean.split(':')
  let h = 0, m = 0, s = 0
  if (parts.length === 3) {
    h = parseInt(parts[0], 10)
    m = parseInt(parts[1], 10)
    s = parseFloat(parts[2])
  } else if (parts.length === 2) {
    m = parseInt(parts[0], 10)
    s = parseFloat(parts[1])
  } else {
    s = parseFloat(parts[0])
  }
  if (Number.isNaN(h)) h = 0
  if (Number.isNaN(m)) m = 0
  if (Number.isNaN(s)) s = 0
  return h * 3600 + m * 60 + s
}

// Convert VTT/SRT inline markup to ASS override tags and escape the rest.
function cueTextToAss(raw: string): string {
  let t = raw
  // Italic / bold / underline tags → ASS overrides.
  t = t.replace(/<\s*i\s*>/gi, '{\\i1}').replace(/<\s*\/\s*i\s*>/gi, '{\\i0}')
  t = t.replace(/<\s*b\s*>/gi, '{\\b1}').replace(/<\s*\/\s*b\s*>/gi, '{\\b0}')
  t = t.replace(/<\s*u\s*>/gi, '{\\u1}').replace(/<\s*\/\s*u\s*>/gi, '{\\u0}')
  // Drop every other tag: <c.classname>, <v Speaker>, <ruby>, karaoke
  // timestamps like <00:00:01.000>, etc.
  t = t.replace(/<[^>]+>/g, '')
  // Decode the handful of entities VTT actually uses.
  t = t
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lrm;/g, '')
    .replace(/&rlm;/g, '')
  // Braces would be parsed as ASS override blocks — neutralize them.
  t = t.replace(/\{/g, '\\{').replace(/\}/g, '\\}')
  // Real newlines → ASS hard line breaks.
  t = t.replace(/\r?\n/g, '\\N')
  return t.trim()
}

/** Parse WebVTT (Jellyfin serves SRT as VTT too) into timed cues. */
export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = []
  // Normalize newlines, then split into blocks on blank lines.
  const body = vtt.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = body.split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.split('\n')
    // Find the timing line ("... --> ...") within the block.
    const timingIdx = lines.findIndex((l) => l.includes('-->'))
    if (timingIdx === -1) continue
    const timing = lines[timingIdx]
    const mArrow = /(.+?)-->(.+)/.exec(timing)
    if (!mArrow) continue
    const start = parseTimestamp(mArrow[1])
    // The end time may be followed by cue settings (e.g. "line:90% align:center").
    const endToken = mArrow[2].trim().split(/\s+/)[0]
    const end = parseTimestamp(endToken)
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue
    const textLines = lines.slice(timingIdx + 1)
    const text = cueTextToAss(textLines.join('\n'))
    if (text) cues.push({ start, end, text })
  }
  return cues
}

/** Build a complete ASS document from VTT text + the user's style. */
export function buildAssFromVtt(vtt: string, style: SubtitleStyle): string {
  const cues = parseVtt(vtt)
  const events = cues
    .map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text}`)
    .join('\n')

  return `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${PLAY_RES_X}
PlayResY: ${PLAY_RES_Y}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${buildStyleLine(style)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`
}

// ---- ASS cue extraction (for the no-libass fallback overlay) ----------------
// Used on platforms where the JASSUB worker can't start (iOS custom-scheme
// worker limits, WebKitGTK OffscreenCanvas gaps). Extracts plain timed text
// from an ASS document — override tags are stripped, vector-drawing cues are
// dropped, and only a coarse top-vs-bottom position survives.

export interface OverlayCue {
  start: number
  end: number
  text: string // plain text with real newlines
  top: boolean // \an7-9 (or legacy \a5-7) → render in the top zone
}

export function parseAssCues(ass: string): OverlayCue[] {
  const cues: OverlayCue[] = []
  let inEvents = false
  // Standard field order; replaced if the file declares its own Format line.
  let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']

  for (const line of ass.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (/^\[events\]$/i.test(trimmed)) { inEvents = true; continue }
    if (/^\[/.test(trimmed)) { inEvents = false; continue }
    if (!inEvents) continue

    if (/^format\s*:/i.test(trimmed)) {
      fields = trimmed.slice(trimmed.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase())
      continue
    }
    const m = /^dialogue\s*:\s*(.*)$/i.exec(trimmed)
    if (!m) continue

    const textIdx = fields.indexOf('text')
    const startIdx = fields.indexOf('start')
    const endIdx = fields.indexOf('end')
    if (textIdx === -1 || startIdx === -1 || endIdx === -1) continue

    const parts = m[1].split(',')
    if (parts.length <= textIdx) continue
    const start = parseTimestamp(parts[startIdx] ?? '')
    const end = parseTimestamp(parts[endIdx] ?? '')
    if (!(end > start)) continue

    // Text is the last field and may itself contain commas.
    const raw = parts.slice(textIdx).join(',')
    // Vector drawing mode (\p1..) draws shapes, not text — skip entirely.
    if (/\\p[1-9]/.test(raw)) continue
    const top = /\\an[789]/.test(raw) || /\\a[567](?!\d)/.test(raw)
    const text = raw
      .replace(/\{[^}]*\}/g, '') // strip override blocks
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/g, ' ')
      .trim()
    if (!text) continue
    cues.push({ start, end, text, top })
  }

  cues.sort((a, b) => a.start - b.start)
  return cues
}
