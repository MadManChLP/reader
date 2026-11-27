import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertCircle, CalendarClock, Send, RefreshCw, Play } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { ScrollSection } from '../../jellyfin/ScrollSection'
import { PosterCard } from '../discover/PosterCard'
import { openDiscoverItem, canOpen } from '../discover/openItem'
import {
  getUpcoming, getUpcomingRequests, requestUpcoming, runUpcomingCheck, checkUpcomingRequest,
} from '../../../utils/requesterDiscoverApi'
import { requesterErrorMessage, RequesterError } from '../../../utils/requesterApi'
import { useConfirm } from '../../ConfirmDialog'
import { useToast } from '../../Toast'
import type { UpcomingItem, UpcomingRequest, UpcomingRow } from '../../../types/requesterDiscover'

const LANGS = [
  { key: 1, label: 'German Dub' },
  { key: 3, label: 'German Sub (anime)' },
  { key: 2, label: 'English Sub / Dub' },
]

/** Titles that aren't out yet: request them now, the server downloads them on release. */
export function UpcomingSection() {
  const { serverUrl, token, isAdmin } = useRequester()
  const [rows, setRows] = useState<UpcomingRow[] | null>(null)
  const [waiting, setWaiting] = useState<UpcomingRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [langKey, setLangKey] = useState(1)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [confirm, confirmUi] = useConfirm()
  const toast = useToast()

  const load = useCallback(async () => {
    if (!serverUrl || !token) return
    try {
      const [r, w] = await Promise.all([
        getUpcoming(serverUrl, token),
        getUpcomingRequests(serverUrl, token).catch(() => [] as UpcomingRequest[]),
      ])
      setRows(r)
      setWaiting(w)
      setError(null)
    } catch (e) {
      setError(requesterErrorMessage(e, 'Could not load upcoming titles'))
    }
  }, [serverUrl, token])

  useEffect(() => { void load() }, [load])

  const request = async (item: UpcomingItem) => {
    if (!serverUrl || !token) return
    const id = item.kind === 'anime' ? item.anilist_id : item.tmdb_id
    if (id == null) return
    setBusyKey(item.key)
    const send = (force: boolean) => requestUpcoming(serverUrl, token, {
      kind: item.kind, id, lang_key: item.kind === 'movie' ? undefined : langKey, force,
    })
    try {
      try {
        await send(false)
      } catch (e) {
        if (!(e instanceof RequesterError) || e.status !== 409) throw e
        const ok = await confirm({ title: 'Already requested', message: `${e.message} Request anyway?`, confirmLabel: 'Request anyway' })
        if (!ok) { setBusyKey(null); return }
        await send(true)
      }
      toast.success(`${item.title}: requested — it downloads when it's out`)
      await load()
    } catch (e) {
      toast.error(requesterErrorMessage(e, 'Request failed'))
    }
    setBusyKey(null)
  }

  const runCheck = async () => {
    if (!serverUrl || !token) return
    try {
      const r = await runUpcomingCheck(serverUrl, token)
      toast.info(r.status === 'running' ? 'The check is already running' : 'Check started')
    } catch (e) { toast.error(requesterErrorMessage(e, 'Could not start the check')) }
  }

  const checkOne = async (r: UpcomingRequest) => {
    if (!serverUrl || !token) return
    setBusyKey(`req:${r.id}`)
    try {
      const res = await checkUpcomingRequest(serverUrl, token, r.id)
      toast.info(`${r.title}: ${res.result}`)
      await load()
    } catch (e) { toast.error(requesterErrorMessage(e, 'Check failed')) }
    setBusyKey(null)
  }

  if (error && !rows) {
    return (
      <div className="flex flex-col items-center py-20 gap-3 text-center px-6">
        <AlertCircle size={32} className="text-red-400/70" />
        <p className="text-sm text-white/60">{error}</p>
      </div>
    )
  }
  if (!rows) return <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-theme-400" /></div>

  return (
    <div className="py-6 space-y-8">
      <div className="px-8 phone:px-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-white/50 flex-1 min-w-[12rem]">
          Request titles before they come out — the server checks weekly and downloads them on release.
        </p>
        <label className="text-xs text-white/50 flex items-center gap-2">
          Language
          <select value={langKey} onChange={e => setLangKey(Number(e.target.value))}
            className="px-2 py-1.5 rounded-lg text-sm bg-white/5 border border-white/10 text-white/80 focus:outline-none">
            {LANGS.map(l => <option key={l.key} value={l.key} className="bg-gray-900">{l.label}</option>)}
          </select>
        </label>
        {isAdmin && (
          <button type="button" onClick={runCheck}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20">
            <RefreshCw size={14} /> Run check now
          </button>
        )}
      </div>

      {waiting.length > 0 && (
        <section className="px-8 phone:px-4">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><CalendarClock size={18} className="text-sky-400" /> Waiting for release</h2>
          <div className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
            {waiting.map(r => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.title}{r.season ? ` · Season ${r.season}` : ''}</p>
                  <p className="text-xs text-white/40 truncate">
                    {[r.date_label || r.release_date, r.lang, r.status === 'pending' ? 'waiting for approval' : null, isAdmin ? r.user_id : null]
                      .filter(Boolean).join(' · ')}
                  </p>
                  {r.last_result && <p className="text-xs text-white/30 truncate">Last check: {r.last_result}</p>}
                </div>
                {isAdmin && r.status === 'upcoming' && (
                  <button type="button" onClick={() => checkOne(r)} disabled={busyKey === `req:${r.id}`} title="Check now"
                    className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white">
                    {busyKey === `req:${r.id}` ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {rows.length === 0 && <p className="px-8 phone:px-4 text-sm text-white/40">No upcoming titles (the server needs a TMDB key for movies and series).</p>}

      {rows.map(row => (
        <ScrollSection key={row.id} title={row.title}>
          {row.items.map(item => (
            <div key={item.key} className="w-36 phone:w-28 flex-shrink-0">
              <PosterCard className="w-full" title={item.title}
                subtitle={item.date_label || item.release_date || item.subtitle}
                posterUrl={item.poster_url}
                status={item.status ?? undefined}
                onClick={canOpen(item) ? () => openDiscoverItem(item) : undefined} />
              {!item.status && (
                <button type="button" onClick={() => request(item)} disabled={busyKey === item.key}
                  className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-theme-600/80 hover:bg-theme-500 text-xs font-medium disabled:opacity-50">
                  {busyKey === item.key ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Request
                </button>
              )}
            </div>
          ))}
        </ScrollSection>
      ))}
      {confirmUi}
    </div>
  )
}
