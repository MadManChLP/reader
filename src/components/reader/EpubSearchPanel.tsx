import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, LoaderCircle } from 'lucide-react'
import type { TocItem } from './types'

// In-book search for EPUBs. epub.js has no index: each spine section is
// loaded, searched with Section.find() (case-insensitive, returns a CFI and an
// excerpt per hit) and unloaded again. Hits stream in section by section, so
// the first ones show before a long book is done.

interface SearchHit {
  cfi: string
  excerpt: string
  chapter: string
}

const MAX_HITS = 500
const MIN_QUERY = 2

/** Flat href → label map of the table of contents (fragment stripped) */
function tocLabels(toc: TocItem[]): Map<string, string> {
  const map = new Map<string, string>()
  const walk = (items: TocItem[]) => {
    for (const item of items) {
      const href = (item.href || '').split('#')[0]
      if (href && !map.has(href)) map.set(href, item.label.trim())
      if (item.subitems?.length) walk(item.subitems)
    }
  }
  walk(toc)
  return map
}

function chapterLabel(labels: Map<string, string>, href: string): string {
  if (labels.has(href)) return labels.get(href)!
  // TOC hrefs may be relative to a different folder than the spine's
  for (const [k, v] of labels) {
    if (href.endsWith(k) || k.endsWith(href)) return v
  }
  return ''
}

export function EpubSearchPanel({
  rendition,
  toc,
  onClose,
  onPicked,
}: {
  /** epub.js Rendition (its .book is searched) */
  rendition: any
  toc: TocItem[]
  onClose: () => void
  /** A hit was opened (phone: close the sheet so the page is visible) */
  onPicked?: () => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [progress, setProgress] = useState(0)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const markedRef = useRef<string | null>(null)
  const labels = useMemo(() => tocLabels(toc), [toc])

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])


  // Run the search (debounced)
  useEffect(() => {
    const q = query.trim()
    setActive(-1)
    if (q.length < MIN_QUERY || !rendition?.book) {
      setHits([])
      setSearching(false)
      setProgress(0)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const book = rendition.book
      const sections: any[] = book?.spine?.spineItems ?? []
      const found: SearchHit[] = []
      setHits([])
      setSearching(true)
      setProgress(0)
      for (let i = 0; i < sections.length && !cancelled && found.length < MAX_HITS; i++) {
        const section = sections[i]
        try {
          await section.load(book.load.bind(book))
          if (cancelled) break
          const results: { cfi: string; excerpt: string }[] = section.find(q) || []
          const chapter = chapterLabel(labels, section.href || '')
          for (const r of results) {
            found.push({ cfi: r.cfi, excerpt: (r.excerpt || '').replace(/\s+/g, ' ').trim(), chapter })
            if (found.length >= MAX_HITS) break
          }
        } catch {
          // A section that fails to load is skipped
        } finally {
          try { section.unload() } catch { /* already unloaded */ }
        }
        if (cancelled) break
        setHits([...found])
        setProgress((i + 1) / sections.length)
      }
      if (!cancelled) setSearching(false)
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, rendition, labels])

  const open = (i: number) => {
    const hit = hits[i]
    if (!hit || !rendition) return
    setActive(i)
    try {
      if (markedRef.current) rendition.annotations.remove(markedRef.current, 'highlight')
    } catch { /* gone */ }
    markedRef.current = null
    Promise.resolve(rendition.display(hit.cfi)).then(() => {
      try {
        rendition.annotations.highlight(hit.cfi, {}, undefined, 'epub-search-hit', { fill: '#f59e0b', 'fill-opacity': '0.4', 'mix-blend-mode': 'multiply' })
        markedRef.current = hit.cfi
        // The mark goes away with the next page turn (the panel may be closed
        // by then). Attached late: display() reports its own relocation.
        const cfi = hit.cfi
        setTimeout(() => {
          const clear = () => {
            rendition.off?.('relocated', clear)
            try { rendition.annotations.remove(cfi, 'highlight') } catch { /* gone */ }
            if (markedRef.current === cfi) markedRef.current = null
          }
          rendition.on?.('relocated', clear)
        }, 400)
      } catch { /* CFI not in the displayed view */ }
    }).catch(() => { /* bad CFI */ })
    onPicked?.()
  }

  const q = query.trim()
  const lowerQ = q.toLowerCase()
  const renderExcerpt = (text: string) => {
    const i = text.toLowerCase().indexOf(lowerQ)
    if (i < 0 || !lowerQ) return text
    return (
      <>
        {text.slice(0, i)}
        <mark className="bg-theme-500/40 text-white rounded px-0.5">{text.slice(i, i + q.length)}</mark>
        {text.slice(i + q.length)}
      </>
    )
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-2 px-3 py-2 bg-white/10 rounded-xl">
        <Search size={16} className="text-white/50 flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits.length > 0) {
              e.preventDefault()
              open(active < 0 ? 0 : (active + (e.shiftKey ? -1 : 1) + hits.length) % hits.length)
            }
          }}
          placeholder="Search in book"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm phone:text-base text-white placeholder:text-white/40"
          enterKeyHint="search"
        />
        {searching && <LoaderCircle size={16} className="animate-spin text-white/50 flex-shrink-0" />}
        {query && (
          <button onClick={() => setQuery('')} className="p-1 text-white/50 hover:text-white" title="Clear" aria-label="Clear search">
            <X size={14} />
          </button>
        )}
        <button onClick={onClose} className="p-1 text-white/50 hover:text-white phone:hidden" title="Close (Esc)" aria-label="Close search">
          <X size={16} />
        </button>
      </div>

      <div className="mt-2 px-1 text-xs text-white/40">
        {q.length < MIN_QUERY
          ? 'Type at least 2 characters'
          : searching
            ? `${hits.length} found · searching ${Math.round(progress * 100)}%`
            : hits.length === 0
              ? 'No matches'
              : `${hits.length}${hits.length >= MAX_HITS ? '+' : ''} ${hits.length === 1 ? 'match' : 'matches'}`}
      </div>

      <div className="mt-1 flex-1 min-h-0 overflow-y-auto custom-scrollbar -mx-1">
        {hits.map((hit, i) => (
          <button
            key={`${hit.cfi}-${i}`}
            onClick={() => open(i)}
            className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
              i === active ? 'bg-theme-500/20' : 'hover:bg-white/10 active:bg-white/10'
            }`}
          >
            {hit.chapter && <div className="text-[11px] uppercase tracking-wide text-white/40 truncate">{hit.chapter}</div>}
            <div className="text-sm text-white/80 line-clamp-2">{renderExcerpt(hit.excerpt)}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
