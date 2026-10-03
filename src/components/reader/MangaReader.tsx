import React, { useEffect, useRef, useState, useCallback } from 'react'
import JSZip from 'jszip'
// @ts-ignore
import { createExtractorFromData } from 'node-unrar-js'
import api, { toLocalUrl, isLocalFileUrl, localUrlToFsPath } from '../../utils/api'

// Cache window - how many images to keep in memory around the current page.
// "Ahead" is always increasing index (RTL only flips which screen side is
// "next" — page order in the archive is unchanged), so bias the window forward.
const MANGA_CACHE_AHEAD = 5
const MANGA_CACHE_BEHIND = 2
// How many upcoming pages to pre-decode (not just extract) for instant turns
const MANGA_DECODE_AHEAD = 3

// True when running inside Tauri (not Electron / browser)
const IS_TAURI = typeof window !== 'undefined' && '__TAURI__' in window

/**
 * Decode a book-file URL back to a plain filesystem path so it can be
 * passed to Rust archive commands. Handles all platform URL forms
 * (incl. iOS's book-file://localhost/…) — see localUrlToFsPath.
 */
const decodeBookFileUrl = localUrlToFsPath

const MangaReader: React.FC<{
  path: string,
  initialPage: number,
  page?: number,
  onPageChange: (page: number, percentage: number) => void,
  onArchiveReady?: (info: { extract: (index: number) => Promise<string | null>; totalPages: number }) => void,
  headers?: any,
  basicAuthHeaders?: any,
  extension?: string,
  direction: 'ltr' | 'rtl',
  viewMode: 'single' | 'double',
  scale?: number,
  onScaleChange?: (s: number) => void,
}> = ({ path, initialPage, page, onPageChange, onArchiveReady, headers, basicAuthHeaders, extension, direction, viewMode, scale = 1, onScaleChange }) => {
  // Metadata state (lightweight - just file names and spread info)
  const [fileNames, setFileNames] = useState<string[]>([])
  const [spreadInfo, setSpreadInfo] = useState<Map<number, boolean>>(new Map())

  // Image cache - only holds currently needed images
  const [imageCache, setImageCache] = useState<Map<number, string>>(new Map())

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(Math.max(0, initialPage - 1))

  // CBR / JSZip (Electron) path: extractor instances hold the archive data
  const zipRef = useRef<JSZip | null>(null)
  const rarExtractorRef = useRef<any>(null)
  const isRarRef = useRef(false)

  // Tauri CBZ path: store the filesystem path to the temp/local archive file
  // When this is set, Rust commands are used for extraction instead of JSZip.
  const archiveFsPathRef = useRef<string | null>(null)

  const extractingRef = useRef<Set<number>>(new Set()) // Track in-flight extractions

  // ── Zoom / pan state (all via direct DOM — zero React re-renders during gesture) ──
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const panOffsetRef = useRef({ x: 0, y: 0 })
  const gesturePinchScaleRef = useRef(1)           // CSS-only scale during pinch
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; panX: number; panY: number } | null>(null)
  const didDragRef = useRef(false)
  const singleTouchStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const pinchStartRef = useRef<{ dist: number; baseScale: number } | null>(null)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  // Stable refs to avoid stale closures in effects with empty deps
  const currentScaleRef = useRef(scale)
  currentScaleRef.current = scale
  const onScaleChangeRef = useRef(onScaleChange)
  onScaleChangeRef.current = onScaleChange
  // Navigation refs — updated each render so the touch handler always calls the latest version
  const goToNextRef = useRef<() => void>(() => {})
  const goToPrevRef = useRef<() => void>(() => {})
  const directionRef = useRef(direction)
  directionRef.current = direction

  const applyTransform = () => {
    if (!contentRef.current) return
    const { x, y } = panOffsetRef.current
    // Total visual scale = committed scale × gesture multiplier
    const totalScale = currentScaleRef.current * gesturePinchScaleRef.current
    contentRef.current.style.transform = totalScale !== 1
      ? `translate(${x}px, ${y}px) scale(${totalScale})`
      : `translate(${x}px, ${y}px)`
  }

  const resetTransform = () => {
    panOffsetRef.current = { x: 0, y: 0 }
    gesturePinchScaleRef.current = 1
    applyTransform()
  }

  // Extract a single image on-demand
  const extractImage = useCallback(async (index: number): Promise<string | null> => {
    if (index < 0 || index >= fileNames.length) return null

    // Already in cache
    if (imageCache.has(index)) return imageCache.get(index)!

    // Already being extracted
    if (extractingRef.current.has(index)) return null

    extractingRef.current.add(index)

    try {
      const fileName = fileNames[index]
      let blobUrl: string | null = null

      if (IS_TAURI && archiveFsPathRef.current && !isRarRef.current) {
        // ── Tauri CBZ path: Rust-side decompression ──────────────────────────
        // Uses compiled DEFLATE (Rust) instead of JS-based decompression.
        // archiveFsPathRef.current is the filesystem path set during loadManga.
        const bytes = await api.extractArchiveEntry(archiveFsPathRef.current, fileName)
        if (bytes?.length) {
          blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart]))
        } else {
          throw new Error(`Rust extraction returned no data for '${fileName}'`)
        }
      } else if (isRarRef.current && rarExtractorRef.current) {
        // ── CBR path (any platform): unrar.wasm ──────────────────────────────
        const extracted = rarExtractorRef.current.extract({ files: [fileName] })
        const files = [...extracted.files]
        if (files.length > 0 && files[0].extraction) {
          const blob = new Blob([files[0].extraction], { type: 'image/jpeg' })
          blobUrl = URL.createObjectURL(blob)
        } else {
          throw new Error(`RAR extraction produced no data for '${fileName}'`)
        }
      } else if (zipRef.current) {
        // ── CBZ in Electron: JSZip ────────────────────────────────────────────
        const blob = await zipRef.current.files[fileName].async("blob")
        blobUrl = URL.createObjectURL(blob)
      }

      return blobUrl
    } catch (e: any) {
      console.error(`Failed to extract image ${index}:`, e)
      // If nothing has rendered yet, surface the failure instead of leaving
      // the reader stuck on the page spinner (looks like a black screen)
      if (imageCache.size === 0) {
        setError(`Failed to extract page ${index + 1}: ${e?.message || e}`)
      }
      return null
    } finally {
      extractingRef.current.delete(index)
    }
  }, [fileNames, imageCache])

  // Warm-decode an extracted blob URL off-screen so the first paint of that
  // page is instant (no visible decode jank on page turn)
  const warmedUrlsRef = useRef<Set<string>>(new Set())
  const warmDecode = (url: string) => {
    if (warmedUrlsRef.current.has(url)) return
    warmedUrlsRef.current.add(url)
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    img.decode?.().catch(() => { /* decode is best-effort */ })
  }

  // Update cache around current index
  const updateImageCache = useCallback(async (centerIndex: number) => {
    const start = Math.max(0, centerIndex - MANGA_CACHE_BEHIND)
    const end = Math.min(fileNames.length - 1, centerIndex + MANGA_CACHE_AHEAD)

    // Determine which indices should be cached
    const neededIndices = new Set<number>()
    for (let i = start; i <= end; i++) {
      neededIndices.add(i)
    }

    // Revoke blob URLs for images outside the cache window
    const newCache = new Map<number, string>()
    imageCache.forEach((url, idx) => {
      if (neededIndices.has(idx)) {
        newCache.set(idx, url)
      } else {
        URL.revokeObjectURL(url)
        warmedUrlsRef.current.delete(url)
      }
    })

    // Phase 1: extract the visible page(s) first and publish immediately so a
    // turn onto an uncached page doesn't wait for the whole window
    const visible = [centerIndex, centerIndex + 1]
      .filter(i => neededIndices.has(i) && !newCache.has(i) && !extractingRef.current.has(i))
    if (visible.length > 0) {
      await Promise.all(visible.map(idx =>
        extractImage(idx).then(url => {
          if (url) newCache.set(idx, url)
        })
      ))
      setImageCache(new Map(newCache))
    }

    // Phase 2: fill the rest of the window in the background
    const extractPromises: Promise<void>[] = []
    neededIndices.forEach(idx => {
      if (!newCache.has(idx) && !extractingRef.current.has(idx)) {
        extractPromises.push(
          extractImage(idx).then(url => {
            if (url) newCache.set(idx, url)
          })
        )
      }
    })

    if (extractPromises.length > 0) {
      await Promise.all(extractPromises)
    }

    setImageCache(new Map(newCache))

    // Pre-decode the next few pages ahead so page turns paint instantly
    for (let i = centerIndex + 1; i <= Math.min(end, centerIndex + MANGA_DECODE_AHEAD); i++) {
      const url = newCache.get(i)
      if (url) warmDecode(url)
    }
  }, [fileNames, imageCache, extractImage])

  // Initial load - only load metadata, not all images
  useEffect(() => {
    const loadManga = async () => {
      setLoading(true)
      setError(null)

      try {
        const isRar = extension === 'cbr' || path.toLowerCase().includes('.cbr')

        // ════════════════════════════════════════════════════════════════════
        // PATH A — CBZ in Tauri: use Rust-side ZIP listing + extraction.
        //   • No large ArrayBuffer loaded into JS memory.
        //   • Rust's compiled DEFLATE is significantly faster than JSZip.
        //   • Each page decompressed on-demand via IPC (returned as base64).
        // ════════════════════════════════════════════════════════════════════
        if (!isRar && IS_TAURI) {
          let fsPath: string

          if (isLocalFileUrl(path)) {
            // Already on disk (local library book): decode URL → filesystem path
            fsPath = decodeBookFileUrl(path)
          } else {
            // Remote book: download to a temp file first (streaming, no OOM)
            let dlRes = await api.downloadToTemp({ url: path, headers, extension: 'cbz' })
            if (!dlRes.success && dlRes.status === 401 && basicAuthHeaders) {
              dlRes = await api.downloadToTemp({ url: path, headers: basicAuthHeaders, extension: 'cbz' })
            }
            if (!dlRes.success || !dlRes.path) {
              throw new Error(dlRes.error || `HTTP error! status: ${dlRes.status}`)
            }
            fsPath = dlRes.path
          }

          const names = await api.listArchive(fsPath)
          if (names.length === 0) throw new Error('Archive appears to be empty or is not a valid ZIP/CBZ file')

          archiveFsPathRef.current = fsPath
          isRarRef.current = false
          setFileNames(names)

          // Provide thumbnail extractor for the page sidebar
          if (onArchiveReady) {
            const thumbCache = new Map<number, string>()
            let inFlight = 0
            const MAX_CONCURRENT = 3
            const waiting: (() => void)[] = []

            onArchiveReady({
              extract: async (index: number): Promise<string | null> => {
                if (index < 0 || index >= names.length) return null
                if (thumbCache.has(index)) return thumbCache.get(index)!

                if (inFlight >= MAX_CONCURRENT) {
                  await new Promise<void>(resolve => waiting.push(resolve))
                }
                inFlight++
                try {
                  const bytes = await api.extractArchiveEntry(fsPath, names[index])
                  if (!bytes?.length) return null
                  const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart]))
                  thumbCache.set(index, blobUrl)
                  return blobUrl
                } catch {
                  return null
                } finally {
                  inFlight--
                  if (waiting.length > 0) waiting.shift()!()
                }
              },
              totalPages: names.length
            })
          }

          return  // Done — no ArrayBuffer needed
        }

        // ════════════════════════════════════════════════════════════════════
        // PATH B — CBR (any platform) or CBZ in Electron: existing flow.
        //   • Download / read archive into ArrayBuffer.
        //   • CBR: decompressed via unrar.wasm.
        //   • CBZ in Electron: decompressed via JSZip.
        // ════════════════════════════════════════════════════════════════════
        let data: ArrayBuffer

        if (isLocalFileUrl(path)) {
          // Fetch through the book-file:// protocol — one ArrayBuffer, same as
          // the streamed-temp-file path. The previous raw-IPC read + buffer
          // copy held the archive in memory twice, which got the WKWebView
          // process memory-killed on iOS for big CBRs (black screen, no error).
          let fetched: ArrayBuffer | null = null
          try {
            const response = await fetch(toLocalUrl(path))
            if (response.ok) fetched = await response.arrayBuffer()
          } catch { /* cross-origin error responses land here — fall back below */ }

          if (fetched) {
            data = fetched
          } else if (IS_TAURI) {
            // Fallback: IPC read (clearer errors; 403/404 from the protocol
            // surface as opaque "Failed to fetch" due to missing CORS headers)
            const fsPath = decodeBookFileUrl(path)
            const bytes = await api.readFileBinary(fsPath)
            if (!bytes) throw new Error('Failed to read archive file')
            data = (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
              ? (bytes.buffer as ArrayBuffer)
              : (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
          } else {
            throw new Error('Failed to read archive file')
          }
        } else {
          // Download to temp file (avoids OOM for large archives)
          const ext = isRar ? 'cbr' : 'cbz'
          let dlRes = await api.downloadToTemp({ url: path, headers, extension: ext })

          // If Bearer auth fails, retry with Basic Auth
          if (!dlRes.success && dlRes.status === 401 && basicAuthHeaders) {
            dlRes = await api.downloadToTemp({ url: path, headers: basicAuthHeaders, extension: ext })
          }

          if (!dlRes.success || !dlRes.path) {
            throw new Error(dlRes.error || `HTTP error! status: ${dlRes.status}`)
          }

          // Load from temp file via book-file:// protocol
          const localUrl = toLocalUrl(dlRes.path)
          const response = await fetch(localUrl)
          if (!response.ok) throw new Error(`Failed to read temp file`)
          data = await response.arrayBuffer()
        }

        let names: string[]

        if (isRar) {
          // Local asset unrar.wasm is fine with fetch
          const wasmRes = await fetch('/unrar.wasm')
          if (!wasmRes.ok) throw new Error('Failed to load unrar.wasm')
          const wasmBinary = await wasmRes.arrayBuffer()

          const extractor = await createExtractorFromData({ data, wasmBinary })
          rarExtractorRef.current = extractor
          isRarRef.current = true

          const list = extractor.getFileList()
          names = [...list.fileHeaders].map((h: any) => h.name)
            .filter((name: string) => /\.(jpg|jpeg|png|webp|gif)$/i.test(name))
            .sort((a: string, b: string) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}))
        } else {
          const zip = await JSZip.loadAsync(data)
          zipRef.current = zip

          names = Object.keys(zip.files)
            .filter(name => /\.(jpg|jpeg|png|webp|gif)$/i.test(name))
            .sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}))
        }

        // Without this check an empty listing renders a silent black screen
        if (names.length === 0) {
          throw new Error(isRar
            ? 'No images found in the CBR archive (corrupt file or unsupported RAR version?)'
            : 'No images found in the archive')
        }

        setFileNames(names)

        // Provide thumbnail extractor to parent for sidebar
        if (onArchiveReady) {
          // Thumbnail cache separate from main imageCache — never evicted until sidebar unmounts
          const thumbCache = new Map<number, string>()
          let inFlight = 0
          const MAX_CONCURRENT = 3
          const waiting: (() => void)[] = []

          const extractForThumbnail = async (index: number): Promise<string | null> => {
            if (index < 0 || index >= names.length) return null
            if (thumbCache.has(index)) return thumbCache.get(index)!

            // Concurrency limiter
            if (inFlight >= MAX_CONCURRENT) {
              await new Promise<void>(resolve => waiting.push(resolve))
            }
            inFlight++

            try {
              const fileName = names[index]
              let blobUrl: string | null = null

              if (isRar && rarExtractorRef.current) {
                const extracted = rarExtractorRef.current.extract({ files: [fileName] })
                const files = [...extracted.files]
                if (files.length > 0) {
                  const blob = new Blob([files[0].extraction], { type: 'image/jpeg' })
                  blobUrl = URL.createObjectURL(blob)
                }
              } else if (zipRef.current) {
                const blob = await zipRef.current.files[fileName].async("blob")
                blobUrl = URL.createObjectURL(blob)
              }

              if (blobUrl) thumbCache.set(index, blobUrl)
              return blobUrl
            } catch {
              return null
            } finally {
              inFlight--
              if (waiting.length > 0) waiting.shift()!()
            }
          }

          onArchiveReady({ extract: extractForThumbnail, totalPages: names.length })
        }

      } catch (e: any) {
        console.error("Failed to load manga", e)
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }

    if (path) loadManga()

    // Cleanup on unmount
    return () => {
      imageCache.forEach(url => URL.revokeObjectURL(url))
      archiveFsPathRef.current = null
      zipRef.current = null
      rarExtractorRef.current = null
    }
  }, [path])

  // Sync external page prop (from thumbnail sidebar clicks)
  useEffect(() => {
    if (page !== undefined && page - 1 !== currentIndex) {
      setCurrentIndex(Math.max(0, Math.min(fileNames.length - 1, page - 1)))
    }
  }, [page])

  // Load images around current page when fileNames are ready or currentIndex changes
  useEffect(() => {
    if (fileNames.length > 0) {
      // Stale progress can point past the end of the archive — clamp, or the
      // reader waits forever for a page that doesn't exist
      if (currentIndex >= fileNames.length) {
        setCurrentIndex(fileNames.length - 1)
        return
      }
      updateImageCache(currentIndex)
    }
  }, [fileNames, currentIndex])

  // Detect spread for current and adjacent pages (on-demand)
  useEffect(() => {
    if (fileNames.length === 0) return

    const detectSpreadForIndex = async (idx: number) => {
      if (spreadInfo.has(idx)) return
      const url = imageCache.get(idx)
      if (!url) return

      return new Promise<void>((resolve) => {
        const img = new Image()
        img.onload = () => {
          const isSpread = img.naturalWidth > (img.naturalHeight * 1.2)
          setSpreadInfo(prev => new Map(prev).set(idx, isSpread))
          resolve()
        }
        img.onerror = () => {
          setSpreadInfo(prev => new Map(prev).set(idx, false))
          resolve()
        }
        img.src = url
      })
    }

    // Detect spreads for visible pages
    const indicesToCheck = [currentIndex, currentIndex + 1, currentIndex - 1].filter(
      i => i >= 0 && i < fileNames.length && !spreadInfo.has(i)
    )

    indicesToCheck.forEach(idx => detectSpreadForIndex(idx))
  }, [currentIndex, imageCache, fileNames.length, spreadInfo])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        if (direction === 'ltr') goToNext()
        else goToPrev()
      } else if (e.key === 'ArrowLeft') {
        if (direction === 'ltr') goToPrev()
        else goToNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, direction, viewMode, fileNames.length])

  useEffect(() => {
    // Only update progress if files are loaded
    if (fileNames.length > 0) {
      const p = currentIndex + 1
      const percentage = p / fileNames.length
      onPageChange(p, percentage)
    }
  }, [currentIndex, fileNames.length])

  // ── Ctrl+Wheel zoom ──────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const delta = e.deltaY < 0 ? 0.15 : -0.15
      const next = Math.max(0.25, Math.min(5, currentScaleRef.current + delta))
      currentScaleRef.current = next  // update ref immediately — React state is async
      onScaleChangeRef.current?.(next)
      if (next <= 1.05) resetTransform()
      else applyTransform()
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
      if (didDragRef.current) setTimeout(() => { didDragRef.current = false }, 50)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // ── Touch: pinch-zoom + 1-finger pan (zoomed) + swipe (normal) ───────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onTouchStart = (e: TouchEvent) => {
      const touches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }))
      didDragRef.current = false
      if (touches.length >= 2) {
        singleTouchStartRef.current = null
        pinchStartRef.current = {
          dist: Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y),
          baseScale: currentScaleRef.current,
        }
      } else {
        pinchStartRef.current = null
        singleTouchStartRef.current = {
          x: touches[0].x, y: touches[0].y,
          panX: panOffsetRef.current.x, panY: panOffsetRef.current.y,
        }
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      const touches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }))
      if (touches.length >= 2 && pinchStartRef.current) {
        // Pinch-to-zoom: CSS only during gesture
        e.preventDefault()
        const dist = Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y)
        const ratio = dist / pinchStartRef.current.dist
        gesturePinchScaleRef.current = Math.max(
          0.25 / pinchStartRef.current.baseScale,
          Math.min(5 / pinchStartRef.current.baseScale, ratio)
        )
        applyTransform()
      } else if (touches.length === 1 && currentScaleRef.current > 1.05 && singleTouchStartRef.current) {
        // 1-finger pan when zoomed — CSS only
        e.preventDefault()
        didDragRef.current = true
        panOffsetRef.current = {
          x: singleTouchStartRef.current.panX + (touches[0].x - singleTouchStartRef.current.x),
          y: singleTouchStartRef.current.panY + (touches[0].y - singleTouchStartRef.current.y),
        }
        applyTransform()
      }
      // 1 finger + not zoomed: don't prevent → swipe detected on touchend
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (pinchStartRef.current && gesturePinchScaleRef.current !== 1) {
        // Commit pinch scale — update ref immediately so applyTransform sees the new value
        const finalScale = Math.max(0.25, Math.min(5, pinchStartRef.current.baseScale * gesturePinchScaleRef.current))
        currentScaleRef.current = finalScale
        gesturePinchScaleRef.current = 1
        if (finalScale <= 1.05) panOffsetRef.current = { x: 0, y: 0 }
        onScaleChangeRef.current?.(finalScale)
        applyTransform()
      } else if (!didDragRef.current && singleTouchStartRef.current && e.changedTouches.length > 0) {
        const t = e.changedTouches[0]
        const now = Date.now()
        const last = lastTapRef.current

        // Double-tap to reset zoom
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
          // Swipe to turn page (only when not zoomed)
          const dx = singleTouchStartRef.current.x - t.clientX
          const dy = singleTouchStartRef.current.y - t.clientY
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
            if (dx > 0) directionRef.current === 'ltr' ? goToNextRef.current() : goToPrevRef.current()
            else directionRef.current === 'ltr' ? goToPrevRef.current() : goToNextRef.current()
          }
        }
      }
      pinchStartRef.current = null
      singleTouchStartRef.current = null
      if (didDragRef.current) setTimeout(() => { didDragRef.current = false }, 50)
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  // Reset pan when page turns
  useEffect(() => { resetTransform() }, [currentIndex])
  // Reflect scale prop changes (e.g. reset button in Reader.tsx)
  useEffect(() => {
    if (scale <= 1.05) resetTransform()
    else applyTransform()
  }, [scale])

  const getCurrentPageCount = () => {
      // Returns how many pages are currently displayed (1 or 2)
      if (fileNames.length === 0) return 0
      const currentIsSpread = spreadInfo.get(currentIndex) ?? false

      // If single mode or spread, 1 page
      if (viewMode === 'single' || currentIsSpread) return 1

      // If double mode, check next
      const nextExists = currentIndex + 1 < fileNames.length
      const nextIsSpread = spreadInfo.get(currentIndex + 1) ?? false
      // If next doesn't exist or is a spread, we only show current
      if (!nextExists || nextIsSpread) return 1

      // Otherwise we show two
      return 2
  }

  const goToNext = () => {
    const step = getCurrentPageCount()
    const nextIndex = Math.min(fileNames.length - 1, currentIndex + step)
    setCurrentIndex(nextIndex)
  }

  const goToPrev = () => {
    if (currentIndex === 0) return
    let prevIndex = currentIndex - 1
    if (viewMode === 'double') {
        const potentialPrevIsSpread = spreadInfo.get(prevIndex) ?? false
        if (potentialPrevIsSpread) {
            setCurrentIndex(prevIndex)
            return
        }
        const prevPrevIndex = prevIndex - 1
        if (prevPrevIndex >= 0) {
            const prevPrevIsSpread = spreadInfo.get(prevPrevIndex) ?? false
            if (!prevPrevIsSpread) {
                setCurrentIndex(prevPrevIndex)
                return
            }
        }
    }
    setCurrentIndex(prevIndex)
  }

  const getPages = (): { url: string, isSpread: boolean }[] => {
    if (fileNames.length === 0) return []

    const currentUrl = imageCache.get(currentIndex)
    const currentIsSpread = spreadInfo.get(currentIndex) ?? false

    if (!currentUrl) {
      // Image not yet loaded
      return []
    }

    const current = { url: currentUrl, isSpread: currentIsSpread }

    if (viewMode === 'single' || currentIsSpread) {
      return [current]
    }

    const nextUrl = imageCache.get(currentIndex + 1)
    const nextIsSpread = spreadInfo.get(currentIndex + 1) ?? false

    if (!nextUrl || nextIsSpread) return [current]

    const next = { url: nextUrl, isSpread: nextIsSpread }

    if (direction === 'rtl') {
      return [next, current]
    } else {
      return [current, next]
    }
  }

  // Keep navigation refs current so the touch effect (empty deps) calls the latest version
  goToNextRef.current = goToNext
  goToPrevRef.current = goToPrev
  directionRef.current = direction

  const pages = getPages()
  const isPageLoading = pages.length === 0 && fileNames.length > 0
  const isZoomed = scale > 1.05

  // Always render the container so containerRef is set before effects run.
  // Loading/error are shown as overlays inside it.
  return (
    <div
      ref={containerRef}
      className="h-full w-full flex flex-col relative group overflow-hidden"
      onMouseDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault() // prevent browser native image drag from hijacking mouse events
        dragStartRef.current = {
          mouseX: e.clientX, mouseY: e.clientY,
          panX: panOffsetRef.current.x, panY: panOffsetRef.current.y,
        }
      }}
      onDoubleClick={() => {
        if (!isZoomed) return
        currentScaleRef.current = 1.0
        onScaleChangeRef.current?.(1.0)
        resetTransform()
      }}
      style={{ cursor: isZoomed ? 'grab' : 'default' }}
    >
       {/* Loading overlay */}
       {loading && (
         <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 text-white bg-zinc-900">
           <div className="w-8 h-8 border-4 border-theme-500 border-t-transparent rounded-full animate-spin"></div>
           <div className="text-sm">Loading Manga...</div>
         </div>
       )}

       {/* Error overlay */}
       {error && (
         <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-red-400 p-4 text-center bg-zinc-900">
           <p>Error loading manga: {error}</p>
         </div>
       )}

       {/* Click zones hidden when zoomed — use keyboard or swipe */}
       {!isZoomed && (
         <>
           <div
             className="absolute inset-y-0 left-0 w-1/4 z-10 cursor-pointer"
             onClick={() => { if (!didDragRef.current) direction === 'ltr' ? goToPrev() : goToNext() }}
             title="Previous"
           />
           <div
             className="absolute inset-y-0 right-0 w-1/4 z-10 cursor-pointer"
             onClick={() => { if (!didDragRef.current) direction === 'ltr' ? goToNext() : goToPrev() }}
             title="Next"
           />
         </>
       )}

       <div ref={contentRef} className="flex-1 flex items-center justify-center gap-1 h-full p-2">
          {isPageLoading ? (
            <div className="flex flex-col items-center justify-center gap-2 text-white/60">
              <div className="w-6 h-6 border-2 border-theme-500 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-xs">Loading page {currentIndex + 1}...</div>
            </div>
          ) : (
            pages.map((img, i) => (
              <img
                key={`${currentIndex}-${i}`}
                src={img.url}
                alt={`Page`}
                draggable={false}
                className={`h-full object-contain shadow-2xl ${viewMode === 'double' && pages.length === 2 ? 'max-w-[50%]' : 'max-w-full'}`}
              />
            ))
          )}
       </div>

       {/* Page indicator */}
       {fileNames.length > 0 && (
         <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/60 rounded-full text-white/80 text-sm opacity-0 group-hover:opacity-100 transition-opacity">
           {currentIndex + 1} / {fileNames.length}
         </div>
       )}
    </div>
  )
}

export default MangaReader
