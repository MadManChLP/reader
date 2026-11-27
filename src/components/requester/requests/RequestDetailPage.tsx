import React, { useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  Loader2, RotateCcw, Ban, Info, Trash2, Send, CheckCircle2, Clock, Download, Flag, ExternalLink, X, ListChecks, Layers,
} from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { PageHeader } from '../discover/PageHeader'
import { useRequesterLive } from '../../../stores/requesterLiveStore'
import { useRequesterNav } from '../../../stores/requesterNavStore'
import { CANCELLABLE_STATUSES, RETRYABLE_STATUSES, FINISHED_STATUSES } from '../../../types/requester'
import { statusConfig, TYPE_LABEL } from './statusConfig'
import { useRequestActions } from './useRequestActions'
import api from '../../../utils/api'
import { needsReleasePick } from '../../../utils/requesterBooksApi'

const VOL_STAGE: Record<string, { label: string; className: string }> = {
  queued: { label: 'Waiting for a hoster slot', className: 'text-white/50' },
  starting: { label: 'Starting', className: 'text-white/50' },
  waiting: { label: 'Hoster wait', className: 'text-amber-300' },
  downloading: { label: 'Downloading', className: 'text-theme-300' },
  processing: { label: 'Unpacking', className: 'text-sky-300' },
  done: { label: 'Done', className: 'text-emerald-300' },
  failed: { label: 'Failed', className: 'text-red-300' },
}

const EP_STATUS: Record<string, string> = {
  starting: 'text-white/50', downloading: 'text-theme-300', complete: 'text-emerald-300',
  skipped: 'text-white/40', unavailable: 'text-amber-300', error: 'text-red-300', cancelled: 'text-white/40',
}

