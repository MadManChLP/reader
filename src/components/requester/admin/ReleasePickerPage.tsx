import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertCircle, Search, CheckCircle2, ExternalLink, Send, X } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { PageHeader } from '../discover/PageHeader'
import { useToast } from '../../Toast'
import { useConfirm } from '../../ConfirmDialog'
import { useRequesterLive } from '../../../stores/requesterLiveStore'
import { useRequesterNav } from '../../../stores/requesterNavStore'
import { getPendingRequests, decideRequest, requesterErrorMessage } from '../../../utils/requesterApi'
import {
  getBookReleases, searchForum, approveWithRelease, parseBookKey,
} from '../../../utils/requesterBooksApi'
import { TYPE_LABEL } from '../requests/statusConfig'
import api from '../../../utils/api'
import type { DownloadRequest } from '../../../types/requester'
import type { BookContentType, BookRelease, ForumKind, ForumThread } from '../../../types/requesterBooks'

/**
 * Admin: approve a pending book / audiobook / manga request by picking its
 * release — a shelfmark release (books) or one or more forum threads (all
 * volumes, every hoster). Locked link containers (Keeplinks / Filecrypt) and
 * per-volume hoster choices stay in the server's web UI; the server answers
 * 409 with the reason when a thread can't be downloaded as is.
 */
