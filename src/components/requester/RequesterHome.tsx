import React, { useState, useEffect, useRef, useCallback, memo } from 'react'
import {
  Clapperboard, Tv2, Film, Youtube, Music, History, Trash2, Loader2,
  CheckCircle2, XCircle, Clock, Download, AlertCircle, RefreshCw, X,
} from 'lucide-react'
import { useRequester } from './RequesterContext'
import { AnimeSerieForm } from './forms/AnimeSerieForm'
import { MovieForm } from './forms/MovieForm'
import { YouTubeForm } from './forms/YouTubeForm'
import { MusicForm } from './forms/MusicForm'
import { AdminPanel } from './admin/AdminPanel'
import {
  getHistory, deleteHistoryEntry, clearHistory as apiClearHistory,
  buildWebSocketUrl,
} from '../../utils/requesterApi'
import type { DownloadRequest, WsEvent, EpisodeUpdateEvent, DownloadStatus } from '../../types/requester'

type MediaType = 'anime' | 'serie' | 'movie' | 'youtube' | 'music'

const TABS: { type: MediaType; label: string; icon: React.ReactNode; color: string }[] = [
  { type: 'anime', label: 'Anime', icon: <Clapperboard size={18} />, color: 'purple' },
  { type: 'serie', label: 'Serie', icon: <Tv2 size={18} />, color: 'blue' },
  { type: 'movie', label: 'Movie', icon: <Film size={18} />, color: 'amber' },
  { type: 'youtube', label: 'YouTube', icon: <Youtube size={18} />, color: 'red' },
  { type: 'music', label: 'Music', icon: <Music size={18} />, color: 'pink' },
]

const TAB_ACTIVE: Record<string, string> = {
  purple: 'border-purple-500/50 bg-purple-500/10 text-purple-400',
  blue: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
  amber: 'border-amber-500/50 bg-amber-500/10 text-amber-400',
  red: 'border-red-500/50 bg-red-500/10 text-red-400',
  pink: 'border-pink-500/50 bg-pink-500/10 text-pink-400',
}

const STATUS_CONFIG: Record<DownloadStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:     { label: 'Pending',     color: 'text-yellow-400', icon: <Clock size={14} /> },
  approved:    { label: 'Approved',    color: 'text-blue-400',   icon: <CheckCircle2 size={14} /> },
  queued:      { label: 'Queued',      color: 'text-blue-400',   icon: <Clock size={14} /> },
  downloading: { label: 'Downloading', color: 'text-theme-400',icon: <Download size={14} /> },
  complete:    { label: 'Complete',    color: 'text-theme-400',icon: <CheckCircle2 size={14} /> },
  error:       { label: 'Error',       color: 'text-red-400',    icon: <AlertCircle size={14} /> },
  rejected:    { label: 'Rejected',    color: 'text-red-400',    icon: <XCircle size={14} /> },
  cancelled:   { label: 'Cancelled',   color: 'text-white/40',   icon: <X size={14} /> },
}

const TERMINAL: Set<DownloadStatus> = new Set(['complete', 'error', 'rejected', 'cancelled'])

const TYPE_ICON: Record<string, React.ReactNode> = {
  anime:   <Clapperboard size={14} />,
  serie:   <Tv2 size={14} />,
  movie:   <Film size={14} />,
  youtube: <Youtube size={14} />,
  music:   <Music size={14} />,
}

// ── History Panel ─────────────────────────────────────────────────────────────

interface HistoryPanelProps {
  entries: DownloadRequest[]
  episodeProgress: Map<number, EpisodeUpdateEvent[]>
  onDelete: (id: number) => void
  onClear: () => void
  onRefresh: () => void
  loading: boolean
  deletingId: number | null
  clearing: boolean
}

