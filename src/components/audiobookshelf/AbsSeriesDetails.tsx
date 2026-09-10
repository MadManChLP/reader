import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Play, CheckCircle2, BookAudio } from 'lucide-react'
import { useAudiobookshelf } from './AudiobookshelfContext'
import {
  formatAbsDuration,
  getItemAuthor,
  getItemSeriesSequence,
  getItemTitle,
  startItemPlayback,
} from './absHelpers'
import { useAudiobookPlayer } from '../../stores/audiobookPlayerStore'
import { useScrollToTopOnMount } from '../../hooks/useScrollRestore'
import type { AbsLibraryItem, AbsMediaProgress } from '../../types/audiobookshelf'
import type { AbsViewType } from './AudiobookshelfView'

interface AbsSeriesDetailsProps {
  seriesId: string
  seriesName: string
  libraryId: string
  onBack: () => void
  onNavigate: (view: AbsViewType) => void
}

// One series: its books as an ordered list (sequence number, cover, title,
// duration, listening progress, finished marker, play button)
export const AbsSeriesDetails: React.FC<AbsSeriesDetailsProps> = ({
  seriesId,
  seriesName,
  libraryId,
  onBack,
  onNavigate,
}) => {
  const { api, user } = useAudiobookshelf()
  const scrollTopAnchor = useScrollToTopOnMount()
  const [books, setBooks] = useState<AbsLibraryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startingItemId, setStartingItemId] = useState<string | null>(null)
  const playingItemId = useAudiobookPlayer((s) => s.currentItem?.id)

  useEffect(() => {
    if (!api) return
    let active = true
    setIsLoading(true)
    setError(null)

    api
      .getSeriesBooks(libraryId, seriesId)
      .then((items) => active && setBooks(items))
      .catch((e) => {
        console.error('[Abs] Failed to load series books:', e)
        if (active) setError(e?.message || 'Failed to load series')
      })
      .finally(() => active && setIsLoading(false))

    return () => {
      active = false
    }
  }, [api, libraryId, seriesId])

  // Sort by sequence client-side as well (server sort may vary by version)
  const sortedBooks = useMemo(() => {
    return [...books].sort((a, b) => {
      const seqA = parseFloat(getItemSeriesSequence(a) ?? '')
      const seqB = parseFloat(getItemSeriesSequence(b) ?? '')
      if (Number.isNaN(seqA) && Number.isNaN(seqB)) return 0
      if (Number.isNaN(seqA)) return 1
      if (Number.isNaN(seqB)) return -1
      return seqA - seqB
    })
  }, [books])

  const progressFor = (item: AbsLibraryItem): AbsMediaProgress | undefined =>
    user?.mediaProgress?.find((p) => p.libraryItemId === item.id && !p.episodeId)

  const handlePlay = async (item: AbsLibraryItem, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!api) return
    setStartingItemId(item.id)
    setError(null)
    try {
      await startItemPlayback(api, item)
    } catch (err: any) {
      console.error('[Abs] Play failed:', err)
      setError(err?.message || 'Playback failed')
    } finally {
      setStartingItemId(null)
    }
  }

  const totalDuration = sortedBooks.reduce((sum, b) => sum + (b.media.duration || 0), 0)
  const finishedCount = sortedBooks.filter((b) => progressFor(b)?.isFinished).length

  return (
    <div className="p-8 phone:p-4 space-y-6 max-w-5xl" ref={scrollTopAnchor}>
      <button onClick={onBack} className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
        <ArrowLeft size={18} /> Back
      </button>

      <div>
        <h1 className="text-3xl font-bold text-white">{seriesName}</h1>
        {!isLoading && sortedBooks.length > 0 && (
          <p className="text-sm text-white/50 mt-2">
            {sortedBooks.length === 1 ? '1 book' : `${sortedBooks.length} books`} · {formatAbsDuration(totalDuration)}
            {finishedCount > 0 && <span> · {finishedCount} finished</span>}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-white/10 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : sortedBooks.length === 0 ? (
        <div className="text-white/50 text-sm py-16 text-center">No books found in this series.</div>
      ) : (
        <div className="bg-white/5 rounded-xl border border-white/10 divide-y divide-white/5">
          {sortedBooks.map((item) => {
            const progress = progressFor(item)
            const finished = progress?.isFinished ?? false
            const inProgress = !!progress && !finished && progress.progress > 0.001
            const sequence = getItemSeriesSequence(item)
            const isCurrent = playingItemId === item.id

            return (
              <div
                key={item.id}
                onClick={() => onNavigate({ type: 'item-details', itemId: item.id })}
                className="flex items-center gap-4 px-4 py-3 group hover:bg-white/5 transition-colors cursor-pointer"
              >
                <span className="w-8 text-center text-sm text-white/40 tabular-nums flex-shrink-0">
                  {sequence ?? '–'}
                </span>

                <div className="w-14 h-14 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                  {api ? (
                    <img
                      src={api.coverUrl(item.id, 120)}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <BookAudio size={20} className="text-white/30" />
                    </div>
                  )}
                </div>

                <div className={`flex-1 min-w-0 ${finished ? 'opacity-60' : ''}`}>
                  <p className={`text-sm truncate ${isCurrent ? 'text-theme-400 font-medium' : 'text-white/90'}`}>
                    {getItemTitle(item)}
                  </p>
                  <p className="text-xs text-white/40 flex items-center gap-2">
                    <span className="truncate">{getItemAuthor(item)}</span>
                    {item.media.duration ? <span className="flex-shrink-0">{formatAbsDuration(item.media.duration)}</span> : null}
                    {inProgress && (
                      <span className="text-theme-400/80 flex-shrink-0">{Math.round(progress!.progress * 100)}%</span>
                    )}
                  </p>
                  {inProgress && (
                    <div className="h-0.5 bg-white/10 rounded-full overflow-hidden mt-1.5 max-w-xs">
                      <div className="h-full bg-theme-500" style={{ width: `${Math.round(progress!.progress * 100)}%` }} />
                    </div>
                  )}
                </div>

                {finished && <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />}

                <button
                  onClick={(e) => handlePlay(item, e)}
                  disabled={startingItemId === item.id}
                  className={`p-2.5 rounded-full flex-shrink-0 transition-colors ${
                    isCurrent ? 'bg-theme-500 text-white' : 'bg-white/10 hover:bg-theme-500 text-white/80 hover:text-white'
                  }`}
                  title={inProgress ? 'Resume' : 'Play'}
                >
                  {startingItemId === item.id ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Play size={16} fill={isCurrent ? 'currentColor' : 'none'} />
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
