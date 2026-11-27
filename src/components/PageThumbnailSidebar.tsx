import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Document, Page } from 'react-pdf'

interface PageThumbnailSidebarProps {
  totalPages: number
  currentPage: number                    // 1-indexed
  onPageClick: (page: number) => void    // 1-indexed
  pdfFile?: { data: Uint8Array } | null  // PDF mode
  extractThumbnail?: (index: number) => Promise<string | null>  // Manga mode (0-indexed)
}

const THUMB_WIDTH = 120

const PageThumbnailSidebar: React.FC<PageThumbnailSidebarProps> = ({
  totalPages,
  currentPage,
  onPageClick,
  pdfFile,
  extractThumbnail,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to active page
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentPage])

  const isPdf = !!pdfFile
  const isManga = !!extractThumbnail

  return (
    <div className="w-40 flex-shrink-0 bg-black/60 backdrop-blur-xl border-r border-white/10 flex flex-col h-full z-10">
      <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/50 border-b border-white/10 flex-shrink-0">
        Pages
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
        {isPdf ? (
          <Document file={pdfFile} loading={null}>
            {Array.from({ length: totalPages }, (_, i) => (
              <PdfThumbnailItem
                key={i + 1}
                pageNumber={i + 1}
                isActive={currentPage === i + 1}
                onClick={() => onPageClick(i + 1)}
                ref={currentPage === i + 1 ? activeRef : undefined}
              />
            ))}
          </Document>
        ) : isManga ? (
          Array.from({ length: totalPages }, (_, i) => (
            <MangaThumbnailItem
              key={i}
              index={i}
              isActive={currentPage === i + 1}
              onClick={() => onPageClick(i + 1)}
              extractThumbnail={extractThumbnail!}
              ref={currentPage === i + 1 ? activeRef : undefined}
            />
          ))
        ) : null}
      </div>
    </div>
  )
}

// --- PDF Thumbnail Item ---

const PdfThumbnailItem = React.memo(React.forwardRef<HTMLDivElement, {
  pageNumber: number
  isActive: boolean
  onClick: () => void
}>(({ pageNumber, isActive, onClick }, ref) => {
  const [isVisible, setIsVisible] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect() } },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={(el) => {
        // Combine refs
        (sentinelRef as React.MutableRefObject<HTMLDivElement | null>).current = el
        if (ref) {
          if (typeof ref === 'function') ref(el)
          else (ref as React.MutableRefObject<HTMLDivElement | null>).current = el
        }
      }}
      onClick={onClick}
      className={`cursor-pointer rounded-lg overflow-hidden transition-all ${
        isActive ? 'ring-2 ring-theme-500 ring-offset-1 ring-offset-black/60' : 'hover:ring-1 hover:ring-white/30'
      }`}
    >
      {isVisible ? (
        <Page
          pageNumber={pageNumber}
          width={THUMB_WIDTH}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          loading={<div className="aspect-[3/4] bg-white/5 animate-pulse" style={{ width: THUMB_WIDTH }} />}
          error={<div className="aspect-[3/4] bg-red-900/20 flex items-center justify-center text-red-400 text-[10px]" style={{ width: THUMB_WIDTH }}>Error</div>}
        />
      ) : (
        <div className="aspect-[3/4] bg-white/5 animate-pulse" style={{ width: THUMB_WIDTH }} />
      )}
      <div className={`text-center text-[10px] py-0.5 ${isActive ? 'text-theme-400 font-bold' : 'text-white/50'}`}>
        {pageNumber}
      </div>
    </div>
  )
}))

// --- Manga Thumbnail Item ---

const MangaThumbnailItem = React.memo(React.forwardRef<HTMLDivElement, {
  index: number
  isActive: boolean
  onClick: () => void
  extractThumbnail: (index: number) => Promise<string | null>
}>(({ index, isActive, onClick, extractThumbnail }, ref) => {
  const [isVisible, setIsVisible] = useState(false)
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // IntersectionObserver for visibility
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect() } },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Extract thumbnail when visible
  useEffect(() => {
    if (!isVisible) return
    let cancelled = false
    extractThumbnail(index).then(url => {
      if (!cancelled && mountedRef.current && url) {
        setThumbUrl(url)
      }
    })
    return () => { cancelled = true }
  }, [isVisible, index, extractThumbnail])

  return (
    <div
      ref={(el) => {
        (sentinelRef as React.MutableRefObject<HTMLDivElement | null>).current = el
        if (ref) {
          if (typeof ref === 'function') ref(el)
          else (ref as React.MutableRefObject<HTMLDivElement | null>).current = el
        }
      }}
      onClick={onClick}
      className={`cursor-pointer rounded-lg overflow-hidden transition-all ${
        isActive ? 'ring-2 ring-theme-500 ring-offset-1 ring-offset-black/60' : 'hover:ring-1 hover:ring-white/30'
      }`}
    >
      {thumbUrl ? (
        <img src={thumbUrl} alt={`Page ${index + 1}`} className="w-full object-cover" style={{ width: THUMB_WIDTH }} />
      ) : (
        <div className="aspect-[3/4] bg-white/5 animate-pulse" style={{ width: THUMB_WIDTH }} />
      )}
      <div className={`text-center text-[10px] py-0.5 ${isActive ? 'text-theme-400 font-bold' : 'text-white/50'}`}>
        {index + 1}
      </div>
    </div>
  )
}))

export default React.memo(PageThumbnailSidebar)
