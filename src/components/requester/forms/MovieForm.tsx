import React, { useState, useCallback } from 'react'
import { Search, Loader2, CheckCircle2, AlertCircle, Film, Send, X, PencilLine } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { searchMovies, downloadMovie, requesterErrorMessage } from '../../../utils/requesterApi'
import { useRequestSubmit } from './useRequestSubmit'
import type { MovieSearchResult } from '../../../types/requester'

export function MovieForm({ initialQuery }: { initialQuery?: string } = {}) {
  const { serverUrl, token } = useRequester()

  const [inputMode, setInputMode] = useState<'search' | 'manual'>('search')
  const [query, setQuery] = useState(initialQuery ?? '')
  const [results, setResults] = useState<MovieSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<MovieSearchResult | null>(null)
  // Manual
  const [manualImdbId, setManualImdbId] = useState('')

  const resetForm = useCallback(() => {
    setSelected(null)
    setQuery('')
    setResults([])
    setManualImdbId('')
  }, [])
  const { isSubmitting, result: submitResult, submit, cancelReset, locked, confirmUi } = useRequestSubmit(resetForm)

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !serverUrl || !token) return
    cancelReset()
    setIsSearching(true)
    setSearchError(null)
    setResults([])
    try {
      const res = await searchMovies(serverUrl, token, query.trim())
      setResults(res)
      if (res.length === 0) setSearchError('No results found.')
    } catch (e) {
      setSearchError(requesterErrorMessage(e, 'Search failed. Please try again.'))
    }
    setIsSearching(false)
  }, [query, serverUrl, token, cancelReset])

  // Pre-filled query searches right away
  const autoSearchedRef = React.useRef(false)
  React.useEffect(() => {
    if (initialQuery && !autoSearchedRef.current) { autoSearchedRef.current = true; void handleSearch() }
  }, [initialQuery, handleSearch])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!serverUrl || !token) return
    // Search results may be TMDB-only (no IMDb ID); send whichever IDs exist
    const ids = selected
      ? { imdb_id: selected.imdb_id, tmdb_id: selected.tmdb_id ?? null }
      : { imdb_id: manualImdbId.trim() || null, tmdb_id: null }
    if (!ids.imdb_id && ids.tmdb_id == null) return
    // The server stores url = IMDb ID, or "tmdb:<id>" without one
    const key = ids.imdb_id ?? `tmdb:${ids.tmdb_id}`
    const posterUrl = selected?.poster_url ?? null
    void submit(key, selected?.title ?? key, (force) => downloadMovie(serverUrl, token, ids, posterUrl, force))
  }

  const canSubmit = !!(selected || manualImdbId.trim())

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Selected movie (from search) */}
      {selected && (
        <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          {selected.poster_url ? (
            <img src={selected.poster_url} alt={selected.title} className="w-10 h-14 object-cover rounded flex-shrink-0" />
          ) : (
            <div className="w-10 h-14 bg-white/10 rounded flex items-center justify-center flex-shrink-0">
              <Film size={16} className="text-white/40" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{selected.title}</p>
            <p className="text-xs text-white/50">{[selected.year, selected.imdb_id].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={() => { cancelReset(); setSelected(null) }}
            className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X size={18} className="text-white/60" />
          </button>
        </div>
      )}

      {/* Tabs + Search/Manual */}
      {!selected && (
        <>
          {/* Mode tabs */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setInputMode('search')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                inputMode === 'search'
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                  : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10'
              }`}>
              <Search size={14} /> Search
            </button>
            <button type="button" onClick={() => setInputMode('manual')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                inputMode === 'manual'
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                  : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10'
              }`}>
              <PencilLine size={14} /> Manual IMDB ID
            </button>
          </div>

          {inputMode === 'search' ? (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={e => { cancelReset(); setQuery(e.target.value) }}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleSearch())}
                  placeholder="Search movies..."
                  className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent transition-all"
                  disabled={isSearching}
                  autoFocus
                />
                <button type="button" onClick={handleSearch}
                  disabled={isSearching || !query.trim()}
                  className="px-4 py-3 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-xl transition-colors">
                  {isSearching ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
                </button>
              </div>
              {searchError && <p className="text-xs text-yellow-400">{searchError}</p>}

              {results.length > 0 && (
                <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar bg-white/5 rounded-xl p-2">
                  {results.map((r, i) => (
                    <button key={i} type="button" onClick={() => { cancelReset(); setSelected(r); setResults([]) }}
                      className="w-full flex items-center gap-3 text-left px-3 py-2 hover:bg-white/10 rounded-lg transition-colors">
                      {r.poster_url ? (
                        <img src={r.poster_url} alt={r.title} className="w-10 h-14 object-cover rounded flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-14 bg-white/10 rounded flex items-center justify-center flex-shrink-0">
                          <Film size={16} className="text-white/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{r.title}</p>
                        <p className="text-xs text-white/50">{r.year}</p>
                        {r.imdb_id && <p className="text-xs text-white/30">{r.imdb_id}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {results.length === 0 && !searchError && (
                <p className="text-sm text-white/30 text-center py-8">Search for a movie to get started</p>
              )}
            </>
          ) : (
            /* Manual IMDB ID */
            <div className="space-y-2">
              <label className="text-xs text-white/60">
                IMDB ID <span className="text-white/30">(e.g. tt0111161)</span>
              </label>
              <input
                type="text"
                value={manualImdbId}
                onChange={e => { cancelReset(); setManualImdbId(e.target.value) }}
                placeholder="tt0111161"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent transition-all"
                autoFocus
              />
              <p className="text-xs text-white/30">
                Find the ID on <span className="text-amber-400/70">imdb.com</span> — it starts with <code className="text-white/50">tt</code>
              </p>
            </div>
          )}
        </>
      )}

      {submitResult && (
        <div className={`flex items-center gap-3 p-4 rounded-xl ${
          submitResult.success
            ? 'bg-theme-500/10 border border-theme-500/20 text-theme-400'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          {submitResult.success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span className="text-sm">{submitResult.success ? 'Movie request submitted!' : submitResult.message}</span>
        </div>
      )}

      {canSubmit && (
        <button type="submit" disabled={locked}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]">
          {isSubmitting ? (
            <><Loader2 size={20} className="animate-spin" /> Submitting...</>
          ) : (
            <><Send size={20} /> Request Movie</>
          )}
        </button>
      )}
      {confirmUi}
    </form>
  )
}
