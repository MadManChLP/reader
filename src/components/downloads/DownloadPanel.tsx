import React, { useEffect, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  X, Download, RotateCw, Trash2, Play, BookOpen, Film, Music, Headphones, CheckCircle2,
} from 'lucide-react'
import {
  useDownloadCenter,
  type DownloadSource,
  type UnifiedDownloadItem,
  type DownloadHistoryEntry,
} from './downloadCenterStore'
import { formatBytes } from '../../utils/jellyfinDownloadManager'
import { registerBackHandler, blockGlobalEsc } from '../../utils/navigationBus'

// Slide-over listing all downloads across the app (Calibre books, Jellyfin
// video, JellyMusic, Audiobookshelf) plus a persisted "Finished" history.
// Desktop: right-side drawer. Phone: bottom sheet.

const SOURCE_META: Record<DownloadSource, { label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  calibre: { label: 'Calibre', Icon: BookOpen },
  jellyfin: { label: 'Jellyfin', Icon: Film },
  jellymusic: { label: 'JellyMusic', Icon: Music },
  audiobookshelf: { label: 'Audiobooks', Icon: Headphones },
}

function statusText(item: UnifiedDownloadItem): string {
  switch (item.status) {
    case 'queued':
      return 'Queued'
    case 'paused':
      return 'Paused'
    case 'failed':
      return item.error ? `Failed — ${item.error}` : 'Failed'
    case 'downloading': {
      const parts: string[] = []
      if (item.fraction !== null) parts.push(`${Math.round(item.fraction * 100)}%`)
      if (item.downloadedBytes && item.totalBytes) {
        parts.push(`${formatBytes(item.downloadedBytes)} / ${formatBytes(item.totalBytes)}`)
      }
      if (item.detail) parts.push(item.detail)
      return parts.length > 0 ? parts.join(' · ') : 'Downloading…'
    }
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

/** 40px cover tile, falling back to the source icon */
function Tile({ imageUrl, source, title }: { imageUrl?: string; source: DownloadSource; title: string }) {
  const [failed, setFailed] = useState(false)
  const { Icon } = SOURCE_META[source]
  if (!imageUrl || failed) {
    return (
      <div className="w-10 h-10 rounded bg-white/5 flex items-center justify-center flex-shrink-0">
        <Icon size={18} className="text-white/30" />
      </div>
    )
  }
  return (
    <img
      src={imageUrl}
      alt={title}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="w-10 h-10 rounded object-cover flex-shrink-0 bg-white/5"
    />
  )
}

function ActiveRow({ item }: { item: UnifiedDownloadItem }) {
  const { cancelItem, retryItem, resumeItem, dismissItem } = useDownloadCenter(
    useShallow((s) => ({
      cancelItem: s.cancelItem,
      retryItem: s.retryItem,
      resumeItem: s.resumeItem,
      dismissItem: s.dismissItem,
    })),
  )
  const { label } = SOURCE_META[item.source]
  const isFailed = item.status === 'failed'

  return (
    <div className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-white/5 transition-colors">
      <Tile imageUrl={item.imageUrl} source={item.source} title={item.title} />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-sm text-white truncate flex-1">{item.title}</p>
          <span className="text-[10px] uppercase tracking-wider text-white/30 flex-shrink-0">{label}</span>
        </div>
        {item.subtitle && <p className="text-xs text-white/50 truncate">{item.subtitle}</p>}

        {/* Progress bar */}
        {!isFailed && (
          <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
            {item.fraction === null ? (
              <div className="h-full w-full bg-theme-500/50 animate-pulse" />
            ) : (
              <div
                className="h-full bg-theme-500 transition-[width] duration-300"
                style={{ width: `${Math.round(item.fraction * 100)}%` }}
              />
            )}
          </div>
        )}

        <p className={`mt-1 text-xs truncate ${isFailed ? 'text-red-400' : 'text-white/40'}`}>
          {statusText(item)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 flex-shrink-0 pt-1">
        {item.canResume && (
          <button
            onClick={() => resumeItem(item.key)}
            className="p-1.5 text-white/40 hover:text-theme-400 transition-colors"
            title="Resume download"
          >
            <Play size={15} />
          </button>
        )}
        {isFailed && (
          <button
            onClick={() => item.canRetry && retryItem(item.key)}
            disabled={!item.canRetry}
            className={`p-1.5 transition-colors ${
              item.canRetry ? 'text-white/40 hover:text-theme-400' : 'text-white/15 cursor-not-allowed'
            }`}
            title={item.canRetry ? 'Retry download' : 'Retry not supported for this source'}
          >
            <RotateCw size={15} />
          </button>
        )}
        {isFailed ? (
          item.canDismiss && (
            <button
              onClick={() => dismissItem(item.key)}
              className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
              title="Remove"
            >
              <X size={16} />
            </button>
          )
        ) : (
          <button
            onClick={() => item.canCancel && cancelItem(item.key)}
            disabled={!item.canCancel}
            className={`p-1.5 transition-colors ${
              item.canCancel ? 'text-white/40 hover:text-red-400' : 'text-white/15 cursor-not-allowed'
            }`}
            title={item.canCancel ? 'Cancel download' : 'Cancel not supported for this source'}
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

function HistoryRow({ entry }: { entry: DownloadHistoryEntry }) {
  const { deleteHistoryEntry, removeHistoryEntry } = useDownloadCenter(
    useShallow((s) => ({
      deleteHistoryEntry: s.deleteHistoryEntry,
      removeHistoryEntry: s.removeHistoryEntry,
    })),
  )
  const [isDeleting, setIsDeleting] = useState(false)
  const { label } = SOURCE_META[entry.source]

  const handleDelete = async () => {
    if (isDeleting) return
    if (!window.confirm(`Delete the downloaded file(s) for "${entry.title}"?`)) return
    setIsDeleting(true)
    await deleteHistoryEntry(entry.key)
  }

  return (
    <div className={`flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 transition-colors ${isDeleting ? 'opacity-40' : ''}`}>
      <Tile imageUrl={entry.imageUrl} source={entry.source} title={entry.title} />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-sm text-white truncate flex-1">{entry.title}</p>
          <span className="text-[10px] uppercase tracking-wider text-white/30 flex-shrink-0">{label}</span>
        </div>
        {entry.subtitle && <p className="text-xs text-white/50 truncate">{entry.subtitle}</p>}
        <p className="mt-0.5 text-xs text-white/40 flex items-center gap-1.5">
          <CheckCircle2 size={12} className="text-theme-400" />
          <span>
            {timeAgo(entry.completedAt)}
            {entry.size ? ` · ${formatBytes(entry.size)}` : ''}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
          title="Delete downloaded file"
        >
          <Trash2 size={15} />
        </button>
        <button
          onClick={() => removeHistoryEntry(entry.key)}
          className="p-1.5 text-white/40 hover:text-white transition-colors"
          title="Remove from list (keep files)"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

export function DownloadPanel({ onClose }: { onClose: () => void }) {
  const { items, history, clearFinished } = useDownloadCenter(
    useShallow((s) => ({
      items: s.items,
      history: s.history,
      clearFinished: s.clearFinished,
    })),
  )

  // While open: suppress the global Esc-as-back dispatcher, close on Esc
  // ourselves, and consume the mouse-back gesture
  useEffect(() => {
    const releaseEsc = blockGlobalEsc()
    const unregisterBack = registerBackHandler(() => {
      onClose()
      return true
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      releaseEsc()
      unregisterBack()
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const activeCount = items.filter((i) => i.status !== 'failed').length

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-[90]" onClick={onClose} />

      {/* Drawer — right slide-over on desktop, bottom sheet on phone */}
      <div
        className="fixed right-0 top-0 bottom-0 w-[400px] max-w-full z-[95] flex flex-col
          bg-gray-900/95 backdrop-blur-md border-l border-white/10 shadow-2xl
          phone:inset-x-0 phone:top-auto phone:bottom-0 phone:w-full phone:h-[75vh]
          phone:border-l-0 phone:border-t phone:rounded-t-2xl phone:pb-safe"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Download size={20} className="text-theme-400" />
            <h2 className="font-semibold text-white">Downloads</h2>
            {activeCount > 0 && <span className="text-sm text-white/50">({activeCount} active)</span>}
          </div>
          <button onClick={onClose} className="p-2 text-white/50 hover:text-white transition-colors" title="Close">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* Active downloads */}
          {items.length > 0 && (
            <div className="px-2 py-3 border-b border-white/10">
              <p className="px-2 text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
                Active
              </p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <ActiveRow key={item.key} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* Finished */}
          {history.length > 0 && (
            <div className="px-2 py-3">
              <div className="flex items-center justify-between px-2 mb-2">
                <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Finished</p>
                <button
                  onClick={clearFinished}
                  className="text-xs text-white/40 hover:text-white transition-colors"
                  title="Clear the finished list (keeps files)"
                >
                  Clear finished
                </button>
              </div>
              <div className="space-y-0.5">
                {history.map((entry) => (
                  <HistoryRow key={entry.key} entry={entry} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {items.length === 0 && history.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <Download size={48} className="text-white/20 mb-4" />
              <p className="text-white/60">No downloads</p>
              <p className="text-sm text-white/40 mt-1">
                Downloads from Calibre, Jellyfin, JellyMusic and Audiobooks show up here
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
