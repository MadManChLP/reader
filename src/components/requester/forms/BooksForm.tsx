import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Loader2, CheckCircle2, AlertCircle, Send, BookOpen, Headphones, BookImage, Eye, ListChecks, X,
} from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { useToast } from '../../Toast'
import { useRequestSubmit } from './useRequestSubmit'
import { RequesterError, requesterErrorMessage } from '../../../utils/requesterApi'
import {
  searchBooks, getBookReleases, requestBook, requestManga, createMonitor,
} from '../../../utils/requesterBooksApi'
import type { BookCard, BookContentType, BookRelease } from '../../../types/requesterBooks'
import type { DownloadRequest } from '../../../types/requester'

/**
 * Book / audiobook / manga requests. Users request the TITLE; it stays pending
 * until an admin picks the release (shelfmark or a forum thread). Admins can
 * pick the shelfmark release right here, request a forum thread directly, and
 * put a manga on the watch list.
 */
export function BooksForm({ kind, initialQuery }: { kind: 'book' | 'manga'; initialQuery?: string }) {
  const { serverUrl, token, isAdmin } = useRequester()
  const toast = useToast()
  const [query, setQuery] = useState(initialQuery ?? '')
  const [results, setResults] = useState<BookCard[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<BookCard | null>(null)
  const [contentType, setContentType] = useState<BookContentType>('ebook')
  const [onlyNew, setOnlyNew] = useState(false)
  const [releases, setReleases] = useState<BookRelease[] | null>(null)
  const [releasesLoading, setReleasesLoading] = useState(false)
  const [releasesError, setReleasesError] = useState<string | null>(null)
  const [monitoring, setMonitoring] = useState(false)

  const reset = useCallback(() => { setSelected(null); setReleases(null) }, [])
  const { isSubmitting, result, submit, cancelReset, locked, confirmUi } = useRequestSubmit(reset)

  const search = useCallback(async (text?: string) => {
    const qText = (text ?? query).trim()
    if (qText.length < 2 || !serverUrl || !token) return
    cancelReset()
    setSearching(true)
    setSearchError(null)
    setSelected(null)
    setReleases(null)
    try {
      const res = await searchBooks(serverUrl, token, kind, qText)
      setResults(res)
      if (res.length === 0) setSearchError('Nothing found.')
    } catch (e) {
      setResults([])
      setSearchError(requesterErrorMessage(e, 'Search failed'))
    }
    setSearching(false)
  }, [query, serverUrl, token, kind, cancelReset])

  const autoRef = useRef(false)
  useEffect(() => {
    if (initialQuery && !autoRef.current) { autoRef.current = true; void search(initialQuery) }
  }, [initialQuery, search])

  const pick = (c: BookCard) => {
    cancelReset()
    setSelected(c)
    setReleases(null)
    setReleasesError(null)
  }

  const isForumCard = !!selected?.forum_source && !!selected?.thread_id
  const isBook = kind === 'book'
  const typLabel = isBook ? (contentType === 'audiobook' ? 'audiobook' : 'eBook') : 'manga'

  // Book/manga duplicates are a plain 409 without `force` — show the reason
  // instead of the "request anyway" prompt the other forms use
  const noForce = (fn: () => Promise<DownloadRequest>) => async () => {
    try { return await fn() } catch (e) {
      if (e instanceof RequesterError && e.status === 409) throw new Error(e.message)
      throw e
    }
  }

  const requestTitle = () => {
    if (!selected || !serverUrl || !token) return
    const c = selected
    if (isForumCard) {
      // Forum thread fallback: admins only (parts), books only (manga needs an AniList ID)
      void submit(null, c.title, noForce(() => requestBook(serverUrl, token, {
        content_type: contentType, parts: [{ source: c.forum_source!, thread_id: c.thread_id! }],
        title: c.title, cover_url: c.poster_url ?? null,
      })))
      return
    }
    if (isBook) {
      if (!c.provider || !c.provider_id) return
      const key = `book:${c.provider}:${c.provider_id}:${contentType}`
      void submit(key, c.title, noForce(() => requestBook(serverUrl, token, {
        provider: c.provider, book_id: c.provider_id, content_type: contentType,
        title: c.title, author: c.authors?.[0] ?? null, cover_url: c.poster_url ?? null,
      })))
    } else {
      if (c.anilist_id == null) return
      void submit(`anilist:${c.anilist_id}`, c.title, noForce(() => requestManga(serverUrl, token, {
        anilist_id: c.anilist_id!, title: c.title, poster_url: c.poster_url ?? null, update: onlyNew,
      })))
    }
  }

  const loadReleases = async () => {
    if (!selected?.provider || !selected.provider_id || !serverUrl || !token) return
    setReleasesLoading(true)
    setReleasesError(null)
    try {
      const r = await getBookReleases(serverUrl, token, selected.provider, selected.provider_id, contentType)
      setReleases(r)
      if (r.length === 0) setReleasesError('No releases in the configured languages.')
    } catch (e) {
      setReleasesError(requesterErrorMessage(e, 'Could not load releases'))
    }
    setReleasesLoading(false)
  }

  const requestRelease = (r: BookRelease) => {
    if (!selected?.provider || !selected.provider_id || !serverUrl || !token) return
    const c = selected
    void submit(null, c.title, noForce(() => requestBook(serverUrl, token, {
      provider: c.provider, book_id: c.provider_id, content_type: r.content_type ?? contentType,
      source_id: r.source_id, title: c.title, author: c.authors?.[0] ?? null, cover_url: c.poster_url ?? null,
    })))
  }

  const watch = async () => {
    if (!selected || !serverUrl || !token) return
    setMonitoring(true)
    try {
      const m = await createMonitor(serverUrl, token, isForumCard
        ? { thread_id: selected.thread_id, source: selected.forum_source, title: selected.title, poster_url: selected.poster_url ?? null }
        : { anilist_id: selected.anilist_id, title: selected.title, poster_url: selected.poster_url ?? null })
      toast.success(`Watching "${m.title}" for new volumes`)
    } catch (e) {
      toast.error(requesterErrorMessage(e, 'Could not add the monitor'))
    }
    setMonitoring(false)
  }

  // Changing ebook/audiobook invalidates the loaded releases
  useEffect(() => { setReleases(null); setReleasesError(null) }, [contentType])

  const canRequest = useMemo(() => {
    if (!selected) return false
    if (isForumCard) return isAdmin && isBook
    return isBook ? !!(selected.provider && selected.provider_id) : selected.anilist_id != null
  }, [selected, isForumCard, isAdmin, isBook])

  const Icon = isBook ? BookOpen : BookImage

  return (
    <div className="space-y-4">
      {confirmUi}
      <form onSubmit={(e) => { e.preventDefault(); void search() }} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input value={query} onChange={e => { setQuery(e.target.value); cancelReset() }}
            placeholder={isBook ? 'Title or author…' : 'Manga title…'}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-white/5 border border-white/10 focus:border-theme-500/50 outline-none text-sm" />
        </div>
        <button type="submit" disabled={searching || query.trim().length < 2}
          className="px-4 py-2.5 rounded-lg bg-theme-600 hover:bg-theme-500 disabled:opacity-40 text-sm font-medium flex items-center gap-2">
          {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          <span className="phone:hidden">Search</span>
        </button>
      </form>

      {searchError && <p className="text-sm text-white/50 flex items-center gap-2"><AlertCircle size={14} />{searchError}</p>}

      {!selected && results.length > 0 && (
        <ul className="space-y-2 max-h-[28rem] overflow-y-auto custom-scrollbar pr-1">
          {results.map((c, i) => (
            <li key={`${c.anilist_id ?? c.provider_id ?? c.thread_id ?? i}:${i}`}>
              <button type="button" onClick={() => pick(c)}
                className="w-full flex gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-left">
                {c.poster_url
                  ? <img src={c.poster_url} alt="" loading="lazy" className="w-12 h-[4.5rem] object-cover rounded flex-shrink-0" />
                  : <div className="w-12 h-[4.5rem] rounded bg-white/10 flex items-center justify-center flex-shrink-0"><Icon size={18} className="text-white/30" /></div>}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{c.title}</p>
                  <p className="text-xs text-white/50 truncate">
                    {[c.authors?.join(', '), c.subtitle].filter(Boolean).join(' · ')}
                  </p>
                  {c.forum_source && <p className="text-[11px] text-amber-300/70">Forum thread ({c.forum_source})</p>}
                  {c.overview && <p className="text-xs text-white/40 line-clamp-2 mt-0.5">{c.overview}</p>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="space-y-4">
          <div className="flex gap-3">
            {selected.poster_url
              ? <img src={selected.poster_url} alt="" className="w-20 h-28 object-cover rounded-lg flex-shrink-0" />
              : <div className="w-20 h-28 rounded-lg bg-white/10 flex-shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <p className="font-semibold text-white flex-1">{selected.title}</p>
                <button type="button" onClick={() => { setSelected(null); setReleases(null) }} title="Back to results"
                  className="p-1 rounded hover:bg-white/10 text-white/50"><X size={16} /></button>
              </div>
              <p className="text-xs text-white/50">{[selected.authors?.join(', '), selected.subtitle].filter(Boolean).join(' · ')}</p>
              {selected.overview && <p className="text-xs text-white/40 line-clamp-4 mt-1">{selected.overview}</p>}
            </div>
          </div>

          {isBook && (
            <div className="flex gap-2">
              {(['ebook', 'audiobook'] as const).map(ct => (
                <button key={ct} type="button" onClick={() => setContentType(ct)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${contentType === ct
                    ? 'border-theme-500/50 bg-theme-500/10 text-theme-300' : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'}`}>
                  {ct === 'ebook' ? <BookOpen size={15} /> : <Headphones size={15} />}
                  {ct === 'ebook' ? 'eBook' : 'Audiobook'}
                </button>
              ))}
            </div>
          )}

          {!isBook && !isForumCard && (
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} className="accent-theme-500" />
              Only volumes that came out since an earlier download
            </label>
          )}

          {isForumCard && !canRequest && (
            <p className="text-xs text-white/50">
              {isAdmin
                ? 'A manga forum thread can\'t be requested without its AniList entry — search for the series title, or watch the thread for new volumes.'
                : 'Only a catalogue result can be requested. Try a different spelling of the title.'}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {canRequest && (
              <button type="button" onClick={requestTitle} disabled={locked}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-theme-600 hover:bg-theme-500 disabled:opacity-50 text-sm font-medium">
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {isForumCard ? `Request this thread as ${typLabel}` : `Request ${typLabel}`}
              </button>
            )}
            {isAdmin && isBook && !isForumCard && selected.provider && (
              <button type="button" onClick={() => void loadReleases()} disabled={releasesLoading || locked}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 text-sm">
                {releasesLoading ? <Loader2 size={16} className="animate-spin" /> : <ListChecks size={16} />}
                Pick release now
              </button>
            )}
            {isAdmin && !isBook && (
              <button type="button" onClick={() => void watch()} disabled={monitoring}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 text-sm">
                {monitoring ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                Watch for new volumes
              </button>
            )}
          </div>
          {!isAdmin && canRequest && (
            <p className="text-[11px] text-white/40">An admin picks the release before the download starts.</p>
          )}

          {releasesError && <p className="text-sm text-white/50 flex items-center gap-2"><AlertCircle size={14} />{releasesError}</p>}
          {releases && releases.length > 0 && (
            <ul className="space-y-1.5 max-h-80 overflow-y-auto custom-scrollbar pr-1">
              {releases.map(r => (
                <li key={r.source_id} className="flex items-center gap-2 p-2 rounded-lg bg-white/5 border border-white/5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white/90 truncate" title={r.title}>{r.title}</p>
                    <p className="text-[11px] text-white/40 truncate">
                      {[r.format, r.language, r.size, r.indexer ?? r.source, r.seeders != null ? `${r.seeders} seeders` : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button type="button" onClick={() => requestRelease(r)} disabled={locked}
                    className="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-theme-600/80 hover:bg-theme-500 text-xs disabled:opacity-50">Download</button>
                </li>
              ))}
            </ul>
          )}

          {result && (
            <p className={`text-sm flex items-center gap-2 ${result.success ? 'text-emerald-300' : 'text-red-300'}`}>
              {result.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              {result.success ? 'Requested' : result.message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
