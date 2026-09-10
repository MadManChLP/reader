import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Play, CheckCircle2, Circle, Mic, Download, Check } from 'lucide-react'
import { useAudiobookshelf } from './AudiobookshelfContext'
import { formatAbsDuration, getItemTitle, startItemPlayback } from './absHelpers'
import { useAudiobookPlayer } from '../../stores/audiobookPlayerStore'
import { downloadAbsItem, downloadKey, getAbsDownloads, getActiveAbsDownloads, subscribeToAbsDownloads } from '../../utils/absDownloadManager'
import CircularProgress from '../CircularProgress'
import { useDownloadFraction } from '../../stores/downloadProgressStore'
import { useScrollToTopOnMount } from '../../hooks/useScrollRestore'
import { useIsPhone } from '../../hooks/useIsPhone'
import { MobileDetailHero } from '../MobileDetailHero'
import type { AbsLibraryItem, AbsMediaProgress, AbsPodcastEpisode } from '../../types/audiobookshelf'

interface AbsPodcastDetailsProps {
  itemId: string
  onBack: () => void
}

// Per-episode download button with a byte-level progress ring while the
// episode file is transferring (extracted so the hook can be used per row)
const EpisodeDownloadButton: React.FC<{
  dlKey: string
  done: boolean
  busy: boolean
  onDownload: () => void
}> = ({ dlKey, done, busy, onDownload }) => {
  const fraction = useDownloadFraction(busy ? dlKey : undefined)
  return (
    <button
      onClick={() => { if (!done && !busy) onDownload() }}
      disabled={done || busy}
      className="p-2 phone:p-2.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-70 transition-colors flex-shrink-0"
      title={done ? 'Available offline' : busy ? 'Downloading...' : 'Download episode'}
    >
      {done ? (
        <Check size={16} className="text-green-400" />
      ) : busy ? (
        <CircularProgress fraction={fraction ?? null} size={16} className="text-theme-400" />
      ) : (
        <Download size={16} />
      )}
    </button>
  )
}

