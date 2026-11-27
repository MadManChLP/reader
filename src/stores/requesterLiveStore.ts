// Requester live state — app-wide (not tied to the Requester tab being open).
//
// Owns the request history list, the /ws/downloads socket (token sent as the
// first message, reconnect with backoff), per-episode / per-job progress and
// the status alerts: an in-app toast (via RequesterLiveBridge) plus an OS
// notification when the window isn't focused, and the unseen badge on the
// Requester tab. Started/stopped by RequesterLiveBridge from the auth state.

import { create } from 'zustand'
import {
  getHistory, buildWebSocketUrl, wsAuthMessage, WS_UNAUTHORIZED,
  setKnownRequests, requesterErrorMessage, REQUEST_SUBMITTED_EVENT,
} from '../utils/requesterApi'
import { FINISHED_STATUSES } from '../types/requester'
import type { DownloadRequest, DownloadStatus, EpisodeUpdateEvent, WsEvent } from '../types/requester'
import { systemNotify } from '../utils/systemNotify'

export interface JobProgress {
  pct?: number
  speed?: string
  eta?: string
  /** forum / shelfmark downloads */
  stage?: string
  mirror?: string
}

/** One volume (or file/part) of a forum download (manga, forum books) */
export interface VolumeProgress {
  key: string
  volume?: number | string
  item?: number
  items?: number
  stage?: string
  percent?: number
  speed?: string
  bytes?: number
  total?: number
  message?: string
}

/** Forum progress sends bytes/s as a number; the others a ready string */
export function formatRate(v: unknown): string | undefined {
  if (typeof v === 'string') return v || undefined
  if (typeof v !== 'number' || !isFinite(v) || v <= 0) return undefined
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let n = v
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}

export interface RequesterAlert {
  id: string
  requestId: number
  title: string
  body: string
  tone: 'success' | 'error' | 'info'
}

const PAGE = 50
const OS_NOTIFY_KEY = 'requesterOsNotifications'

export function getOsNotifyEnabled(): boolean {
  try { return localStorage.getItem(OS_NOTIFY_KEY) !== 'false' } catch { return true }
}
export function setOsNotifyEnabled(on: boolean) {
  try { localStorage.setItem(OS_NOTIFY_KEY, String(on)) } catch { /* ignore */ }
}

interface LiveState {
  serverUrl: string | null
  token: string | null
  username: string | null
  isAdmin: boolean

