import React, { useEffect, useState } from 'react'
import { ArrowLeft, Play, CheckCircle2, Circle, BookAudio, Clock, ListOrdered, Download, Check } from 'lucide-react'
import { useAudiobookshelf } from './AudiobookshelfContext'
import { formatAbsDuration, formatAbsTime, getItemAuthor, getItemSeries, getItemTitle, startItemPlayback } from './absHelpers'
import { useAudiobookPlayer } from '../../stores/audiobookPlayerStore'
import { downloadAbsItem, isAbsItemDownloaded, getActiveAbsDownloads, subscribeToAbsDownloads, type AbsDownloadProgress } from '../../utils/absDownloadManager'
import CircularProgress from '../CircularProgress'
import { useDownloadFraction } from '../../stores/downloadProgressStore'
import { useScrollToTopOnMount } from '../../hooks/useScrollRestore'
import { useIsPhone } from '../../hooks/useIsPhone'
import { MobileDetailHero } from '../MobileDetailHero'
import { DetailActionBar } from '../DetailActionBar'
import type { AbsLibraryItem, AbsMediaProgress } from '../../types/audiobookshelf'
import type { AbsViewType } from './AudiobookshelfView'

interface AbsItemDetailsProps {
  itemId: string
  onBack: () => void
  onNavigate?: (view: AbsViewType) => void
}

