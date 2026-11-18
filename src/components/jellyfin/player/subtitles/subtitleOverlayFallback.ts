// DOM text-overlay subtitle renderer — the fallback for platforms where the
// JASSUB/libass worker cannot start (iOS WKWebView doesn't service worker/WASM
// fetches over the custom tauri:// scheme; WebKitGTK lacks OffscreenCanvas
// support; etc.). Renders plain timed text styled from the user's
// SubtitleStyle. ASS authored styling (fonts/colors/positions/karaoke) is NOT
// preserved here beyond a coarse top-vs-bottom split — that fidelity needs
// libass, which these engines can't run. Subtitles showing plainly beats
// subtitles not showing at all.
//
// Injected as a sibling-overlay inside the player's dedicated video wrapper
// (same insertion point JASSUB uses), driven by a rAF loop that only touches
// the DOM when the set of active cues changes.

import type { SubtitleStyle } from '../../../../types/settings'
import type { OverlayCue } from './subtitleAss'

// CSS text-shadow approximating the libass outline/shadow edge styles.
function edgeShadow(edge: SubtitleStyle['edgeStyle'], color: string): string {
  if (edge === 'none') return 'none'
  if (edge === 'shadow') return `2px 2px 4px ${color}, 1px 1px 2px ${color}`
  const radius = edge === 'thin' ? 1 : edge === 'medium' ? 1.75 : 2.75
  const steps = 12
  const parts: string[] = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    parts.push(`${(Math.cos(a) * radius).toFixed(2)}px ${(Math.sin(a) * radius).toFixed(2)}px 0 ${color}`)
  }
  return parts.join(', ')
}

function fontStack(family: string): string {
  return family && family !== 'Default'
    ? `"${family}", system-ui, "Segoe UI", Roboto, sans-serif`
    : 'system-ui, "Segoe UI", Roboto, sans-serif'
}

function boxRgba(hex: string, opacityPct: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const rgb = m ? m[1] : '000000'
  const r = parseInt(rgb.slice(0, 2), 16)
  const g = parseInt(rgb.slice(2, 4), 16)
  const b = parseInt(rgb.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${(opacityPct / 100).toFixed(2)})`
}

export class SubtitleOverlayFallback {
  private root = document.createElement('div')
  private topZone = document.createElement('div')
  private middleZone = document.createElement('div')
  private bottomZone = document.createElement('div')
  private raf = 0
  private lastKey: string | null = null
  private destroyed = false

  constructor(
    private video: HTMLVideoElement,
    private cues: OverlayCue[],
    private style: SubtitleStyle,
  ) {
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      overflow: 'hidden',
    } satisfies Partial<CSSStyleDeclaration>)
    this.root.className = 'subtitle-overlay-fallback'

    for (const zone of [this.topZone, this.middleZone, this.bottomZone]) {
      Object.assign(zone.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.25em',
        textAlign: 'center',
        padding: '0 5%',
      } satisfies Partial<CSSStyleDeclaration>)
    }
    this.topZone.style.paddingTop = '3.5%'
    this.bottomZone.style.paddingBottom = '4.5%'
    this.middleZone.style.flex = '1'
    this.middleZone.style.justifyContent = 'center'

    this.root.append(this.topZone, this.middleZone, this.bottomZone)
    ;(video.parentElement ?? video.ownerDocument.body).appendChild(this.root)

    const loop = () => {
      if (this.destroyed) return
      this.update()
      this.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  /** Re-style live (settings changed while playing). */
  applyStyle(style: SubtitleStyle) {
    this.style = style
    this.lastKey = null // force re-render with new styling
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.root.remove()
  }

  private update() {
    const t = this.video.currentTime
    const active = this.cues.filter((c) => c.start <= t && t < c.end)
    const key = active.map((c) => `${c.start}/${c.end}`).join('|')
    this.syncFontSize()
    if (key === this.lastKey) return
    this.lastKey = key
    this.render(active)
  }

  private syncFontSize() {
    // ~4.6% of the video element height at 100% scale — matches the libass
    // base size (46px at PlayResY 720) closely enough for a consistent feel.
    const px = Math.max(12, Math.round(this.video.clientHeight * 0.046 * (this.style.fontScale / 100)))
    const val = `${px}px`
    if (this.root.style.fontSize !== val) this.root.style.fontSize = val
  }

  private render(active: OverlayCue[]) {
    const s = this.style
    const makeLine = (text: string) => {
      const line = document.createElement('div')
      const span = document.createElement('span')
      span.textContent = text
      Object.assign(span.style, {
        whiteSpace: 'pre-line',
        fontFamily: fontStack(s.fontFamily),
        fontWeight: s.bold ? '700' : '400',
        color: s.color,
        textShadow: edgeShadow(s.edgeStyle, s.outlineColor),
        lineHeight: '1.35',
      } satisfies Partial<CSSStyleDeclaration>)
      if (s.backgroundOpacity > 0) {
        Object.assign(span.style, {
          backgroundColor: boxRgba(s.outlineColor, s.backgroundOpacity),
          padding: '0.08em 0.35em',
          borderRadius: '0.15em',
        } satisfies Partial<CSSStyleDeclaration>)
      }
      line.appendChild(span)
      return line
    }

    const topCues = active.filter((c) => c.top)
    const mainCues = active.filter((c) => !c.top)
    // \an-top cues always render top; everything else goes to the zone the
    // user picked in settings (bottom by default).
    const mainZone = s.position === 'top' ? this.topZone : s.position === 'middle' ? this.middleZone : this.bottomZone

    this.topZone.replaceChildren(...topCues.map((c) => makeLine(c.text)))
    this.middleZone.replaceChildren()
    this.bottomZone.replaceChildren()
    for (const c of mainCues) mainZone.appendChild(makeLine(c.text))
  }
}
