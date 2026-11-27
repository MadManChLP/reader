// Requester — books, audiobooks, manga, release picking, manga monitors and the
// CAPTCHA inbox (mediamaster-server 2026-11-25, see reverence/api.md).
// Every call throws RequesterError on failure (detail message included).

import { apiGet, apiSend, rememberSubmittedRequest, serverAbsoluteUrl } from './requesterApi'
import type { DownloadRequest } from '../types/requester'
import type {
  BookCard, BookContentType, BookRelease, BookSearchKind, CaptchaInbox, ForumKind, ForumThread,
  ForumThreadDetail, MangaMonitor, NewMonitor, ReleaseBody, ReleasePart,
} from '../types/requesterBooks'

const q = (v: string | number) => encodeURIComponent(String(v))

// ── Search ───────────────────────────────────────────────────────────────

/** Catalogue cards (AniList for manga, shelfmark for books, forum threads as fallback). q: 2–200 chars. */
export const searchBooks = (s: string, t: string, kind: BookSearchKind, query: string) =>
  apiGet<BookCard[]>(s, t, `/api/books/search?kind=${kind}&q=${q(query)}`)

export const getBookReleases = (s: string, t: string, provider: string, bookId: string, contentType: BookContentType) =>
  apiGet<BookRelease[]>(s, t, `/api/books/releases?provider=${q(provider)}&book_id=${q(bookId)}&content_type=${contentType}`)

export const searchForum = (s: string, t: string, kind: ForumKind, query: string) =>
  apiGet<ForumThread[]>(s, t, `/api/books/forum?kind=${kind}&q=${q(query)}`)

export const getForumThread = (s: string, t: string, source: string, threadId: string) =>
  apiGet<ForumThreadDetail>(s, t, `/api/books/forum/${q(source)}/${q(threadId)}`)

// ── Requests ─────────────────────────────────────────────────────────────

/**
 * A book / audiobook. Without source_id/parts it is a title request that stays
 * pending until an admin picks the release; source_id / parts are admin-only.
 */
export async function requestBook(
  s: string, t: string,
  body: {
    provider?: string; book_id?: string; content_type: BookContentType
    source_id?: string; parts?: ReleasePart[]
    title?: string; author?: string | null; cover_url?: string | null
  },
): Promise<DownloadRequest> {
  const req = await apiSend<DownloadRequest>(s, t, 'POST', '/api/download/book', body)
  rememberSubmittedRequest(req)
  return req
}

/** A manga series by AniList ID (pending until an admin picks the release; parts = admin-only). */
export async function requestManga(
  s: string, t: string,
  body: { anilist_id: number; title?: string; update?: boolean; poster_url?: string | null; parts?: ReleasePart[] },
): Promise<DownloadRequest> {
  const req = await apiSend<DownloadRequest>(s, t, 'POST', '/api/download/manga', body)
  rememberSubmittedRequest(req)
  return req
}

/** Admin: approve a pending book/manga request with the picked release. */
export async function approveWithRelease(s: string, t: string, id: number, body: ReleaseBody): Promise<DownloadRequest> {
  const req = await apiSend<DownloadRequest>(s, t, 'POST', `/api/download/${id}/release`, body)
  rememberSubmittedRequest(req)
  return req
}

/** Book/manga requests need a release picked before they can be approved. */
export const needsReleasePick = (typ: string | null | undefined) =>
  typ === 'book' || typ === 'audiobook' || typ === 'manga'

/** `book:<provider>:<book_id>:<content_type>` → its parts */
export function parseBookKey(url: string | null | undefined): { provider: string; bookId: string; contentType: BookContentType } | null {
  const m = /^book:([^:]+):(.+):(ebook|audiobook)$/.exec(url ?? '')
  return m ? { provider: m[1], bookId: m[2], contentType: m[3] as BookContentType } : null
}

/** `anilist:<id>` → the id */
export function parseAnilistKey(url: string | null | undefined): number | null {
  const m = /^anilist:(\d+)$/.exec(url ?? '')
  return m ? Number(m[1]) : null
}

// ── Manga monitors (admin) ───────────────────────────────────────────────

export const getMonitors = (s: string, t: string) =>
  apiGet<MangaMonitor[]>(s, t, '/api/admin/monitors')

export const createMonitor = (s: string, t: string, body: NewMonitor) =>
  apiSend<MangaMonitor>(s, t, 'POST', '/api/admin/monitors', body)

export const checkAllMonitors = (s: string, t: string) =>
  apiSend<{ status: string }>(s, t, 'POST', '/api/admin/monitors/check')

export const updateMonitor = (s: string, t: string, id: number, body: { title?: string; query?: string | null; poster_url?: string | null; paused?: boolean }) =>
  apiSend<MangaMonitor>(s, t, 'PATCH', `/api/admin/monitors/${id}`, body)

export const attachMonitorThreads = (s: string, t: string, id: number, threads: string[], reportExisting = false) =>
  apiSend<MangaMonitor & { added?: unknown[] }>(s, t, 'POST', `/api/admin/monitors/${id}/threads`, { threads, report_existing: reportExisting })

export const removeMonitorThread = (s: string, t: string, id: number, source: string, threadId: string) =>
  apiSend<MangaMonitor>(s, t, 'DELETE', `/api/admin/monitors/${id}/threads/${q(source)}/${q(threadId)}`)

export const checkMonitor = (s: string, t: string, id: number) =>
  apiSend<MangaMonitor>(s, t, 'POST', `/api/admin/monitors/${id}/check`)

export const requestMonitorVolumes = (s: string, t: string, id: number) =>
  apiSend<{ request_id: number; redirect?: string }>(s, t, 'POST', `/api/admin/monitors/${id}/request`)

export const dismissMonitor = (s: string, t: string, id: number) =>
  apiSend<MangaMonitor>(s, t, 'POST', `/api/admin/monitors/${id}/dismiss`)

export const deleteMonitor = (s: string, t: string, id: number) =>
  apiSend<unknown>(s, t, 'DELETE', `/api/admin/monitors/${id}`)

// ── CAPTCHA inbox (admin) ────────────────────────────────────────────────

export const getCaptchaInbox = (s: string, t: string) =>
  apiGet<CaptchaInbox>(s, t, '/api/admin/captcha')

/** Screenshot URL (needs the Bearer header → AuthenticatedImage); `n` busts the cache. */
export const captchaScreenshotUrl = (s: string, id: string, n: number) =>
  `${serverAbsoluteUrl(s, `/api/admin/captcha/${q(id)}/screenshot`)}?n=${n}`

export const captchaClick = (s: string, t: string, id: string, x: number, y: number) =>
  apiSend<unknown>(s, t, 'POST', `/api/admin/captcha/${q(id)}/click`, { x: Math.round(x), y: Math.round(y) })

export const CAPTCHA_KEYS = ['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const

export const captchaType = (s: string, t: string, id: string, body: { text?: string; key?: string }) =>
  apiSend<unknown>(s, t, 'POST', `/api/admin/captcha/${q(id)}/type`, body)