/** One request: status timeline, per-episode progress, actions. */
export function RequestDetailPage({ id }: { id: number }) {
  const { isAdmin } = useRequester()
  const { req, episodes, job, volumes } = useRequesterLive(useShallow(s => ({
    req: s.history.find(h => h.id === id),
    episodes: s.episodeProgress[id],
    job: s.jobProgress[id],
    volumes: s.volumeProgress[id],
  })))
  const { push, pop } = useRequesterNav(useShallow(s => ({ push: s.push, pop: s.pop })))
  const actions = useRequestActions()

  const sortedEpisodes = useMemo(
    () => [...(episodes ?? [])].sort((a, b) => a.episode.localeCompare(b.episode, undefined, { numeric: true })),
    [episodes],
  )

  const sortedVolumes = useMemo(
    () => Object.values(volumes ?? {}).sort((a, b) =>
      (a.item ?? 0) - (b.item ?? 0) || String(a.volume ?? a.key).localeCompare(String(b.volume ?? b.key), undefined, { numeric: true })),
    [volumes],
  )

  if (!req) {
    return (
      <div>
        <PageHeader title="Request" />
        <p className="px-8 phone:px-4 text-sm text-white/40">This request is no longer in the loaded history.</p>
      </div>
    )
  }

  const st = statusConfig(req.status)
  const title = req.title ?? req.slug ?? req.url ?? 'Request'
  const canOpenTitle = !!req.slug && (req.typ === 'anime' || req.typ === 'serie')
  const timeline: { label: string; at: string | null | undefined; icon: React.ReactNode; note?: string | null }[] = [
    { label: 'Requested', at: req.requested_at, icon: <Send size={12} />, note: isAdmin ? `by ${req.user_id}` : null },
    { label: 'Approved', at: req.approved_at, icon: <CheckCircle2 size={12} />, note: req.approved_by ? `by ${req.approved_by.replace(/^discord:/, 'Discord · ')}` : null },
    { label: FINISHED_STATUSES.has(req.status) ? st.label : 'Finished', at: req.completed_at, icon: <Flag size={12} /> },
  ]

  return (
    <div className="pb-12 max-w-3xl">
      <PageHeader title={title} subtitle={TYPE_LABEL[req.typ] ?? req.typ} />
      <div className="px-8 phone:px-4 space-y-5">
        <div className="flex gap-4">
          {req.poster_url && <img src={req.poster_url} alt="" className="w-24 h-36 object-cover rounded-lg flex-shrink-0" />}
          <div className="min-w-0 space-y-2">
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${st.chip}`}>{st.icon}{st.label}</span>
            <p className="text-sm text-white/60">
              {[req.season != null ? `Season ${req.season}` : (req.typ === 'anime' || req.typ === 'serie') ? 'All seasons' : null, req.lang]
                .filter(Boolean).join(' · ')}
            </p>
            {req.status === 'retrying' && req.next_retry_at && (
              <p className="text-xs text-amber-300/80">
                Next try {new Date(req.next_retry_at).toLocaleString()}{req.retry_count ? ` (attempt ${req.retry_count + 1})` : ''}
              </p>
            )}
            {req.error_message && <p className="text-xs text-red-300/80 whitespace-pre-line">{req.error_message}</p>}
            {req.status === 'downloading' && job?.stage && sortedVolumes.length === 0 && (
              <p className="text-xs text-white/50">{job.stage}{job.mirror ? ` · ${job.mirror}` : ''}</p>
            )}
            {req.status === 'downloading' && typeof job?.pct === 'number' && sortedVolumes.length === 0 && (
              <div className="space-y-1 max-w-sm">
                <div className="flex justify-between text-xs text-white/50">
                  <span>{Math.round(job.pct)}%</span><span>{[job.speed, job.eta].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="bg-white/10 rounded-full h-1.5">
                  <div className="bg-theme-500 h-1.5 rounded-full transition-all" style={{ width: `${Math.min(100, job.pct)}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {isAdmin && req.status === 'pending' && needsReleasePick(req.typ) && (
            <button type="button" onClick={() => push({ type: 'release', id })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-sm">
              <ListChecks size={14} /> Pick release
            </button>
          )}
          {canOpenTitle && (
            <button type="button" onClick={() => push({ type: 'title', kind: req.typ === 'serie' ? 'series' : 'anime', slug: req.slug!, title, poster: req.poster_url })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
              <ExternalLink size={14} /> Open title
            </button>
          )}
          {req.typ === 'youtube' && req.url && (
            <button type="button" onClick={() => void api.openExternal(req.url!)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
              <ExternalLink size={14} /> Open link
            </button>
          )}
          {isAdmin && RETRYABLE_STATUSES.has(req.status) && (
            <button type="button" onClick={() => actions.retry(id)} disabled={actions.busyId === id}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-theme-600/80 hover:bg-theme-500 text-sm disabled:opacity-50">
              {actions.busyId === id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Retry
            </button>
          )}
          {isAdmin && (req.status === 'error' || req.status === 'partial') && (
            <button type="button" onClick={() => actions.showError(id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
              <Info size={14} /> Why it failed
            </button>
          )}
          {isAdmin && CANCELLABLE_STATUSES.has(req.status) && (
            <button type="button" onClick={() => actions.cancel(id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 text-sm">
              <Ban size={14} /> Cancel
            </button>
          )}
          {FINISHED_STATUSES.has(req.status) && (
            <button type="button" onClick={async () => { if (await actions.remove(id)) pop() }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-300 text-white/60 text-sm">
              <Trash2 size={14} /> Remove
            </button>
          )}
        </div>

        {/* Timeline */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white/80 mb-3">Timeline</h3>
          <ol className="space-y-3">
            {timeline.map(t => (
              <li key={t.label} className={`flex items-start gap-3 ${t.at ? '' : 'opacity-40'}`}>
                <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center ${t.at ? 'bg-theme-500/30 text-theme-200' : 'bg-white/10 text-white/40'}`}>{t.icon}</span>
                <div>
                  <p className="text-sm text-white/80">{t.label}</p>
                  <p className="text-xs text-white/40">{t.at ? new Date(t.at).toLocaleString() : '—'}{t.note && t.at ? ` · ${t.note}` : ''}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Volumes / files of a forum download (live) */}
        {sortedVolumes.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
              <Layers size={14} /> {req.typ === 'manga' ? 'Volumes' : 'Files'}
              {sortedVolumes[0]?.items ? <span className="text-white/40 font-normal">({sortedVolumes[0].items})</span> : null}
            </h3>
            <ul className="space-y-2">
              {sortedVolumes.map(v => {
                const st = VOL_STAGE[v.stage ?? ''] ?? { label: v.stage ?? '', className: 'text-white/50' }
                const pct = v.percent ?? (v.total ? ((v.bytes ?? 0) / v.total) * 100 : undefined)
                return (
                  <li key={v.key} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-white/60 w-16 flex-shrink-0">
                      {v.volume != null ? (req.typ === 'manga' ? `Vol. ${v.volume}` : `#${v.volume}`) : v.key}
                    </span>
                    <div className="flex-1 min-w-0">
                      {v.stage === 'downloading' && typeof pct === 'number' ? (
                        <div className="bg-white/10 rounded-full h-1">
                          <div className="bg-theme-500 h-1 rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      ) : (
                        <span className={`text-xs ${st.className}`}>{st.label}{v.message ? ` — ${v.message}` : ''}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-white/40 w-24 text-right truncate">
                      {v.stage === 'downloading' ? [typeof pct === 'number' ? `${Math.round(pct)}%` : null, v.speed].filter(Boolean).join(' · ') : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="text-[11px] text-white/30 mt-3 flex items-center gap-1"><Clock size={11} /> Live while this app is open</p>
          </div>
        )}

        {/* Episodes (live) */}
        {sortedEpisodes.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2"><Download size={14} /> Episodes</h3>
            <ul className="space-y-2">
              {sortedEpisodes.map(ep => {
                const pct = ep.pct ?? ep.progress
                const running = ep.ep_status === 'downloading' || ep.ep_status === 'starting'
                return (
                  <li key={ep.episode} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-white/60 w-16 flex-shrink-0">{ep.episode}</span>
                    <div className="flex-1 min-w-0">
                      {ep.ep_status === 'downloading' && typeof pct === 'number' ? (
                        <div className="bg-white/10 rounded-full h-1">
                          <div className="bg-theme-500 h-1 rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      ) : (
                        <span className={`text-xs ${EP_STATUS[ep.ep_status] ?? 'text-white/50'}`}>
                          {ep.ep_status}{ep.reason ? ` — ${ep.reason}` : ''}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-white/40 w-24 text-right truncate">
                      {ep.ep_status === 'downloading' ? [ep.speed, ep.eta].filter(Boolean).join(' · ') : ''}
                    </span>
                    {isAdmin && running && (
                      <button type="button" onClick={() => actions.cancel(id, ep.episode)} title={`Cancel ${ep.episode}`}
                        className="p-1 rounded hover:bg-red-500/20 text-white/30 hover:text-red-300"><X size={12} /></button>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="text-[11px] text-white/30 mt-3 flex items-center gap-1"><Clock size={11} /> Live while this app is open</p>
          </div>
        )}
      </div>
      {actions.confirmUi}
    </div>
  )
}
