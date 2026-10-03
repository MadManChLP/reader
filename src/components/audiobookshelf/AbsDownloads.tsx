import React, { useEffect, useState } from 'react'
import { Play, Trash2, Download, BookAudio, Mic, WifiOff } from 'lucide-react'
import { toLocalUrl } from '../../utils/api'
import {
  getAbsDownloads,
  getActiveAbsDownloads,
  deleteAbsDownload,
  subscribeToAbsDownloads,
  type AbsDownloadedItem,
  type AbsDownloadProgress,
} from '../../utils/absDownloadManager'
import { getLocalAbsProgress } from '../../utils/absOfflineQueue'
import { formatBytes } from '../../utils/musicDownloadManager'
import { useAudiobookPlayer } from '../../stores/audiobookPlayerStore'
import { formatAbsDuration } from './absHelpers'
import type { AbsLibraryItem } from '../../types/audiobookshelf'

// Downloaded audiobooks/episodes — playable fully offline
export const AbsDownloads: React.FC<{ offlineMode?: boolean }> = ({ offlineMode }) => {
  const [downloads, setDownloads] = useState<AbsDownloadedItem[]>(getAbsDownloads)
  const [active, setActive] = useState<AbsDownloadProgress[]>(getActiveAbsDownloads)

  useEffect(() => {
    return subscribeToAbsDownloads((activeList, downloadList) => {
      setActive([...activeList])
      setDownloads(downloadList)
    })
  }, [])

  const playOffline = (download: AbsDownloadedItem) => {
    const local = getLocalAbsProgress(download.itemId, download.episodeId)
    // Minimal item stub — offline playback needs no server round-trips
    const itemStub: AbsLibraryItem = {
      id: download.itemId,
      libraryId: '',
      mediaType: download.mediaType,
      media: { metadata: { title: download.title, authorName: download.author }, duration: download.duration, chapters: download.chapters },
      addedAt: 0,
      updatedAt: 0,
    }
    useAudiobookPlayer.getState().startPlayback({
      item: itemStub,
      episodeId: download.episodeId,
      sessionId: null,
      tracks: download.files.map((f) => ({
        localPath: f.localPath,
        mimeType: f.mimeType,
        startOffset: f.startOffset,
        duration: f.duration,
      })),
      chapters: download.chapters,
      duration: download.duration,
      startTime: local && local.currentTime < download.duration - 10 ? local.currentTime : 0,
      displayTitle: download.title,
      displayAuthor: download.author,
      coverUrl: download.localCoverPath ? toLocalUrl(download.localCoverPath) : null,
      isOfflinePlayback: true,
    })
  }

  const handleDelete = async (download: AbsDownloadedItem) => {
    if (!confirm(`Delete "${download.title}" from downloads?`)) return
    await deleteAbsDownload(download.key)
    setDownloads(getAbsDownloads())
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-white">Downloads</h1>
        {offlineMode && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-medium">
            <WifiOff size={10} /> OFFLINE
          </span>
        )}
      </div>

      {/* Active downloads */}
      {active.length > 0 && (
        <div className="space-y-2">
          {active.map((progress) => (
            <div key={progress.key} className="flex items-center gap-4 bg-white/5 rounded-xl border border-white/10 px-4 py-3">
              <Download size={18} className={progress.status === 'failed' ? 'text-red-400' : 'text-theme-400 animate-pulse'} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/90 truncate">{progress.title}</p>
                {progress.status === 'failed' ? (
                  <p className="text-xs text-red-400">{progress.error || 'Download failed'}</p>
                ) : (
                  <>
                    <p className="text-xs text-white/50">
                      {progress.completedFiles} / {progress.totalFiles} files
                    </p>
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden mt-1.5 max-w-md">
                      <div
                        className="h-full bg-theme-500 transition-all"
                        style={{ width: `${Math.round((progress.completedFiles / Math.max(1, progress.totalFiles)) * 100)}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed downloads */}
      {downloads.length === 0 && active.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-white/40 gap-3">
          <Download size={40} />
          <p className="text-sm">No downloads yet. Use the download button on an audiobook or episode.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {downloads.map((download) => (
            <div key={download.key} className="flex items-center gap-4 bg-white/5 rounded-xl border border-white/10 px-4 py-3 group">
              <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                {download.localCoverPath ? (
                  <img src={toLocalUrl(download.localCoverPath)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    {download.mediaType === 'podcast' ? <Mic size={20} className="text-white/30" /> : <BookAudio size={20} className="text-white/30" />}
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{download.title}</p>
                <p className="text-xs text-white/50 truncate">
                  {download.author && <span>{download.author} · </span>}
                  {formatAbsDuration(download.duration)} · {formatBytes(download.totalSize)}
                  {download.episodeId && <span> · Episode</span>}
                </p>
              </div>

              <button
                onClick={() => playOffline(download)}
                className="p-2.5 bg-theme-500 hover:bg-theme-400 rounded-full text-white transition-colors flex-shrink-0"
                title="Play offline"
              >
                <Play size={16} fill="currentColor" />
              </button>
              <button
                onClick={() => handleDelete(download)}
                className="p-2.5 text-white/40 hover:text-red-400 hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
                title="Delete download"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