  history: DownloadRequest[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean

  episodeProgress: Record<number, EpisodeUpdateEvent[]>
  jobProgress: Record<number, JobProgress>
  /** request id → volume key → progress (forum downloads) */
  volumeProgress: Record<number, Record<string, VolumeProgress>>
  connected: boolean

  /** Alerts not yet looked at (badge on the Requester tab) */
  unseen: number
  /** Last alert (the bridge turns it into a toast) */
  lastAlert: RequesterAlert | null
  /** The Requests list is on screen — alerts don't add to the badge */
  requestsVisible: boolean

  start: (cfg: { serverUrl: string; token: string; username: string | null; isAdmin: boolean }) => void
  stop: () => void
  reload: () => Promise<void>
  loadMore: () => Promise<void>
  patch: (id: number, changes: Partial<DownloadRequest>) => void
  remove: (id: number) => void
  markSeen: () => void
  setRequestsVisible: (v: boolean) => void
}

// Socket bookkeeping lives outside the store (not state)
let ws: WebSocket | null = null
let retryTimer: number | null = null
let attempt = 0
let session = 0
let pollTimer: number | null = null

const titleOf = (r: Pick<DownloadRequest, 'title' | 'slug' | 'url'> | undefined) =>
  r?.title || r?.slug || r?.url || 'Request'

function describeChange(prev: DownloadStatus | undefined, next: DownloadStatus): { body: string; tone: RequesterAlert['tone'] } | null {
  switch (next) {
    case 'complete': return { body: 'Download finished', tone: 'success' }
    case 'partial': return { body: 'Partly downloaded — some episodes failed', tone: 'error' }
    case 'error': return { body: 'Download failed', tone: 'error' }
    case 'rejected': return { body: 'Request was rejected', tone: 'error' }
    case 'not_found': return { body: 'Not found at the sources', tone: 'error' }
    case 'approved': return prev === 'pending' ? { body: 'Request approved', tone: 'success' } : null
    case 'queued':
    case 'downloading':
      // Upcoming title came out and is now on its way
      return prev === 'upcoming' ? { body: 'Released — downloading now', tone: 'info' } : null
    default: return null
  }
}

export const useRequesterLive = create<LiveState>((set, get) => {
  const alert = (a: Omit<RequesterAlert, 'id'>) => {
    const full: RequesterAlert = { ...a, id: `${a.requestId}-${Date.now()}` }
    set(s => ({ lastAlert: full, unseen: s.requestsVisible ? s.unseen : s.unseen + 1 }))
    // OS notification only when the user isn't looking at the app
    const looking = typeof document !== 'undefined' && !document.hidden && document.hasFocus()
    if (!looking && getOsNotifyEnabled()) void systemNotify(a.title, a.body)
  }

  const isMine = (r: DownloadRequest | undefined) => {
    const u = get().username
    return !!r && (!u || r.user_id === u)
  }

  const onStatus = (requestId: number, status: DownloadStatus, extra: Partial<DownloadRequest>) => {
    const prev = get().history.find(h => h.id === requestId)
    if (!prev) {
      // Unknown request: another device, or (admins) another user's request
      void get().reload().then(() => {
        const now = get().history.find(h => h.id === requestId)
        if (now && get().isAdmin && status === 'pending' && !isMine(now)) {
          alert({ requestId, title: titleOf(now), body: `New request from ${now.user_id} — waiting for approval`, tone: 'info' })
        }
      })
      return
    }
    get().patch(requestId, { status, ...extra })
    if (FINISHED_STATUSES.has(status)) {
      set(s => {
        if (!(requestId in s.jobProgress)) return {}
        const jobProgress = { ...s.jobProgress }
        delete jobProgress[requestId]
        return { jobProgress }
      })
    }
    if (prev.status !== status && isMine(prev)) {
      const change = describeChange(prev.status, status)
      if (change) alert({ requestId, title: titleOf(prev), ...change })
    }
  }

  const handle = (data: WsEvent) => {
    switch (data.type) {
      case 'status':
      case 'queue_update':
        onStatus(data.request_id, data.status, {
          ...(data.error ? { error_message: data.error } : {}),
          ...(data.next_retry_at ? { next_retry_at: data.next_retry_at } : {}),
          ...(typeof data.retry_attempt === 'number' ? { retry_count: data.retry_attempt } : {}),
        })
        break
      case 'progress': {
        const pct = typeof data.pct === 'number' ? data.pct : typeof data.percent === 'number' ? data.percent : undefined
        const speed = formatRate(data.speed)
        const volKey = data.volume != null ? String(data.volume) : data.item != null ? `#${data.item}` : null
        set(s => {
          const next: Partial<LiveState> = {
            jobProgress: {
              ...s.jobProgress,
              [data.request_id]: {
                pct, speed, eta: data.eta,
                stage: typeof data.stage === 'string' ? data.stage : undefined,
                mirror: typeof data.mirror === 'string' ? data.mirror : undefined,
              },
            },
          }
          // Forum downloads: one event per volume / item
          if (volKey && typeof data.stage === 'string') {
            const vols = s.volumeProgress[data.request_id] ?? {}
            next.volumeProgress = {
              ...s.volumeProgress,
              [data.request_id]: {
                ...vols,
                [volKey]: {
                  key: volKey, volume: data.volume, item: data.item, items: data.items, stage: data.stage,
                  percent: typeof data.percent === 'number' ? data.percent : undefined,
                  speed, bytes: data.bytes, total: data.total,
                  message: typeof data.message === 'string' ? data.message : undefined,
                },
              },
            }
          }
          return next
        })
        break
      }
      case 'episode_update':
        set(s => {
          const existing = s.episodeProgress[data.request_id] ?? []
          return {
            episodeProgress: {
              ...s.episodeProgress,
              [data.request_id]: [...existing.filter(e => e.episode !== data.episode), data],
            },
          }
        })
        break
      case 'season_update':
        void get().reload()
        break
    }
  }

  const connect = (mySession: number) => {
    const { serverUrl, token } = get()
    if (!serverUrl || !token || mySession !== session) return
    let sock: WebSocket
    try { sock = new WebSocket(buildWebSocketUrl(serverUrl)) } catch { return }
    ws = sock
    sock.onopen = () => sock.send(wsAuthMessage(token))
    sock.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WsEvent
        if (data.type === 'connected') { attempt = 0; set({ connected: true }); return }
        handle(data)
      } catch { /* malformed */ }
    }
    sock.onclose = (ev) => {
      if (ws === sock) ws = null
      set({ connected: false })
      if (mySession !== session) return
      // Token rejected: a history load hits 401 → silent re-login → new
      // token → the bridge restarts us
      if (ev.code === WS_UNAUTHORIZED) { void get().reload(); return }
      const delay = Math.min(60_000, 1000 * 2 ** attempt++)
      retryTimer = window.setTimeout(() => connect(mySession), delay)
    }
  }

