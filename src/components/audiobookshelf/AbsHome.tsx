import React, { useEffect, useState } from 'react'
import { useAudiobookshelf } from './AudiobookshelfContext'
import { AbsItemCard } from './AbsItemCard'
import { AbsSeriesCard } from './AbsSeriesGrid'
import { startItemPlayback } from './absHelpers'
import type { AbsLibrary, AbsLibraryItem, AbsSeries, AbsShelf } from '../../types/audiobookshelf'
import type { AbsViewType } from './AudiobookshelfView'

interface AbsHomeProps {
  libraries: AbsLibrary[]
  onNavigate: (view: AbsViewType) => void
}

interface LoadedShelf extends AbsShelf {
  libraryId: string
}

// Personalized home: one row per shelf from /api/libraries/{id}/personalized
// (Continue Listening, Recently Added, ...), across all libraries.
export const AbsHome: React.FC<AbsHomeProps> = ({ libraries, onNavigate }) => {
  const { api, user } = useAudiobookshelf()
  const [shelves, setShelves] = useState<LoadedShelf[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!api || libraries.length === 0) {
      setIsLoading(false)
      return
    }
    let active = true
    setIsLoading(true)

    Promise.all(
      libraries.map(async (lib) => {
        try {
          const libShelves = await api.getPersonalized(lib.id)
          return libShelves
            .filter((s) => (s.type === 'book' || s.type === 'podcast' || s.type === 'series') && s.entities?.length > 0)
            .map((s) => ({ ...s, libraryId: lib.id }))
        } catch (e) {
          console.error(`[Abs] Failed to load shelves for library ${lib.name}:`, e)
          return []
        }
      }),
    ).then((results) => {
      if (active) {
        setShelves(results.flat())
        setIsLoading(false)
      }
    })

    return () => {
      active = false
    }
  }, [api, libraries])

  const progressFor = (item: AbsLibraryItem): number | undefined => {
    const progress = user?.mediaProgress?.find((p) => p.libraryItemId === item.id && !p.episodeId)
    return progress && !progress.isFinished ? progress.progress : undefined
  }

  const openItem = (item: AbsLibraryItem) => {
    onNavigate(item.mediaType === 'podcast' ? { type: 'podcast-details', itemId: item.id } : { type: 'item-details', itemId: item.id })
  }

  if (isLoading) {
    return (
      <div className="p-8 space-y-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-4">
            <div className="h-6 w-48 bg-white/10 rounded animate-pulse" />
            <div className="flex gap-4">
              {[0, 1, 2, 3, 4].map((j) => (
                <div key={j} className="w-40 flex-shrink-0">
                  <div className="aspect-square bg-white/10 rounded-lg animate-pulse mb-3" />
                  <div className="h-4 bg-white/10 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (shelves.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/50 text-sm">
        Nothing here yet — your libraries appear to be empty.
      </div>
    )
  }

  return (
    <div className="p-8 space-y-8">
      {shelves.map((shelf) => (
        <section key={`${shelf.libraryId}-${shelf.id}`} className="space-y-4">
          <h2 className="text-lg font-bold text-white">{shelf.label}</h2>
          <div className="flex gap-4 overflow-x-auto custom-scrollbar pb-2">
            {shelf.type === 'series'
              ? (shelf.entities as AbsSeries[]).map((series) => (
                  <AbsSeriesCard
                    key={series.id}
                    series={series}
                    coverUrl={api && series.books?.[0] ? api.coverUrl(series.books[0].id, 300) : null}
                    onClick={() =>
                      onNavigate({
                        type: 'series-details',
                        seriesId: series.id,
                        seriesName: series.name,
                        libraryId: shelf.libraryId,
                      })
                    }
                  />
                ))
              : (shelf.entities as AbsLibraryItem[]).map((item) => (
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
        </section>
      ))}
    </div>
  )
}
