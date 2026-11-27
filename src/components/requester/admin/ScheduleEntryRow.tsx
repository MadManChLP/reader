import React, { useState } from 'react'
import { Loader2, Trash2, Pencil, Check, X, ShieldCheck, Download, Play } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { useToast } from '../../Toast'
import { updateScheduleEntry, requesterErrorMessage } from '../../../utils/requesterApi'
import { verifyScheduleEntry, downloadMissingForEntry, triggerScheduleEntry } from '../../../utils/requesterDiscoverApi'
import { DAY_NAMES } from '../../../types/requester'
import type { ScheduleEntry } from '../../../types/requester'

const VERIFY_CHIP: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300',
  missing: 'bg-amber-500/15 text-amber-300',
  error: 'bg-red-500/15 text-red-300',
  unknown: 'bg-white/10 text-white/50',
}

function parseList(v: unknown): number[] {
  if (Array.isArray(v)) return v.filter((n): n is number => typeof n === 'number')
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

/** One schedule entry: verify state, inline edit (day/season/language), verify / fetch missing / trigger now. */
export function ScheduleEntryRow({ entry, deleting, onDelete, onChanged, onUpdate }: {
  entry: ScheduleEntry
  deleting: boolean
  onDelete: () => void
  onChanged: () => void
  onUpdate: (next: ScheduleEntry) => void
}) {
  const { serverUrl, token } = useRequester()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [day, setDay] = useState(entry.day)
  const [season, setSeason] = useState(entry.season)
  const [lang, setLang] = useState(entry.lang ?? 'German Dub')
  const [busy, setBusy] = useState<string | null>(null)

  const missing = parseList(entry.missing_episodes)
  const verify = entry.verify_status

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what)
    try { await fn() } catch (e) { toast.error(requesterErrorMessage(e, 'Failed')) }
    setBusy(null)
  }

  const save = () => run('save', async () => {
    if (!serverUrl || !token) return
    const next = await updateScheduleEntry(serverUrl, token, entry.id, { day, season, lang })
    if (!next) throw new Error('Could not save the entry')
    onUpdate({ ...entry, ...next })
    setEditing(false)
  })

  const doVerify = () => run('verify', async () => {
    if (!serverUrl || !token) return
    const r = await verifyScheduleEntry(serverUrl, token, entry.id)
    const e = r.entries[0]
    toast.info(e ? `${entry.title ?? entry.slug}: ${e.present}/${e.expected} present${e.missing.length ? `, missing ${e.missing.join(', ')}` : ''}` : 'Checked')
    onChanged()
  })

  const doMissing = () => run('missing', async () => {
    if (!serverUrl || !token) return
    const r = await downloadMissingForEntry(serverUrl, token, entry.id)
    if (r.queued) toast.success(`Queued ${r.missing?.length ?? 0} missing episode(s)`)
    else toast.info(r.note || 'Nothing to download')
    onChanged()
  })

  const doTrigger = () => run('trigger', async () => {
    if (!serverUrl || !token) return
    const r = await triggerScheduleEntry(serverUrl, token, entry.id)
    toast.success(r.queued ? `Queued: ${r.title}` : 'Not queued')
  })

  const sel = 'px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none'
  const btn = 'p-1.5 rounded-lg transition-colors text-white/40 flex-shrink-0 disabled:opacity-40'
  const langs = entry.typ === 'anime' ? ['German Dub', 'German Sub', 'English Sub'] : ['German Dub', 'English Dub']

  return (
    <div className="p-3 bg-white/5 rounded-lg space-y-2">
      <div className="flex items-center gap-3">
        {entry.poster_url && <img src={entry.poster_url} alt="" className="w-8 h-11 object-cover rounded flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white/90 truncate">{entry.title ?? entry.slug}</p>
          {!editing && (
            <p className="text-xs text-white/40 flex flex-wrap items-center gap-x-2">
              <span>{entry.typ} · S{entry.season} · {DAY_NAMES[entry.day]} · {entry.lang ?? 'Default'}</span>
              {entry.lang_episode_count != null && entry.episode_count != null && (
                <span>{entry.lang_episode_count}/{entry.episode_count} eps in this language</span>
              )}
              {verify && (
                <span className={`px-1.5 rounded ${VERIFY_CHIP[verify] ?? VERIFY_CHIP.unknown}`}>
                  {verify === 'missing' && missing.length ? `missing ${missing.join(', ')}` : verify}
                </span>
              )}
            </p>
          )}
        </div>
        {!editing && (
          <div className="flex items-center">
            <button onClick={doVerify} disabled={!!busy} title="Verify against the files" className={`${btn} hover:bg-white/10 hover:text-white`}>
              {busy === 'verify' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            </button>
            {verify === 'missing' && (
              <button onClick={doMissing} disabled={!!busy} title="Download the missing episodes" className={`${btn} hover:bg-white/10 hover:text-amber-300`}>
                {busy === 'missing' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              </button>
            )}
            <button onClick={doTrigger} disabled={!!busy} title="Queue now" className={`${btn} hover:bg-white/10 hover:text-theme-300`}>
              {busy === 'trigger' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            </button>
            <button onClick={() => setEditing(true)} title="Edit" className={`${btn} hover:bg-white/10 hover:text-white`}>
              <Pencil size={14} />
            </button>
            <button onClick={onDelete} disabled={deleting} title="Delete" className={`${btn} hover:bg-red-500/20 hover:text-red-400`}>
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>
        )}
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={day} onChange={e => setDay(Number(e.target.value))} className={sel}>
            {Object.entries(DAY_NAMES).map(([k, v]) => <option key={k} value={k} className="bg-gray-800">{v}</option>)}
          </select>
          <input type="number" min={1} value={season} onChange={e => setSeason(Math.max(1, Number(e.target.value)))}
            className={`${sel} w-16`} aria-label="Season" />
          <select value={lang} onChange={e => setLang(e.target.value)} className={sel}>
            {langs.map(l => <option key={l} value={l} className="bg-gray-800">{l}</option>)}
          </select>
          <button onClick={save} disabled={busy === 'save'} className={`${btn} hover:bg-emerald-500/20 hover:text-emerald-300`} title="Save">
            {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          </button>
          <button onClick={() => { setEditing(false); setDay(entry.day); setSeason(entry.season); setLang(entry.lang ?? 'German Dub') }}
            className={`${btn} hover:bg-white/10`} title="Cancel"><X size={14} /></button>
        </div>
      )}
    </div>
  )
}
