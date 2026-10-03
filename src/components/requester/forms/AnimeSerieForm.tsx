import React, { useState, useCallback, useEffect } from 'react'
import { Search, Loader2, CheckCircle2, AlertCircle, Send, X, ChevronLeft, ImageOff, PencilLine } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import {
  searchAnime, searchSeries, getMediaInfo, fetchPosterUrl,
  downloadAnime, downloadSeries,
} from '../../../utils/requesterApi'
import type {
  AnimeSearchResult, MediaInfo, SeasonInfo,
} from '../../../types/requester'
import { LANG_KEY_MAP, SERIES_LANG_KEY_MAP } from '../../../types/requester'

interface Props {
  type: 'anime' | 'serie'
  onExpand: (expanded: boolean) => void
}

interface ExcludeMap {
  [season: string]: string  // raw input per season
}

// Resolved posters per "type:slug" — search results always come back with
// poster_url null, so repeated searches shouldn't re-hit /api/search/poster
const posterCache = new Map<string, string | null>()

export function AnimeSerieForm({ type, onExpand }: Props) {
  const { serverUrl, token } = useRequester()

  const [inputMode, setInputMode] = useState<'search' | 'manual'>('search')

  // Search
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AnimeSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Manual input
  const [manualSlug, setManualSlug] = useState('')
  const [manualUrl, setManualUrl] = useState('')
  const [loadingManual, setLoadingManual] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)

  // Detail
  const [selected, setSelected] = useState<AnimeSearchResult | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)

  // Options
  const [allSeasons, setAllSeasons] = useState(true)
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(new Set())
  const [langKey, setLangKey] = useState<number | null>(null)
  const [multilang, setMultilang] = useState(false)
  const [excludes, setExcludes] = useState<ExcludeMap>({})

  // Submit
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message?: string } | null>(null)

  // Notify parent when detail panel opens/closes
  useEffect(() => {
    onExpand(!!selected)
    return () => onExpand(false)
  }, [selected, onExpand])

  // Patch a resolved poster into the result list (and the open detail panel)
  // by slug — safe across overlapping searches since it only touches matches.
  const applyPoster = useCallback((slug: string, url: string) => {
    setResults(prev => prev.map(r => (r.slug === slug && !r.poster_url) ? { ...r, poster_url: url } : r))
    setSelected(prev => (prev && prev.slug === slug && !prev.poster_url) ? { ...prev, poster_url: url } : prev)
  }, [])

  // Search results never include posters (the site's search endpoint has no
  // covers) — resolve them lazily via /api/search/poster like the server's own UI.
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

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !serverUrl || !token) return
    setIsSearching(true)
    setSearchError(null)
    setResults([])
    try {
      const res = type === 'anime'
        ? await searchAnime(serverUrl, token, query.trim())
        : await searchSeries(serverUrl, token, query.trim())
      setResults(res)
      if (res.length === 0) setSearchError('No results found.')
      loadPosters(res)
    } catch {
      setSearchError('Search failed.')
    }
    setIsSearching(false)
  }, [query, serverUrl, token, type, loadPosters])

  const handleManualLookup = useCallback(async () => {
    if (!manualSlug.trim() || !serverUrl || !token) return
    setLoadingManual(true)
    setManualError(null)
    // Synthesise a search result from the manual slug so the detail panel opens
    const slug = manualSlug.trim()
    const synth: AnimeSearchResult = {
      title: slug,
      slug,
      url: manualUrl.trim() || slug,
      poster_url: null,
    }
    await handleSelect(synth)
    setLoadingManual(false)
  }, [manualSlug, manualUrl, serverUrl, token]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = async (result: AnimeSearchResult) => {
    setSelected(result)
    setInfo(null)
    setLoadingInfo(true)
    setAllSeasons(true)
    setSelectedSeasons(new Set())
    setLangKey(null)
    setMultilang(false)
    setExcludes({})
    setSubmitResult(null)

    if (serverUrl && token) {
      const data = await getMediaInfo(serverUrl, token, result.slug, type)
      setInfo(data)
      // Info includes the poster the search result lacks — reuse it everywhere
      if (data?.poster_url) {
        posterCache.set(`${type}:${result.slug}`, data.poster_url)
        applyPoster(result.slug, data.poster_url)
      }
      // Default: first lang_key from first season
      if (data?.seasons.length) {
        const firstKeys = data.seasons[0].lang_keys
        if (firstKeys.length) setLangKey(firstKeys[0])
      }
    }
    setLoadingInfo(false)
  }

  const handleClearSelection = () => {
    setSelected(null)
    setInfo(null)
    setSubmitResult(null)
  }

  // Compute available languages across selected seasons (or all)
  const availableLangKeys = React.useMemo(() => {
    if (!info) return []
    const seasons = allSeasons
      ? info.seasons
      : info.seasons.filter(s => selectedSeasons.has(s.number))
    if (!seasons.length) return []
    // Union of lang_keys across selected seasons
    const keySet = new Set<number>()
    seasons.forEach(s => s.lang_keys.forEach(k => keySet.add(k)))
    return [...keySet].sort()
  }, [info, allSeasons, selectedSeasons])

  const langMap = type === 'anime' ? LANG_KEY_MAP : SERIES_LANG_KEY_MAP

  const toggleSeason = (n: number) => {
    setSelectedSeasons(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  const parseExclude = (raw: string): number[] =>
    raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0)

  const buildExcludeEpisodes = (): Record<string, number[]> | null => {
    const result: Record<string, number[]> = {}
    Object.entries(excludes).forEach(([season, raw]) => {
      const parsed = parseExclude(raw)
      if (parsed.length) result[season] = parsed
    })
    return Object.keys(result).length ? result : null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected || !serverUrl || !token) return

    setIsSubmitting(true)
    setSubmitResult(null)

    const seasonsArray = allSeasons
      ? null
      : selectedSeasons.size ? [...selectedSeasons].sort() : null

    const excludeEpisodes = buildExcludeEpisodes()
    // Search results carry no poster for anime/series — the info response does
    const posterUrl = info?.poster_url ?? selected.poster_url ?? null

    let req: Awaited<ReturnType<typeof downloadAnime>> | null = null
    if (type === 'anime') {
      req = await downloadAnime(serverUrl, token, {
        slug: selected.slug,
        lang_key: multilang ? undefined : (langKey ?? undefined),
        multilang,
        seasons: seasonsArray,
        exclude_episodes: excludeEpisodes,
        poster_url: posterUrl,
      })
    } else {
      req = await downloadSeries(serverUrl, token, {
        slug: selected.slug,
        lang_key: langKey ?? undefined,
        seasons: seasonsArray,
        exclude_episodes: excludeEpisodes,
        poster_url: posterUrl,
      })
    }

    if (req) {
      setSubmitResult({ success: true })
      // Reset after success
      setTimeout(() => {
        setSelected(null)
        setInfo(null)
        setQuery('')
        setResults([])
        setSubmitResult(null)
      }, 2000)
    } else {
      setSubmitResult({ success: false, message: 'Request failed. Please try again.' })
    }
    setIsSubmitting(false)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (selected) {
    const detailPoster = info?.poster_url ?? selected.poster_url
    return (
      <div className="flex gap-4 min-h-96">
        {/* Left: search results */}
        <div className="w-56 flex-shrink-0 flex flex-col gap-2">
          <button
            onClick={handleClearSelection}
            className="flex items-center gap-1 text-sm text-white/50 hover:text-white/80 transition-colors mb-1"
          >
            <ChevronLeft size={16} />
            Back to search
          </button>
          <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar max-h-[520px]">
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(r)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors text-sm ${
                  r.slug === selected.slug
                    ? 'bg-theme-500/20 text-theme-300'
                    : 'hover:bg-white/10 text-white/70'
                }`}
              >
                <p className="font-medium truncate">{r.title}</p>
                <p className="text-xs text-white/40 truncate">{r.slug}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 min-w-0">
          {loadingInfo ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={28} className="animate-spin text-theme-400" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Header */}
              <div className="flex gap-4">
                {detailPoster ? (
                  <img
                    src={detailPoster}
                    alt={selected.title}
                    className="w-20 h-28 object-cover rounded-lg flex-shrink-0"
                  />
                ) : (
                  <div className="w-20 h-28 bg-white/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <ImageOff size={20} className="text-white/30" />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-semibold text-lg text-white truncate">{selected.title}</h3>
                  <p className="text-xs text-white/40 truncate">{selected.slug}</p>
                  {info?.description && (
                    <p className="text-xs text-white/50 mt-2 line-clamp-3">{info.description}</p>
                  )}
                  {info && (
                    <p className="text-xs text-theme-400 mt-1">
                      {info.seasons.length} season{info.seasons.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </div>

              {info ? (
                <>
                  {/* Season Selection */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-white/80">Seasons</label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setAllSeasons(true)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                          allSeasons
                            ? 'border-theme-500/50 bg-theme-500/10 text-theme-400'
                            : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                        }`}
                      >
                        All
                      </button>
                      {info.seasons.map((s: SeasonInfo) => (
                        <button
                          key={s.number}
                          type="button"
                          onClick={() => {
                            setAllSeasons(false)
                            toggleSeason(s.number)
                          }}
                          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                            !allSeasons && selectedSeasons.has(s.number)
                              ? 'border-theme-500/50 bg-theme-500/10 text-theme-400'
                              : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                          }`}
                        >
                          S{s.number}
                          <span className="text-xs ml-1 text-white/30">({s.episode_count}ep)</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Language Selection */}
                  {!multilang && availableLangKeys.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-white/80">Language</label>
                      <div className="flex flex-wrap gap-2">
                        {availableLangKeys.map(k => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setLangKey(k)}
                            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                              langKey === k
                                ? 'border-theme-500/50 bg-theme-500/10 text-theme-400'
                                : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                            }`}
                          >
                            {langMap[k] ?? `Lang ${k}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Multilang (anime only) */}
                  {type === 'anime' && (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <div
                        onClick={() => setMultilang(v => !v)}
                        className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${
                          multilang ? 'bg-theme-500' : 'bg-white/20'
                        }`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow ${
                          multilang ? 'translate-x-5' : 'translate-x-0.5'
                        }`} />
                      </div>
                      <div>
                        <p className="text-sm text-white/80">Multilanguage</p>
                        <p className="text-xs text-white/40">Merge German Dub + German Sub into one MKV</p>
                      </div>
                    </label>
                  )}

                  {/* Episode exclusion */}
                  {(allSeasons ? info.seasons : info.seasons.filter(s => selectedSeasons.has(s.number))).length > 0 && (
                    <details className="group">
                      <summary className="text-sm text-white/50 cursor-pointer hover:text-white/70 transition-colors list-none flex items-center gap-1">
                        <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                        Exclude episodes (optional)
                      </summary>
                      <div className="mt-3 space-y-2">
                        {(allSeasons ? info.seasons : info.seasons.filter(s => selectedSeasons.has(s.number))).map(s => (
                          <div key={s.number} className="flex items-center gap-2">
                            <span className="text-xs text-white/50 w-12 flex-shrink-0">S{s.number}:</span>
                            <input
                              type="text"
                              value={excludes[String(s.number)] ?? ''}
                              onChange={e => setExcludes(prev => ({ ...prev, [String(s.number)]: e.target.value }))}
                              placeholder="e.g. 1, 3, 5"
                              className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-theme-500/50"
                            />
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <p className="text-sm text-white/40">Could not load season details. Request will use defaults.</p>
              )}

              {/* Result feedback */}
              {submitResult && (
                <div className={`flex items-center gap-3 p-3 rounded-xl ${
                  submitResult.success
                    ? 'bg-theme-500/10 border border-theme-500/20 text-theme-400'
                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}>
                  {submitResult.success ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                  <span className="text-sm">
                    {submitResult.success ? 'Request submitted!' : submitResult.message}
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || (!allSeasons && selectedSeasons.size === 0)}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-theme-600 to-teal-500 hover:from-theme-500 hover:to-teal-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all"
              >
                {isSubmitting ? (
                  <><Loader2 size={18} className="animate-spin" /> Submitting...</>
                ) : (
                  <><Send size={18} /> Request {type === 'anime' ? 'Anime' : 'Series'}</>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  // ── Search / Manual view ─────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Mode tabs */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setInputMode('search')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            inputMode === 'search'
              ? 'border-theme-500/50 bg-theme-500/10 text-theme-400'
              : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10'
          }`}
        >
          <Search size={14} /> Search
        </button>
        <button
          type="button"
          onClick={() => setInputMode('manual')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            inputMode === 'manual'
              ? 'border-theme-500/50 bg-theme-500/10 text-theme-400'
              : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10'
          }`}
        >
          <PencilLine size={14} /> Manual
        </button>
      </div>

      {inputMode === 'search' ? (
        <>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleSearch())}
              placeholder={type === 'anime' ? 'Search anime...' : 'Search series...'}
              className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50 focus:border-transparent transition-all"
              disabled={isSearching}
              autoFocus
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={isSearching || !query.trim()}
              className="px-4 py-3 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-xl transition-colors"
            >
              {isSearching ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
            </button>
          </div>

          {searchError && <p className="text-xs text-yellow-400">{searchError}</p>}

          {results.length > 0 && (
            <div className="max-h-72 overflow-y-auto space-y-1 custom-scrollbar">
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelect(r)}
                  className="w-full flex items-center gap-3 text-left px-3 py-2 hover:bg-white/10 rounded-lg transition-colors"
                >
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
        /* Manual slug input */
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs text-white/60">
              Slug <span className="text-white/30">(e.g. sword-art-online)</span>
            </label>
            <input
              type="text"
              value={manualSlug}
              onChange={e => setManualSlug(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleManualLookup())}
              placeholder={type === 'anime' ? 'sword-art-online' : 'breaking-bad'}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50 focus:border-transparent transition-all"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-white/60">
              URL <span className="text-white/30">(optional, used if info fetch needs it)</span>
            </label>
            <input
              type="text"
              value={manualUrl}
              onChange={e => setManualUrl(e.target.value)}
              placeholder={
                type === 'anime'
                  ? 'https://aniworld.to/anime/stream/sword-art-online'
                  : 'https://s.to/serie/stream/breaking-bad'
              }
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50 focus:border-transparent transition-all"
            />
          </div>
          {manualError && <p className="text-xs text-red-400">{manualError}</p>}
          <button
            type="button"
            onClick={handleManualLookup}
            disabled={loadingManual || !manualSlug.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-xl text-sm text-white/80 transition-colors"
          >
            {loadingManual ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Load Details & Configure
          </button>
        </div>
      )}
    </div>
  )
}