  const onSubmitted = () => { void get().reload() }

  return {
    serverUrl: null,
    token: null,
    username: null,
    isAdmin: false,
    history: [],
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    episodeProgress: {},
    jobProgress: {},
    volumeProgress: {},
    connected: false,
    unseen: 0,
    lastAlert: null,
    requestsVisible: false,

    start: (cfg) => {
      const s = get()
      if (s.serverUrl === cfg.serverUrl && s.token === cfg.token && s.username === cfg.username) return
      get().stop()
      session++
      const mySession = session
      set({ ...cfg, history: [], error: null, hasMore: false, episodeProgress: {}, jobProgress: {}, volumeProgress: {} })
      window.addEventListener(REQUEST_SUBMITTED_EVENT, onSubmitted)
      void get().reload()
      connect(mySession)
      // Fallback poll while something is in flight (socket down / missed events)
      pollTimer = window.setInterval(() => {
        const active = get().history.some(h => ['approved', 'queued', 'downloading', 'retrying'].includes(h.status))
        if (active && !get().connected) void get().reload()
      }, 15_000)
    },

    stop: () => {
      session++
      window.removeEventListener(REQUEST_SUBMITTED_EVENT, onSubmitted)
      if (retryTimer !== null) { window.clearTimeout(retryTimer); retryTimer = null }
      if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null }
      attempt = 0
      const sock = ws
      ws = null
      sock?.close()
      set({ serverUrl: null, token: null, username: null, isAdmin: false, connected: false, history: [], unseen: 0 })
    },

    reload: async () => {
      const { serverUrl, token } = get()
      if (!serverUrl || !token) return
      const mySession = session
      set({ loading: true })
      try {
        // Keep as many rows as are loaded (Load more pages), at least one page
        const limit = Math.min(200, Math.max(PAGE, get().history.length))
        const rows = await getHistory(serverUrl, token, limit, 0)
        if (mySession !== session) return
        set({ history: rows, hasMore: rows.length >= limit, error: null, loading: false })
        setKnownRequests(rows)
      } catch (e) {
        if (mySession !== session) return
        set({ error: requesterErrorMessage(e, 'Request failed'), loading: false })
      }
    },

    loadMore: async () => {
      const { serverUrl, token, history, loadingMore, hasMore } = get()
      if (!serverUrl || !token || loadingMore || !hasMore) return
      const mySession = session
      set({ loadingMore: true })
      try {
        const rows = await getHistory(serverUrl, token, PAGE, history.length)
        if (mySession !== session) return
        const known = new Set(get().history.map(h => h.id))
        set(s => ({
          history: [...s.history, ...rows.filter(r => !known.has(r.id))],
          hasMore: rows.length >= PAGE,
          loadingMore: false,
        }))
        setKnownRequests(get().history)
      } catch (e) {
        if (mySession !== session) return
        set({ loadingMore: false, error: requesterErrorMessage(e, 'Request failed') })
      }
    },

    patch: (id, changes) => set(s => ({ history: s.history.map(h => h.id === id ? { ...h, ...changes } : h) })),
    remove: (id) => set(s => ({ history: s.history.filter(h => h.id !== id) })),
    markSeen: () => set({ unseen: 0 }),
    setRequestsVisible: (v) => set(v ? { requestsVisible: true, unseen: 0 } : { requestsVisible: false }),
  }
})
