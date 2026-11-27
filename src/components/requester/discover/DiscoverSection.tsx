import React, { useEffect, useMemo, useState, memo } from 'react'
import { Loader2, AlertCircle, Compass, Tags } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { ScrollSection } from '../../jellyfin/ScrollSection'
import { PosterCard } from './PosterCard'
import { openDiscoverItem } from './openItem'
import { getDiscoverRows, getDiscoverRow, getGenres, jellyfinImagePath } from '../../../utils/requesterDiscoverApi'
import { requesterErrorMessage, serverAbsoluteUrl } from '../../../utils/requesterApi'
import { useRequesterNav } from '../../../stores/requesterNavStore'
import type { DiscoverItem, DiscoverRowInfo, Genre } from '../../../types/requesterDiscover'

// Rows and genres are cached for the session (the server caches them too)
const rowCache = new Map<string, DiscoverItem[]>()
let rowsCache: DiscoverRowInfo[] | null = null
let genresCache: Genre[] | null = null

export function clearDiscoverCache() {
  rowCache.clear()
  rowsCache = null
  genresCache = null
}

/** Discover start page: the server's rows (popular/new anime & series, TMDB movies, recently added) and genre chips. */
export function DiscoverSection() {
  const { serverUrl, token } = useRequester()
  const [rows, setRows] = useState<DiscoverRowInfo[] | null>(rowsCache)
  const [genres, setGenres] = useState<Genre[] | null>(genresCache)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!serverUrl || !token) return
    if (!rowsCache) {
      getDiscoverRows(serverUrl, token)
        .then(r => { rowsCache = r; setRows(r); setError(null) })
        .catch(e => setError(requesterErrorMessage(e, 'Could not load Discover')))
    }
    if (!genresCache) {
      getGenres(serverUrl, token)
        .then(g => { genresCache = g; setGenres(g) })
        .catch(() => setGenres([]))
    }
  }, [serverUrl, token])

  if (error && !rows) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
        <AlertCircle size={32} className="text-red-400/70" />
        <p className="text-white/60 text-sm">{error}</p>
        <p className="text-white/30 text-xs">Discover needs a mediamaster server from November 2026 or newer.</p>
      </div>
    )
  }
  if (!rows) {
    return <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-theme-400" /></div>
  }

  return (
    <div className="py-6 space-y-8">
      {rows.length === 0 && (
        <div className="flex flex-col items-center py-16 gap-2 text-white/40">
          <Compass size={32} />
          <p className="text-sm">Nothing to discover — the server has no sources configured.</p>
        </div>
      )}
      {rows.map(r => <DiscoverRow key={r.id} row={r} />)}
      {genres && genres.length > 0 && <GenreChips genres={genres} />}
    </div>
  )
}

const DiscoverRow = memo(function DiscoverRow({ row }: { row: DiscoverRowInfo }) {
  const { serverUrl, token } = useRequester()
  const [items, setItems] = useState<DiscoverItem[] | null>(rowCache.get(row.id) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!serverUrl || !token || rowCache.has(row.id)) return
    let cancelled = false
    getDiscoverRow(serverUrl, token, row.id)
      .then(list => { if (cancelled) return; rowCache.set(row.id, list); setItems(list) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [serverUrl, token, row.id])

  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : undefined), [token])

  if (failed || (items && items.length === 0)) return null

  return (
    <ScrollSection title={row.title}>
      {items === null
        ? Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="w-36 phone:w-28 flex-shrink-0">
              <div className="aspect-[2/3] rounded-xl bg-white/10 animate-pulse" />
              <div className="h-3 mt-2 rounded bg-white/10 animate-pulse w-3/4" />
            </div>
          ))
        : items.map((it, i) => {
            const isJellyfin = it.kind === 'jellyfin'
            const poster = isJellyfin && it.jellyfin_id
              ? serverAbsoluteUrl(serverUrl, jellyfinImagePath(it.jellyfin_id))
              : it.poster_url
            return (
              <PosterCard
                key={`${it.kind}:${it.slug ?? it.tmdb_id ?? it.jellyfin_id ?? i}`}
                title={it.title}
                subtitle={it.subtitle ?? (it.year ? String(it.year) : null)}
                posterUrl={poster}
                authHeaders={isJellyfin ? authHeaders : undefined}
                status={isJellyfin ? undefined : it.status}
                onClick={() => openDiscoverItem(it)}
              />
            )
          })}
    </ScrollSection>
  )
})

function GenreChips({ genres }: { genres: Genre[] }) {
  const push = useRequesterNav(s => s.push)
  return (
    <section className="px-8 phone:px-4">
      <h2 className="text-xl phone:text-lg font-semibold flex items-center gap-2 mb-4">
        <Tags size={18} className="text-theme-400" /> Genres
      </h2>
      <div className="flex flex-wrap gap-2">
        {genres.map(g => (
          <button key={g.id} type="button" data-press=""
            onClick={() => push({ type: 'genre', id: g.id, label: g.label })}
            className="relative overflow-hidden px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm text-white/80 transition-colors">
            {g.backdrop_url && (
              <img src={g.backdrop_url} alt="" aria-hidden loading="lazy"
                className="absolute inset-0 w-full h-full object-cover opacity-20" />
            )}
            <span className="relative">{g.label}</span>
            {g.counts && (
              <span className="relative ml-2 text-xs text-white/40">
                {Object.values(g.counts).reduce((a, b) => a + (b ?? 0), 0) || ''}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
