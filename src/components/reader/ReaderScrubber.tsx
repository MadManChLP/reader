import React, { useEffect, useMemo, useRef, useState, memo } from 'react'
import { Document, Page } from 'react-pdf'

// Page scrubber for the readers (Apple Books / Mihon style): drag along the
// bar and a bubble shows where you would land — page number, chapter name and
// a thumbnail — and the jump happens on release, so dragging across a
// 600-page book doesn't render 600 pages on the way.
//
// Units: `value`/`max` are page numbers (1..max) for PDF and manga, or a
// 0..1000 per-mille position for EPUB (min 0). Ticks use the same unit.

export interface ScrubberTick {
  at: number
  label: string
}

interface ReaderScrubberProps {
  value: number
  min?: number
  max: number
  onCommit: (value: number) => void
  /** Chapter start markers */
  ticks?: ScrubberTick[]
  /** Right-to-left books: the bar runs from right to left */
  reversed?: boolean
  /** Text in the bubble, e.g. "Page 12 / 300" */
  formatLabel: (value: number) => string
  /** Manga: thumbnail URL for a page (1-indexed) */
  getThumbnail?: (page: number) => Promise<string | null>
  /** PDF: raw document bytes (copied per drag — pdf.js detaches the buffer it gets) */
  pdfData?: Uint8Array | null
  className?: string
}

const THUMB_W = 96

function chapterAt(ticks: ScrubberTick[] | undefined, v: number): string | undefined {
  if (!ticks || ticks.length === 0) return undefined
  let label: string | undefined
  for (const t of ticks) {
    if (t.at <= v) label = t.label
    else break
  }
  return label
}

export const ReaderScrubber = memo(function ReaderScrubber({
  value, min = 1, max, onCommit, ticks, reversed, formatLabel, getThumbnail, pdfData, className = '',
}: ReaderScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? value
  const span = Math.max(1, max - min)
  const frac = Math.max(0, Math.min(1, (shown - min) / span))
  const pos = reversed ? 1 - frac : frac
  const sortedTicks = ticks ? [...ticks].sort((a, b) => a.at - b.at) : undefined

  const valueFromX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return value
    const r = el.getBoundingClientRect()
    let f = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    if (reversed) f = 1 - f
    return Math.round(min + f * span)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    setDrag(valueFromX(e.clientX))
    const move = (ev: PointerEvent) => setDrag(valueFromX(ev.clientX))
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      const v = valueFromX(ev.clientX)
      setDrag(null)
      if (ev.type === 'pointerup' && v !== value) onCommit(v)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  // Keyboard on the focused bar: arrows step one page
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const dir = (e.key === 'ArrowRight') !== !!reversed ? 1 : -1
    const step = min === 0 ? 10 : 1
    onCommit(Math.max(min, Math.min(max, value + dir * step)))
  }

  const chapter = chapterAt(sortedTicks, shown)

  return (
    <div className={`relative select-none ${className}`}>
      {/* Preview bubble while dragging */}
      {drag !== null && (
        <div
          className="absolute bottom-full mb-3 -translate-x-1/2 flex flex-col items-center gap-1 px-2 py-2 rounded-xl bg-black/85 backdrop-blur-md border border-white/10 shadow-2xl pointer-events-none z-10"
          style={{ left: `${pos * 100}%` }}
        >
          {(getThumbnail || pdfData) && min !== 0 && (
            <ScrubThumb page={drag} getThumbnail={getThumbnail} pdfData={pdfData} />
          )}
          {chapter && <span className="max-w-[10rem] truncate text-[11px] text-white/60">{chapter}</span>}
          <span className="text-xs font-semibold text-white tabular-nums whitespace-nowrap">{formatLabel(drag)}</span>
        </div>
      )}

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatLabel(value)}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className="relative h-6 flex items-center cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-theme-500 rounded-full"
      >
        <div className="relative w-full h-1 rounded-full bg-white/25 overflow-hidden">
          <div
            className="absolute inset-y-0 bg-theme-500"
            style={reversed ? { right: 0, width: `${frac * 100}%` } : { left: 0, width: `${frac * 100}%` }}
          />
        </div>
        {/* Chapter ticks */}
        {sortedTicks?.map((t, i) => {
          const f = Math.max(0, Math.min(1, (t.at - min) / span))
          return (
            <span
              key={`${t.at}-${i}`}
              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-2.5 rounded-full bg-white/50 pointer-events-none"
              style={{ left: `${(reversed ? 1 - f : f) * 100}%` }}
              title={t.label}
            />
          )
        })}
        <span
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow transition-[width,height] ${drag !== null ? 'w-4 h-4' : 'w-3 h-3'}`}
          style={{ left: `${pos * 100}%` }}
        />
      </div>
    </div>
  )
})

// Thumbnail of the page under the finger. Debounced so a fast drag only
// renders where it settles.
function ScrubThumb({ page, getThumbnail, pdfData }: {
  page: number
  getThumbnail?: (page: number) => Promise<string | null>
  pdfData?: Uint8Array | null
}) {
  // Own copy for this drag's Document (the worker transfer detaches it)
  const pdfFile = useMemo(() => (pdfData ? { data: new Uint8Array(pdfData) } : null), [pdfData])
  const [settled, setSettled] = useState(page)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setSettled(page), 120)
    return () => clearTimeout(t)
  }, [page])

  useEffect(() => {
    if (!getThumbnail) return
    let cancelled = false
    getThumbnail(settled).then(u => { if (!cancelled) setUrl(u) }).catch(() => {})
    return () => { cancelled = true }
  }, [settled, getThumbnail])

  if (pdfFile) {
    return (
      <div className="rounded overflow-hidden bg-white/5" style={{ width: THUMB_W, minHeight: THUMB_W * 1.3 }}>
        <Document file={pdfFile} loading={null} error={null}>
          <Page pageNumber={settled} width={THUMB_W} renderTextLayer={false} renderAnnotationLayer={false} loading={null} />
        </Document>
      </div>
    )
  }
  return url
    ? <img src={url} alt="" className="rounded object-cover" style={{ width: THUMB_W }} />
    : <div className="rounded bg-white/10 animate-pulse" style={{ width: THUMB_W, height: THUMB_W * 1.4 }} />
}

export default ReaderScrubber
