import React from 'react'
import { Bookmark, Highlighter, Trash2, Download, StickyNote } from 'lucide-react'
import type { EpubBookmark } from '../../utils/syncServerApi'
import { HIGHLIGHT_COLORS, bookmarkPage, type Highlight } from '../../utils/readerAnnotations'

/**
 * "Notes & bookmarks" list for every reader format: bookmarks (EPUB CFI or
 * PDF/manga page) and EPUB highlights with their notes. Tap to jump.
 */
export function AnnotationsList({
  bookmarks,
  highlights,
  onOpenBookmark,
  onDeleteBookmark,
  onOpenHighlight,
  onEditHighlight,
  onExport,
}: {
  bookmarks: EpubBookmark[]
  highlights: Highlight[]
  onOpenBookmark: (bm: EpubBookmark) => void
  onDeleteBookmark: (bm: EpubBookmark) => void
  onOpenHighlight: (h: Highlight) => void
  onEditHighlight: (h: Highlight) => void
  onExport: () => void
}) {
  const sortedBookmarks = [...bookmarks].sort((a, b) => {
    const pa = bookmarkPage(a), pb = bookmarkPage(b)
    if (pa !== null && pb !== null) return pa - pb
    return a.createdAt - b.createdAt
  })
  const empty = bookmarks.length === 0 && highlights.length === 0

  return (
    <div className="space-y-4 text-white">
      {empty && (
        <div className="py-8 text-center text-sm text-white/50">
          No bookmarks or highlights yet.
          <p className="mt-1 text-xs text-white/35">Select text in an EPUB to highlight it; use the bookmark button for the current page.</p>
        </div>
      )}

      {sortedBookmarks.length > 0 && (
        <section>
          <h4 className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold text-white/50 mb-2">
            <Bookmark size={12} /> Bookmarks
          </h4>
          <div className="space-y-0.5">
            {sortedBookmarks.map(bm => (
              <div key={bm.id} className="group flex items-center rounded-lg hover:bg-white/10">
                <button onClick={() => onOpenBookmark(bm)} className="flex-1 min-w-0 text-left px-3 py-2 text-sm text-white/85 truncate">
                  {bm.name}
                </button>
                <button
                  onClick={() => onDeleteBookmark(bm)}
                  className="p-2 mr-1 text-white/40 hover:text-red-400 transition-colors"
                  title="Delete bookmark"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {highlights.length > 0 && (
        <section>
          <h4 className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold text-white/50 mb-2">
            <Highlighter size={12} /> Highlights
          </h4>
          <div className="space-y-1.5">
            {[...highlights].sort((a, b) => a.createdAt - b.createdAt).map(h => (
              <div key={h.id} className="flex items-start gap-2 rounded-lg hover:bg-white/5 p-1.5">
                <button onClick={() => onOpenHighlight(h)} className="flex-1 min-w-0 text-left">
                  <p
                    className="text-sm text-white/85 line-clamp-3 border-l-4 pl-2"
                    style={{ borderColor: HIGHLIGHT_COLORS[h.color] }}
                  >
                    {h.text}
                  </p>
                  {h.note && (
                    <p className="mt-1 pl-3 text-xs text-white/55 flex items-start gap-1">
                      <StickyNote size={12} className="flex-shrink-0 mt-0.5" /> <span className="line-clamp-3">{h.note}</span>
                    </p>
                  )}
                  {h.chapter && <p className="mt-0.5 pl-3 text-[11px] text-white/35 truncate">{h.chapter}</p>}
                </button>
                <button
                  onClick={() => onEditHighlight(h)}
                  className="p-1.5 text-white/40 hover:text-white transition-colors"
                  title="Edit note / colour"
                >
                  <StickyNote size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!empty && (
        <button
          onClick={onExport}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-xs text-white/75 transition-colors"
        >
          <Download size={14} /> Export as Markdown
        </button>
      )}
    </div>
  )
}
