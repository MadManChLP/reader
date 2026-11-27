import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ShieldAlert, Loader2, X, CornerDownLeft, Delete, RefreshCw } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { useToast } from '../../Toast'
import { api } from '../../../utils/api'
import { fetchImageViaApi, releaseImage } from '../../../utils/requestQueue'
import { requesterErrorMessage, RequesterError } from '../../../utils/requesterApi'
import {
  getCaptchaInbox, captchaScreenshotUrl, captchaClick, captchaType,
} from '../../../utils/requesterBooksApi'
import { formatWhen } from '../requests/statusConfig'
import type { CaptchaInbox as Inbox, CaptchaPage } from '../../../types/requesterBooks'

const POLL_MS = 20_000
const SHOT_MS = 2_000

/**
 * Admin: hoster pages waiting for a CAPTCHA. Shows nothing while none waits.
 * Solving works on a refreshed screenshot: a tap is sent as a click at the
 * same spot of the server's page, text and keys are typed into it. (The live
 * view over /ws/admin/captcha needs the web UI's session cookie.)
 */
export function CaptchaInbox() {
  const { serverUrl, token } = useRequester()
  const [inbox, setInbox] = useState<Inbox | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!serverUrl || !token) return
    try {
      setInbox(await getCaptchaInbox(serverUrl, token))
    } catch {
      setInbox(null) // older server / not set up: stay hidden
    }
  }, [serverUrl, token])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => { void load() }, POLL_MS)
    return () => window.clearInterval(t)
  }, [load])

  const waiting = inbox?.waiting ?? []
  useEffect(() => {
    if (open && !waiting.some(w => w.id === open)) setOpen(null)
  }, [open, waiting])

  if (!serverUrl || !token || waiting.length === 0) return null

  return (
    <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
      <h4 className="text-sm font-semibold text-red-200 flex items-center gap-2 mb-2">
        <ShieldAlert size={15} /> {waiting.length === 1 ? 'A download waits for a CAPTCHA' : `${waiting.length} downloads wait for a CAPTCHA`}
      </h4>
      <ul className="space-y-2">
        {waiting.map(w => (
          <li key={w.id}>
            {open === w.id ? (
              <CaptchaSolver page={w} viewport={inbox!.viewport} onClose={() => { setOpen(null); void load() }} />
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0 truncate text-white/80">{w.label}</span>
                {w.since && <span className="text-xs text-white/40">{formatWhen(w.since)}</span>}
                <button type="button" onClick={() => setOpen(w.id)}
                  className="px-2.5 py-1 rounded-lg bg-red-500/30 hover:bg-red-500/40 text-red-100 text-xs">Solve</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Keeps showing the previous screenshot until the next one has loaded (an
 * <img> swap per refresh would flicker), and releases the old blob after.
 */
function useScreenshot(url: string | null, headers: Record<string, string> | undefined): string | null {
  const [shown, setShown] = useState<{ src: string; blob: string } | null>(null)
  const shownRef = useRef(shown)
  shownRef.current = shown
  useEffect(() => {
    if (!url || !headers) return
    let active = true
    fetchImageViaApi(url, api, headers).then(blob => {
      if (!active || !blob) { if (blob) releaseImage(url); return }
      const prev = shownRef.current
      setShown({ src: url, blob })
      if (prev) releaseImage(prev.src)
    }).catch(() => { /* keep the last picture */ })
    return () => { active = false }
  }, [url, headers])
  useEffect(() => () => { if (shownRef.current) releaseImage(shownRef.current.src) }, [])
  return shown?.blob ?? null
}

function CaptchaSolver({ page, viewport, onClose }: { page: CaptchaPage; viewport: Inbox['viewport']; onClose: () => void }) {
  const { serverUrl, token } = useRequester()
  const toast = useToast()
  const [n, setN] = useState(() => Date.now())
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const imgWrap = useRef<HTMLDivElement>(null)
  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : undefined), [token])
  const shot = useScreenshot(serverUrl && token ? captchaScreenshotUrl(serverUrl, page.id, n) : null, authHeaders)

  useEffect(() => {
    const t = window.setInterval(() => setN(Date.now()), SHOT_MS)
    return () => window.clearInterval(t)
  }, [])

  const send = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      if (e instanceof RequesterError && e.status === 404) { toast.info('This page no longer waits'); onClose(); return }
      toast.error(requesterErrorMessage(e, 'Failed'))
    } finally {
      setBusy(false)
      setN(Date.now())
    }
  }

  const onTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!serverUrl || !token) return
    const r = imgWrap.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    const x = ((e.clientX - r.left) / r.width) * viewport.width
    const y = ((e.clientY - r.top) / r.height) * viewport.height
    void send(() => captchaClick(serverUrl, token, page.id, x, y))
  }

  if (!serverUrl || !token) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate text-sm text-white/80">{page.label}</span>
        {busy && <Loader2 size={14} className="animate-spin text-white/50" />}
        <button type="button" onClick={() => setN(Date.now())} title="Reload picture" className="p-1 rounded hover:bg-white/10 text-white/50"><RefreshCw size={14} /></button>
        <button type="button" onClick={onClose} title="Close" className="p-1 rounded hover:bg-white/10 text-white/50"><X size={14} /></button>
      </div>
      <div ref={imgWrap} onClick={onTap} className="relative w-full rounded-lg overflow-hidden bg-black cursor-crosshair"
        style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}>
        {shot
          ? <img src={shot} alt="CAPTCHA page" draggable={false}
              className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none" />
          : <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-white/40" /></div>}
      </div>
      <p className="text-[11px] text-white/40">Tap where you would click. The picture refreshes every few seconds.</p>
      <form className="flex gap-2" onSubmit={e => {
        e.preventDefault()
        if (!text) return
        const t = text.slice(0, 200)
        setText('')
        void send(() => captchaType(serverUrl, token, page.id, { text: t }))
      }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Type text…" maxLength={200}
          className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 outline-none text-sm" />
        <button type="submit" className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm">Type</button>
        <button type="button" title="Enter" onClick={() => void send(() => captchaType(serverUrl, token, page.id, { key: 'Enter' }))}
          className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20"><CornerDownLeft size={14} /></button>
        <button type="button" title="Backspace" onClick={() => void send(() => captchaType(serverUrl, token, page.id, { key: 'Backspace' }))}
          className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20"><Delete size={14} /></button>
      </form>
    </div>
  )
}
