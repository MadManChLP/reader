import React, { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import { useAudiobookshelf } from './AudiobookshelfContext'
import type { AbsLibrary, AbsSeries } from '../../types/audiobookshelf'
import type { AbsViewType } from './AudiobookshelfView'

const PAGE_SIZE = 50

interface AbsSeriesGridProps {
  library: AbsLibrary
  onNavigate: (view: AbsViewType) => void
}

// Series card: first book's cover with a slight stacked-covers effect + count
export const AbsSeriesCard: React.FC<{
  series: AbsSeries
  coverUrl: string | null
  onClick: () => void
}> = ({ series, coverUrl, onClick }) => {
  const bookCount = series.books?.length ?? 0
  return (
    <div onClick={onClick} className="group w-40 flex-shrink-0 cursor-pointer">
      <div className="relative aspect-square mb-3">
        {/* Stacked-cover backdrop */}
        <div className="absolute inset-0 translate-x-1.5 -translate-y-1.5 rounded-lg bg-white/5 border border-white/10" />
        <div className="absolute inset-0 rounded-lg overflow-hidden bg-white/5 shadow-lg">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={series.name}
              className="w-full h-full object-cover transition-all duration-300 group-hover:scale-105 group-hover:brightness-75"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-red-900/50">
              <Layers size={40} className="text-white/30" />
            </div>
          )}
          {bookCount > 0 && (
            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 text-xs font-medium text-white">
              {bookCount}
            </span>
          )}
        </div>
      </div>
      <h3 className="text-sm font-medium text-white truncate">{series.name}</h3>
      <p className="text-xs text-white/60 truncate">{bookCount === 1 ? '1 book' : `${bookCount} books`}</p>
    </div>
  )
}

// Paged grid of all series in a library
export const AbsSeriesGrid: React.FC<AbsSeriesGridProps> = ({ library, onNavigate }) => {
  const { api } = useAudiobookshelf()
  const [series, setSeries] = useState<AbsSeries[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setPage(0)
  }, [library.id])

  useEffect(() => {
    if (!api) return
    let active = true
    setIsLoading(true)

    api
      .getSeries(library.id, { limit: PAGE_SIZE, page })
      .then((res) => {
        if (!active) return
        setSeries(res.results ?? [])
        setTotal(res.total ?? 0)
      })
      .catch((e) => console.error('[Abs] Failed to load series:', e))
      .finally(() => active && setIsLoading(false))

    return () => {
      active = false
    }
  }, [api, library.id, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{library.name} — Series</h1>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-sm text-white/60">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-2 rounded-full hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-2 rounded-full hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-square bg-white/10 rounded-lg animate-pulse mb-3" />
              <div className="h-4 bg-white/10 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : series.length === 0 ? (
        <div className="text-white/50 text-sm py-16 text-center">No series in this library.</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-6">
          {series.map((s) => (
            <AbsSeriesCard
              key={s.id}
              series={s}
              coverUrl={api && s.books?.[0] ? api.coverUrl(s.books[0].id, 300) : null}
              onClick={() =>
                onNavigate({ type: 'series-details', seriesId: s.id, seriesName: s.name, libraryId: library.id })
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
