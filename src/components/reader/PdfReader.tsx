import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { RedownloadButton } from './RedownloadButton'
import { Document, Page, pdfjs } from 'react-pdf'
import { Search, ChevronUp, ChevronDown, X, LoaderCircle } from 'lucide-react'
import { AnnotationCanvas, AnnotationToolbar, TextNoteEditor, useAnnotationStore } from '../pdf-annotations'
import api, { toLocalUrl, isLocalFileUrl } from '../../utils/api'
import { registerBackHandler } from '../../utils/navigationBus'
import { useToast } from '../Toast'
import {
  usePdfTextStore, buildPageIndex, normalizeQuery, findInPage, makeHighlightRenderer,
  meaningfulLength, NO_TEXT_LAYER_MESSAGE,
  type PageTextIndex, type PdfTextMatch,
} from './pdfText'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import type { TocItem, PdfDisplayMode } from './types'

// Configure PDF Worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PdfReader: React.FC<{
  path: string,
  headers?: any,
  basicAuthHeaders?: any,
  page: number,
  onPageChange: (page: number, percentage: number) => void,
  onTocLoaded?: (toc: TocItem[]) => void,
  onTotalPagesChange?: (total: number) => void,
  onPdfDataLoaded?: (data: Uint8Array) => void,
  scale: number,
  fitMode: 'page' | 'width' | 'custom',
  displayMode: PdfDisplayMode,
  bookId: string,
  onScaleChange?: (scale: number) => void,
  onRedownload?: () => void,
}> = ({ path, headers, basicAuthHeaders, page, onPageChange, onTocLoaded, onTotalPagesChange, onPdfDataLoaded, scale, fitMode, displayMode, bookId, onScaleChange, onRedownload }) => {
  const [numPages, setNumPages] = useState<number>(0)
  const [pageNumber, setPageNumber] = useState<number>(page || 1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)

  // Pan / zoom interaction state — all via direct DOM (no React state → no re-renders during gesture)
  const contentRef = useRef<HTMLDivElement>(null)   // the single/double page wrapper
  const panOffsetRef = useRef({ x: 0, y: 0 })
  const gesturePinchScaleRef = useRef(1)            // CSS-only scale during pinch gesture
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; panX: number; panY: number } | null>(null)
  const didDragRef = useRef(false)
  const touchStartRef = useRef<{
    touches: Array<{ x: number; y: number }>
    panX: number; panY: number
    baseScale: number
    pinchDist: number | null
  } | null>(null)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  // Stable refs so event listeners with empty deps can read current values
  const currentScaleRef = useRef(scale)
  currentScaleRef.current = scale
  const onScaleChangeRef = useRef(onScaleChange)
  onScaleChangeRef.current = onScaleChange

  // Apply pan+pinch-scale as CSS transform directly — zero React re-renders during gesture
  const applyTransform = () => {
    if (!contentRef.current) return
    const { x, y } = panOffsetRef.current
    const s = gesturePinchScaleRef.current
    contentRef.current.style.transform = s !== 1
      ? `translate(${x}px, ${y}px) scale(${s})`
      : `translate(${x}px, ${y}px)`
  }

  const updatePanOffset = (next: { x: number; y: number }) => {
    panOffsetRef.current = next
    applyTransform()
  }

  const resetTransform = () => {
    panOffsetRef.current = { x: 0, y: 0 }
    gesturePinchScaleRef.current = 1
    applyTransform()
  }

  // Annotation: page size tracking for canvas overlay
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({})
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  const annotationMode = useAnnotationStore(s => s.annotationMode)
  const annotationInitialize = useAnnotationStore(s => s.initialize)
  const annotationCleanup = useAnnotationStore(s => s.cleanup)
  const annotationUndo = useAnnotationStore(s => s.undo)
  const annotationRedo = useAnnotationStore(s => s.redo)

  // ── Text layer (OCR) ────────────────────────────────────────────────────────
  // Scanned PDFs with OCR carry invisible text over the page image; pdf.js
  // extracts it like normal text. See ./pdfText.ts.
  const toast = useToast()
  const textStatus = usePdfTextStore(s => s.status)
  const selectModeRaw = usePdfTextStore(s => s.selectMode)
  const searchOpen = usePdfTextStore(s => s.searchOpen)
  // Annotation mode owns the pointer — text selection is off while it's active
  const selectMode = selectModeRaw && !annotationMode
  const selectModeRef = useRef(selectMode)
  selectModeRef.current = selectMode

  const pdfDocRef = useRef<any>(null)
  const textIndexRef = useRef<Map<number, PageTextIndex>>(new Map())
  const detectedForDataRef = useRef<Uint8Array | null>(null)
  const [docVersion, setDocVersion] = useState(0)

  // Fresh store per opened PDF
  useEffect(() => {
    usePdfTextStore.getState().reset()
    return () => usePdfTextStore.getState().reset()
  }, [])

  // Annotation mode (however it was entered) ends select mode
  useEffect(() => {
    if (annotationMode) usePdfTextStore.getState().setSelectMode(false)
  }, [annotationMode])

  // Leaving select mode drops any selection left on the page
  useEffect(() => {
    if (!selectMode) window.getSelection()?.removeAllRanges()
  }, [selectMode])

  /** Text index for one page (cached per loaded file, shared by detection + search). */
  const getPageIndex = useCallback(async (doc: any, n: number): Promise<PageTextIndex> => {
    const cache = textIndexRef.current
    const cached = cache.get(n)
    if (cached) return cached
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const index = buildPageIndex(content.items)
    cache.set(n, index)
    return index
  }, [])

  /** Sample a few pages to decide whether the PDF has a (OCR) text layer at all. */
  const detectTextLayer = useCallback(async (doc: any) => {
    const n: number = doc.numPages
    const sample = Array.from(new Set([1, 2, 3, 4, 5, Math.ceil(n / 2), n])).filter(p => p >= 1 && p <= n)
    let chars = 0
    for (const p of sample) {
      try {
        chars += meaningfulLength(await getPageIndex(doc, p))
      } catch {
        // Document proxy destroyed mid-check (display mode switch) — handled below
      }
      if (chars > 0) break
    }
    // The Document remounted while we were sampling → redo with the live proxy
    if (pdfDocRef.current && pdfDocRef.current !== doc && chars === 0) {
      return detectTextLayer(pdfDocRef.current)
    }
    console.log(`[PdfReader] Text layer: ${chars > 0 ? 'present' : 'absent (image-only)'}`)
    usePdfTextStore.getState().setStatus(chars > 0 ? 'present' : 'absent')
  }, [getPageIndex])

  // Initialize annotation store
  useEffect(() => {
    annotationInitialize(bookId)
    return () => { annotationCleanup() }
  }, [bookId])

  // ResizeObserver for page dimensions
  useEffect(() => {
    resizeObserverRef.current = new ResizeObserver((entries) => {
      const updates: Record<number, { width: number; height: number }> = {}
      for (const entry of entries) {
        const el = entry.target as HTMLDivElement
        const pn = parseInt(el.dataset.annotationPage || '0')
        if (pn > 0) {
          const w = Math.round(entry.contentRect.width)
          const h = Math.round(entry.contentRect.height)
          if (w > 0 && h > 0) {
            updates[pn] = { width: w, height: h }
          }
        }
      }
      if (Object.keys(updates).length > 0) {
        setPageSizes(prev => {
          // Only update if sizes actually changed to prevent re-render loops
          let changed = false
          for (const [key, val] of Object.entries(updates)) {
            const pn = Number(key)
            if (!prev[pn] || prev[pn].width !== val.width || prev[pn].height !== val.height) {
              changed = true
              break
            }
          }
          return changed ? { ...prev, ...updates } : prev
        })
      }
    })
    return () => resizeObserverRef.current?.disconnect()
  }, [])

  // ── Ctrl+Wheel zoom ──────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const delta = e.deltaY < 0 ? 0.15 : -0.15
      const next = Math.max(0.25, Math.min(5, currentScaleRef.current + delta))
      onScaleChangeRef.current?.(next)
      if (next <= 1.05) resetTransform()
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  // ── Mouse drag pan ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return
      const dx = e.clientX - dragStartRef.current.mouseX
      const dy = e.clientY - dragStartRef.current.mouseY
      if (!didDragRef.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      if (!didDragRef.current) {
        didDragRef.current = true
        document.body.style.cursor = 'grabbing'
      }
      panOffsetRef.current = { x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy }
      applyTransform()
    }
    const handleMouseUp = () => {
      dragStartRef.current = null
      document.body.style.cursor = ''
      if (didDragRef.current) {
        setTimeout(() => { didDragRef.current = false }, 50)
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // ── Touch pinch-zoom + single-finger pan ──────────────────────────────────
  // During gesture: only CSS transform (no React re-renders, no PDF re-renders)
  // On touchend: commit final scale once → PDF re-renders exactly once
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onTouchStart = (e: TouchEvent) => {
      const touches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }))
      const pinchDist = touches.length === 2
        ? Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y)
        : null
      touchStartRef.current = {
        touches, pinchDist,
        panX: panOffsetRef.current.x,
        panY: panOffsetRef.current.y,
        baseScale: currentScaleRef.current,
      }
      didDragRef.current = false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!touchStartRef.current) return
      const cur = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }))

      if (cur.length === 2 && touchStartRef.current.pinchDist !== null) {
        // Pinch-to-zoom: apply CSS scale only — no parent state update yet
        e.preventDefault()
        const dist = Math.hypot(cur[1].x - cur[0].x, cur[1].y - cur[0].y)
        const ratio = dist / touchStartRef.current.pinchDist
        const clampedRatio = Math.max(
          0.25 / touchStartRef.current.baseScale,
          Math.min(5 / touchStartRef.current.baseScale, ratio)
        )
        gesturePinchScaleRef.current = clampedRatio
        applyTransform()
      } else if (cur.length === 1 && currentScaleRef.current > 1.05 && !selectModeRef.current) {
        // Single-finger pan when zoomed in — CSS only, no setState
        // (not in text-select mode: there the finger drags the selection)
        e.preventDefault()
        didDragRef.current = true
        const dx = cur[0].x - touchStartRef.current.touches[0].x
        const dy = cur[0].y - touchStartRef.current.touches[0].y
        panOffsetRef.current = { x: touchStartRef.current.panX + dx, y: touchStartRef.current.panY + dy }
        applyTransform()
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (touchStartRef.current && gesturePinchScaleRef.current !== 1) {
        // Commit the final scale to parent — triggers exactly one PDF re-render
        const finalScale = Math.max(0.25, Math.min(5, touchStartRef.current.baseScale * gesturePinchScaleRef.current))
        gesturePinchScaleRef.current = 1
        if (finalScale <= 1.05) panOffsetRef.current = { x: 0, y: 0 }
        onScaleChangeRef.current?.(finalScale)
        applyTransform()
      } else if (!didDragRef.current && !selectModeRef.current && e.changedTouches.length === 1 && e.touches.length === 0) {
        // Single-finger tap — detect double-tap for zoom reset
        const t = e.changedTouches[0]
        const now = Date.now()
        const last = lastTapRef.current
        if (last && now - last.time < 300 && Math.abs(t.clientX - last.x) < 40 && Math.abs(t.clientY - last.y) < 40) {
          lastTapRef.current = null
          if (currentScaleRef.current > 1.05) {
            currentScaleRef.current = 1.0
            gesturePinchScaleRef.current = 1
            panOffsetRef.current = { x: 0, y: 0 }
            onScaleChangeRef.current?.(1.0)
            applyTransform()
          }
        } else {
          lastTapRef.current = { time: now, x: t.clientX, y: t.clientY }
        }
      }
      touchStartRef.current = null
      if (didDragRef.current) {
        setTimeout(() => { didDragRef.current = false }, 50)
      }
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
    }
  }, [])  // empty deps — all values accessed via refs

  // Reset pan when page turns or scale resets to fit
  useEffect(() => { resetTransform() }, [pageNumber])
  useEffect(() => { if (scale <= 1.05) resetTransform() }, [scale])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || annotationMode || selectModeRef.current) return
    dragStartRef.current = {
      mouseX: e.clientX, mouseY: e.clientY,
      panX: panOffsetRef.current.x, panY: panOffsetRef.current.y,
    }
  }, [annotationMode])

  const registerPageRef = useCallback((pageNum: number, el: HTMLDivElement | null) => {
    const observer = resizeObserverRef.current
    if (!observer) return
    const prev = pageRefs.current.get(pageNum)
    // Skip if same element — prevents unobserve/observe cycle on re-render
    if (prev === el) return
    if (prev) observer.unobserve(prev)
    if (el) {
      el.dataset.annotationPage = String(pageNum)
      pageRefs.current.set(pageNum, el)
      observer.observe(el)
    } else {
      pageRefs.current.delete(pageNum)
    }
  }, [])

  // Memoize the file prop to prevent react-pdf from re-transferring the ArrayBuffer
  // to the worker on every render (which causes "ArrayBuffer already detached" errors)
  const pdfFile = React.useMemo(() => pdfData ? { data: pdfData } : null, [pdfData])

  // Fetch PDF data — stream to temp file to avoid OOM from base64 round-trip
  useEffect(() => {
    const fetchPdf = async () => {
      setLoading(true)
      setError(null)
      try {
        let buf: ArrayBuffer

        if (isLocalFileUrl(path)) {
          // Load local file into ArrayBuffer via fetch (react-pdf needs binary data)
          const localUrl = toLocalUrl(path)
          console.log(`[PdfReader] Loading local file: ${localUrl}`)
          const response = await fetch(localUrl)
          if (!response.ok) throw new Error(`Failed to read local file`)
          buf = await response.arrayBuffer()
        } else {
          // Stream to temp file first (avoids base64 encoding the entire PDF over IPC)
          console.log(`[PdfReader] Downloading from: ${path}`)
          let res = await api.downloadToTemp({ url: path, headers, extension: 'pdf' })

          // If Bearer auth fails, retry with Basic Auth
          if (!res.success && res.status === 401 && basicAuthHeaders) {
            console.log('[PdfReader] Bearer auth failed (401), retrying with Basic Auth...')
            res = await api.downloadToTemp({ url: path, headers: basicAuthHeaders, extension: 'pdf' })
          }

          if (!res.success || !res.path) {
            throw new Error(res.error || `HTTP error! status: ${res.status}`)
          }

          // Read from temp file via book-file:// protocol into ArrayBuffer
          const localUrl = toLocalUrl(res.path)
          const response = await fetch(localUrl)
          if (!response.ok) throw new Error(`Failed to read downloaded file`)
          buf = await response.arrayBuffer()
        }

        // Validate: react-pdf crashes on empty data
        if (!buf || buf.byteLength === 0) {
          throw new Error('Downloaded file is empty')
        }
        // Basic PDF header check (%PDF)
        const header = new Uint8Array(buf.slice(0, 5))
        if (header[0] !== 0x25 || header[1] !== 0x50 || header[2] !== 0x44 || header[3] !== 0x46) {
          throw new Error('Downloaded file is not a valid PDF')
        }

        const arr = new Uint8Array(buf)
        // New file → previous text index / detection result no longer applies
        textIndexRef.current = new Map()
        detectedForDataRef.current = null
        usePdfTextStore.getState().setStatus('checking')
        setPdfData(arr)
        onPdfDataLoaded?.(arr)
      } catch (e: any) {
        console.error("[PdfReader] Failed to load PDF:", e)
        setError(e.message)
        setPdfData(null)
        setLoading(false)
      }
    }

    fetchPdf()
  }, [path, JSON.stringify(headers)])

  // Debug
  useEffect(() => {
    console.log(`[PdfReader] Init: path=${path}, page=${page}, pageNumber=${pageNumber}`)
  }, [])

  // Sync prop changes to state
  useEffect(() => {
    if (page && page !== pageNumber) {
      setPageNumber(page)
    }
  }, [page])

  // Track container size for responsive scaling
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        })
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  // Memoize options to prevent re-renders
  const options = React.useMemo(() => ({
    // httpHeaders handled by pre-fetch
  }), [])

  // Update parent when page changes
  useEffect(() => {
    if (numPages > 0) {
      onPageChange(pageNumber, pageNumber / numPages)
    }
  }, [pageNumber, numPages])

  const onDocumentLoadSuccess = async (pdf: any) => {
    console.log(`[PdfReader] Loaded. Total pages: ${pdf.numPages}`)
    setNumPages(pdf.numPages)
    onTotalPagesChange?.(pdf.numPages)
    setLoading(false)

    // Text layer: the Document remounts on display-mode switches, so keep the
    // live proxy and only run detection once per loaded file
    pdfDocRef.current = pdf
    setDocVersion(v => v + 1)
    if (detectedForDataRef.current !== pdfData) {
      detectedForDataRef.current = pdfData
      detectTextLayer(pdf)
    }
    // Ensure page number is valid
    if (pageNumber > pdf.numPages) setPageNumber(pdf.numPages)
    if (pageNumber < 1) setPageNumber(1)

    // Load Outline
    if (onTocLoaded) {
      try {
        const outline = await pdf.getOutline()
        if (outline) {
          const processOutline = async (items: any[]): Promise<TocItem[]> => {
            const processed = []
            for (const item of items) {
              let targetPage = null
              if (typeof item.dest === 'string') {
                const dest = await pdf.getDestination(item.dest)
                if (dest) {
                  const ref = dest[0]
                  targetPage = await pdf.getPageIndex(ref) + 1
                }
              } else if (Array.isArray(item.dest)) {
                const ref = item.dest[0]
                targetPage = await pdf.getPageIndex(ref) + 1
              }

              if (targetPage) {
                processed.push({
                  label: item.title,
                  page: targetPage,
                  subitems: item.items && item.items.length > 0 ? await processOutline(item.items) : undefined
                })
              }
            }
            return processed
          }
          const toc = await processOutline(outline)
          onTocLoaded(toc)
        }
      } catch (e) {
        console.error("Error loading PDF outline:", e)
      }
    }
  }

  // Navigation functions
  const getStep = useCallback(() => {
    if (displayMode === 'double-even' || displayMode === 'double-odd') return 2
    return 1
  }, [displayMode])

  const goToPrev = useCallback(() => {
    const step = getStep()
    setPageNumber(prev => Math.max(1, prev - step))
  }, [getStep])

  const goToNext = useCallback(() => {
    const step = getStep()
    setPageNumber(prev => Math.min(numPages, prev + step))
  }, [getStep, numPages])

  const goToFirst = useCallback(() => setPageNumber(1), [])
  const goToLast = useCallback(() => setPageNumber(numPages), [numPages])

  // Keyboard navigation with Page Up/Down and Home/End
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      // Undo/Redo for annotations
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (e.shiftKey) annotationRedo()
        else annotationUndo()
        return
      }

      // Block navigation keys when in annotation mode
      if (annotationMode) return

      if (e.ctrlKey || e.metaKey || e.altKey) return

      // Space turns pages in the paged modes; scroll modes keep native scrolling
      if (e.key === ' ' && (displayMode === 'single' || displayMode.startsWith('double'))) {
        e.preventDefault()
        if (e.shiftKey) goToPrev()
        else goToNext()
        return
      }

      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault()
          goToPrev()
          break
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault()
          goToNext()
          break
        case 'Home':
          e.preventDefault()
          goToFirst()
          break
        case 'End':
          e.preventDefault()
          goToLast()
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goToPrev, goToNext, goToFirst, goToLast, annotationMode, annotationUndo, annotationRedo, displayMode])

  // Calculate page dimensions based on fit mode
  const getPageDimensions = useCallback(() => {
    const availableHeight = containerSize.height - 40 // Padding
    const availableWidth = containerSize.width - 40

    if (fitMode === 'width') {
      // For double page modes, each page gets half width
      const widthPerPage = (displayMode.startsWith('double')) ? (availableWidth / 2) - 8 : availableWidth
      return { width: widthPerPage * scale }
    } else if (fitMode === 'page') {
      return { height: availableHeight * scale }
    } else {
      // Custom zoom
      return { height: availableHeight * scale }
    }
  }, [containerSize, fitMode, scale, displayMode])

  // Get pages to render based on display mode
  const getPagesToRender = useCallback((): number[] => {
    if (displayMode === 'single') {
      return [pageNumber]
    }

    if (displayMode === 'double-even') {
      // Pages 2-3, 4-5, etc. Page 1 alone
      if (pageNumber === 1) return [1]
      const evenStart = pageNumber % 2 === 0 ? pageNumber : pageNumber - 1
      const pages = [evenStart]
      if (evenStart + 1 <= numPages) pages.push(evenStart + 1)
      return pages
    }

    if (displayMode === 'double-odd') {
      // Pages 1-2, 3-4, etc.
      const oddStart = pageNumber % 2 === 1 ? pageNumber : pageNumber - 1
      const pages = [oddStart]
      if (oddStart + 1 <= numPages) pages.push(oddStart + 1)
      return pages
    }

    // Scroll modes render all pages
    if (displayMode === 'scroll-v' || displayMode === 'scroll-h') {
      return Array.from({ length: numPages }, (_, i) => i + 1)
    }

    return [pageNumber]
  }, [displayMode, pageNumber, numPages])

  const pageDimensions = getPageDimensions()
  const pagesToRender = getPagesToRender()

  // Scroll modes: pageNumber changes that did NOT come from the user's own
  // scrolling (resume, TOC, thumbnails, page input, keys) must scroll the
  // page into view. Pages above the target only get their real height once
  // rendered, so the jump is repeated for a few seconds until the layout
  // settles — and the scroll tracker below is muted meanwhile, otherwise it
  // would report page 1 and overwrite the synced position.
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  /** Last page number set by the scroll tracker (not a programmatic jump). */
  const pageFromScrollRef = useRef<number | null>(null)
  /** Page a programmatic jump is still settling on, or null. */
  const scrollJumpTargetRef = useRef<number | null>(null)
  const isScrollMode = displayMode === 'scroll-v' || displayMode === 'scroll-h'
  const scrollModeRef = useRef(displayMode)
  useEffect(() => {
    // Entering a scroll mode (or switching between them) always jumps
    if (scrollModeRef.current !== displayMode) {
      scrollModeRef.current = displayMode
      pageFromScrollRef.current = null
    }
    if (!isScrollMode || loading || numPages === 0) return
    if (pageFromScrollRef.current === pageNumber) return
    const container = scrollContainerRef.current
    if (!container) return

    const target = pageNumber
    scrollJumpTargetRef.current = target
    const jump = () => {
      container.querySelector(`[data-page-number="${target}"]`)
        ?.scrollIntoView({ block: 'start', inline: 'start' })
    }
    jump()
    const stop = () => {
      if (scrollJumpTargetRef.current === target) scrollJumpTargetRef.current = null
      clearInterval(timer)
      clearTimeout(deadline)
      userEvents.forEach(ev => container.removeEventListener(ev, stop))
    }
    const timer = setInterval(jump, 150)
    const deadline = setTimeout(stop, 4000)
    // The user taking over (wheel, touch, drag, keys) ends the settling phase
    const userEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    userEvents.forEach(ev => container.addEventListener(ev, stop, { passive: true }))
    return stop
  }, [isScrollMode, displayMode, loading, numPages, pageNumber])

  // Scroll mode: track visible page
  useEffect(() => {
    if ((displayMode === 'scroll-v' || displayMode === 'scroll-h') && scrollContainerRef.current && !loading) {
      const handleScroll = () => {
        const container = scrollContainerRef.current
        if (!container) return
        // A programmatic jump is still settling — don't report interim pages
        if (scrollJumpTargetRef.current !== null) return

        // Find which page is most visible
        const pages = container.querySelectorAll('[data-page-number]')
        let maxVisibility = 0
        let mostVisiblePage = pageNumber

        pages.forEach((pageEl) => {
          const rect = pageEl.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()

          let visibility = 0
          if (displayMode === 'scroll-v') {
            const visibleTop = Math.max(rect.top, containerRect.top)
            const visibleBottom = Math.min(rect.bottom, containerRect.bottom)
            visibility = Math.max(0, visibleBottom - visibleTop)
          } else {
            const visibleLeft = Math.max(rect.left, containerRect.left)
            const visibleRight = Math.min(rect.right, containerRect.right)
            visibility = Math.max(0, visibleRight - visibleLeft)
          }

          if (visibility > maxVisibility) {
            maxVisibility = visibility
            mostVisiblePage = parseInt(pageEl.getAttribute('data-page-number') || '1')
          }
        })

        if (mostVisiblePage !== pageNumber) {
          pageFromScrollRef.current = mostVisiblePage
          setPageNumber(mostVisiblePage)
        }
      }

      const container = scrollContainerRef.current
      if (container) {
        container.addEventListener('scroll', handleScroll)
        return () => container.removeEventListener('scroll', handleScroll)
      }
    }
  }, [displayMode, loading, pageNumber])

  // ── In-document search (text / OCR layer) ─────────────────────────────────
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<PdfTextMatch[]>([])
  const [activeMatch, setActiveMatch] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [searchedPages, setSearchedPages] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pageNumberRef = useRef(pageNumber)
  pageNumberRef.current = pageNumber
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  const activeMatchRef = useRef(activeMatch)
  activeMatchRef.current = activeMatch

  const openSearch = useCallback(() => {
    const { status, setSearchOpen } = usePdfTextStore.getState()
    if (status === 'absent') {
      toast.info(NO_TEXT_LAYER_MESSAGE)
      return
    }
    setSearchOpen(true)
    // Already open → just refocus
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [toast])

  const closeSearch = useCallback(() => {
    usePdfTextStore.getState().setSearchOpen(false)
    setQuery('')
  }, [])

  // Focus the field when the bar opens (also when opened from the toolbar)
  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchOpen])

  // Ctrl+F can open the bar while detection is still sampling pages. If the
  // PDF then turns out to be image-only, close the bar again with the notice
  // instead of leaving a search that can never match anything.
  useEffect(() => {
    if (textStatus === 'absent' && searchOpen) {
      closeSearch()
      toast.info(NO_TEXT_LAYER_MESSAGE)
    }
  }, [textStatus, searchOpen, closeSearch, toast])

  /** Make match `i` current and bring its page into view. */
  const goToMatch = useCallback((i: number, list: PdfTextMatch[]) => {
    const m = list[i]
    if (!m) return
    setActiveMatch(i)
    if (displayMode === 'scroll-v' || displayMode === 'scroll-h') {
      const el = scrollContainerRef.current?.querySelector(`[data-page-number="${m.page}"]`)
      el?.scrollIntoView({ block: 'start', inline: 'start' })
    } else {
      setPageNumber(m.page)
    }
  }, [displayMode])

  const stepMatch = useCallback((dir: 1 | -1) => {
    const list = matchesRef.current
    if (list.length === 0) return
    const cur = activeMatchRef.current
    const next = cur < 0 ? 0 : (cur + dir + list.length) % list.length
    goToMatch(next, list)
  }, [goToMatch])

  // Run the search (debounced). Scans every page's text, publishing results
  // progressively so the first hits show up before a long book is done.
  useEffect(() => {
    const normQuery = searchOpen ? normalizeQuery(query) : ''
    if (!normQuery) {
      setMatches([])
      setActiveMatch(-1)
      setSearching(false)
      setSearchedPages(0)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const doc = pdfDocRef.current
      if (!doc) return
      setSearching(true)
      setSearchedPages(0)
      setMatches([])
      setActiveMatch(-1)
      const startPage = pageNumberRef.current
      const found: PdfTextMatch[] = []
      let chosen = false
      for (let p = 1; p <= doc.numPages; p++) {
        let index: PageTextIndex | null = null
        try {
          index = await getPageIndex(doc, p)
        } catch {
          // Proxy destroyed (display mode switch) — docVersion re-runs us
        }
        if (cancelled) return
        if (index) found.push(...findInPage(index, normQuery, p))
        const done = p === doc.numPages
        if (p % 20 === 0 || done) {
          const snapshot = found.slice()
          setMatches(snapshot)
          setSearchedPages(p)
          // Jump to the first hit at/after the page the reader was on
          if (!chosen) {
            const at = snapshot.findIndex(m => m.page >= startPage)
            if (at !== -1 || (done && snapshot.length > 0)) {
              chosen = true
              goToMatch(at !== -1 ? at : 0, snapshot)
            }
          }
        }
      }
      setSearching(false)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, searchOpen, docVersion, getPageIndex, goToMatch])

  // Scroll modes: center the active hit once its page's text layer rendered
  useEffect(() => {
    if (activeMatch < 0 || (displayMode !== 'scroll-v' && displayMode !== 'scroll-h')) return
    const m = matches[activeMatch]
    if (!m) return
    let tries = 0
    let raf = 0
    const tick = () => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-page-number="${m.page}"] mark.pdf-hit-active`)
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'center' })
        return
      }
      if (++tries < 120) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [activeMatch, matches, displayMode])

  // Group matches per page. Entries for pages whose hits didn't change are
  // reused, so progressive updates don't re-render every visible text layer.
  const prevByPageRef = useRef<Map<number, { first: number; list: PdfTextMatch[] }>>(new Map())
  const matchesByPage = useMemo(() => {
    const map = new Map<number, { first: number; list: PdfTextMatch[] }>()
    let i = 0
    while (i < matches.length) {
      const page = matches[i].page
      let j = i
      while (j < matches.length && matches[j].page === page) j++
      const prev = prevByPageRef.current.get(page)
      const reuse = prev && prev.first === i && prev.list.length === j - i && prev.list[0] === matches[i]
      map.set(page, reuse ? prev : { first: i, list: matches.slice(i, j) })
      i = j
    }
    prevByPageRef.current = map
    return map
  }, [matches])

  // Stable customTextRenderer per page (a new function identity re-renders that layer)
  const rendererCacheRef = useRef<Map<number, {
    entry: { first: number; list: PdfTextMatch[] }
    activeLocal: number
    fn: (args: { itemIndex: number; str: string }) => string
  }>>(new Map())
  const getTextRenderer = (p: number) => {
    const entry = matchesByPage.get(p)
    const index = textIndexRef.current.get(p)
    if (!entry || !index) return undefined
    const activeLocal = activeMatch >= entry.first && activeMatch < entry.first + entry.list.length
      ? activeMatch - entry.first
      : -1
    const cached = rendererCacheRef.current.get(p)
    if (cached && cached.entry === entry && cached.activeLocal === activeLocal) return cached.fn
    const fn = makeHighlightRenderer(index, entry.list, activeLocal)
    rendererCacheRef.current.set(p, { entry, activeLocal, fn })
    return fn
  }

  // Search / select-mode keyboard: Ctrl+F, F3 / Shift+F3, Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openSearch()
        return
      }
      if (e.key === 'F3' && searchOpen) {
        e.preventDefault()
        stepMatch(e.shiftKey ? -1 : 1)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSearch, closeSearch, stepMatch, searchOpen, selectModeRaw])

  // Esc, mouse-back and the phone edge-swipe all go through the back stack:
  // search bar first, then select / draw mode, then the reader (Reader.tsx).
  useEffect(() => {
    if (!searchOpen && !selectModeRaw && !annotationMode) return
    return registerBackHandler(() => {
      if (usePdfTextStore.getState().searchOpen) { closeSearch(); return true }
      if (usePdfTextStore.getState().selectMode) { usePdfTextStore.getState().setSelectMode(false); return true }
      if (useAnnotationStore.getState().annotationMode) { useAnnotationStore.getState().setAnnotationMode(false); return true }
      return false
    })
  }, [searchOpen, selectModeRaw, annotationMode, closeSearch])

  const searchStatusLabel = !normalizeQuery(query)
    ? ''
    : matches.length > 0
      ? `${activeMatch >= 0 ? `${activeMatch + 1} / ` : ''}${matches.length}${searching ? '+' : ''}`
      : searching
        ? `${searchedPages} / ${numPages}`
        : 'No matches'

  // Click zones: only in single/double mode, not annotation/select mode, not when zoomed in
  const showClickZones = (displayMode === 'single' || displayMode.startsWith('double')) && !annotationMode && !selectMode && scale <= 1.05
  const isZoomed = scale > 1.05
  const renderTextLayer = textStatus !== 'absent'
  // Scroll modes mount every page: a text layer (hundreds of absolutely
  // positioned spans each) on all of them made long scanned PDFs crawl. Only
  // pages around the current one get one — search jumps move the current
  // page to the match, so highlights still show where you look.
  const textLayerFor = (p: number) => renderTextLayer && Math.abs(p - pageNumber) <= 2

  return (
    <div
      ref={containerRef}
      className={`pdf-reader-root h-full w-full relative flex items-center justify-center overflow-hidden bg-zinc-900 ${selectMode ? 'pdf-select-mode' : ''}`}
      onMouseDown={handleMouseDown}
      onDoubleClick={() => {
        // In select mode a double-click selects a word instead
        if (!isZoomed || selectMode) return
        currentScaleRef.current = 1.0
        onScaleChangeRef.current?.(1.0)
        resetTransform()
      }}
      style={{ cursor: isZoomed && !selectMode ? 'grab' : 'default' }}
    >
      {/* In-document search bar */}
      {searchOpen && (
        <div
          className="absolute right-4 phone:left-3 phone:right-3 z-40 flex items-center gap-1 bg-black/80 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl pl-4 pr-1.5 py-1.5 text-white"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 4.5rem)' }}
          onMouseDown={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          <Search size={16} className="text-white/50 shrink-0" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                stepMatch(e.shiftKey ? -1 : 1)
              }
            }}
            placeholder="Search in document"
            className="bg-transparent outline-none text-sm w-52 phone:w-auto phone:flex-1 min-w-0 placeholder:text-white/40 select-text"
            spellCheck={false}
          />
          <span className="flex items-center gap-1 text-xs text-white/60 tabular-nums whitespace-nowrap px-1">
            {searching && <LoaderCircle size={12} className="animate-spin" />}
            {searchStatusLabel}
          </span>
          <button
            onClick={() => stepMatch(-1)}
            disabled={matches.length === 0}
            className="p-1.5 rounded-full hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp size={16} />
          </button>
          <button
            onClick={() => stepMatch(1)}
            disabled={matches.length === 0}
            className="p-1.5 rounded-full hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Next match (Enter)"
          >
            <ChevronDown size={16} />
          </button>
          <button
            onClick={closeSearch}
            className="p-1.5 rounded-full hover:bg-white/15 transition-colors"
            title="Close search (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Click Zones (hidden when zoomed — use keyboard/slider to navigate) */}
      {showClickZones && (
        <>
          <div
            className="absolute inset-y-0 left-0 w-1/4 z-20 cursor-pointer"
            onClick={() => { if (!didDragRef.current) goToPrev() }}
            title="Previous Page"
          />
          <div
            className="absolute inset-y-0 right-0 w-1/4 z-20 cursor-pointer"
            onClick={() => { if (!didDragRef.current) goToNext() }}
            title="Next Page"
          />
        </>
      )}

      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 text-white">
          <div className="w-8 h-8 border-4 border-theme-500 border-t-transparent rounded-full animate-spin"></div>
          <div>Loading PDF...</div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 text-white bg-zinc-900/95">
          <div className="text-red-400 text-lg font-bold">Failed to load PDF</div>
          <div className="text-white/60 text-sm max-w-md text-center">{error}</div>
          {onRedownload
            ? <RedownloadButton onRedownload={onRedownload} />
            : <div className="text-white/40 text-xs mt-2">Try downloading the book first for offline reading</div>}
        </div>
      )}

      {/* Single/Double Page Display */}
      {(displayMode === 'single' || displayMode.startsWith('double')) && pdfFile && (
        <div
          ref={contentRef}
          className="h-full w-full flex items-center justify-center p-4"
        >
          <Document
            file={pdfFile}
            options={options}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(err) => {
              console.error("PDF Error:", err)
              setError(err.message)
              setPdfData(null)
              setLoading(false)
            }}
            loading={null}
            className="flex items-center justify-center gap-2 h-full"
          >
            {numPages > 0 && pagesToRender.map(p => (
              <div key={p} ref={el => registerPageRef(p, el)} className="relative inline-block">
                <Page
                  pageNumber={p}
                  renderTextLayer={renderTextLayer}
                  customTextRenderer={renderTextLayer ? getTextRenderer(p) : undefined}
                  renderAnnotationLayer={false}
                  {...pageDimensions}
                  className="shadow-2xl"
                  loading={null}
                  error={<div className="text-red-400 p-4">Error rendering page {p}</div>}
                />
                <AnnotationCanvas pageNumber={p} width={pageSizes[p]?.width ?? 0} height={pageSizes[p]?.height ?? 0} />
              </div>
            ))}
          </Document>
        </div>
      )}

      {/* Vertical Scroll Mode */}
      {displayMode === 'scroll-v' && pdfData && (
        <div
          ref={scrollContainerRef}
          className="h-full w-full overflow-y-auto overflow-x-hidden p-4"
        >
          <Document
            file={pdfFile}
            options={options}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(err) => {
              console.error("PDF Error:", err)
              setError(err.message)
              setPdfData(null)
              setLoading(false)
            }}
            loading={null}
            className="flex flex-col items-center gap-4"
          >
            {numPages > 0 && pagesToRender.map(p => (
              <div key={p} data-page-number={p} ref={el => registerPageRef(p, el)} className="relative">
                <Page
                  pageNumber={p}
                  renderTextLayer={textLayerFor(p)}
                  customTextRenderer={textLayerFor(p) ? getTextRenderer(p) : undefined}
                  renderAnnotationLayer={false}
                  {...pageDimensions}
                  className="shadow-2xl"
                  loading={<div className="h-[500px] bg-zinc-800 animate-pulse rounded" />}
                  error={<div className="text-red-400 p-4">Error rendering page {p}</div>}
                />
                <AnnotationCanvas pageNumber={p} width={pageSizes[p]?.width ?? 0} height={pageSizes[p]?.height ?? 0} />
              </div>
            ))}
          </Document>
        </div>
      )}

      {/* Horizontal Scroll Mode */}
      {displayMode === 'scroll-h' && pdfData && (
        <div
          ref={scrollContainerRef}
          className="h-full w-full overflow-x-auto overflow-y-hidden p-4"
        >
          <div className="flex flex-row items-center gap-4 h-full" style={{ width: 'max-content' }}>
            <Document
              file={pdfFile}
              options={options}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={(err) => {
                console.error("PDF Error:", err)
                setError(err.message)
                setLoading(false)
              }}
              loading={null}
              className="flex flex-row items-center gap-4 h-full"
            >
              {numPages > 0 && pagesToRender.map(p => (
                <div key={p} data-page-number={p} ref={el => registerPageRef(p, el)} className="flex-shrink-0 relative">
                  <Page
                    pageNumber={p}
                    renderTextLayer={textLayerFor(p)}
                    customTextRenderer={textLayerFor(p) ? getTextRenderer(p) : undefined}
                    renderAnnotationLayer={false}
                    {...pageDimensions}
                    className="shadow-2xl"
                    loading={<div className="w-[400px] h-[600px] bg-zinc-800 animate-pulse rounded" />}
                    error={<div className="text-red-400 p-4">Error rendering page {p}</div>}
                  />
                  <AnnotationCanvas pageNumber={p} width={pageSizes[p]?.width ?? 0} height={pageSizes[p]?.height ?? 0} />
                </div>
              ))}
            </Document>
          </div>
        </div>
      )}

      {/* Annotation overlays */}
      <AnnotationToolbar />
      <TextNoteEditor />
    </div>
  )
}

export default PdfReader
