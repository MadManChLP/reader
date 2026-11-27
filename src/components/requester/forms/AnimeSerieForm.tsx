import React, { useState, useCallback, useEffect } from 'react'
import { Search, Loader2, ChevronLeft, ImageOff, PencilLine } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import {
  searchAnime, searchSeries, fetchPosterUrl, requesterErrorMessage,
} from '../../../utils/requesterApi'
import { registerBackHandler } from '../../../utils/navigationBus'
import type { AnimeSearchResult } from '../../../types/requester'
import { ShowRequestOptions } from './ShowRequestOptions'

interface Props {
  type: 'anime' | 'serie'
  onExpand: (expanded: boolean) => void
  /** Pre-filled search (e.g. "Request" from Jellyfin details) */
  initialQuery?: string
}

// Resolved posters per "type:slug" — repeated searches shouldn't re-hit
// /api/search/poster for results that came back without one
const posterCache = new Map<string, string | null>()

export function AnimeSerieForm({ type, onExpand, initialQuery }: Props) {
  const { serverUrl, token } = useRequester()

  const [inputMode, setInputMode] = useState<'search' | 'manual'>('search')

  // Search
  const [query, setQuery] = useState(initialQuery ?? '')
  const [results, setResults] = useState<AnimeSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Manual input
  const [manualSlug, setManualSlug] = useState('')

  // Detail
  const [selected, setSelected] = useState<AnimeSearchResult | null>(null)

  const resetForm = useCallback(() => {
    setSelected(null)
    setQuery('')
    setResults([])
  }, [])

  // The detail panel is a sub-view: Back / Esc / edge-swipe return to the results
  useEffect(() => {
    if (!selected) return
    return registerBackHandler(() => { setSelected(null); return true })
  }, [selected])

  // Notify parent when detail panel opens/closes
  useEffect(() => {
    onExpand(!!selected)
    return () => onExpand(false)
  }, [selected, onExpand])

  // Patch a resolved poster into the result list (and the open detail panel)
  const applyPoster = useCallback((slug: string, url: string) => {
    setResults(prev => prev.map(r => (r.slug === slug && !r.poster_url) ? { ...r, poster_url: url } : r))
    setSelected(prev => (prev && prev.slug === slug && !prev.poster_url) ? { ...prev, poster_url: url } : prev)
  }, [])

  const loadPosters = useCallback((list: AnimeSearchResult[]) => {
    if (!serverUrl || !token) return
    list.filter(r => r.slug && !r.poster_url).forEach(r => {
      const cacheKey = `${type}:${r.slug}`
      if (posterCache.has(cacheKey)) {
        const cached = posterCache.get(cacheKey)
        if (cached) applyPoster(r.slug, cached)
        return
      }
      fetchPosterUrl(serverUrl, token, r.slug, type).then(url => {
        posterCache.set(cacheKey, url)
        if (url) applyPoster(r.slug, url)
      })
    })
  }, [serverUrl, token, type, applyPoster])

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim() || !serverUrl || !token) return
    setIsSearching(true)
    setSearchError(null)
    try {
      const res = type === 'anime'
        ? await searchAnime(serverUrl, token, q.trim())
        : await searchSeries(serverUrl, token, q.trim())
      setResults(res)
      if (res.length === 0) setSearchError('No results found.')
      loadPosters(res)
    } catch (e) {
      setSearchError(requesterErrorMessage(e, 'Search failed.'))
    }
    setIsSearching(false)
  }, [serverUrl, token, type, loadPosters])

  // Search as you type (debounced), Enter searches at once
  useEffect(() => {
    if (inputMode !== 'search' || query.trim().length < 2) return
    const t = window.setTimeout(() => { void runSearch(query) }, 450)
    return () => window.clearTimeout(t)
  }, [query, inputMode, runSearch])

  const handleSelect = (r: AnimeSearchResult) => setSelected(r)

  const handleManualLookup = () => {
    const slug = manualSlug.trim()
    if (!slug) return
    setSelected({ title: slug, slug, url: slug, poster_url: null })
  }

  // ── Detail ───────────────────────────────────────────────────────────────
  if (selected) {
    return (
      <div className="flex gap-4 min-h-96">
        {/* Results column (desktop) — switch between results without going back */}
        <div className="w-56 flex-shrink-0 flex flex-col gap-2 phone:hidden">
          <button onClick={() => setSelected(null)}
            className="flex items-center gap-1 text-sm text-white/50 hover:text-white/80 transition-colors mb-1">
            <ChevronLeft size={16} />
            Back to search
          </button>
          <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar max-h-[520px]">
            {results.map((r, i) => (
              <button key={i} type="button" onClick={() => handleSelect(r)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors text-sm ${
                  r.slug === selected.slug ? 'bg-theme-500/20 text-theme-300' : 'hover:bg-white/10 text-white/70'
                }`}>
                <p className="font-medium truncate">{r.title}</p>
                <p className="text-xs text-white/40 truncate">{r.slug}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <button onClick={() => setSelected(null)}
            className="hidden phone:flex items-center gap-1 text-sm text-white/50 active:text-white/80 mb-3">
            <ChevronLeft size={16} />
            Results
          </button>
          <ShowRequestOptions
            key={selected.slug}
            type={type}
            slug={selected.slug}
            title={selected.title}
            posterUrl={selected.poster_url}
            onPoster={(url) => {
              posterCache.set(`${type}:${selected.slug}`, url)
              applyPoster(selected.slug, url)
            }}
            onDone={resetForm}
          />
        </div>
      </div>
    )
  }

  // ── Search / Manual ──────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button type="button" onClick={() => setInputMode('search')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            inputMode === 'search' ? 'border-theme-500/50 bg-theme-500/10 text-theme-400' : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10'
          }`}>
          <Search size={14} /> Search
        </button>
        <button type="button" onClick={() => setInputMode('manual')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            inputMode === 'manual' ? 'border-theme-500/50 bg-theme-500/10 text-theme-400' : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10'
          }`}>
          <PencilLine size={14} /> Manual
        </button>
      </div>

      {inputMode === 'search' ? (
        <>
          <div className="flex gap-2">
            <input type="text" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), runSearch(query))}
              placeholder={type === 'anime' ? 'Search anime...' : 'Search series...'}
              className="flex-1 min-w-0 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50 focus:border-transparent transition-all"
              autoFocus />
            <button type="button" onClick={() => runSearch(query)} disabled={isSearching || !query.trim()}
              className="px-4 py-3 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-xl transition-colors">
              {isSearching ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
            </button>
          </div>

          {searchError && <p className="text-xs text-yellow-400">{searchError}</p>}

          {results.length > 0 && (
            <div className="max-h-72 phone:max-h-none overflow-y-auto space-y-1 custom-scrollbar">
              {results.map((r, i) => (
                <button key={i} type="button" onClick={() => handleSelect(r)}
                  className="w-full flex items-center gap-3 text-left px-3 py-2 hover:bg-white/10 rounded-lg transition-colors">
                  {r.poster_url ? (
                    <img src={r.poster_url} alt={r.title} className="w-8 h-11 object-cover rounded flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-11 bg-white/10 rounded flex items-center justify-center flex-shrink-0">
                      <ImageOff size={12} className="text-white/30" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate text-sm">{r.title}</p>
                    <p className="text-xs text-white/40 truncate">{r.slug}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {results.length === 0 && !searchError && (
            <p className="text-sm text-white/30 text-center py-8">
              Search for {type === 'anime' ? 'an anime' : 'a series'} to get started
            </p>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs text-white/60">
              Slug or URL <span className="text-white/30">(e.g. sword-art-online)</span>
            </label>
            <input type="text" value={manualSlug}
              onChange={e => setManualSlug(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleManualLookup())}
              placeholder={type === 'anime' ? 'sword-art-online' : 'breaking-bad'}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50 focus:border-transparent transition-all"
              autoFocus />
            <p className="text-xs text-white/30">The server accepts a full aniworld.to / s.to URL here too.</p>
          </div>
          <button type="button" onClick={handleManualLookup} disabled={!manualSlug.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-xl text-sm text-white/80 transition-colors">
            <Search size={16} />
            Load Details & Configure
          </button>
        </div>
      )}
    </div>
  )
}