// Podcast details: episode list (newest first) with per-episode progress
export const AbsPodcastDetails: React.FC<AbsPodcastDetailsProps> = ({ itemId, onBack }) => {
  const { api, user } = useAudiobookshelf()
  const scrollTopAnchor = useScrollToTopOnMount()
  const isPhone = useIsPhone()
  const [item, setItem] = useState<AbsLibraryItem | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startingEpisodeId, setStartingEpisodeId] = useState<string | null>(null)
  // Local overrides after mark-played toggles (avoids refetching /api/me)
  const [progressOverrides, setProgressOverrides] = useState<Record<string, boolean>>({})
  const [downloadedKeys, setDownloadedKeys] = useState<Set<string>>(() => new Set(getAbsDownloads().map((d) => d.key)))
  const [downloadingKeys, setDownloadingKeys] = useState<Set<string>>(
    () => new Set(getActiveAbsDownloads().filter((d) => d.status === 'downloading').map((d) => d.key)),
  )

  useEffect(() => {
    return subscribeToAbsDownloads((active, downloads) => {
      setDownloadingKeys(new Set(active.filter((d) => d.status === 'downloading').map((d) => d.key)))
      setDownloadedKeys(new Set(downloads.map((d) => d.key)))
    })
  }, [])

  const playingEpisodeId = useAudiobookPlayer((s) => s.currentEpisodeId)

  useEffect(() => {
    if (!api) return
    let active = true
    setIsLoading(true)
    setError(null)

    api
      .getItem(itemId)
      .then((loaded) => active && setItem(loaded))
      .catch((e) => {
        console.error('[Abs] Failed to load podcast:', e)
        if (active) setError(e?.message || 'Failed to load')
      })
      .finally(() => active && setIsLoading(false))

    return () => {
      active = false
    }
  }, [api, itemId])

  const episodes = useMemo(() => {
    const list = [...(item?.media.episodes ?? [])]
    return list.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  }, [item])

  const progressFor = (episode: AbsPodcastEpisode): AbsMediaProgress | undefined =>
    user?.mediaProgress?.find((p) => p.libraryItemId === itemId && p.episodeId === episode.id)

  const isFinished = (episode: AbsPodcastEpisode): boolean =>
    progressOverrides[episode.id] ?? progressFor(episode)?.isFinished ?? false

  const handlePlayEpisode = async (episode: AbsPodcastEpisode) => {
    if (!api || !item) return
    setStartingEpisodeId(episode.id)
    setError(null)
    try {
      await startItemPlayback(api, item, episode.id)
    } catch (e: any) {
      console.error('[Abs] Episode play failed:', e)
      setError(e?.message || 'Playback failed')
    } finally {
      setStartingEpisodeId(null)
    }
  }

  const toggleEpisodeFinished = async (episode: AbsPodcastEpisode) => {
    if (!api || !item) return
    const newFinished = !isFinished(episode)
    try {
      await api.patchProgress(item.id, { isFinished: newFinished }, episode.id)
      setProgressOverrides((prev) => ({ ...prev, [episode.id]: newFinished }))
    } catch (e) {
      console.error('[Abs] Failed to update episode status:', e)
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
        <p className="text-red-400 text-sm">{error || 'Podcast not found'}</p>
      </div>
    )
  }

  const meta = item.media.metadata

  const episodesList = (
    <div className="space-y-3">
        <h2 className="text-lg font-bold text-white">Episodes</h2>
        <div className="bg-white/5 rounded-xl border border-white/10 divide-y divide-white/5">
          {episodes.map((episode) => {
            const progress = progressFor(episode)
            const finished = isFinished(episode)
            const isCurrent = playingEpisodeId === episode.id
            const duration = episode.duration ?? episode.audioFile?.duration

            return (
              <div
                key={episode.id}
                className={`flex items-center gap-4 px-4 py-3 group hover:bg-white/5 transition-colors ${finished ? 'opacity-50' : ''}`}
              >
                <button
                  onClick={() => handlePlayEpisode(episode)}
                  disabled={startingEpisodeId === episode.id}
                  className={`p-2.5 rounded-full flex-shrink-0 transition-colors ${
                    isCurrent ? 'bg-theme-500 text-white' : 'bg-white/10 hover:bg-theme-500 text-white/80 hover:text-white'
                  }`}
                  title="Play episode"
                >
                  {startingEpisodeId === episode.id ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Play size={16} fill={isCurrent ? 'currentColor' : 'none'} />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${isCurrent ? 'text-theme-400 font-medium' : 'text-white/90'}`}>
                    {episode.title}
                  </p>
                  <p className="text-xs text-white/40 flex items-center gap-2">
                    {episode.publishedAt && <span>{new Date(episode.publishedAt).toLocaleDateString()}</span>}
                    {duration && <span>{formatAbsDuration(duration)}</span>}
                    {progress && !progress.isFinished && progress.progress > 0.01 && (
                      <span className="text-theme-400/80">{Math.round(progress.progress * 100)}% listened</span>
                    )}
                  </p>
                  {progress && !progress.isFinished && progress.progress > 0.01 && (
                    <div className="h-0.5 bg-white/10 rounded-full overflow-hidden mt-1.5 max-w-xs">
                      <div className="h-full bg-theme-500" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                    </div>
                  )}
                </div>

                {(() => {
                  const key = downloadKey(itemId, episode.id)
                  return (
                    <EpisodeDownloadButton
                      dlKey={key}
                      done={downloadedKeys.has(key)}
                      busy={downloadingKeys.has(key)}
                      onDownload={() => {
                        if (!api || !item) return
                        downloadAbsItem(api, item, episode.id).catch((e) => setError(e?.message || 'Download failed'))
                      }}
                    />
                  )
                })()}

                <button
                  onClick={() => toggleEpisodeFinished(episode)}
                  className="p-2 phone:p-2.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                  title={finished ? 'Mark as not played' : 'Mark as played'}
                >
                  {finished ? <CheckCircle2 size={16} className="text-green-400" /> : <Circle size={16} />}
                </button>
              </div>
            )
          })}
          {episodes.length === 0 && <div className="px-4 py-8 text-center text-sm text-white/50">No episodes.</div>}
        </div>
      </div>
  )

  if (isPhone) {
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
                <Mic size={56} className="text-white/30" />
              </div>
            )
          }
          title={getItemTitle(item)}
          meta={
            <div className="space-y-1">
              {meta.authorName && <p className="text-white/60">{meta.authorName}</p>}
              <p className="text-sm text-white/50">{episodes.length} episodes</p>
            </div>
          }
        >
          {meta.description && (
            <p className="text-sm text-white/60 leading-relaxed line-clamp-4">{meta.description}</p>
          )}
          {error && <p className="text-sm text-red-400 text-center">{error}</p>}
        </MobileDetailHero>
        <div className="px-4 mt-4">{episodesList}</div>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-8 max-w-5xl" ref={scrollTopAnchor}>
      <button onClick={onBack} className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
        <ArrowLeft size={18} /> Back
      </button>

      <div className="flex gap-8">
        <div className="w-48 flex-shrink-0">
          <div className="aspect-square rounded-xl overflow-hidden bg-white/5 shadow-2xl">
            {api ? (
              <img src={api.coverUrl(item.id, 600)} alt={getItemTitle(item)} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Mic size={64} className="text-white/30" />
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          <h1 className="text-3xl font-bold text-white">{getItemTitle(item)}</h1>
          {meta.authorName && <p className="text-white/60">{meta.authorName}</p>}
          <p className="text-sm text-white/50">{episodes.length} episodes</p>
          {meta.description && (
            <p className="text-sm text-white/60 leading-relaxed line-clamp-4 max-w-2xl">{meta.description}</p>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>

      {episodesList}
    </div>
  )
}