// Audiobook details: metadata, resume/play, mark finished, chapter list
export const AbsItemDetails: React.FC<AbsItemDetailsProps> = ({ itemId, onBack, onNavigate }) => {
  const { api } = useAudiobookshelf()
  const scrollTopAnchor = useScrollToTopOnMount()
  const isPhone = useIsPhone()
  const [item, setItem] = useState<AbsLibraryItem | null>(null)
  const [progress, setProgress] = useState<AbsMediaProgress | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDownloaded, setIsDownloaded] = useState(() => isAbsItemDownloaded(itemId))
  const [downloadEntry, setDownloadEntry] = useState<AbsDownloadProgress | null>(
    () => getActiveAbsDownloads().find((d) => d.key === itemId && d.status === 'downloading') ?? null,
  )
  const isDownloading = downloadEntry !== null
  // Byte fraction of the file currently transferring (per-file, resets each file)
  const fileFraction = useDownloadFraction(isDownloading ? itemId : undefined)
  // Combined fraction over all files of the audiobook; null = indeterminate
  const downloadFraction = downloadEntry && downloadEntry.totalFiles > 0 && fileFraction !== null
    ? (downloadEntry.completedFiles + (fileFraction ?? 0)) / downloadEntry.totalFiles
    : null
  const seek = useAudiobookPlayer((s) => s.seek)
  const playingItemId = useAudiobookPlayer((s) => s.currentItem?.id)

  useEffect(() => {
    setIsDownloaded(isAbsItemDownloaded(itemId))
    return subscribeToAbsDownloads((active, downloads) => {
      setDownloadEntry(active.find((d) => d.key === itemId && d.status === 'downloading') ?? null)
      setIsDownloaded(downloads.some((d) => d.key === itemId))
    })
  }, [itemId])

  useEffect(() => {
    if (!api) return
    let active = true
    setIsLoading(true)
    setError(null)

    Promise.all([api.getItem(itemId), api.getProgress(itemId)])
      .then(([loadedItem, loadedProgress]) => {
        if (!active) return
        setItem(loadedItem)
        setProgress(loadedProgress)
      })
      .catch((e) => {
        console.error('[Abs] Failed to load item:', e)
        if (active) setError(e?.message || 'Failed to load')
      })
      .finally(() => active && setIsLoading(false))

    return () => {
      active = false
    }
  }, [api, itemId])

  const handlePlay = async () => {
    if (!api || !item) return
    setIsStarting(true)
    setError(null)
    try {
      await startItemPlayback(api, item)
    } catch (e: any) {
      console.error('[Abs] Play failed:', e)
      setError(e?.message || 'Playback failed')
    } finally {
      setIsStarting(false)
    }
  }

  const handleChapterClick = async (start: number) => {
    if (!api || !item) return
    if (playingItemId === item.id) {
      seek(start)
    } else {
      setIsStarting(true)
      try {
        await startItemPlayback(api, item)
        seek(start)
      } catch (e: any) {
        setError(e?.message || 'Playback failed')
      } finally {
        setIsStarting(false)
      }
    }
  }

  const toggleFinished = async () => {
    if (!api || !item) return
    const newFinished = !(progress?.isFinished ?? false)
    try {
      await api.patchProgress(item.id, { isFinished: newFinished })
      setProgress((prev) =>
        prev
          ? { ...prev, isFinished: newFinished }
          : ({ id: '', libraryItemId: item.id, duration: item.media.duration || 0, progress: newFinished ? 1 : 0, currentTime: 0, isFinished: newFinished, lastUpdate: Date.now() } as AbsMediaProgress),
      )
    } catch (e) {
      console.error('[Abs] Failed to update read status:', e)
    }
  }

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="w-10 h-10 border-4 border-theme-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!item) {
    return (
      <div className="p-8 space-y-4">
        <button onClick={onBack} className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
          <ArrowLeft size={18} /> Back
        </button>
        <p className="text-red-400 text-sm">{error || 'Item not found'}</p>
      </div>
    )
  }

  const meta = item.media.metadata
  const chapters = item.media.chapters ?? []
  const hasProgress = !!progress && !progress.isFinished && progress.currentTime > 5
  const duration = item.media.duration || 0

  if (isPhone) {
    const seriesRef = getItemSeries(item)
    const seriesLabel =
      meta.seriesName || (seriesRef ? `${seriesRef.name}${seriesRef.sequence ? ` #${seriesRef.sequence}` : ''}` : null)

    return (
      <div ref={scrollTopAnchor} className="pb-6">
        <MobileDetailHero
          coverShape="square"
          onBack={onBack}
          cover={
            api ? (
              <img src={api.coverUrl(item.id, 600)} alt={getItemTitle(item)} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <BookAudio size={56} className="text-white/30" />
              </div>
            )
          }
          title={getItemTitle(item)}
          meta={
            <div className="space-y-1">
              {meta.subtitle && <p className="text-white/70">{meta.subtitle}</p>}
              <p>{getItemAuthor(item)}</p>
              {meta.narratorName && <p className="text-xs text-white/40">Narrated by {meta.narratorName}</p>}
              {seriesLabel &&
                (seriesRef && onNavigate ? (
                  <button
                    onClick={() =>
                      onNavigate({
                        type: 'series-details',
                        seriesId: seriesRef.id,
                        seriesName: seriesRef.name,
                        libraryId: item.libraryId,
                      })
                    }
                    className="text-sm text-theme-400/80 hover:text-theme-300 hover:underline"
                  >
                    {seriesLabel}
                  </button>
                ) : (
                  <p className="text-sm text-theme-400/80">{seriesLabel}</p>
                ))}
            </div>
          }
        >
          <div className="flex items-center justify-center gap-4 text-sm text-white/50">
            <span className="flex items-center gap-1.5">
              <Clock size={14} /> {formatAbsDuration(duration)}
            </span>
            {chapters.length > 0 && (
              <span className="flex items-center gap-1.5">
                <ListOrdered size={14} /> {chapters.length} chapters
              </span>
            )}
            {meta.publishedYear && <span>{meta.publishedYear}</span>}
          </div>

          {hasProgress && (
            <div className="space-y-1.5">
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-theme-500" style={{ width: `${Math.round((progress!.progress || 0) * 100)}%` }} />
              </div>
              <p className="text-xs text-white/50 text-center">
                {formatAbsTime(progress!.currentTime)} of {formatAbsTime(duration)} · {Math.round((progress!.progress || 0) * 100)}%
              </p>
            </div>
          )}

          <DetailActionBar
            primary={{ label: hasProgress ? 'Resume' : 'Play', icon: Play, onClick: handlePlay, busy: isStarting }}
            secondary={
              <>
                <button
                  onClick={toggleFinished}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-full text-sm font-medium transition-colors"
                >
                  {progress?.isFinished ? <CheckCircle2 size={16} className="text-green-400" /> : <Circle size={16} />}
                  {progress?.isFinished ? 'Finished' : 'Mark finished'}
                </button>
                <button
                  onClick={() => {
                    if (!api || !item || isDownloaded || isDownloading) return
                    downloadAbsItem(api, item).catch((e) => setError(e?.message || 'Download failed'))
                  }}
                  disabled={isDownloaded || isDownloading}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 disabled:opacity-60 rounded-full text-sm font-medium transition-colors"
                >
                  {isDownloaded ? (
                    <>
                      <Check size={16} className="text-green-400" /> Downloaded
                    </>
                  ) : isDownloading ? (
                    <>
                      <CircularProgress fraction={downloadFraction} size={16} className="text-theme-400" />
                      {typeof downloadFraction === 'number' ? `${Math.round(downloadFraction * 100)}%` : '...'}
                    </>
                  ) : (
                    <>
                      <Download size={16} /> Download
                    </>
                  )}
                </button>
              </>
            }
          />

          {error && <p className="text-sm text-red-400 text-center">{error}</p>}
          {meta.description && (
            <p className="text-sm text-white/60 leading-relaxed whitespace-pre-line">{meta.description}</p>
          )}
        </MobileDetailHero>

        {chapters.length > 0 && (
          <div className="px-4 space-y-3 mt-4">
            <h2 className="text-lg font-bold text-white">Chapters</h2>
            <div className="bg-white/5 rounded-xl border border-white/10 divide-y divide-white/5">
              {chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  onClick={() => handleChapterClick(chapter.start)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors group"
                >
                  <span className="text-sm text-white/80 group-hover:text-white truncate">{chapter.title}</span>
                  <span className="text-xs text-white/40 tabular-nums ml-4 flex-shrink-0">{formatAbsTime(chapter.start)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-8 space-y-8 max-w-5xl" ref={scrollTopAnchor}>
      <button onClick={onBack} className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
        <ArrowLeft size={18} /> Back
      </button>

      <div className="flex gap-8">
        {/* Cover */}
        <div className="w-56 flex-shrink-0">
          <div className="aspect-square rounded-xl overflow-hidden bg-white/5 shadow-2xl">
            {api ? (
              <img src={api.coverUrl(item.id, 600)} alt={getItemTitle(item)} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <BookAudio size={64} className="text-white/30" />
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-white">{getItemTitle(item)}</h1>
            {meta.subtitle && <p className="text-lg text-white/70 mt-1">{meta.subtitle}</p>}
            <p className="text-white/60 mt-2">{getItemAuthor(item)}</p>
            {meta.narratorName && <p className="text-sm text-white/40">Narrated by {meta.narratorName}</p>}
            {(() => {
              const seriesRef = getItemSeries(item)
              const label = meta.seriesName || (seriesRef ? `${seriesRef.name}${seriesRef.sequence ? ` #${seriesRef.sequence}` : ''}` : null)
              if (!label) return null
              // Clickable when we know the series id (expanded items do)
              if (seriesRef && onNavigate) {
                return (
                  <button
                    onClick={() =>
                      onNavigate({
                        type: 'series-details',
                        seriesId: seriesRef.id,
                        seriesName: seriesRef.name,
                        libraryId: item.libraryId,
                      })
                    }
                    className="text-sm text-theme-400/80 hover:text-theme-300 hover:underline mt-1 text-left"
                    title="Show all books in this series"
                  >
                    {label}
                  </button>
                )
              }
              return <p className="text-sm text-theme-400/80 mt-1">{label}</p>
            })()}
          </div>

          <div className="flex items-center gap-4 text-sm text-white/50">
            <span className="flex items-center gap-1.5">
              <Clock size={14} /> {formatAbsDuration(duration)}
            </span>
            {chapters.length > 0 && (
              <span className="flex items-center gap-1.5">
                <ListOrdered size={14} /> {chapters.length} chapters
              </span>
            )}
            {meta.publishedYear && <span>{meta.publishedYear}</span>}
          </div>

          {hasProgress && (
            <div className="space-y-1.5 max-w-md">
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-theme-500" style={{ width: `${Math.round((progress!.progress || 0) * 100)}%` }} />
              </div>
              <p className="text-xs text-white/50">
                {formatAbsTime(progress!.currentTime)} of {formatAbsTime(duration)} · {Math.round((progress!.progress || 0) * 100)}%
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handlePlay}
              disabled={isStarting}
              className="flex items-center gap-2 px-6 py-3 bg-theme-500 hover:bg-theme-400 disabled:opacity-50 rounded-full text-sm font-semibold transition-colors"
            >
              {isStarting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              {hasProgress ? 'Resume' : 'Play'}
            </button>

            <button
              onClick={toggleFinished}
              className="flex items-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/20 rounded-full text-sm font-medium transition-colors"
              title={progress?.isFinished ? 'Mark as not finished' : 'Mark as finished'}
            >
              {progress?.isFinished ? <CheckCircle2 size={16} className="text-green-400" /> : <Circle size={16} />}
              {progress?.isFinished ? 'Finished' : 'Mark finished'}
            </button>

            <button
              onClick={() => {
                if (!api || !item || isDownloaded || isDownloading) return
                downloadAbsItem(api, item).catch((e) => setError(e?.message || 'Download failed'))
              }}
              disabled={isDownloaded || isDownloading}
              className="flex items-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/20 disabled:opacity-60 rounded-full text-sm font-medium transition-colors"
              title={isDownloaded ? 'Available offline' : 'Download for offline listening'}
            >
              {isDownloaded ? (
                <>
                  <Check size={16} className="text-green-400" /> Downloaded
                </>
              ) : isDownloading ? (
                <>
                  <CircularProgress fraction={downloadFraction} size={16} className="text-theme-400" />
                  {typeof downloadFraction === 'number'
                    ? `Downloading ${Math.round(downloadFraction * 100)}%`
                    : 'Downloading...'}
                </>
              ) : (
                <>
                  <Download size={16} /> Download
                </>
              )}
            </button>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {meta.description && (
            <p className="text-sm text-white/60 leading-relaxed whitespace-pre-line max-w-2xl">{meta.description}</p>
          )}
        </div>
      </div>

      {/* Chapters */}
      {chapters.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-white">Chapters</h2>
          <div className="bg-white/5 rounded-xl border border-white/10 divide-y divide-white/5">
            {chapters.map((chapter) => (
              <button
                key={chapter.id}
                onClick={() => handleChapterClick(chapter.start)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors group"
              >
                <span className="text-sm text-white/80 group-hover:text-white truncate">{chapter.title}</span>
                <span className="text-xs text-white/40 tabular-nums ml-4 flex-shrink-0">{formatAbsTime(chapter.start)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
