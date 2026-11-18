// EPUB appearance system — themes, font stacks, line height and margins.
// All styling is injected into the epub iframe via addStylesheetCss (innerHTML
// replace per key), using !important to override publisher inline/class styles.

export type EpubTheme = 'dark' | 'light' | 'sepia' | 'black'
export type EpubFontFamily = 'default' | 'serif' | 'sans' | 'charter' | 'palatino'
export type EpubMargin = 'narrow' | 'normal' | 'wide'

/** Everything that affects how the book text is rendered. */
export interface EpubAppearance {
  theme: EpubTheme
  fontSize: number // percentage, 50–200
  fontFamily: EpubFontFamily
  lineHeight: number // 0 = book default, else 1.2–2.2 (unitless)
  margin: EpubMargin
}

export const EPUB_THEME_COLORS: Record<EpubTheme, { bg: string; fg: string; link: string }> = {
  dark:  { bg: '#1a1a1a', fg: '#e0e0e0', link: '#8ab4f8' },
  black: { bg: '#000000', fg: '#c9c9c9', link: '#8ab4f8' }, // OLED
  light: { bg: '#ffffff', fg: '#000000', link: '#0066cc' },
  sepia: { bg: '#f6f1d1', fg: '#5f4b32', link: '#704214' },
}

// Tailwind background class for the reader container (behind/around the iframe)
export const EPUB_BG: Record<EpubTheme, string> = {
  dark: 'bg-[#1a1a1a]',
  black: 'bg-black',
  light: 'bg-white',
  sepia: 'bg-[#f6f1d1]',
}

// Pure CSS font stacks — no bundled font files. Each falls back gracefully
// across Windows / macOS / iOS / Linux.
export const EPUB_FONT_STACKS: Record<Exclude<EpubFontFamily, 'default'>, string> = {
  serif: `Georgia, 'Times New Roman', Times, serif`,
  sans: `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
  // Charter (macOS/iOS) → Sitka/Cambria (Windows) — excellent long-form reading faces
  charter: `Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, serif`,
  palatino: `Palatino, 'Palatino Linotype', 'Book Antiqua', 'URW Palladio L', Georgia, serif`,
}

export const EPUB_FONT_LABELS: Record<EpubFontFamily, string> = {
  default: 'Book Default',
  serif: 'Georgia',
  sans: 'Sans Serif',
  charter: 'Charter',
  palatino: 'Palatino',
}

// Horizontal padding applied around the epub.js container (per side).
// Percentages of the reader width so presets scale from phone to ultrawide.
export const EPUB_MARGIN_PADDING: Record<EpubMargin, string> = {
  narrow: '0%',
  normal: '4%',
  wide: '10%',
}

export const EPUB_MARGIN_LABELS: Record<EpubMargin, string> = {
  narrow: 'Narrow',
  normal: 'Normal',
  wide: 'Wide',
}

export const EPUB_LINE_HEIGHT_MIN = 1.2
export const EPUB_LINE_HEIGHT_MAX = 2.2
export const EPUB_LINE_HEIGHT_STEP = 0.1

/**
 * Build the stylesheet injected into each epub chapter iframe.
 * Font size is NOT included here — it goes through rendition.themes.fontSize()
 * so epub.js can factor it into its own layout math.
 */
export function buildEpubCss(a: Pick<EpubAppearance, 'theme' | 'fontFamily' | 'lineHeight'>): string {
  const c = EPUB_THEME_COLORS[a.theme] ?? EPUB_THEME_COLORS.dark
  const rules = [
    `html, body { background-color: ${c.bg} !important; color: ${c.fg} !important; }`,
    `* { color: inherit !important; }`,
    `a, a * { color: ${c.link} !important; }`,
  ]

  if (a.fontFamily !== 'default') {
    const stack = EPUB_FONT_STACKS[a.fontFamily]
    rules.push(`body, body * { font-family: ${stack} !important; }`)
    // Keep code samples monospaced even when a reading face is forced
    rules.push(`pre, pre *, code, code *, kbd, samp, tt { font-family: ui-monospace, Consolas, 'Courier New', monospace !important; }`)
  }

  if (a.lineHeight > 0) {
    // Unitless value scales with each element's own font size (headings stay sane)
    rules.push(`body, body * { line-height: ${a.lineHeight} !important; }`)
  }

  return rules.join('\n')
}