export function ReleasePickerPage({ id }: { id: number }) {
  const { serverUrl, token } = useRequester()
  const toast = useToast()
  const [confirm, confirmUi] = useConfirm()
  const pop = useRequesterNav(s => s.pop)
  const fromHistory = useRequesterLive(s => s.history.find(h => h.id === id))
  const [req, setReq] = useState<DownloadRequest | null>(fromHistory ?? null)
  const [loadingReq, setLoadingReq] = useState(!fromHistory)

  useEffect(() => {
    if (req || !serverUrl || !token) return
    let cancelled = false
    void getPendingRequests(serverUrl, token).then(list => {
      if (cancelled) return
      setReq(list.find(r => r.id === id) ?? null)
      setLoadingReq(false)
    })
    return () => { cancelled = true }
  }, [req, id, serverUrl, token])

  const book = useMemo(() => parseBookKey(req?.url), [req?.url])
  const contentType: BookContentType = book?.contentType ?? (req?.typ === 'audiobook' ? 'audiobook' : 'ebook')
  const forumKind: ForumKind = req?.typ === 'manga' ? 'manga' : contentType === 'audiobook' ? 'audiobook' : 'book'
  const [tab, setTab] = useState<'releases' | 'forum'>('forum')
  useEffect(() => { if (book) setTab('releases') }, [book])

  // Shelfmark releases
  const [releases, setReleases] = useState<BookRelease[] | null>(null)
  const [relError, setRelError] = useState<string | null>(null)
  const [relLoading, setRelLoading] = useState(false)
  useEffect(() => {
    if (tab !== 'releases' || !book || releases || !serverUrl || !token) return
    setRelLoading(true)
    getBookReleases(serverUrl, token, book.provider, book.bookId, book.contentType)
      .then(r => { setReleases(r); if (!r.length) setRelError('No shelfmark releases in the configured languages.') })
      .catch(e => setRelError(requesterErrorMessage(e, 'Could not load releases')))
      .finally(() => setRelLoading(false))
  }, [tab, book, releases, serverUrl, token])

  // Forum threads
  const [query, setQuery] = useState('')
  useEffect(() => { if (req?.title && !query) setQuery(req.title) }, [req?.title]) // eslint-disable-line react-hooks/exhaustive-deps
  const [threads, setThreads] = useState<ForumThread[] | null>(null)
  const [forumError, setForumError] = useState<string | null>(null)
  const [forumLoading, setForumLoading] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const threadKey = (t: ForumThread) => `${t.source}:${t.thread_id}`

  const runForumSearch = useCallback(async (text: string) => {
    if (!serverUrl || !token || text.trim().length < 2) return
    setForumLoading(true)
    setForumError(null)
    setPicked(new Set())
    try {
      const r = await searchForum(serverUrl, token, forumKind, text.trim())
      setThreads(r)
      if (!r.length) setForumError('No threads found.')
    } catch (e) {
      setThreads([])
      setForumError(requesterErrorMessage(e, 'Forum search failed'))
    }
    setForumLoading(false)
  }, [serverUrl, token, forumKind])

  const autoSearched = React.useRef(false)
  useEffect(() => {
    if (tab === 'forum' && req?.title && !autoSearched.current) { autoSearched.current = true; void runForumSearch(req.title) }
  }, [tab, req?.title, runForumSearch])

  const [busy, setBusy] = useState(false)
  const done = (r: DownloadRequest) => {
    useRequesterLive.getState().patch(id, r)
    void useRequesterLive.getState().reload()
    toast.success('Approved — download queued')
    pop()
  }

  const pickRelease = async (r: BookRelease) => {
    if (!serverUrl || !token || !book || busy) return
    setBusy(true)
    try {
      done(await approveWithRelease(serverUrl, token, id, {
        provider: book.provider, book_id: book.bookId, content_type: r.content_type ?? book.contentType, source_id: r.source_id,
      }))
    } catch (e) { toast.error(requesterErrorMessage(e, 'Could not approve')) }
    setBusy(false)
  }

  const approveThreads = async () => {
    if (!serverUrl || !token || !threads || picked.size === 0 || busy) return
    const parts = threads.filter(t => picked.has(threadKey(t))).map(t => ({ source: t.source, thread_id: t.thread_id }))
    setBusy(true)
    try {
      done(await approveWithRelease(serverUrl, token, id, req?.typ === 'manga' ? { parts } : { parts, content_type: contentType }))
    } catch (e) {
      toast.error(requesterErrorMessage(e, 'Could not approve'))
    }
    setBusy(false)
  }

  const reject = async () => {
    if (!serverUrl || !token || !req) return
    if (!(await confirm({ title: 'Reject this request?', message: `${req.title ?? req.url} — requested by ${req.user_id}`, confirmLabel: 'Reject', destructive: true }))) return
    const failure = await decideRequest(serverUrl, token, id, 'reject')
    if (failure) { toast.error(failure); return }
    useRequesterLive.getState().patch(id, { status: 'rejected' })
    toast.info('Request rejected')
    pop()
  }

  const pickedCount = picked.size
  const sortedThreads = useMemo(() => threads ?? [], [threads])

  if (loadingReq) {
    return <div><PageHeader title="Pick release" /><div className="px-8 phone:px-4"><Loader2 className="animate-spin text-white/40" /></div></div>
  }
  if (!req) {
    return (
      <div>
        <PageHeader title="Pick release" />
        <p className="px-8 phone:px-4 text-sm text-white/50">This request isn't waiting for approval any more.</p>
      </div>
    )
  }
  if (req.status !== 'pending') {
    return (
      <div>
        <PageHeader title={req.title ?? 'Pick release'} />
        <p className="px-8 phone:px-4 text-sm text-white/50">This request is {req.status} — there is nothing to pick.</p>
      </div>
    )
  }

  const tabBtn = (t: 'releases' | 'forum', label: string) => (
    <button type="button" onClick={() => setTab(t)}
      className={`px-3.5 py-1.5 rounded-full text-sm ${tab === t ? 'bg-theme-500/20 text-theme-300' : 'text-white/60 hover:bg-white/10'}`}>{label}</button>
  )

  return (
    <div className="pb-12 max-w-3xl">
      {confirmUi}
      <PageHeader title={req.title ?? 'Pick release'}
        subtitle={`${TYPE_LABEL[req.typ] ?? req.typ} · requested by ${req.user_id}`}
        right={(
          <button type="button" onClick={() => void reject()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 text-sm">
            <X size={14} /> Reject
          </button>
        )} />
      <div className="px-8 phone:px-4 space-y-4">
        {book && <div className="flex gap-1">{tabBtn('releases', 'Shelfmark releases')}{tabBtn('forum', 'Forum threads')}</div>}

        {tab === 'releases' && book && (
          <div className="space-y-2">
            {relLoading && <Loader2 className="animate-spin text-white/40" />}
            {relError && <p className="text-sm text-white/50 flex items-center gap-2"><AlertCircle size={14} />{relError}</p>}
            <ul className="space-y-1.5">
              {(releases ?? []).map(r => (
                <li key={r.source_id} className="flex items-center gap-2 p-2.5 rounded-lg bg-white/5 border border-white/5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white/90 truncate" title={r.title}>{r.title}</p>
                    <p className="text-xs text-white/40 truncate">
                      {[r.format, r.language, r.size, r.indexer ?? r.source, r.protocol, r.seeders != null ? `${r.seeders} seeders` : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {r.info_url && (
                    <button type="button" onClick={() => void api.openExternal(r.info_url!)} title="Open info page"
                      className="p-1.5 rounded hover:bg-white/10 text-white/40"><ExternalLink size={14} /></button>
                  )}
                  <button type="button" onClick={() => void pickRelease(r)} disabled={busy}
                    className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs disabled:opacity-50">
                    <CheckCircle2 size={13} /> Use
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'forum' && (
          <div className="space-y-3">
            <form onSubmit={e => { e.preventDefault(); void runForumSearch(query) }} className="flex gap-2">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the forums…"
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-theme-500/50 outline-none text-sm" />
              <button type="submit" disabled={forumLoading} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50">
                {forumLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              </button>
            </form>
            {forumError && <p className="text-sm text-white/50 flex items-center gap-2"><AlertCircle size={14} />{forumError}</p>}
            <ul className="space-y-1.5">
              {sortedThreads.map(t => {
                const k = threadKey(t)
                const on = picked.has(k)
                return (
                  <li key={k}>
                    <label className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer ${on ? 'bg-theme-500/10 border-theme-500/40' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}>
                      <input type="checkbox" checked={on} className="mt-1 accent-theme-500"
                        onChange={() => setPicked(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n })} />
                      {t.cover_url && <img src={t.cover_url} alt="" loading="lazy" className="w-10 h-14 object-cover rounded flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white/90">{t.title}</p>
                        <p className="text-xs text-white/40">
                          {[t.source, t.forum, t.volumes ? `Vol. ${t.volumes}` : null, t.publisher, t.year, t.running ? 'running' : null, t.prefix].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {t.url && (
                        <button type="button" onClick={(e) => { e.preventDefault(); void api.openExternal(t.url!) }} title="Open thread"
                          className="p-1.5 rounded hover:bg-white/10 text-white/40"><ExternalLink size={14} /></button>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
            {sortedThreads.length > 0 && (
              <div className="sticky bottom-0 py-3 bg-gradient-to-t from-black via-black/90 to-transparent">
                <button type="button" onClick={() => void approveThreads()} disabled={busy || pickedCount === 0}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-theme-600 hover:bg-theme-500 disabled:opacity-40 text-sm font-medium">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  Approve with {pickedCount || 'the selected'} thread{pickedCount === 1 ? '' : 's'}
                </button>
                <p className="text-[11px] text-white/40 mt-1.5">All volumes, every hoster. Choosing volumes or hosters, and unlocking link containers, is done in the server's web UI.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
