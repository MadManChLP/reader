import React, { useCallback, useEffect, useState } from 'react'
import { Eye, RefreshCw, Loader2, Pause, Play, Trash2, Send, CheckCheck, AlertCircle, ExternalLink, BookImage } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { useToast } from '../../Toast'
import { useConfirm } from '../../ConfirmDialog'
import { useRequesterNav } from '../../../stores/requesterNavStore'
import { useRequesterLive } from '../../../stores/requesterLiveStore'
import { requesterErrorMessage } from '../../../utils/requesterApi'
import {
  getMonitors, checkAllMonitors, checkMonitor, updateMonitor, dismissMonitor, deleteMonitor, requestMonitorVolumes,
} from '../../../utils/requesterBooksApi'
import { formatWhen } from '../requests/statusConfig'
import api from '../../../utils/api'
import type { MangaMonitor } from '../../../types/requesterBooks'

const STATUS_CHIP: Record<string, string> = {
  new: 'bg-white/10 text-white/60',
  ok: 'bg-emerald-500/15 text-emerald-300',
  found: 'bg-amber-500/20 text-amber-300',
  error: 'bg-red-500/15 text-red-300',
}
const STATUS_LABEL: Record<string, string> = { new: 'First check…', ok: 'Up to date', found: 'New volumes', error: 'Error' }

/**
 * Admin: manga series / forum threads watched for new volumes. Monitors are
 * added from the Search → Manga tab ("Watch for new volumes"); attaching
 * threads by link and the ignore list stay in the server's web UI.
 */
export function MangaMonitors() {
  const { serverUrl, token } = useRequester()
  const toast = useToast()
  const [confirm, confirmUi] = useConfirm()
  const push = useRequesterNav(s => s.push)
  const [monitors, setMonitors] = useState<MangaMonitor[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!serverUrl || !token) return
    setLoading(true)
    try {
      setMonitors(await getMonitors(serverUrl, token))
      setError(null)
    } catch (e) {
      setError(requesterErrorMessage(e, 'Could not load the monitors'))
    }
    setLoading(false)
  }, [serverUrl, token])

  useEffect(() => { void load() }, [load])

  const replace = (m: MangaMonitor) => setMonitors(list => (list ?? []).map(x => (x.id === m.id ? m : x)))

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn() } catch (e) { toast.error(requesterErrorMessage(e, 'Failed')) }
    setBusy(null)
  }

  if (!serverUrl || !token) return null
  // The server answers 404/409 when no forum is set up — hide the block then
  if (error && !monitors) {
    return (
      <div className="mt-6">
        <h4 className="text-sm font-semibold text-white/80 mb-2 flex items-center gap-2"><Eye size={14} /> Manga monitors</h4>
        <p className="text-xs text-white/40 flex items-center gap-2"><AlertCircle size={12} />{error}</p>
      </div>
    )
  }

  return (
    <div className="mt-6">
      {confirmUi}
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-semibold text-white/80 flex-1 flex items-center gap-2">
          <Eye size={14} /> Manga monitors {monitors && monitors.length > 0 && <span className="text-white/40">({monitors.length})</span>}
        </h4>
        <button type="button" disabled={busy === 'all'}
          onClick={() => run('all', async () => { await checkAllMonitors(serverUrl, token); toast.info('Checking all monitors in the background') })}
          className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50">Check all</button>
        <button type="button" onClick={() => void load()} title="Refresh" className="p-1.5 rounded-lg hover:bg-white/10 text-white/50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {monitors && monitors.length === 0 && (
        <p className="text-xs text-white/40 p-3 rounded-lg bg-white/5">
          Nothing watched yet. Search a manga under Search → Manga and choose “Watch for new volumes”.
        </p>
      )}

      <ul className="space-y-2">
        {(monitors ?? []).map(m => (
          <li key={m.id} className={`p-3 rounded-lg border ${m.status === 'found' ? 'bg-amber-500/5 border-amber-500/30' : 'bg-white/5 border-white/10'} ${m.paused ? 'opacity-60' : ''}`}>
            <div className="flex gap-3">
              {m.poster_url
                ? <img src={m.poster_url} alt="" loading="lazy" className="w-10 h-14 object-cover rounded flex-shrink-0" />
                : <div className="w-10 h-14 rounded bg-white/10 flex items-center justify-center flex-shrink-0"><BookImage size={16} className="text-white/30" /></div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm text-white truncate">{m.title}</p>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_CHIP[m.status] ?? STATUS_CHIP.new}`}>{STATUS_LABEL[m.status] ?? m.status}</span>
                  {m.paused && <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-white/50">Paused</span>}
                </div>
                <p className="text-xs text-white/40">
                  {m.threads.length} thread{m.threads.length === 1 ? '' : 's'}
                  {m.query ? ` · searching “${m.query}”` : ''}
                  {m.last_checked ? ` · checked ${formatWhen(m.last_checked)}` : ''}
                </p>
                {m.last_error && <p className="text-xs text-red-300/80 mt-0.5">{m.last_error}</p>}
                {m.found.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {m.found.map(f => (
                      <li key={`${f.source}:${f.thread_id}`} className="text-xs text-amber-200/90">
                        {f.label ?? (f.volumes?.length ? `Vol. ${f.volumes.join(', ')}` : 'New')}
                        <span className="text-white/40"> — {f.new_thread ? 'new thread: ' : ''}{f.title ?? `${f.source} ${f.thread_id}`}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {m.found.length > 0 && (
                <>
                  <button type="button" disabled={busy === `r${m.id}`}
                    onClick={() => run(`r${m.id}`, async () => {
                      const r = await requestMonitorVolumes(serverUrl, token, m.id)
                      void useRequesterLive.getState().reload()
                      push({ type: 'release', id: r.request_id })
                    })}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-theme-600/80 hover:bg-theme-500 disabled:opacity-50">
                    {busy === `r${m.id}` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Request new volumes
                  </button>
                  <button type="button" disabled={busy === `d${m.id}`}
                    onClick={() => run(`d${m.id}`, async () => replace(await dismissMonitor(serverUrl, token, m.id)))}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50">
                    <CheckCheck size={12} /> Dismiss
                  </button>
                </>
              )}
              <button type="button" disabled={busy === `c${m.id}`}
                onClick={() => run(`c${m.id}`, async () => replace(await checkMonitor(serverUrl, token, m.id)))}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50">
                {busy === `c${m.id}` ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check
              </button>
              <button type="button" disabled={busy === `p${m.id}`}
                onClick={() => run(`p${m.id}`, async () => replace(await updateMonitor(serverUrl, token, m.id, { paused: !m.paused })))}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50">
                {m.paused ? <Play size={12} /> : <Pause size={12} />} {m.paused ? 'Resume' : 'Pause'}
              </button>
              {m.threads[0]?.link && (
                <button type="button" onClick={() => void api.openExternal(m.threads[0].link!)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20">
                  <ExternalLink size={12} /> Thread
                </button>
              )}
              <button type="button" disabled={busy === `x${m.id}`}
                onClick={async () => {
                  if (!(await confirm({ title: 'Stop watching?', message: m.title, confirmLabel: 'Delete monitor', destructive: true }))) return
                  await run(`x${m.id}`, async () => {
                    await deleteMonitor(serverUrl, token, m.id)
                    setMonitors(list => (list ?? []).filter(x => x.id !== m.id))
                  })
                }}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/5 hover:bg-red-500/20 hover:text-red-300 text-white/50 disabled:opacity-50 ml-auto">
                <Trash2 size={12} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
