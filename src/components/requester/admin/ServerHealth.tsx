import React, { useCallback, useEffect, useState } from 'react'
import { HardDrive, Activity, Loader2, RefreshCw, AlertCircle, PlayCircle, Film, Database } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { useToast } from '../../Toast'
import {
  getStorage, rescanStorage, testStorageTarget, getSources, runQualityCheck, runCatalogSync,
} from '../../../utils/requesterDiscoverApi'
import { requesterErrorMessage } from '../../../utils/requesterApi'
import type { SourceHealthRow, SourcesInfo, StorageInfo } from '../../../types/requesterDiscover'

const LEVEL_DOT: Record<string, string> = {
  ok: 'bg-emerald-400', warn: 'bg-amber-400', error: 'bg-red-500', idle: 'bg-white/20',
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}

const pct = (r: number | null | undefined) => (r == null ? '—' : `${Math.round(r <= 1 ? r * 100 : r)}%`)

/**
 * Admin, read-only: storage targets (free space, reachability, sizes per
 * media type) and source health (scraper / hoster success rates), plus the
 * "run now" buttons. Editing the configuration stays in the server's web UI.
 */
export function ServerHealth() {
  const { serverUrl, token } = useRequester()
  const toast = useToast()
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [sources, setSources] = useState<SourcesInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (refresh: boolean) => {
    if (!serverUrl || !token) return
    setLoading(true)
    const [st, so] = await Promise.allSettled([getStorage(serverUrl, token, refresh), getSources(serverUrl, token)])
    if (st.status === 'fulfilled') setStorage(st.value)
    if (so.status === 'fulfilled') setSources(so.value)
    setError(st.status === 'rejected' && so.status === 'rejected'
      ? requesterErrorMessage(st.reason, 'Could not load the server status') : null)
    setLoading(false)
  }, [serverUrl, token])

  useEffect(() => { void load(false) }, [load])

  const act = async (key: string, fn: () => Promise<{ status?: string } | unknown>, done: string) => {
    setBusy(key)
    try {
      const r = await fn() as { status?: string }
      toast.info(r?.status === 'running' ? 'Already running' : done)
    } catch (e) { toast.error(requesterErrorMessage(e, 'Failed')) }
    setBusy(null)
  }

  const testTarget = async (id: string, name: string) => {
    if (!serverUrl || !token) return
    setBusy(`t:${id}`)
    try {
      const r = await testStorageTarget(serverUrl, token, id)
      if (r.success) toast.success(`${name}: OK${r.space ? ` · ${formatBytes(r.space[1])} free` : ''}`)
      else toast.error(`${name}: ${r.message ?? 'failed'}`)
    } catch (e) { toast.error(requesterErrorMessage(e, 'Test failed')) }
    setBusy(null)
  }

  const card = 'bg-white/5 border border-white/10 rounded-xl p-4 space-y-3'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-amber-300 flex-1 flex items-center gap-2"><Activity size={16} /> Server health</h3>
        <button type="button" onClick={() => load(true)} disabled={loading} title="Check now"
          className="p-1.5 rounded-lg hover:bg-white/10 text-white/50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {error && <p className="text-sm text-red-300/80 flex items-center gap-2"><AlertCircle size={14} />{error}</p>}

      {storage && (
        <div className={card}>
          <div className="flex items-center gap-2">
            <HardDrive size={14} className="text-white/60" />
            <p className="text-sm font-medium flex-1">Storage</p>
            <button type="button" onClick={() => act('rescan', () => rescanStorage(serverUrl, token!), 'Size scan started')}
              disabled={busy === 'rescan' || !!storage.status?.scanning}
              className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50">
              {storage.status?.scanning ? 'Scanning…' : 'Rescan sizes'}
            </button>
          </div>
          {storage.restart_needed && <p className="text-xs text-amber-300">The server needs a restart to apply storage changes.</p>}
          <ul className="space-y-2">
            {(storage.targets ?? []).map(t => {
              const st = storage.status?.targets?.[t.id]
              const used = st?.total && st.free != null ? 1 - st.free / st.total : null
              return (
                <li key={t.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full ${LEVEL_DOT[st?.level ?? 'idle']}`} />
                    <span className="text-white/80 flex-1 truncate">{t.name} <span className="text-white/30">({t.type})</span></span>
                    <span className="text-white/50">{st?.reachable === false ? (st.error || 'unreachable') : `${formatBytes(st?.free)} free of ${formatBytes(st?.total)}`}</span>
                    <button type="button" onClick={() => testTarget(t.id, t.name)} disabled={busy === `t:${t.id}`}
                      className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px]">
                      {busy === `t:${t.id}` ? <Loader2 size={10} className="animate-spin" /> : 'Test'}
                    </button>
                  </div>
                  {used != null && (
                    <div className="h-1 bg-white/10 rounded-full">
                      <div className={`h-1 rounded-full ${st?.level === 'error' ? 'bg-red-500' : st?.level === 'warn' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${Math.min(100, Math.round(used * 100))}%` }} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {Object.keys(storage.status?.sizes ?? {}).length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50 pt-1">
              {Object.entries(storage.status?.sizes ?? {}).map(([kind, v]) => (
                <span key={kind}>{kind}: <span className="text-white/70">{formatBytes(v.bytes)}</span> · {v.files} files</span>
              ))}
            </div>
          )}
          <p className="text-[11px] text-white/30">Warns below {storage.warn_free_gb} GB, stops below {storage.min_free_gb} GB.</p>
        </div>
      )}

      {sources && (
        <div className={card}>
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-white/60" />
            <p className="text-sm font-medium flex-1">Sources</p>
          </div>
          <SourceTable title="Sites" rows={sources.health?.sites} />
          <SourceTable title="Hosters" rows={sources.health?.hosters} />

          {sources.quality && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
              <Film size={14} className="text-white/50" />
              <p className="text-xs text-white/60 flex-1">
                Quality upgrades: {sources.quality.counts?.needs ?? sources.quality.candidate_count ?? 0} need one
                {sources.quality.counts?.all != null || sources.quality.total != null
                  ? ` of ${sources.quality.counts?.all ?? sources.quality.total} movies` : ''}
                {sources.quality.counts?.upgraded ? ` · ${sources.quality.counts.upgraded} upgraded` : ''}
              </p>
              <button type="button" onClick={() => act('quality', () => runQualityCheck(serverUrl, token!), 'Upgrade check started')}
                disabled={busy === 'quality' || !!sources.quality.running}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50">
                <PlayCircle size={12} /> {sources.quality.running ? 'Running…' : 'Run now'}
              </button>
            </div>
          )}
          {sources.catalog && (
            <div className="flex flex-wrap items-center gap-2">
              <Database size={14} className="text-white/50" />
              <p className="text-xs text-white/60 flex-1">
                Catalog: {Object.entries(sources.catalog.counts ?? {}).map(([k, v]) => `${v} ${k}`).join(', ') || '—'}
                {sources.catalog.last_sync ? ` · synced ${new Date(sources.catalog.last_sync).toLocaleDateString()}` : ''}
                {sources.catalog.last_error ? ` · last error: ${sources.catalog.last_error}` : ''}
              </p>
              <button type="button" onClick={() => act('catalog', () => runCatalogSync(serverUrl, token!), 'Catalog sync started')}
                disabled={busy === 'catalog' || sources.catalog.running}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50">
                <PlayCircle size={12} /> {sources.catalog.running ? 'Running…' : 'Sync now'}
              </button>
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] text-white/30">Settings for storage, sources and authentication are edited in the server's web UI.</p>
    </div>
  )
}

function SourceTable({ title, rows }: { title: string; rows: SourceHealthRow[] | undefined }) {
  if (!rows?.length) return null
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-white/30 mb-1">{title}</p>
      <div className="space-y-1">
        {rows.map(r => (
          <div key={`${r.kind}:${r.source}`} className="flex items-center gap-2 text-xs" title={r.last_error ? `Last error (${r.last_error_stage ?? 'unknown stage'}): ${r.last_error}` : undefined}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${LEVEL_DOT[r.level] ?? LEVEL_DOT.idle}`} />
            <span className="text-white/80 flex-1 truncate">{r.source}</span>
            <span className="text-white/50 w-24 text-right">7 d: {pct(r.d7?.rate)} <span className="text-white/30">({r.d7?.attempts ?? 0})</span></span>
            <span className="text-white/40 w-24 text-right phone:hidden">30 d: {pct(r.d30?.rate)}</span>
            {!!r.streak && r.level === 'error' && <span className="text-red-300/80">{r.streak}× failed</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