function HistoryPanel({
  entries, episodeProgress, onDelete, onClear, onRefresh, loading, deletingId, clearing,
}: HistoryPanelProps) {
  if (loading && entries.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={20} className="animate-spin text-white/40" />
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
        <History size={28} className="text-white/20 mx-auto mb-2" />
        <p className="text-sm text-white/40">No download history yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-white/80 flex items-center gap-2">
          <History size={16} />
          Download History
        </h4>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} disabled={loading}
            className="p-1 hover:bg-white/10 rounded transition-colors">
            <RefreshCw size={14} className={`text-white/40 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onClear} disabled={clearing}
            className="text-xs text-white/40 hover:text-white/60 transition-colors">
            {clearing ? 'Clearing...' : 'Clear all'}
          </button>
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
        {entries.map(entry => {
          const status = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.pending
          const isTerminal = TERMINAL.has(entry.status)
          const episodes = episodeProgress.get(entry.id) ?? []
          const activeEp = episodes.find(e => e.ep_status === 'downloading')

          return (
            <div key={entry.id} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
              <span className="text-white/30 mt-0.5">{TYPE_ICON[entry.typ] ?? <Download size={14} />}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-white/90 truncate">{entry.title ?? entry.slug ?? entry.url ?? '—'}</p>
                  <span className={`flex items-center gap-1 text-xs ${status.color}`}>
                    {status.icon}
                    {status.label}
                  </span>
                </div>

                {/* Active episode progress */}
                {activeEp && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center justify-between text-xs text-white/50">
                      <span>{activeEp.episode}</span>
                      <span>{activeEp.speed} · {activeEp.eta}</span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-1">
                      <div
                        className="bg-theme-500 h-1 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, activeEp.progress)}%` }}
                      />
                    </div>
                  </div>
                )}

                <p className="text-xs text-white/30 mt-0.5">
                  {entry.lang && <>{entry.lang} · </>}
                  {new Date(entry.requested_at).toLocaleString()}
                </p>
              </div>

              {isTerminal && (
                <button
                  onClick={() => onDelete(entry.id)}
                  disabled={deletingId === entry.id}
                  className="p-1.5 hover:bg-red-500/20 rounded transition-colors text-white/30 hover:text-red-400 flex-shrink-0"
                >
                  {deletingId === entry.id
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Trash2 size={12} />}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── RequesterHome ─────────────────────────────────────────────────────────────

export const RequesterHome = memo(function RequesterHome() {
  const { serverUrl, token, isAdmin } = useRequester()
  const [activeTab, setActiveTab] = useState<MediaType>('anime')
  const [isWide, setIsWide] = useState(false)

  // History state
  const [history, setHistory] = useState<DownloadRequest[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)

  // WebSocket episode progress: requestId → latest updates per episode
  const [episodeProgress, setEpisodeProgress] = useState<Map<number, EpisodeUpdateEvent[]>>(new Map())
  const wsRef = useRef<WebSocket | null>(null)

  const loadHistory = useCallback(async () => {
    if (!serverUrl || !token) return
    setHistoryLoading(true)
    const data = await getHistory(serverUrl, token, 50)
    setHistory(data)
    setHistoryLoading(false)
  }, [serverUrl, token])

  useEffect(() => { loadHistory() }, [loadHistory])

  // WebSocket for live progress
  useEffect(() => {
    if (!serverUrl || !token) return

    const wsUrl = buildWebSocketUrl(serverUrl, token)
    let ws: WebSocket

    try {
      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WsEvent

          if (data.type === 'queue_update') {
            setHistory(prev =>
              prev.map(h => h.id === data.request_id ? { ...h, status: data.status } : h)
            )
            // If newly appeared (from another session), reload
            if (!history.some(h => h.id === data.request_id)) {
              loadHistory()
            }
          } else if (data.type === 'episode_update') {
            setEpisodeProgress(prev => {
              const next = new Map(prev)
              const existing = next.get(data.request_id) ?? []
              const filtered = existing.filter(e => e.episode !== data.episode)
              next.set(data.request_id, [...filtered, data])
              return next
            })
          } else if (data.type === 'season_update') {
            // Reload history to get fresh status
            loadHistory()
          }
        } catch { /* malformed message */ }
      }

      ws.onerror = () => { /* silent — fall back to manual refresh */ }
      ws.onclose = () => { wsRef.current = null }
    } catch { /* WebSocket not available */ }

    return () => {
      ws?.close()
      wsRef.current = null
    }
  }, [serverUrl, token]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll history every 15s if there are active downloads (fallback for failed WS)
  useEffect(() => {
    const hasActive = history.some(h => !TERMINAL.has(h.status))
    if (!hasActive) return
    const interval = setInterval(loadHistory, 15000)
    return () => clearInterval(interval)
  }, [history, loadHistory])

  const handleDelete = async (id: number) => {
    if (!serverUrl || !token) return
    setDeletingId(id)
    await deleteHistoryEntry(serverUrl, token, id)
    setHistory(prev => prev.filter(h => h.id !== id))
    setDeletingId(null)
  }

  const handleClear = async () => {
    if (!serverUrl || !token) return
    setClearing(true)
    await apiClearHistory(serverUrl, token)
    await loadHistory()
    setClearing(false)
  }

  const renderForm = () => {
    switch (activeTab) {
      case 'anime': return <AnimeSerieForm type="anime" onExpand={setIsWide} />
      case 'serie': return <AnimeSerieForm type="serie" onExpand={setIsWide} />
      case 'movie': return <MovieForm />
      case 'youtube': return <YouTubeForm />
      case 'music': return <MusicForm />
    }
  }

  return (
    <div className={`mx-auto p-8 space-y-8 pb-20 transition-all duration-300 ${isWide ? 'max-w-5xl' : 'max-w-2xl'}`}>
      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(tab => {
          const isActive = activeTab === tab.type
          return (
            <button
              key={tab.type}
              onClick={() => { setActiveTab(tab.type); setIsWide(false) }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                isActive ? TAB_ACTIVE[tab.color] : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              {tab.icon}
              <span className="font-medium">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Form area */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        {renderForm()}
      </div>

      {/* Admin Panel */}
      {isAdmin && <AdminPanel />}

      {/* Download History */}
      <HistoryPanel
        entries={history}
        episodeProgress={episodeProgress}
        onDelete={handleDelete}
        onClear={handleClear}
        onRefresh={loadHistory}
        loading={historyLoading}
        deletingId={deletingId}
        clearing={clearing}
      />
    </div>
  )
})
