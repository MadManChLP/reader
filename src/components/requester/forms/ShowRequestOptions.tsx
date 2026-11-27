import React, { useEffect, useMemo, useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle, Send, ImageOff, AlertTriangle } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { getMediaInfo, downloadAnime, downloadSeries } from '../../../utils/requesterApi'
import { getEpisodeLangs } from '../../../utils/requesterDiscoverApi'
import { LANG_KEY_MAP, SERIES_LANG_KEY_MAP } from '../../../types/requester'
import type { MediaInfo, SeasonInfo } from '../../../types/requester'
import { useRequestSubmit } from './useRequestSubmit'

interface Props {
  type: 'anime' | 'serie'
  slug: string
  title: string
  posterUrl?: string | null
  /** Poster + title + description block (the search form); detail pages have their own header */
  showHeader?: boolean
  /** The info response carries the poster the search result lacks */
  onPoster?: (url: string) => void
  /** Called 2 s after a successful request (the form resets) */
  onDone?: () => void
}

/**
 * Season / language / multilang / exclude options plus the submit button for
 * one anime or series. Used by the search form and the title detail page.
 * Loads /api/info itself; checks per-episode language availability for the
 * chosen seasons (GET /api/info/episode-langs) before you submit.
 */
export function ShowRequestOptions({ type, slug, title, posterUrl, showHeader = true, onPoster, onDone }: Props) {
  const { serverUrl, token } = useRequester()

  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(true)
  const [allSeasons, setAllSeasons] = useState(true)
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(new Set())
  const [langKey, setLangKey] = useState<number | null>(null)
  const [multilang, setMultilang] = useState(false)
  const [excludes, setExcludes] = useState<Record<string, string>>({})
  // season → episodes missing in the chosen language
  const [langGaps, setLangGaps] = useState<Record<number, number[]>>({})
  const [checkingLangs, setCheckingLangs] = useState(false)

  const { isSubmitting, result: submitResult, submit, locked, confirmUi } = useRequestSubmit(() => onDone?.())

  useEffect(() => {
    if (!serverUrl || !token) return
    let cancelled = false
    setLoadingInfo(true)
    getMediaInfo(serverUrl, token, slug, type).then(data => {
      if (cancelled) return
      setInfo(data)
      if (data?.poster_url) onPoster?.(data.poster_url)
      const firstKeys = data?.seasons[0]?.lang_keys ?? []
      if (firstKeys.length) setLangKey(firstKeys[0])
      setLoadingInfo(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, token, slug, type])

  const chosenSeasons: SeasonInfo[] = useMemo(() => {
    if (!info) return []
    return allSeasons ? info.seasons : info.seasons.filter(s => selectedSeasons.has(s.number))
  }, [info, allSeasons, selectedSeasons])

  // Languages offered by ANY chosen season (union)
  const availableLangKeys = useMemo(() => {
    const keys = new Set<number>()
    chosenSeasons.forEach(s => s.lang_keys.forEach(k => keys.add(k)))
    return [...keys].sort((a, b) => a - b)
  }, [chosenSeasons])

  // Changing the seasons can drop the chosen language — pick a valid one
  useEffect(() => {
    if (availableLangKeys.length === 0) return
    if (langKey === null || !availableLangKeys.includes(langKey)) setLangKey(availableLangKeys[0])
  }, [availableLangKeys, langKey])

  // Per-episode language check for the chosen seasons (at most 6 requests)
  useEffect(() => {
    if (!serverUrl || !token || !info || multilang || langKey === null) { setLangGaps({}); return }
    const seasons = chosenSeasons.slice(0, 6)
    if (seasons.length === 0) { setLangGaps({}); return }
    let cancelled = false
    setCheckingLangs(true)
    const timer = window.setTimeout(() => {
      Promise.all(seasons.map(s =>
        getEpisodeLangs(serverUrl, token, slug, s.number, langKey, type)
          .then(map => [s.number, Object.entries(map).filter(([, ok]) => !ok).map(([ep]) => Number(ep)).sort((a, b) => a - b)] as const)
          .catch(() => [s.number, [] as number[]] as const),
      )).then(entries => {
        if (cancelled) return
        const gaps: Record<number, number[]> = {}
        for (const [season, missing] of entries) if (missing.length) gaps[season] = missing
        setLangGaps(gaps)
        setCheckingLangs(false)
      })
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer); setCheckingLangs(false) }
  }, [serverUrl, token, info, chosenSeasons, langKey, multilang, slug, type])

  const langMap = type === 'anime' ? LANG_KEY_MAP : SERIES_LANG_KEY_MAP

  const toggleSeason = (n: number) => {
    setAllSeasons(false)
    setSelectedSeasons(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  // "1, 3, 5-8" → [1, 3, 5, 6, 7, 8]
  const parseExclude = (raw: string): number[] => {
    const out = new Set<number>()
    for (const part of raw.split(',')) {
      const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/)
      if (!m) continue
      const a = Number(m[1])
      const b = m[2] ? Number(m[2]) : a
      for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 500; n++) if (n > 0) out.add(n)
    }
    return [...out].sort((x, y) => x - y)
  }

  const buildExcludeEpisodes = (): Record<string, number[]> | null => {
    const result: Record<string, number[]> = {}
    Object.entries(excludes).forEach(([season, raw]) => {
      const parsed = parseExclude(raw)
      if (parsed.length) result[season] = parsed
    })
    return Object.keys(result).length ? result : null
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!serverUrl || !token) return
    const seasons = allSeasons ? null : selectedSeasons.size ? [...selectedSeasons].sort((a, b) => a - b) : null
    const excludeEpisodes = buildExcludeEpisodes()
    const poster = info?.poster_url ?? posterUrl ?? null
    // Duplicates are checked by the server per season and language (409)
    void submit(null, title, (force) => type === 'anime'
      ? downloadAnime(serverUrl, token, {
          slug,
          lang_key: multilang ? undefined : (langKey ?? undefined),
          multilang,
          seasons,
          exclude_episodes: excludeEpisodes,
          poster_url: poster,
          force,
        })
      : downloadSeries(serverUrl, token, {
          slug,
          lang_key: langKey ?? undefined,
          seasons,
          exclude_episodes: excludeEpisodes,
          poster_url: poster,
          force,
        }))
  }

  const headerPoster = info?.poster_url ?? posterUrl
  const gapSeasons = Object.keys(langGaps).map(Number)

  if (loadingInfo) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 size={28} className="animate-spin text-theme-400" />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {showHeader && (
        <div className="flex gap-4">
          {headerPoster ? (
            <img src={headerPoster} alt={title} className="w-20 h-28 object-cover rounded-lg flex-shrink-0" />
          ) : (
            <div className="w-20 h-28 bg-white/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <ImageOff size={20} className="text-white/30" />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="font-semibold text-lg text-white truncate">{info?.title || title}</h3>
            <p className="text-xs text-white/40 truncate">{slug}</p>
            {info?.description && <p className="text-xs text-white/50 mt-2 line-clamp-3">{info.description}</p>}
            {info && (
              <p className="text-xs text-theme-400 mt-1">
                {info.seasons.length} season{info.seasons.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      )}

      {info ? (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Seasons</label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAllSeasons(true)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  allSeasons ? 'border-theme-500/50 bg-theme-500/10 text-theme-400' : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                }`}>
                All
              </button>
              {info.seasons.map(s => (
                <button key={s.number} type="button" onClick={() => toggleSeason(s.number)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    !allSeasons && selectedSeasons.has(s.number)
                      ? 'border-theme-500/50 bg-theme-500/10 text-theme-400'
                      : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                  }`}>
                  S{s.number}
                  <span className="text-xs ml-1 text-white/30">({s.episode_count}ep)</span>
                </button>
              ))}
            </div>
          </div>

          {!multilang && availableLangKeys.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Language</label>
              <div className="flex flex-wrap gap-2">
                {availableLangKeys.map(k => {
                  // Seasons that don't offer this language at all
                  const lacking = chosenSeasons.filter(s => !s.lang_keys.includes(k)).map(s => s.number)
                  return (
                    <button key={k} type="button" onClick={() => setLangKey(k)}
                      title={lacking.length ? `Not available for S${lacking.join(', S')}` : undefined}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        langKey === k ? 'border-theme-500/50 bg-theme-500/10 text-theme-400' : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                      }`}>
                      {langMap[k] ?? `Lang ${k}`}
                      {lacking.length > 0 && <span className="text-xs ml-1 text-amber-400/70">*</span>}
                    </button>
                  )
                })}
              </div>
              {checkingLangs && <p className="text-xs text-white/40 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Checking episodes…</p>}
              {!checkingLangs && gapSeasons.length > 0 && langKey !== null && (
                <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-amber-400" />
                  <div className="space-y-0.5">
                    <p>Not every episode exists in {langMap[langKey] ?? 'this language'} — these will be skipped:</p>
                    {gapSeasons.map(sn => (
                      <p key={sn} className="text-amber-200/70">S{sn}: episode {langGaps[sn].join(', ')}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {type === 'anime' && (
            <label className="flex items-center gap-3 cursor-pointer">
              <div onClick={() => setMultilang(v => !v)}
                className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${multilang ? 'bg-theme-500' : 'bg-white/20'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow ${multilang ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <div>
                <p className="text-sm text-white/80">Multilanguage</p>
                <p className="text-xs text-white/40">German dub, Japanese audio and German subs in one MKV</p>
              </div>
            </label>
          )}

          {chosenSeasons.length > 0 && (
            <details className="group">
              <summary className="text-sm text-white/50 cursor-pointer hover:text-white/70 transition-colors list-none flex items-center gap-1">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                Exclude episodes (optional)
              </summary>
              <div className="mt-3 space-y-2">
                {chosenSeasons.map(s => (
                  <div key={s.number} className="flex items-center gap-2">
                    <span className="text-xs text-white/50 w-12 flex-shrink-0">S{s.number}:</span>
                    <input type="text" value={excludes[String(s.number)] ?? ''}
                      onChange={e => setExcludes(prev => ({ ...prev, [String(s.number)]: e.target.value }))}
                      placeholder="e.g. 1, 3, 5-8"
                      className="flex-1 min-w-0 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-theme-500/50" />
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      ) : (
        <p className="text-sm text-white/40">Could not load season details. The request will use the defaults.</p>
      )}

      {submitResult && (
        <div className={`flex items-center gap-3 p-3 rounded-xl ${
          submitResult.success ? 'bg-theme-500/10 border border-theme-500/20 text-theme-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          {submitResult.success ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm">{submitResult.success ? 'Request submitted!' : submitResult.message}</span>
        </div>
      )}

      <div className="phone:sticky phone:bottom-0 phone:-mx-4 phone:px-4 phone:py-3 phone:bg-gray-900/95 phone:backdrop-blur">
        <button type="submit" disabled={locked || (!allSeasons && selectedSeasons.size === 0)}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-theme-600 hover:bg-theme-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-colors">
          {isSubmitting
            ? <><Loader2 size={18} className="animate-spin" /> Submitting...</>
            : <><Send size={18} /> Request {type === 'anime' ? 'Anime' : 'Series'}</>}
        </button>
      </div>
      {confirmUi}
    </form>
  )
}
