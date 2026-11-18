import React, { useEffect, useRef, useState } from 'react'
import { RedownloadButton } from './RedownloadButton'
import { HIGHLIGHT_COLORS, type Highlight } from '../../utils/readerAnnotations'
import ePub, { Rendition } from 'epubjs'
import api, { toLocalUrl, isLocalFileUrl } from '../../utils/api'
import type { TocItem } from './types'
import { getItem, setItem } from '../../utils/storage'

/** True for inputs/textareas/selects/contentEditable — keys typed there must not turn pages. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}
import {
  type EpubAppearance,
  EPUB_BG,
  EPUB_THEME_COLORS,
  EPUB_MARGIN_PADDING,
  buildEpubCss,
} from './epubStyles'

// Re-export for consumers that previously imported these from here
export { EPUB_BG } from './epubStyles'

const EpubReader: React.FC<{
  path: string,
  onRenditionReady: (r: Rendition) => void,
  initialLocation?: string,
  /** percentage is undefined until epub.js locations are available */
  onLocationChange?: (loc: string, percentage: number | undefined) => void,
  onTocLoaded?: (toc: TocItem[]) => void,
  appearance: EpubAppearance,
  onActivity?: () => void,
  headers?: any,
  basicAuthHeaders?: any,
  onRedownload?: () => void,
  /** Saved highlights to draw over the text */
  highlights?: Highlight[],
  /** Text selected in the book (null = selection dismissed by a page turn) */
  onTextSelected?: (sel: { cfiRange: string; text: string } | null) => void,
  /** A drawn highlight was tapped */
  onHighlightClick?: (id: string) => void,
}> = ({ path, onRenditionReady, initialLocation, onLocationChange, onTocLoaded, appearance, onActivity, headers, basicAuthHeaders, onRedownload, highlights, onTextSelected, onHighlightClick }) => {
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<any>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { theme, fontSize, fontFamily, lineHeight, margin } = appearance

  // Refs for content hook closures
  const appearanceRef = useRef(appearance)
  appearanceRef.current = appearance
  const onActivityRef = useRef(onActivity)
  onActivityRef.current = onActivity
  const onLocationChangeRef = useRef(onLocationChange)
  onLocationChangeRef.current = onLocationChange
  const onTextSelectedRef = useRef(onTextSelected)
  onTextSelectedRef.current = onTextSelected
  const onHighlightClickRef = useRef(onHighlightClick)
  onHighlightClickRef.current = onHighlightClick
  // Set once the first chapter is on screen (highlights can be drawn then)
  const [renditionReady, setRenditionReady] = useState(false)
  // id → "cfi|color" of the highlights currently drawn
  const drawnRef = useRef<Map<string, { cfi: string; color: string }>>(new Map())
  // Window keydown listener cleanup (set inside the async loader)
  const removeKeyListenerRef = useRef<(() => void) | null>(null)

  // Last known reading position — used to restore after appearance re-flows
  const currentCfiRef = useRef<string | null>(initialLocation ?? null)

  // Touch Handling for EPUB
  const touchStart = useRef<{ x: number, y: number } | null>(null)
  const minSwipeDistance = 50

  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const touchEnd = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }

    const distanceX = touchStart.current.x - touchEnd.x
    const distanceY = touchStart.current.y - touchEnd.y
    const isHorizontalSwipe = Math.abs(distanceX) > Math.abs(distanceY)

    if (isHorizontalSwipe && Math.abs(distanceX) > minSwipeDistance) {
      if (distanceX > 0) {
         bookRef.current?.rendition?.next()
      } else {
         bookRef.current?.rendition?.prev()
      }
    }
    touchStart.current = null
  }

  /**
   * Touches inside the chapter iframe never reach the wrapper's handlers, so
   * swipes and taps over the text did nothing on phones. Same gestures,
   * attached to each chapter document:
   * - horizontal swipe → next / previous page
   * - tap in the outer quarter → previous / next page (Kindle-style zones)
   * - tap in the middle → just counts as activity (shows the controls)
   * Links, highlights and text selection keep working: taps on them and
   * touches that end with a selection are left alone.
   */
  const attachIframeTouch = (contents: any) => {
    const doc: Document = contents.document
    const win = doc.defaultView
    let start: { x: number; y: number; t: number } | null = null
    let multi = false

    const toHost = (t: Touch) => {
      // clientX is relative to the iframe viewport; shift into the host page
      const frame = win?.frameElement as HTMLElement | null
      const r = frame?.getBoundingClientRect()
      return { x: (r?.left ?? 0) + t.clientX, y: (r?.top ?? 0) + t.clientY }
    }

    doc.addEventListener('touchstart', (e: TouchEvent) => {
      multi = e.touches.length > 1
      if (multi) { start = null; return }
      const p = toHost(e.touches[0])
      start = { ...p, t: Date.now() }
    }, { passive: true })

    doc.addEventListener('touchend', (e: TouchEvent) => {
      if (!start || multi || e.touches.length > 0) { start = null; return }
      const s0 = start
      start = null
      const p = toHost(e.changedTouches[0])
      const dx = p.x - s0.x
      const dy = p.y - s0.y
      const rendition = bookRef.current?.rendition
      if (!rendition) return

      // Selecting text (long-press) — never turn the page under the user
      const sel = win?.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().trim()) return

      if (Math.abs(dx) > minSwipeDistance && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) rendition.next()
        else rendition.prev()
        return
      }

      const isTap = Math.hypot(dx, dy) < 10 && Date.now() - s0.t < 450
      if (!isTap) return
      const target = e.target as Element | null
      if (target?.closest?.('a[href], button, input, textarea, select, [role="button"]')) return
      // Highlights are drawn in an SVG overlay outside this document, so a
      // tap on one never lands here.

      const host = viewerRef.current?.getBoundingClientRect()
      if (!host || host.width === 0) return
      const rel = (p.x - host.left) / host.width
      if (rel < 0.25) rendition.prev()
      else if (rel > 0.75) rendition.next()
    }, { passive: true })

    doc.addEventListener('touchcancel', () => { start = null }, { passive: true })
  }

  /**
   * Push the current appearance (theme colors, font family, line height) into
   * every rendered chapter iframe. Same 'reader-theme' stylesheet key as the
   * content hook — addStylesheetCss replaces the <style> innerHTML for a key,
   * so repeated calls update in place (live preview, no reload).
   */
  const applyAppearanceStyles = () => {
    const r = renditionRef.current as any
    if (!r) return
    const a = appearanceRef.current
    const colors = EPUB_THEME_COLORS[a.theme] ?? EPUB_THEME_COLORS.dark
    try {
      r.themes.override('background-color', colors.bg, true)
      r.themes.override('color', colors.fg, true)
    } catch {}
    try {
      const css = buildEpubCss(a)
      const contents = r.getContents() as any[]
      if (contents) {
        contents.forEach((c: any) => {
          try { c.addStylesheetCss(css, 'reader-theme') } catch {}
        })
      }
    } catch {}
  }

  // ── Live theme change (colors only — no re-flow needed) ──────────────────
  useEffect(() => {
    applyAppearanceStyles()
  }, [theme])

  // ── Live re-flowing changes (font size/family, line height, margins) ─────
  // Styles are injected immediately for live preview; the expensive layout
  // pass + position restore is debounced so rapid stepper clicks don't thrash.
  const reflowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const r = renditionRef.current
    if (!r) return

    try { r.themes.fontSize(`${fontSize}%`) } catch {}
    applyAppearanceStyles()

    if (reflowTimerRef.current) clearTimeout(reflowTimerRef.current)
    reflowTimerRef.current = setTimeout(() => {
      const rendition = renditionRef.current as any
      if (!rendition) return
      const cfi = currentCfiRef.current
      try {
        // Margin changes resize the container → epub.js must re-measure + clear
        // views (no-op when the container size is unchanged, e.g. font changes).
        rendition.resize(undefined, undefined, cfi || undefined)
      } catch {}
      if (cfi) {
        // Font/line-height changes re-flow the columns without a container
        // resize — re-display at the saved CFI so the exact position is kept.
        try { rendition.display(cfi) } catch {}
      }
    }, 300)

    return () => {
      if (reflowTimerRef.current) clearTimeout(reflowTimerRef.current)
    }
  }, [fontSize, fontFamily, lineHeight, margin])

  // Draw / update / remove highlights to match the `highlights` prop
  useEffect(() => {
    const rendition: any = renditionRef.current
    if (!renditionReady || !rendition) return
    const wanted = new Map((highlights ?? []).map(h => [h.id, h]))
    const drawn = drawnRef.current
    for (const [id, d] of drawn) {
      const w = wanted.get(id)
      if (!w || w.color !== d.color) {
        try { rendition.annotations.remove(d.cfi, 'highlight') } catch { /* gone */ }
        drawn.delete(id)
      }
    }
    for (const [id, h] of wanted) {
      if (drawn.has(id)) continue
      try {
        rendition.annotations.highlight(
          h.cfiRange,
          { id },
          () => onHighlightClickRef.current?.(id),
          'reader-hl',
          { fill: HIGHLIGHT_COLORS[h.color], 'fill-opacity': '0.35', 'mix-blend-mode': 'multiply' },
        )
        drawn.set(id, { cfi: h.cfiRange, color: h.color })
      } catch (e) {
        console.warn('[EpubReader] Could not draw highlight', e)
      }
    }
  }, [highlights, renditionReady])

  useEffect(() => {
    let active = true
    const loadBook = async () => {
      setLoading(true)
      setRenditionReady(false)
      setError(null)
      try {
        console.log("Loading EPUB from:", path)

        let arrayBuffer: ArrayBuffer;

        if (isLocalFileUrl(path)) {
          // Local file protocol handles its own fetching
          const response = await fetch(toLocalUrl(path))
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
          arrayBuffer = await response.arrayBuffer()
        } else {
          // Download to temp file first (avoids OOM for large files)
          let dlRes = await api.downloadToTemp({ url: path, headers, extension: 'epub' })

          // If Bearer auth fails, retry with Basic Auth
          if (!dlRes.success && dlRes.status === 401 && basicAuthHeaders) {
            console.log('[EpubReader] Bearer auth failed (401), retrying with Basic Auth...')
            dlRes = await api.downloadToTemp({ url: path, headers: basicAuthHeaders, extension: 'epub' })
          }

          if (!dlRes.success || !dlRes.path) {
            throw new Error(dlRes.error || `HTTP error! status: ${dlRes.status}`)
          }

          // Load from temp file via book-file:// protocol
          const localUrl = toLocalUrl(dlRes.path)
          const response = await fetch(localUrl)
          if (!response.ok) throw new Error(`Failed to read temp file`)
          arrayBuffer = await response.arrayBuffer()
        }

        if (arrayBuffer.byteLength === 0) throw new Error("Downloaded file is empty")

        console.log("EPUB Data Loaded. Size:", arrayBuffer.byteLength)

        if (!viewerRef.current || !active) return

        if (bookRef.current) {
          bookRef.current.destroy()
        }

        const book = ePub(arrayBuffer)
        bookRef.current = book

        console.log("Waiting for book.ready...")
        await book.ready
        console.log("EPUB Ready.")

        // Load TOC
        if (onTocLoaded) {
            const navigation = await book.loaded.navigation
            const processToc = (items: any[]): TocItem[] => {
                return items.map(item => ({
                    label: item.label,
                    href: item.href,
                    subitems: item.subitems ? processToc(item.subitems) : undefined
                }))
            }
            onTocLoaded(processToc(navigation.toc))
        }

        if (!active || !viewerRef.current) return

        console.log("Rendering to div...")
        // SECURITY: never set allowScriptedContent. epub.js would then sandbox
        // the chapter iframe with "allow-same-origin allow-scripts", letting a
        // script inside any (untrusted) EPUB reach window.parent and the Tauri
        // IPC (fs/http commands). Without it the iframe keeps allow-same-origin
        // only, so our content hook can still style/observe the document.
        const rendition = book.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          manager: "default",
        })
        renditionRef.current = rendition

        // Initial appearance: font size + colors registered before display so
        // epub.js applies them as each chapter is injected
        try { rendition.themes.fontSize(`${appearanceRef.current.fontSize}%`) } catch {}
        try {
          const colors = EPUB_THEME_COLORS[appearanceRef.current.theme] ?? EPUB_THEME_COLORS.dark
          rendition.themes.override('background-color', colors.bg, true)
          rendition.themes.override('color', colors.fg, true)
        } catch {}

        // Forward iframe events & inject appearance CSS for each new chapter
        rendition.hooks.content.register((contents: any) => {
          // Inject current appearance CSS for newly loaded chapters
          try {
            contents.addStylesheetCss(buildEpubCss(appearanceRef.current), 'reader-theme')
          } catch {}
          // Forward mouse/touch events so idle detection works
          if (contents.document) {
            const forward = () => onActivityRef.current?.()
            contents.document.addEventListener('mousemove', forward)
            contents.document.addEventListener('mousedown', forward)
            contents.document.addEventListener('touchstart', forward)
            contents.document.addEventListener('keydown', forward)
            attachIframeTouch(contents)
          }
        })

        console.log("Displaying...")
        // epub.js throws "No Section Found" when the target doesn't resolve to
        // a spine item: a saved position that isn't a CFI/href of this file
        // (page number, other edition), or — with no target — a book whose
        // spine items are all linear="no". Fall back step by step instead of
        // failing to open the book.
        const spineItems: any[] = (book.spine as any)?.spineItems ?? []
        const attempts: (string | undefined)[] = []
        if (initialLocation) attempts.push(initialLocation)
        attempts.push(undefined)
        if (spineItems[0]?.href) attempts.push(spineItems[0].href)
        let displayed = false
        let lastError: unknown = null
        for (const target of attempts) {
          try {
            await (target ? rendition.display(target) : rendition.display())
            displayed = true
            break
          } catch (e) {
            lastError = e
            console.warn('[EpubReader] display failed for', target ?? '(start)', e)
          }
        }
        if (!displayed) {
          throw lastError instanceof Error ? lastError : new Error('This EPUB has no readable sections')
        }
        console.log("Displayed.")

        setLoading(false)
        onRenditionReady(rendition)
        drawnRef.current = new Map()
        setRenditionReady(true)

        // Text selection → highlight toolbar in Reader.tsx
        rendition.on('selected', (cfiRange: string) => {
          let text = ''
          try { text = (rendition as any).getRange(cfiRange)?.toString() ?? '' } catch { /* ignore */ }
          if (text.trim()) onTextSelectedRef.current?.({ cfiRange, text: text.trim() })
        })

        // epub.js only fills location.start.percentage once book.locations
        // exist. Until then report `undefined` (keep the stored percentage)
        // instead of a misleading 0.
        const hasLocations = () => {
          try { return (book.locations as any).length() > 0 } catch { return false }
        }
        rendition.on('relocated', (location: any) => {
          currentCfiRef.current = location.start.cfi
          onTextSelectedRef.current?.(null)
          onLocationChangeRef.current?.(
            location.start.cfi,
            hasLocations() ? location.start.percentage : undefined,
          )
        })

        // Locations: cached per book (generation walks every chapter and can
        // take seconds on a phone), generated in the background otherwise.
        void (async () => {
          const cacheKey = `epub_locations_${path}`
          try {
            const cached = await getItem(cacheKey)
            if (cached) (book.locations as any).load(cached)
            else {
              await book.locations.generate(1600)
              if (!active) return
              await setItem(cacheKey, (book.locations as any).save())
            }
          } catch (e) {
            console.warn('[EpubReader] Could not build locations:', e)
            return
          }
          if (!active || !hasLocations()) return
          const cfi = currentCfiRef.current
          if (cfi) {
            try {
              const pct = (book.locations as any).percentageFromCfi(cfi)
              if (typeof pct === 'number') onLocationChangeRef.current?.(cfi, pct)
            } catch {}
          }
        })()

        // Arrow-key page turns. Inside the book iframe epub.js re-emits
        // keydown through the rendition; outside it the window listener
        // handles it. keydown only — listening to keyup too turned two pages.
        const handleKey = (e: KeyboardEvent) => {
          if (isEditableTarget(e.target)) return
          if (e.ctrlKey || e.metaKey || e.altKey) return
          const k = e.key
          if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) {
            e.preventDefault?.()
            rendition.next()
          } else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) {
            e.preventDefault?.()
            rendition.prev()
          } else if (k === 'Home' || k === 'End') {
            // First / last chapter of the book
            const items: any[] = (book.spine as any)?.spineItems ?? []
            const target = k === 'Home' ? items[0] : items[items.length - 1]
            if (target?.href) {
              e.preventDefault?.()
              void rendition.display(target.href)
            }
          }
        }
        rendition.on('keydown', handleKey)
        window.addEventListener('keydown', handleKey)
        removeKeyListenerRef.current = () => window.removeEventListener('keydown', handleKey)

      } catch (e: any) {
        console.error("Failed to load EPUB", e)
        if (active) {
            setError(e.message || "Unknown error")
            setLoading(false)
        }
      }
    }

    loadBook()

    return () => {
      active = false
      removeKeyListenerRef.current?.()
      removeKeyListenerRef.current = null
      renditionRef.current = null
      if (bookRef.current) {
        bookRef.current.destroy()
        bookRef.current = null
      }
    }
  }, [path])

  return (
    <div
      className={`relative h-full w-full ${EPUB_BG[theme] || EPUB_BG.dark}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
        {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-gray-900 text-white">
                <div className="w-8 h-8 border-4 border-theme-500 border-t-transparent rounded-full animate-spin"></div>
                <div className="text-sm">Loading EPUB...</div>
            </div>
        )}

        {error && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900 text-red-400 p-4 text-center">
                <div className="max-w-md">
                    <p className="font-bold mb-2">Error loading book</p>
                    <p className="text-sm">{error}</p>
                    <RedownloadButton onRedownload={onRedownload} />
                </div>
            </div>
        )}

        {/* Margin wrapper — padding shrinks the epub.js container; the debounced
            rendition.resize() in the margins effect re-measures it */}
        <div
          className="h-full w-full"
          style={{ paddingLeft: EPUB_MARGIN_PADDING[margin], paddingRight: EPUB_MARGIN_PADDING[margin] }}
        >
          <div ref={viewerRef} className="h-full w-full" style={{ minHeight: '400px' }} />
        </div>
    </div>
  )
}

export default EpubReader
