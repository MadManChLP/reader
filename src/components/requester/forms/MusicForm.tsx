import React, { useState, useCallback } from 'react'
import { Search, Loader2, CheckCircle2, AlertCircle, Music, Send, X, PencilLine } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { searchMusic, downloadMusic } from '../../../utils/requesterApi'
import type { MusicSearchResult } from '../../../types/requester'

type SearchType = 'artist' | 'album'

function isSpotifyUrl(s: string) {
  try {
    const u = new URL(s)
    return u.hostname === 'open.spotify.com'
  } catch { return false }
}

export function MusicForm() {
  const { serverUrl, token } = useRequester()

  const [inputMode, setInputMode] = useState<'search' | 'manual'>('search')
  const [query, setQuery] = useState('')
  const [searchType, setSearchType] = useState<SearchType>('album')
  const [results, setResults] = useState<MusicSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<MusicSearchResult | null>(null)
  // Manual
  const [manualUrl, setManualUrl] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message?: string } | null>(null)

  const manualUrlValid = manualUrl.trim() ? isSpotifyUrl(manualUrl.trim()) : null

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !serverUrl || !token) return
    setIsSearching(true)
    setSearchError(null)
    setResults([])
    try {
      const res = await searchMusic(serverUrl, token, query.trim(), searchType, 15)
      setResults(res)
      if (res.length === 0) setSearchError('No results found.')
    } catch {
      setSearchError('Search failed. Please try again.')
    }
    setIsSearching(false)
  }, [query, serverUrl, token, searchType])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!serverUrl || !token) return

    const url = selected?.spotify_url ?? (manualUrlValid ? manualUrl.trim() : null)
    if (!url) return

    setIsSubmitting(true)
    setSubmitResult(null)

    const req = await downloadMusic(serverUrl, token, url, selected?.name)
    if (req) {
      setSubmitResult({ success: true })
      setTimeout(() => {
        setSelected(null)
        setQuery('')
        setResults([])
        setManualUrl('')
        setSubmitResult(null)
      }, 2000)
    } else {
      setSubmitResult({ success: false, message: 'Request failed. Please try again.' })
    }
    setIsSubmitting(false)
  }

  const canSubmit = !!(selected?.spotify_url || manualUrlValid)

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Selected */}
      {selected && (
        <div className="flex items-center gap-3 p-4 bg-pink-500/10 border border-pink-500/20 rounded-xl">
          {selected.cover_url ? (
            <img src={selected.cover_url} alt={selected.name} className="w-12 h-12 object-cover rounded flex-shrink-0" />
          ) : (
            <div className="w-12 h-12 bg-white/10 rounded flex items-center justify-center flex-shrink-0">
              <Music size={18} className="text-white/40" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{selected.name}</p>
            <p className="text-xs text-white/50">
              {selected.type === 'album' ? `Album${selected.artist ? ` · ${selected.artist}` : ''}` : 'Artist'}
              {selected.year ? ` · ${selected.year}` : ''}
            </p>
          </div>
          <button type="button" onClick={() => { setSelected(null); setSubmitResult(null) }}
            className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X size={18} className="text-white/60" />
          </button>
        </div>
      )}

      {/* Search / Manual */}
      {!selected && (
        <>
          {/* Mode tabs */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setInputMode('search')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                inputMode === 'search'
                  ? 'border-pink-500/50 bg-pink-500/10 text-pink-400'
                  : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10'
              }`}>
              <Search size={14} /> Search
            </button>
            <button type="button" onClick={() => setInputMode('manual')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                inputMode === 'manual'
                  ? 'border-pink-500/50 bg-pink-500/10 text-pink-400'
                  : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10'
              }`}>
              <PencilLine size={14} /> Manual URL
            </button>
          </div>

          {inputMode === 'search' ? (
            <>
              {/* Type toggle */}
              <div className="flex gap-2">
                {(['album', 'artist'] as SearchType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSearchType(t)}
                    className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                      searchType === t
                        ? 'border-pink-500/50 bg-pink-500/10 text-pink-400'
                        : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleSearch())}
                  placeholder={`Search ${searchType}s...`}
                  className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-transparent transition-all"
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
                    <button key={i} type="button" onClick={() => { setSelected(r); setResults([]) }}
                      className="w-full flex items-center gap-3 text-left px-3 py-2 hover:bg-white/10 rounded-lg transition-colors">
                      {r.cover_url ? (
                        <img src={r.cover_url} alt={r.name} className={`w-10 h-10 object-cover flex-shrink-0 ${r.type === 'artist' ? 'rounded-full' : 'rounded'}`} />
                      ) : (
                        <div className="w-10 h-10 bg-white/10 rounded flex items-center justify-center flex-shrink-0">
                          <Music size={14} className="text-white/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-sm">{r.name}</p>
                        <p className="text-xs text-white/40 truncate">
                          {r.type === 'album' && r.artist ? `${r.artist}` : r.type}
                          {r.year ? ` · ${r.year}` : ''}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {results.length === 0 && !searchError && (
                <p className="text-sm text-white/30 text-center py-8">Search for an artist or album to get started</p>
              )}
            </>
          ) : (
            /* Manual Spotify URL */
            <div className="space-y-2">
              <label className="text-xs text-white/60">
                Spotify URL <span className="text-white/30">(artist or album)</span>
              </label>
              <input
                type="text"
                value={manualUrl}
                onChange={e => setManualUrl(e.target.value)}
                placeholder="https://open.spotify.com/album/..."
                className={`w-full px-4 py-3 bg-white/5 border rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${
                  manualUrlValid === false
                    ? 'border-red-500/50 focus:ring-red-500/50'
                    : manualUrlValid === true
                    ? 'border-theme-500/50 focus:ring-theme-500/50'
                    : 'border-white/10 focus:ring-pink-500/50'
                }`}
                autoFocus
              />
              {manualUrlValid === false && (
                <p className="text-xs text-red-400">Must be a valid open.spotify.com URL</p>
              )}
              {manualUrlValid === true && (
                <p className="text-xs text-theme-400">Valid Spotify URL</p>
              )}
              <p className="text-xs text-white/30">
                Paste a link from <span className="text-pink-400/70">Spotify</span> — artist or album URL
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
          <span className="text-sm">{submitResult.success ? 'Music request submitted!' : submitResult.message}</span>
        </div>
      )}

      {canSubmit && (
        <button type="submit" disabled={isSubmitting}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]">
          {isSubmitting ? (
            <><Loader2 size={20} className="animate-spin" /> Submitting...</>
          ) : (
            <><Send size={20} /> Request Music</>
          )}
        </button>
      )}
    </form>
  )
}
