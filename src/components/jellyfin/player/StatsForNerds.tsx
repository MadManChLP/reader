import React from 'react'
import { X } from 'lucide-react'
import type { PlayMethod } from './types'

export interface VideoStats {
  resolution: string
  videoCodec: string
  audioCodec: string
  container: string
  bitrate: number
  playMethod: PlayMethod
  buffered: number
  droppedFrames: number
  decodedFrames: number
}

interface StatsForNerdsProps {
  visible: boolean
  stats: VideoStats | null
  itemId?: string
  mediaSourceId: string | null
  playSessionId: string | null
  playMethod: PlayMethod
  volume: number
  isMuted: boolean
  onClose: () => void
}

const StatsForNerds: React.FC<StatsForNerdsProps> = ({
  visible,
  stats,
  itemId,
  mediaSourceId,
  playSessionId,
  playMethod,
  volume,
  isMuted,
  onClose,
}) => {
  if (!visible || !stats) return null

  return (
    <div
      className="absolute top-8 left-8 z-[100] p-4 text-[0.8rem] font-mono max-w-[400px]"
      style={{
        background: 'rgba(20, 20, 20, 0.6)',
        backdropFilter: 'blur(16px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        color: 'white',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold">Stats for Nerds</span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-white/10 rounded-full transition-all duration-200"
        >
          <X size={14} className="text-white/60" />
        </button>
      </div>
      <div className="grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: 'auto 1fr' }}>
        <span className="text-white/50">Video ID:</span>
        <span className="truncate">{itemId}</span>
        <span className="text-white/50">Media Source ID:</span>
        <span className="truncate">{mediaSourceId || '-'}</span>
        <span className="text-white/50">Play Session ID:</span>
        <span className="truncate">{playSessionId || '-'}</span>
        <span className="text-white/50">Playback Method:</span>
        <span className={`font-semibold ${playMethod === 'DirectPlay' ? 'text-green-400' : playMethod === 'Transcode' ? 'text-amber-400' : 'text-sky-400'}`}>
          {playMethod}
        </span>
        <span className="text-white/50">Container:</span>
        <span>{stats.container}</span>
        <span className="text-white/50">Video Codec:</span>
        <span>{stats.videoCodec}</span>
        <span className="text-white/50">Audio Codec:</span>
        <span>{stats.audioCodec}</span>
        <span className="text-white/50">Resolution:</span>
        <span>{stats.resolution}</span>
        <span className="text-white/50">Volume:</span>
        <span>{Math.round((isMuted ? 0 : volume) * 100)}%</span>
        <span className="text-white/50">Buffer Health:</span>
        <span>{stats.buffered}s</span>
        <span className="text-white/50">Dropped Frames:</span>
        <span>
          {stats.droppedFrames} / {stats.decodedFrames}
        </span>
      </div>
    </div>
  )
}

export default React.memo(StatsForNerds)
