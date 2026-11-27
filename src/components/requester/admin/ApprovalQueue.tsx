import React, { useCallback, useEffect, useState } from 'react'
import { Check, X, Loader2, RefreshCw, Inbox, AlertCircle, ListChecks } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { getPendingRequests, decideRequest } from '../../../utils/requesterApi'
import type { DownloadRequest } from '../../../types/requester'
import { useConfirm } from '../../ConfirmDialog'
import { needsReleasePick } from '../../../utils/requesterBooksApi'
import { useRequesterNav } from '../../../stores/requesterNavStore'
import { TYPE_LABEL } from '../requests/statusConfig'

// Admin approval queue. The server holds non-admin requests at "pending"
// until an admin approves or rejects them (GET /api/admin/requests,
// POST /api/download/{id}/approve|reject) — before this the app had no way
// to act on them, so other users' requests waited forever.

function describe(r: DownloadRequest): string {
  const parts = [TYPE_LABEL[r.typ] ?? r.typ]
  if (r.season !== null && r.season !== undefined) parts.push(`Season ${r.season}`)
  if (r.lang) parts.push(r.lang)
  return parts.join(' · ')
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const min = Math.round(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export function ApprovalQueue() {
  const { serverUrl, token } = useRequester()
  const [pending, setPending] = useState<DownloadRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!serverUrl || !token) return
    setLoading(true)
    setPending(await getPendingRequests(serverUrl, token))
    setLoading(false)
  }, [serverUrl, token])

  useEffect(() => { void load() }, [load])

  // Keep it current while the panel is open (new requests arrive any time)
  useEffect(() => {
    const t = setInterval(() => { void load() }, 60_000)
    return () => clearInterval(t)
  }, [load])

  const [confirm, confirmUi] = useConfirm()
  const push = useRequesterNav(s => s.push)

  const decide = async (r: DownloadRequest, decision: 'approve' | 'reject') => {
    if (!serverUrl || !token || busyId !== null) return
    if (decision === 'reject' && !(await confirm({
      title: 'Reject this request?',
      message: `${r.title || r.slug || r.url} — requested by ${r.user_id}`,
      confirmLabel: 'Reject',
      destructive: true,
    }))) return
    setBusyId(r.id)
    setError(null)
    const failure = await decideRequest(serverUrl, token, r.id, decision)
    setBusyId(null)
    if (failure) {
      setError(`Could not ${decision} "${r.title || r.id}": ${failure}`)
      void load() // the request may already have been handled elsewhere
      return
    }
    setPending(list => list.filter(p => p.id !== r.id))
  }

  return (
    <div className="mb-6">
      {confirmUi}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-white/80">
          Pending approval {pending.length > 0 && <span className="text-amber-400">({pending.length})</span>}
        </h4>
        <button
          onClick={() => void load()}
          className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white"
          title="Refresh"
          aria-label="Refresh pending requests"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading && pending.length === 0 ? (
        <div className="space-y-2">
          {[0, 1].map(i => <div key={i} className="h-14 rounded-lg bg-white/10 animate-pulse" />)}
        </div>
      ) : pending.length === 0 ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5 text-sm text-white/40">
          <Inbox size={16} /> No requests waiting for approval
        </div>
      ) : (
        <ul className="space-y-2">
          {pending.map(r => (
            <li key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
              {r.poster_url ? (
                <img src={r.poster_url} alt="" className="w-9 h-12 object-cover rounded flex-shrink-0" loading="lazy" />
              ) : (
                <div className="w-9 h-12 rounded bg-white/10 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-white truncate">{r.title || r.slug || r.url || `Request #${r.id}`}</div>
                <div className="text-xs text-white/40 truncate">
                  {describe(r)} · {r.user_id} · {timeAgo(r.requested_at)}
                </div>
              </div>
              {busyId === r.id ? (
                <Loader2 size={18} className="animate-spin text-white/60 flex-shrink-0" />
              ) : (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {needsReleasePick(r.typ) ? (
                    // Books / manga: the release is picked first (plain approve = 409)
                    <button
                      onClick={() => push({ type: 'release', id: r.id })}
                      disabled={busyId !== null}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs disabled:opacity-40"
                      aria-label={`Pick a release for ${r.title || r.id}`}
                    >
                      <ListChecks size={14} /> <span className="phone:hidden">Pick release</span>
                    </button>
                  ) : (
                  <button
                    onClick={() => void decide(r, 'approve')}
                    disabled={busyId !== null}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs disabled:opacity-40"
                    aria-label={`Approve ${r.title || r.id}`}
                  >
                    <Check size={14} /> <span className="phone:hidden">Approve</span>
                  </button>
                  )}
                  <button
                    onClick={() => void decide(r, 'reject')}
                    disabled={busyId !== null}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs disabled:opacity-40"
                    aria-label={`Reject ${r.title || r.id}`}
                  >
                    <X size={14} /> <span className="phone:hidden">Reject</span>
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
