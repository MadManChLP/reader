import React from 'react'
import { X, Play, ChevronRight, Check } from 'lucide-react'
import type { BaseItemDto } from '../JellyfinContext'

interface QueuePanelProps {
  visible: boolean
  episodeQueue: BaseItemDto[]
  currentItemId: string | undefined
  currentEpisodeIndex: number
  serverUrl: string | null
  onPlayEpisode: (episode: BaseItemDto) => void
  onClose: () => void
}

const QueuePanel: React.FC<QueuePanelProps> = ({
  visible,
  episodeQueue,
  currentItemId,
  currentEpisodeIndex,
  serverUrl,
  onPlayEpisode,
  onClose,
}) => {
  if (!visible || episodeQueue.length === 0) return null

  const getThumbnail = (episode: BaseItemDto) => {
    if (!serverUrl || !episode.Id) return null
    return `${serverUrl}/Items/${episode.Id}/Images/Primary?maxWidth=200&quality=80`
  }

  return (
    <div className="absolute top-0 right-0 bottom-0 w-80 bg-gray-900/95 backdrop-blur-md border-l border-white/10 z-20 animate-in slide-in-from-right duration-200">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h3 className="font-semibold text-white">Episode Queue</h3>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-full transition-all duration-200"
          >
            <X size={18} className="text-white/60" />
          </button>
        </div>

        {/* Episode List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {episodeQueue.map((episode, index) => {
            const isCurrent = episode.Id === currentItemId
            const isPast = index < currentEpisodeIndex

            return (
              <button
                key={episode.Id}
                onClick={() => { if (!isCurrent) onPlayEpisode(episode) }}
                disabled={isCurrent}
                className={`w-full flex gap-3 p-2.5 rounded-lg text-left transition-all duration-200 ${
                  isCurrent
                    ? 'bg-theme-500/20 cursor-default'
                    : isPast
                      ? 'opacity-50 hover:opacity-75 hover:bg-white/5'
                      : 'hover:bg-white/10 hover:scale-[1.01]'
                }`}
              >
                {/* Thumbnail */}
                <div className="relative w-20 aspect-video rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                  {getThumbnail(episode) ? (
                    <img src={getThumbnail(episode)!} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Play size={14} className="text-white/30" />
                    </div>
                  )}
                  {isCurrent && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <div className="w-3 h-3 bg-theme-500 rounded-full animate-pulse" />
                    </div>
                  )}
                  {episode.UserData?.Played && !isCurrent && (
                    <div className="absolute top-1 right-1 w-4 h-4 bg-theme-500 rounded-full flex items-center justify-center">
                      <Check size={10} className="text-white" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 py-0.5">
                  <p className="text-xs text-white/50 font-medium">E{episode.IndexNumber}</p>
                  <h4 className={`text-sm font-semibold truncate ${isCurrent ? 'text-theme-300' : 'text-white'}`}>
                    {episode.Name}
                  </h4>
                </div>

                {!isCurrent && !isPast && (
                  <ChevronRight size={16} className="text-white/30 self-center flex-shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default React.memo(QueuePanel)
