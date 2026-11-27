import React, { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  History, Loader2, AlertCircle, RefreshCw, Trash2, RotateCcw, Ban, Info, Download, ChevronRight, Bell,
} from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { useRequesterLive } from '../../../stores/requesterLiveStore'
import { useRequesterNav } from '../../../stores/requesterNavStore'
import { CANCELLABLE_STATUSES, RETRYABLE_STATUSES, FINISHED_STATUSES } from '../../../types/requester'
import type { DownloadRequest } from '../../../types/requester'
import { statusConfig, TYPE_ICON, IN_FLIGHT, formatWhen } from './statusConfig'
import { useRequestActions } from './useRequestActions'

type Filter = 'all' | 'mine' | 'pending' | 'active' | 'upcoming' | 'done' | 'failed'
const FILTERS: { id: Filter; label: string; adminOnly?: boolean }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine', adminOnly: true },
  { id: 'pending', label: 'Pending' },
  { id: 'active', label: 'Active' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'done', label: 'Done' },
  { id: 'failed', label: 'Failed' },
]

const FILTER_KEY = 'requesterRequestsFilter'

function matches(f: Filter, r: DownloadRequest, me: string | null): boolean {
  switch (f) {
    case 'all': return true
    case 'mine': return !me || r.user_id === me
    case 'pending': return r.status === 'pending'
    case 'active': return IN_FLIGHT.has(r.status)
    case 'upcoming': return r.status === 'upcoming'
    case 'done': return r.status === 'complete'
    case 'failed': return r.status === 'error' || r.status === 'partial' || r.status === 'not_found' || r.status === 'rejected'
  }
}

