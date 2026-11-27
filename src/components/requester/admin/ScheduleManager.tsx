import React, { useState, useEffect, useCallback } from 'react'
import {
  Calendar, Plus, Trash2, RefreshCw, Loader2, ChevronDown, ChevronUp, AlertCircle, CheckCircle2,
} from 'lucide-react'
import { useRequester } from '../RequesterContext'
import {
  getSchedule, addScheduleEntry, deleteScheduleEntry, enrichSchedule,
} from '../../../utils/requesterApi'
import type { ScheduleEntry, NewScheduleEntry } from '../../../types/requester'
import { DAY_NAMES } from '../../../types/requester'
import { useConfirm } from '../../ConfirmDialog'
import { useToast } from '../../Toast'
import { ScheduleEntryRow } from './ScheduleEntryRow'
import { verifySchedule } from '../../../utils/requesterDiscoverApi'
import { requesterErrorMessage } from '../../../utils/requesterApi'

const LANG_OPTIONS = [
  { value: 'German Dub', label: 'German Dub' },
  { value: 'English Sub', label: 'English Sub' },
  { value: 'German Sub', label: 'German Sub' },
  { value: 'English Dub', label: 'English Dub' },
]

export function ScheduleManager() {
  const { serverUrl, token } = useRequester()

  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [enrichResult, setEnrichResult] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [addSuccess, setAddSuccess] = useState(false)

  // Add form
  const [form, setForm] = useState<Omit<NewScheduleEntry, 'url'> & { url: string }>({
    slug: '', url: '', typ: 'anime', day: 1, season: 1, lang: 'German Dub', title: '',
  })

  const load = useCallback(async () => {
    if (!serverUrl || !token) return
    setLoading(true)
    const data = await getSchedule(serverUrl, token)
    setEntries(data)
    setLoading(false)
  }, [serverUrl, token])

  useEffect(() => { load() }, [load])

  const handleEnrich = async () => {
    if (!serverUrl || !token) return
    setEnriching(true)
    setEnrichResult(null)
    const res = await enrichSchedule(serverUrl, token)
    if (res) {
      setEnrichResult(`Enriched ${res.enriched} entries, ${res.failed} failed`)
      await load()
    } else {
      setEnrichResult('Enrichment failed')
    }
    setEnriching(false)
    setTimeout(() => setEnrichResult(null), 4000)
  }

  const [confirm, confirmUi] = useConfirm()
  const toast = useToast()
  const [verifying, setVerifying] = useState(false)

  // Check every entry against the files on the share (no auto-download, no Discord)
  const handleVerifyAll = async () => {
    if (!serverUrl || !token) return
    setVerifying(true)
    try {
      const r = await verifySchedule(serverUrl, token, { autoDownload: false, notify: false })
      toast.info(`Checked ${r.checked}: ${r.ok} complete, ${r.missing} missing, ${r.unknown} unknown`)
      await load()
    } catch (e) {
      toast.error(requesterErrorMessage(e, 'Verification failed'))
    }
    setVerifying(false)
  }

  const handleDelete = async (id: number) => {
    if (!serverUrl || !token) return
    const entry = entries.find(e => e.id === id)
    const ok = await confirm({
      title: 'Delete this schedule entry?',
      message: (entry as any)?.title || (entry as any)?.slug || undefined,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setDeletingId(id)
    await deleteScheduleEntry(serverUrl, token, id)
    setEntries(prev => prev.filter(e => e.id !== id))
    setDeletingId(null)
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!serverUrl || !token || !form.slug.trim() || !form.url.trim()) return
    setAddError(null)
    setAddSuccess(false)

    const entry: NewScheduleEntry = {
      slug: form.slug.trim(),
      url: form.url.trim(),
      typ: form.typ,
      day: form.day,
      season: form.season,
      lang: form.lang || undefined,
      title: form.title?.trim() || undefined,
    }

    const res = await addScheduleEntry(serverUrl, token, entry)
    if (res) {
      setAddSuccess(true)
      setForm({ slug: '', url: '', typ: 'anime', day: 1, season: 1, lang: 'German Dub', title: '' })
      setShowAdd(false)
      setEntries(prev => [...prev, res])
    } else {
      setAddError('Failed to add schedule entry')
    }
  }

  return (
    <div className="space-y-4">
      {confirmUi}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-amber-400" />
          <span className="text-sm font-medium text-white/80">Download Schedule</span>
          <span className="text-xs text-white/40">({entries.length} entries)</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={handleVerifyAll}
            disabled={verifying || entries.length === 0}
            title="Compare every entry with the files on the share"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-lg text-xs transition-colors"
          >
            {verifying ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Verify all
          </button>
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-lg text-xs transition-colors"
          >
            <RefreshCw size={12} className={enriching ? 'animate-spin' : ''} />
            Enrich
          </button>
          <button
            onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 rounded-lg text-xs text-amber-400 transition-colors"
          >
            <Plus size={12} />
            Add
            {showAdd ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {enrichResult && (
        <p className="text-xs text-theme-400">{enrichResult}</p>
      )}

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white/5 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 phone:grid-cols-1 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/60">Slug *</label>
              <input
                type="text" value={form.slug} onChange={e => setForm(p => ({ ...p, slug: e.target.value }))}
                placeholder="sword-art-online"
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">Title (optional)</label>
              <input
                type="text" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="Sword Art Online"
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-white/60">URL *</label>
            <input
              type="text" value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
              placeholder="https://aniworld.to/anime/stream/sword-art-online"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              required
            />
          </div>

          <div className="grid grid-cols-4 phone:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/60">Type</label>
              <select
                value={form.typ} onChange={e => setForm(p => ({ ...p, typ: e.target.value as 'anime' | 'serie' }))}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              >
                <option value="anime" className="bg-gray-800">Anime</option>
                <option value="serie" className="bg-gray-800">Serie</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">Day</label>
              <select
                value={form.day} onChange={e => setForm(p => ({ ...p, day: Number(e.target.value) }))}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              >
                {Object.entries(DAY_NAMES).map(([k, v]) => (
                  <option key={k} value={k} className="bg-gray-800">{v}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">Season</label>
              <input
                type="number" min={1} value={form.season}
                onChange={e => setForm(p => ({ ...p, season: Number(e.target.value) }))}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/60">Language</label>
              <select
                value={form.lang} onChange={e => setForm(p => ({ ...p, lang: e.target.value }))}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              >
                {LANG_OPTIONS.map(l => (
                  <option key={l.value} value={l.value} className="bg-gray-800">{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          {addError && (
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle size={14} /> {addError}
            </div>
          )}

          <div className="flex gap-2">
            <button type="submit"
              className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 rounded-lg text-sm text-amber-400 transition-colors">
              Add Entry
            </button>
            <button type="button" onClick={() => setShowAdd(false)}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white/60 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {addSuccess && (
        <div className="flex items-center gap-2 text-theme-400 text-xs">
          <CheckCircle2 size={14} /> Entry added successfully
        </div>
      )}

      {/* Schedule list */}
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={20} className="animate-spin text-white/40" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-white/30 text-center py-6">No scheduled downloads</p>
      ) : (
        <div className="space-y-2 max-h-[28rem] overflow-y-auto custom-scrollbar">
          {entries.map(entry => (
            <ScheduleEntryRow
              key={entry.id}
              entry={entry}
              deleting={deletingId === entry.id}
              onDelete={() => handleDelete(entry.id)}
              onChanged={load}
              onUpdate={(next) => setEntries(prev => prev.map(e => e.id === next.id ? { ...e, ...next } : e))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
