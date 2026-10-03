import React, { useEffect, useRef, useState } from 'react'
import ePub, { Rendition } from 'epubjs'
import api, { toLocalUrl, isLocalFileUrl } from '../../utils/api'
import type { TocItem } from './types'
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
  onLocationChange?: (loc: string, percentage: number) => void,
  onTocLoaded?: (toc: TocItem[]) => void,
  appearance: EpubAppearance,
  onActivity?: () => void,
  headers?: any,
  basicAuthHeaders?: any
}> = ({ path, onRenditionReady, initialLocation, onLocationChange, onTocLoaded, appearance, onActivity, headers, basicAuthHeaders }) => {
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

  useEffect(() => {
    let active = true
    const loadBook = async () => {
      setLoading(true)
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
        const rendition = book.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          manager: "default",
          // @ts-ignore
          allowScriptedContent: true
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
          }
        })

        console.log("Displaying...")
        if (initialLocation) {
            await rendition.display(initialLocation)
        } else {
            await rendition.display()
        }
        console.log("Displayed.")

        setLoading(false)
        onRenditionReady(rendition)

        rendition.on('relocated', (location: any) => {
          currentCfiRef.current = location.start.cfi
          if (onLocationChange) {
             const percentage = location.start.percentage
             onLocationChange(location.start.cfi, percentage)
          }
        })

        const handleKey = (e: KeyboardEvent | any) => {
            if (e.key === 'ArrowRight') rendition.next()
            if (e.key === 'ArrowLeft') rendition.prev()
        }

        rendition.on('keydown', handleKey)
        rendition.on('keyup', handleKey)
        window.addEventListener('keydown', handleKey)

        return () => {
            window.removeEventListener('keydown', handleKey)
        }

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