/** All requests (admins: everyone's) with filters, Load more, live progress and actions. */
export function RequestsSection() {
  const { isAdmin, userInfo } = useRequester()
  const live = useRequesterLive(useShallow(s => ({
    history: s.history, loading: s.loading, loadingMore: s.loadingMore, error: s.error, hasMore: s.hasMore,
    episodeProgress: s.episodeProgress, jobProgress: s.jobProgress, connected: s.connected,
  })))
  const push = useRequesterNav(s => s.push)
  const actions = useRequestActions()
  const [filter, setFilter] = useState<Filter>(() => {
    try { return (localStorage.getItem(FILTER_KEY) as Filter) || 'all' } catch { return 'all' }
  })

  // While the list is on screen, alerts don't add to the tab badge
  useEffect(() => {
    useRequesterLive.getState().setRequestsVisible(true)
    return () => useRequesterLive.getState().setRequestsVisible(false)
  }, [])

  const setF = (f: Filter) => {
    setFilter(f)
    try { localStorage.setItem(FILTER_KEY, f) } catch { /* ignore */ }
  }

  const me = userInfo?.username ?? null
  const rows = useMemo(() => live.history.filter(r => matches(filter, r, me)), [live.history, filter, me])
  const counts = useMemo(() => {
    const c: Partial<Record<Filter, number>> = {}
    for (const f of FILTERS) c[f.id] = live.history.filter(r => matches(f.id, r, me)).length
    return c
  }, [live.history, me])

  return (
    <div className="max-w-4xl mx-auto px-8 phone:px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2 flex-1">
          <History size={18} className="text-theme-400" /> Requests
          <span title={live.connected ? 'Live updates connected' : 'Live updates offline — refreshing periodically'}
            className={`w-2 h-2 rounded-full ${live.connected ? 'bg-emerald-400' : 'bg-white/20'}`} />
        </h2>
        <button type="button" onClick={() => push({ type: 'notifications' })} title="Notifications"
          className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white"><Bell size={16} /></button>
        <button type="button" onClick={() => useRequesterLive.getState().reload()} disabled={live.loading} title="Refresh"
          className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white">
          <RefreshCw size={16} className={live.loading ? 'animate-spin' : ''} />
        </button>
        <button type="button" onClick={() => actions.clearAll(isAdmin)}
          className="text-xs text-white/40 hover:text-white/70 px-2">Clear finished</button>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
        {FILTERS.filter(f => !f.adminOnly || isAdmin).map(f => (
          <button key={f.id} type="button" onClick={() => setF(f.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm border transition-colors ${
              filter === f.id ? 'border-theme-500/50 bg-theme-500/15 text-theme-300' : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
            }`}>
            {f.label}
            {!!counts[f.id] && f.id !== 'all' && <span className="ml-1.5 text-xs text-white/40">{counts[f.id]}</span>}
          </button>
        ))}
      </div>

      {live.error && live.history.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center space-y-3">
          <AlertCircle size={28} className="text-red-400/60 mx-auto" />
          <p className="text-sm text-white/60">Couldn't load the requests: {live.error}</p>
          <button onClick={() => useRequesterLive.getState().reload()}
            className="px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 rounded-lg text-white/80">Retry</button>
        </div>
      ) : live.loading && live.history.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-white/40" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center text-sm text-white/40">
          {filter === 'all' ? 'No requests yet' : 'Nothing here'}
        </div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
          {rows.map(r => (
            <RequestRow key={r.id} r={r}
              isAdmin={isAdmin}
              showUser={isAdmin && r.user_id !== me}
              episodePct={activeEpisodePct(live.episodeProgress[r.id])}
              jobPct={live.jobProgress[r.id]?.pct}
              busy={actions.busyId === r.id}
              onOpen={() => push({ type: 'request', id: r.id })}
              onCancel={() => actions.cancel(r.id)}
              onRetry={() => actions.retry(r.id)}
              onError={() => actions.showError(r.id)}
              onDelete={() => actions.remove(r.id)} />
          ))}
        </div>
      )}

      {live.hasMore && (
        <div className="flex justify-center">
          <button type="button" onClick={() => useRequesterLive.getState().loadMore()} disabled={live.loadingMore}
            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm text-white/80 disabled:opacity-50">
            {live.loadingMore ? <Loader2 size={16} className="animate-spin" /> : 'Load more'}
          </button>
        </div>
      )}
      {actions.confirmUi}
    </div>
  )
}

function activeEpisodePct(eps: { ep_status: string; pct?: number; progress?: number; episode: string }[] | undefined) {
  const ep = eps?.find(e => e.ep_status === 'downloading')
  return ep ? { episode: ep.episode, pct: ep.pct ?? ep.progress ?? 0 } : null
}

function RequestRow({ r, isAdmin, showUser, episodePct, jobPct, busy, onOpen, onCancel, onRetry, onError, onDelete }: {
  r: DownloadRequest
  isAdmin: boolean
  showUser: boolean
  episodePct: { episode: string; pct: number } | null
  jobPct?: number
  busy: boolean
  onOpen: () => void
  onCancel: () => void
  onRetry: () => void
  onError: () => void
  onDelete: () => void
}) {
  const st = statusConfig(r.status)
  const pct = episodePct?.pct ?? (r.status === 'downloading' ? jobPct : undefined)
  const iconBtn = 'p-1.5 rounded transition-colors text-white/30 flex-shrink-0'
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <button type="button" onClick={onOpen} className="flex items-center gap-3 flex-1 min-w-0 text-left" data-press="">
        <div className="w-10 h-14 rounded-md overflow-hidden bg-white/5 flex-shrink-0 flex items-center justify-center text-white/30">
          {r.poster_url
            ? <img src={r.poster_url} alt="" loading="lazy" className="w-full h-full object-cover" />
            : (TYPE_ICON[r.typ] ?? <Download size={14} />)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white/90 truncate">{r.title ?? r.slug ?? r.url ?? '—'}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${st.chip}`}>{st.icon}{st.label}</span>
            <span className="text-xs text-white/30 truncate">
              {[r.season != null ? `S${r.season}` : null, r.lang, showUser ? r.user_id : null, formatWhen(r.requested_at)].filter(Boolean).join(' · ')}
            </span>
          </div>
          {typeof pct === 'number' && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 bg-white/10 rounded-full h-1">
                <div className="bg-theme-500 h-1 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <span className="text-[10px] text-white/40">{episodePct ? `${episodePct.episode} · ` : ''}{Math.round(pct)}%</span>
            </div>
          )}
        </div>
      </button>
      <div className="flex items-center">
        {isAdmin && (r.status === 'error' || r.status === 'partial') && (
          <button onClick={onError} disabled={busy} title="Error details" className={`${iconBtn} hover:bg-white/10 hover:text-white/70 phone:hidden`}><Info size={13} /></button>
        )}
        {isAdmin && RETRYABLE_STATUSES.has(r.status) && (
          <button onClick={onRetry} disabled={busy} title="Retry" className={`${iconBtn} hover:bg-white/10 hover:text-theme-400`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
          </button>
        )}
        {isAdmin && CANCELLABLE_STATUSES.has(r.status) && (
          <button onClick={onCancel} disabled={busy} title="Cancel" className={`${iconBtn} hover:bg-red-500/20 hover:text-red-400`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
          </button>
        )}
        {FINISHED_STATUSES.has(r.status) && (
          <button onClick={onDelete} disabled={busy} title="Remove from history" className={`${iconBtn} hover:bg-red-500/20 hover:text-red-400 phone:hidden`}>
            <Trash2 size={13} />
          </button>
        )}
        <ChevronRight size={16} className="text-white/20 ml-1 hidden phone:block" />
      </div>
    </div>
  )
}
