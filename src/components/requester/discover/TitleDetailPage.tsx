import React, { useEffect, useMemo, useState } from 'react'
import {
  Loader2, AlertCircle, ExternalLink, Star, Clock, CalendarPlus, Film, Send, CheckCircle2, CalendarClock,
} from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { PageHeader } from './PageHeader'
import { PosterCard, StatusBadge } from './PosterCard'
import { openDiscoverItem } from './openItem'
import { ShowRequestOptions } from '../forms/ShowRequestOptions'
import { useRequestSubmit } from '../forms/useRequestSubmit'
import { getShowDetails, getMovieDetails } from '../../../utils/requesterDiscoverApi'
import { downloadMovie, addScheduleEntry, requesterErrorMessage } from '../../../utils/requesterApi'
import { useRequesterNav } from '../../../stores/requesterNavStore'
import { useToast } from '../../Toast'
import { DAY_NAMES } from '../../../types/requester'
import type { GenreLink, MovieDetails, ShowDetails, TitleRequestInfo } from '../../../types/requesterDiscover'
import api from '../../../utils/api'

type Props =
  | { kind: 'anime' | 'series'; slug: string; title?: string; poster?: string | null }
  | { kind: 'movie'; tmdbId: number; title?: string; poster?: string | null }

/** Detail page for one anime, series or movie from Discover / Upcoming / genres. */
export function TitleDetailPage(props: Props) {
  const { serverUrl, token } = useRequester()
  const [show, setShow] = useState<ShowDetails | null>(null)
  const [movie, setMovie] = useState<MovieDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const idKey = props.kind === 'movie' ? `movie:${props.tmdbId}` : `${props.kind}:${props.slug}`

  useEffect(() => {
    if (!serverUrl || !token) return
    let cancelled = false
    setError(null)
    const p = props.kind === 'movie'
      ? getMovieDetails(serverUrl, token, props.tmdbId).then(m => { if (!cancelled) setMovie(m) })
      : getShowDetails(serverUrl, token, props.kind, props.slug).then(s => { if (!cancelled) setShow(s) })
    p.catch(e => { if (!cancelled) setError(requesterErrorMessage(e, 'Could not load the details')) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, token, idKey])

  const details = props.kind === 'movie' ? movie : show
  if (error && !details) {
    return (
      <div>
        <PageHeader title={props.title} />
        <div className="flex flex-col items-center py-16 gap-2 text-center px-6">
          <AlertCircle size={28} className="text-red-400/70" />
          <p className="text-sm text-white/60">{error}</p>
        </div>
      </div>
    )
  }
  if (!details) {
    return (
      <div>
        <PageHeader title={props.title} />
        <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-theme-400" /></div>
      </div>
    )
  }

  const poster = details.poster_url || props.poster
  const backdrop = details.backdrop_url
  const description = props.kind === 'movie' ? movie?.overview : show?.description

  return (
    <div className="pb-12">
      {/* Hero */}
      <div className="relative">
        {backdrop && (
          <div className="absolute inset-0 h-80 phone:h-56 overflow-hidden">
            <img src={backdrop} alt="" aria-hidden className="w-full h-full object-cover opacity-40" />
            <div className="absolute inset-0 bg-gradient-to-b from-gray-900/30 via-gray-900/70 to-gray-900" />
          </div>
        )}
        <div className="relative">
          <PageHeader />
          <div className="px-8 phone:px-4 flex phone:flex-col phone:items-center gap-6 phone:gap-4">
            <div className="w-44 phone:w-36 flex-shrink-0">
              <div className="aspect-[2/3] rounded-xl overflow-hidden bg-white/5 shadow-2xl ring-1 ring-white/10">
                {poster
                  ? <img src={poster} alt={details.title} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><Film size={32} className="text-white/20" /></div>}
              </div>
            </div>
            <div className="min-w-0 flex-1 phone:text-center space-y-2 pt-2">
              <div className="flex items-center gap-2 phone:justify-center flex-wrap">
                <StatusBadge status={details.status} />
                <span className="text-xs uppercase tracking-wider text-white/50">
                  {props.kind === 'movie' ? 'Movie' : props.kind === 'anime' ? 'Anime' : 'Series'}
                </span>
              </div>
              <h1 className="text-3xl phone:text-2xl font-bold leading-tight">{details.title}</h1>
              {movie?.tagline && <p className="text-sm italic text-white/60">{movie.tagline}</p>}
              <MetaLine kind={props.kind} show={show} movie={movie} />
              <GenreRow links={details.genre_links} genres={details.genres} kind={props.kind} />
              {description && <p className="text-sm text-white/70 leading-relaxed max-w-3xl whitespace-pre-line">{description}</p>}
              {movie?.directors?.length ? (
                <p className="text-xs text-white/50">Directed by {movie.directors.join(', ')}</p>
              ) : null}
              {movie?.cast?.length ? (
                <p className="text-xs text-white/40 line-clamp-2">
                  {movie.cast.slice(0, 8).map(c => typeof c === 'string' ? c : c.name).join(' · ')}
                </p>
              ) : null}
              {show?.source_url && (
                <button type="button" onClick={() => void api.openExternal(show.source_url!)}
                  className="inline-flex items-center gap-1 text-xs text-theme-400 hover:text-theme-300">
                  <ExternalLink size={12} /> Source page
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 phone:px-4 mt-8 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem] gap-8">
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 phone:p-4 min-w-0">
          <h2 className="font-semibold mb-4">Request</h2>
          {props.kind === 'movie'
            ? <MovieRequest tmdbId={props.tmdbId} movie={movie!} />
            : <ShowRequestOptions type={props.kind === 'series' ? 'serie' : 'anime'} slug={props.slug}
                title={details.title} posterUrl={poster} showHeader={false} />}
        </div>

        <div className="space-y-6 min-w-0">
          <ExistingRequests requests={details.requests} />
          {props.kind !== 'movie' && <AddToSchedule kind={props.kind} slug={props.slug} title={details.title} seasons={show?.season_count ?? null} />}
        </div>
      </div>

      {movie?.recommendations?.length ? (
        <div className="mt-10">
          <h2 className="px-8 phone:px-4 text-lg font-semibold mb-4">You might also like</h2>
          <div className="px-8 phone:px-4 flex gap-4 overflow-x-auto scrollbar-hide snap-x pb-2">
            {movie.recommendations.map((r, i) => (
              <PosterCard key={r.tmdb_id ?? i} title={r.title} subtitle={r.year ? String(r.year) : null}
                posterUrl={r.poster_url} status={r.status} onClick={() => openDiscoverItem(r)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MetaLine({ kind, show, movie }: { kind: string; show: ShowDetails | null; movie: MovieDetails | null }) {
  const parts: React.ReactNode[] = []
  const year = movie?.year ?? show?.year
  if (year) parts.push(String(year))
  if (kind === 'movie') {
    if (movie?.runtime) parts.push(<span key="rt" className="inline-flex items-center gap-1"><Clock size={12} />{Math.floor(movie.runtime / 60) ? `${Math.floor(movie.runtime / 60)} h ` : ''}{movie.runtime % 60} min</span>)
    if (movie?.rating) parts.push(<span key="r" className="inline-flex items-center gap-1"><Star size={12} className="text-amber-400" />{movie.rating.toFixed(1)}</span>)
    if (movie?.release_status && movie.release_status !== 'Released') parts.push(movie.release_status)
  } else {
    if (show?.season_count) parts.push(`${show.season_count} season${show.season_count === 1 ? '' : 's'}`)
    if (show?.age_rating) parts.push(`FSK ${show.age_rating}`)
  }
  if (parts.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/60 phone:justify-center">
      {parts.map((p, i) => <span key={i}>{p}</span>)}
    </div>
  )
}

/** Genre chips; links from the server look like /ui/genre/<id>?type=anime */
function GenreRow({ links, genres, kind }: { links?: GenreLink[]; genres?: string[]; kind: 'anime' | 'series' | 'movie' }) {
  const push = useRequesterNav(s => s.push)
  const items = links?.length ? links : (genres ?? []).map(name => ({ name, href: null }))
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 phone:justify-center">
      {items.map(g => {
        const id = g.href?.match(/\/genre\/([^?/#]+)/)?.[1]
        return id ? (
          <button key={g.name} type="button"
            onClick={() => push({ type: 'genre', id: decodeURIComponent(id), label: g.name, kind })}
            className="px-2.5 py-0.5 rounded-full text-xs bg-white/10 hover:bg-theme-500/20 text-white/70 hover:text-theme-300 transition-colors">
            {g.name}
          </button>
        ) : (
          <span key={g.name} className="px-2.5 py-0.5 rounded-full text-xs bg-white/5 text-white/50">{g.name}</span>
        )
      })}
    </div>
  )
}

function MovieRequest({ tmdbId, movie }: { tmdbId: number; movie: MovieDetails }) {
  const { serverUrl, token } = useRequester()
  const { isSubmitting, result, submit, locked, confirmUi } = useRequestSubmit(() => {})
  const inLibrary = movie.status === 'available' || movie.status === 'downloaded'
  const alreadyRequested = movie.status === 'pending' || movie.status === 'processing' || movie.status === 'upcoming'
  const unreleased = !!movie.release_date && new Date(movie.release_date).getTime() > Date.now()

  const onRequest = () => {
    if (!serverUrl || !token) return
    const key = movie.imdb_id ?? `tmdb:${tmdbId}`
    void submit(key, movie.title, (force) => downloadMovie(serverUrl, token, { imdb_id: movie.imdb_id, tmdb_id: tmdbId }, movie.poster_url, force))
  }

  return (
    <div className="space-y-4">
      {inLibrary && <p className="text-sm text-emerald-300/80">This movie is already in your library.</p>}
      {alreadyRequested && <p className="text-sm text-amber-300/80">Somebody already requested this movie.</p>}
      {unreleased && (
        <p className="text-sm text-sky-300/80 flex items-center gap-2">
          <CalendarClock size={16} />
          Not out yet ({new Date(movie.release_date!).toLocaleDateString()}) — the request waits and downloads it once it's released.
        </p>
      )}
      {result && (
        <div className={`flex items-center gap-3 p-3 rounded-xl ${result.success ? 'bg-theme-500/10 border border-theme-500/20 text-theme-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
          {result.success ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm">{result.success ? 'Request submitted!' : result.message}</span>
        </div>
      )}
      <button type="button" onClick={onRequest} disabled={locked}
        className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-theme-600 hover:bg-theme-500 disabled:opacity-50 rounded-xl text-white font-semibold transition-colors">
        {isSubmitting ? <><Loader2 size={18} className="animate-spin" /> Submitting...</>
          : <><Send size={18} /> {inLibrary || alreadyRequested ? 'Request anyway' : 'Request movie'}</>}
      </button>
      {confirmUi}
    </div>
  )
}

const REQ_LABEL: Record<string, string> = {
  pending: 'Waiting for approval', approved: 'Approved', queued: 'Queued', downloading: 'Downloading',
  retrying: 'Retrying', complete: 'Done', partial: 'Partly done', error: 'Failed', rejected: 'Rejected',
  cancelled: 'Cancelled', upcoming: 'Waiting for release', not_found: 'Not found',
}

function ExistingRequests({ requests }: { requests?: TitleRequestInfo[] }) {
  if (!requests?.length) return null
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-white/80 mb-3">Existing requests</h3>
      <ul className="space-y-2">
        {requests.map((r, i) => (
          <li key={i} className="text-xs flex items-center justify-between gap-2">
            <span className="text-white/70">
              {r.season != null ? `Season ${r.season}` : 'All seasons'}{r.lang ? ` · ${r.lang}` : ''}
            </span>
            <span className="text-white/50">{REQ_LABEL[r.status] ?? r.status}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Admins: add this show to the weekly schedule (one season, one weekday). */
function AddToSchedule({ kind, slug, title, seasons }: { kind: 'anime' | 'series'; slug: string; title: string; seasons: number | null }) {
  const { serverUrl, token, isAdmin } = useRequester()
  const toast = useToast()
  const [day, setDay] = useState(((new Date().getDay() + 6) % 7) + 1)
  const [season, setSeason] = useState(seasons ?? 1)
  const [lang, setLang] = useState('German Dub')
  const [saving, setSaving] = useState(false)
  const seasonOptions = useMemo(() => Array.from({ length: Math.max(1, seasons ?? 1) }, (_, i) => i + 1), [seasons])
  if (!isAdmin) return null

  const add = async () => {
    if (!serverUrl || !token) return
    setSaving(true)
    try {
      const entry = await addScheduleEntry(serverUrl, token, { slug, typ: kind === 'series' ? 'serie' : 'anime', day, season, lang, title })
      if (entry) toast.success(`Added to the schedule (${DAY_NAMES[day]})`)
      else toast.error('Could not add it to the schedule')
    } catch (e) {
      toast.error(requesterErrorMessage(e, 'Could not add it to the schedule'))
    }
    setSaving(false)
  }

  const sel = 'px-2 py-1.5 rounded-lg text-sm bg-white/5 border border-white/10 text-white/80 focus:outline-none'
  return (
    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-amber-300 flex items-center gap-2"><CalendarPlus size={14} /> Weekly schedule</h3>
      <p className="text-xs text-white/40">Download new episodes of one season automatically the day after they air.</p>
      <div className="grid grid-cols-2 gap-2">
        <select value={season} onChange={e => setSeason(Number(e.target.value))} className={sel}>
          {seasonOptions.map(n => <option key={n} value={n} className="bg-gray-900">Season {n}</option>)}
        </select>
        <select value={day} onChange={e => setDay(Number(e.target.value))} className={sel}>
          {Object.entries(DAY_NAMES).map(([n, name]) => <option key={n} value={n} className="bg-gray-900">{name}</option>)}
        </select>
        <select value={lang} onChange={e => setLang(e.target.value)} className={`${sel} col-span-2`}>
          {(kind === 'anime' ? ['German Dub', 'German Sub', 'English Sub'] : ['German Dub', 'English Dub']).map(l =>
            <option key={l} value={l} className="bg-gray-900">{l}</option>)}
        </select>
      </div>
      <button type="button" onClick={add} disabled={saving}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-sm transition-colors disabled:opacity-50">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />} Add to schedule
      </button>
    </div>
  )
}
