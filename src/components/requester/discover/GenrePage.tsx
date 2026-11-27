import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { PosterCard } from './PosterCard'
import { openDiscoverItem } from './openItem'
import { PageHeader } from './PageHeader'
import { getGenrePage } from '../../../utils/requesterDiscoverApi'
import { requesterErrorMessage } from '../../../utils/requesterApi'
import type { DiscoverItem, GenreSort } from '../../../types/requesterDiscover'

type Kind = 'anime' | 'series' | 'movie'
const KIND_LABEL: Record<Kind, string> = { anime: 'Anime', series: 'Series', movie: 'Movies' }
const SORTS: { id: GenreSort; label: string }[] = [
  { id: 'popular', label: 'Popular' },
  { id: 'newest', label: 'Newest' },
  { id: 'rating', label: 'Top rated' },
  { id: 'title', label: 'A–Z' },
]

export function GenrePage({ id, label, kind: initialKind }: { id: string; label: string; kind?: Kind }) {
  const { serverUrl, token } = useRequester()
  const [kind, setKind] = useState<Kind | undefined>(initialKind)
  const [types, setTypes] = useState<Kind[]>([])
  const [sort, setSort] = useState<GenreSort>('popular')
  const [items, setItems] = useState<DiscoverItem[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (p: number, append: boolean) => {
    if (!serverUrl || !token) return
    setLoading(true)
    try {
      const res = await getGenrePage(serverUrl, token, id, { type: kind, sort, page: p })
      setTypes(res.types)
      if (!kind) setKind(res.type)
      setItems(prev => append ? [...prev, ...res.items] : res.items)
      setPage(res.page)
      setTotalPages(res.total_pages)
      setTotal(res.total)
      setError(null)
    } catch (e) {
      setError(requesterErrorMessage(e, 'Could not load the genre'))
    }
    setLoading(false)
  }, [serverUrl, token, id, kind, sort])

  useEffect(() => { void load(1, false) }, [load])

  return (
    <div className="pb-10">
      <PageHeader title={label} subtitle={total ? `${total} titles` : undefined} />

      <div className="px-8 phone:px-4 flex flex-wrap items-center gap-2 mb-5">
        {types.length > 1 && types.map(t => (
          <button key={t} type="button" onClick={() => setKind(t)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              kind === t ? 'border-theme-500/50 bg-theme-500/10 text-theme-400' : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
            }`}>
            {KIND_LABEL[t]}
          </button>
        ))}
        <div className="flex-1" />
        <select value={sort} onChange={e => setSort(e.target.value as GenreSort)}
          className="px-3 py-1.5 rounded-lg text-sm bg-white/5 border border-white/10 text-white/80 focus:outline-none">
          {SORTS.map(s => <option key={s.id} value={s.id} className="bg-gray-900">{s.label}</option>)}
        </select>
      </div>

      {error && items.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-2 text-center">
          <AlertCircle size={28} className="text-red-400/70" />
          <p className="text-sm text-white/60">{error}</p>
        </div>
      ) : (
        <div className="px-8 phone:px-4 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] phone:grid-cols-3 gap-4 phone:gap-3">
          {items.map((it, i) => (
            <PosterCard key={`${it.kind}:${it.slug ?? it.tmdb_id ?? i}`}
              className="w-full"
              title={it.title}
              subtitle={it.year ? String(it.year) : null}
              posterUrl={it.poster_url}
              status={it.status}
              onClick={() => openDiscoverItem(it)} />
          ))}
        </div>
      )}

      <div className="flex justify-center mt-6">
        {loading ? (
          <Loader2 size={24} className="animate-spin text-theme-400" />
        ) : page < totalPages ? (
          <button type="button" onClick={() => load(page + 1, true)}
            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm text-white/80 transition-colors">
            Load more
          </button>
        ) : null}
      </div>
    </div>
  )
}
