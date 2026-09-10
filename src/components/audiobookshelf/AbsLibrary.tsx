import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAudiobookshelf } from './AudiobookshelfContext'
import { AbsItemCard } from './AbsItemCard'
import { startItemPlayback } from './absHelpers'
import { AlphabetScrollRail } from '../AlphabetScrollRail'
import { useScrollRestore } from '../../hooks/useScrollRestore'
import { loadGridState, saveGridState, setScrollPos } from '../../utils/viewStateCache'
import type { AbsLibrary as AbsLibraryType, AbsLibraryItem } from '../../types/audiobookshelf'
import type { AbsViewType } from './AudiobookshelfView'

const PAGE_SIZE = 50

interface AbsLibraryProps {
  library: AbsLibraryType
  onNavigate: (view: AbsViewType) => void
}

interface AbsLibraryCache {
  items: AbsLibraryItem[]
  total: number
  page: number
}

// Paged grid of all items in one library (books or podcasts)
export const AbsLibrary: React.FC<AbsLibraryProps> = ({ library, onNavigate }) => {
  const { api, user } = useAudiobookshelf()

  // Restore the cached page so coming back from item details neither
  // refetches nor loses the scroll position (rendered with key={library.id},
  // so switching libraries remounts with a fresh cache lookup)
  const cacheKey = `abs-library:${library.id}`
  const [cached] = useState(() => loadGridState<AbsLibraryCache>(cacheKey))
  const [items, setItems] = useState<AbsLibraryItem[]>(cached?.data.items ?? [])
  const [total, setTotal] = useState(cached?.data.total ?? 0)
  const [page, setPage] = useState(cached?.data.page ?? 0)
  const [isLoading, setIsLoading] = useState(!cached)

  useEffect(() => {
    if (!api) return

    const cachedNow = loadGridState<AbsLibraryCache>(cacheKey)
    if (cachedNow && cachedNow.sig === `page:${page}`) {
      setItems(cachedNow.data.items)
      setTotal(cachedNow.data.total)
      setIsLoading(false)
      return
    }

    let active = true
    setIsLoading(true)

    api
      .getLibraryItems(library.id, {
        limit: PAGE_SIZE,
        page,
        sort: 'media.metadata.title',
      })
      .then((res) => {
        if (!active) return
        const results = res.results ?? []
        setItems(results)
        setTotal(res.total ?? 0)
        saveGridState<AbsLibraryCache>(cacheKey, `page:${page}`, {
          items: results,
          total: res.total ?? 0,
          page,
        })
        // A freshly fetched page starts at the top
        setScrollPos(cacheKey, 0)
      })
      .catch((e) => console.error('[Abs] Failed to load library items:', e))
      .finally(() => active && setIsLoading(false))

    return () => {
      active = false
    }
  }, [api, library.id, page, cacheKey])

  const scrollAnchorRef = useScrollRestore(cacheKey, !isLoading)

  // Grid element — A–Z rail jumps by scrolling the Nth card into view.
  // Note: this ABS view is page-paginated, so the rail spans the current page.
  const gridRef = useRef<HTMLDivElement>(null)
  const jumpToIndex = useCallback((i: number) => {
    (gridRef.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: 'start' })
  }, [])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const progressFor = (item: AbsLibraryItem): number | undefined => {
    const progress = user?.mediaProgress?.find((p) => p.libraryItemId === item.id && !p.episodeId)
    return progress && !progress.isFinished ? progress.progress : undefined
  }

  const openItem = (item: AbsLibraryItem) => {
    onNavigate(item.mediaType === 'podcast' ? { type: 'podcast-details', itemId: item.id } : { type: 'item-details', itemId: item.id })
  }

  return (
    <div className="p-8 space-y-6" ref={scrollAnchorRef}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{library.name}</h1>
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
      ) : items.length === 0 ? (
        <div className="text-white/50 text-sm py-16 text-center">This library is empty.</div>
      ) : (
        <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-6">
          {items.map((item) => (
            <AbsItemCard
              key={item.id}
              item={item}
              coverUrl={api ? api.coverUrl(item.id, 300) : null}
              progress={progressFor(item)}
              onClick={() => openItem(item)}
              onPlay={
                item.mediaType === 'book' && api
                  ? () => startItemPlayback(api, item).catch((e) => console.error('[Abs] Play failed:', e))
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* A–Z fast-scroll rail (phone; ABS is title-sorted, spans current page) */}
      {!isLoading && (
        <AlphabetScrollRail
          labels={items.map((i) => i.media?.metadata?.title || '')}
          onJump={jumpToIndex}
          enabled={items.length > 30}
        />
      )}
    </div>
  )
}
