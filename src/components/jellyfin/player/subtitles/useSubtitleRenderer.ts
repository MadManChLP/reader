// Renders subtitles over the Jellyfin <video> with libass (JASSUB / libass-wasm).
//
//   • ASS / SSA  → fed to libass verbatim, so authored fonts, positioning,
//                  colors, karaoke and effects are preserved exactly.
//   • SRT / VTT  → converted to an ASS document built from the user's
//                  SubtitleStyle (font/size/color/outline/box/position), then
//                  rendered by the same libass pipeline for a clean, heavy
//                  streaming-style look.
//
// The subtitle stream is fetched through the app's Rust HTTP client
// (api.request) rather than letting JASSUB fetch a subUrl itself: the worker's
// own fetch is subject to CORS and can't use our SSL bypass, which made
// subtitles silently fail to load. We always hand libass ready subContent.
//
// FALLBACK: JASSUB requires OffscreenCanvas + a module worker that fetches its
// own WASM. Some WebViews can't do that — iOS WKWebView doesn't service
// worker/WASM requests over the custom tauri:// scheme, WebKitGTK (Linux) has
// OffscreenCanvas gaps. When libass fails to boot (constructor throw, worker
// error, or init timeout), we degrade to SubtitleOverlayFallback: a DOM text
// overlay styled from SubtitleStyle. Plain text instead of full ASS fidelity,
// but subtitles always show. If libass finishes booting after the timeout
// fired, we switch back to it.

import { useEffect, useRef, type RefObject } from 'react'
import JASSUB from 'jassub'
import { api } from '../../../../utils/api'
import type { SubtitleStyle } from '../../../../types/settings'
import { buildAssFromVtt, parseAssCues } from './subtitleAss'
import { SubtitleOverlayFallback } from './subtitleOverlayFallback'

export interface SubtitleSource {
  url: string
  isAss: boolean // true = authored ASS/SSA (render as-is); false = text (VTT)
}

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>
  source: SubtitleSource | null
  style: SubtitleStyle
  // Changes whenever the <video> element is remounted (new play session), so
  // we re-attach libass to the fresh DOM node.
  resetKey: string
}

// How long libass gets to finish worker+WASM init before the DOM fallback
// takes over. Late success still swaps back, so this only delays first paint
// on slow devices — it never permanently downgrades them.
const LIBASS_READY_TIMEOUT_MS = 8000

// Desktop Linux WebKitGTK: OffscreenCanvas is only half-implemented — the
// transfer succeeds, worker boots, `ready` resolves, draws "succeed", but the
// pixels never reach the on-screen placeholder canvas (broken commit path,
// esp. under Wayland). Every API reports success, so no runtime trigger can
// catch it — skip libass deterministically. (Android is also Linux+WebKit in
// UA terms but runs Chromium and works; excluded via the Android token.)
const IS_LINUX_WEBKIT =
  navigator.userAgent.includes('Linux') &&
  navigator.userAgent.includes('AppleWebKit') &&
  !navigator.userAgent.includes('Android')

// Fetch subtitle text via the Rust HTTP client (CORS + self-signed SSL bypass).
async function fetchSubtitleText(url: string): Promise<string | null> {
  try {
    const res = await api.request({
      method: 'GET',
      url,
      responseType: 'text',
      allowInsecureSsl: true,
    })
    if (!res.success || typeof res.data !== 'string') {
      console.warn('[Subtitles] fetch failed', res.status, res.error)
      return null
    }
    return res.data
  } catch (e) {
    console.warn('[Subtitles] fetch threw', e)
    return null
  }
}

export function useSubtitleRenderer({ videoRef, source, style, resetKey }: Options) {
  const instanceRef = useRef<JASSUB | null>(null)
  const fallbackRef = useRef<SubtitleOverlayFallback | null>(null)
  // Cache the current text track's raw VTT so style tweaks can rebuild the ASS
  // document without re-fetching. Only set for text (non-ASS) tracks.
  const vttCacheRef = useRef<string | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const styleRef = useRef(style)
  styleRef.current = style

  const destroyLibass = () => {
    if (resizeCleanupRef.current) {
      resizeCleanupRef.current()
      resizeCleanupRef.current = null
    }
    const inst = instanceRef.current
    if (!inst) return
    instanceRef.current = null
    // JASSUB.destroy() only detaches its overlay canvas via the video's
    // parentNode. When React has already remounted the <video> (new play
    // session), that node is detached and the canvas would be orphaned in the
    // wrapper — so grab the wrapper and remove it ourselves as well.
    const canvasParent = inst._canvasParent
    try {
      inst.destroy()
    } catch {
      // Worker may already be gone — ignore.
    }
    canvasParent?.remove()
  }

  const destroyAll = () => {
    destroyLibass()
    fallbackRef.current?.destroy()
    fallbackRef.current = null
  }

  // (Re)create the renderer when the track, its format, or the video element
  // changes.
  useEffect(() => {
    let cancelled = false
    let readyTimer: ReturnType<typeof setTimeout> | undefined
    const video = videoRef.current

    destroyAll()
    vttCacheRef.current = null

    if (!video || !source) return

    let assContent = ''

    const startFallback = (reason: string, err?: unknown) => {
      if (cancelled || fallbackRef.current) return
      console.warn(`[Subtitles] libass unavailable (${reason}) — using text-overlay fallback`, err ?? '')
      destroyLibass()
      const cues = parseAssCues(assContent)
      console.log('[Subtitles] fallback overlay active', { cues: cues.length })
      fallbackRef.current = new SubtitleOverlayFallback(video, cues, styleRef.current)
    }

    const start = async () => {
      const text = await fetchSubtitleText(source.url)
      if (cancelled || !text) return
      assContent = source.isAss ? text : buildAssFromVtt(text, styleRef.current)
      if (!source.isAss) vttCacheRef.current = text
      console.log('[Subtitles] fetched', {
        isAss: source.isAss,
        chars: assContent.length,
        events: (assContent.match(/^Dialogue:/gm) || []).length,
        video: `${video.videoWidth}x${video.videoHeight} ready=${video.readyState} connected=${video.isConnected}`,
      })

      if (IS_LINUX_WEBKIT) {
        startFallback('WebKitGTK OffscreenCanvas pixels never reach the screen')
        return
      }

      let inst: JASSUB
      try {
        inst = new JASSUB({ video, subContent: assContent })
        instanceRef.current = inst
      } catch (e) {
        // No Worker / no OffscreenCanvas / no WASM on this engine.
        startFallback('constructor threw', e)
        return
      }

      // The worker's script/WASM loads can fail without ever settling `ready`
      // (e.g. custom-scheme requests from workers) — cover every path:
      // explicit worker error, ready rejection, and a hard timeout.
      inst._worker.addEventListener('error', (ev) => {
        startFallback(`worker error: ${(ev as ErrorEvent).message || 'script load failed'}`)
      })
      readyTimer = setTimeout(() => startFallback('init timeout'), LIBASS_READY_TIMEOUT_MS)

      // Render-crash watchdog. On iOS, WebKit's OffscreenCanvas WebGL2 is
      // broken: the worker boots and `ready` resolves, but the first real
      // glyph upload dies in native texSubImage3D. That failure surfaces ONLY
      // as an unhandled rejection on the main thread (JASSUB's frame callback
      // awaits the worker draw without a catch), so none of the init-phase
      // triggers above see it. Match jassub's draw-path signatures and degrade.
      const onRenderCrash = (ev: PromiseRejectionEvent) => {
        if (instanceRef.current !== inst) return
        const reason = ev.reason as Error | undefined
        const desc = `${reason?.message ?? ''}\n${reason?.stack ?? ''}`
        if (!/texSubImage|jassub|_draw@|_resizeCanvas/i.test(desc)) return
        ev.preventDefault()
        startFallback(`render crashed: ${reason?.message || 'engine WebGL bug'}`)
      }
      window.addEventListener('unhandledrejection', onRenderCrash)

      inst.ready
        .then(() => {
          clearTimeout(readyTimer)
          if (cancelled || instanceRef.current !== inst) return
          // libass finished booting after the fallback took over (slow device,
          // not a broken engine) — prefer full fidelity, drop the fallback.
          if (fallbackRef.current) {
            fallbackRef.current.destroy()
            fallbackRef.current = null
            console.log('[Subtitles] libass ready late — replacing fallback overlay')
          }
          // Force a resize so the overlay canvas is sized/positioned even if
          // the first automatic measurement ran before the video had layout.
          inst.resize()
          const c = inst._canvas
          const rect = c?.getBoundingClientRect()
          console.log('[Subtitles] libass ready', {
            canvas: c ? `${Math.round(rect!.width)}x${Math.round(rect!.height)} @ ${Math.round(rect!.left)},${Math.round(rect!.top)} connected=${c.isConnected}` : 'none',
          })
        })
        .catch((e) => {
          clearTimeout(readyTimer)
          startFallback('init rejected', e)
        })

      // Re-assert sizing once the video reports dimensions (covers the case
      // where subtitles were enabled before metadata loaded).
      const onMeta = () => { try { instanceRef.current?.resize() } catch { /* destroyed */ } }
      video.addEventListener('loadedmetadata', onMeta)
      video.addEventListener('playing', onMeta)
      resizeCleanupRef.current = () => {
        video.removeEventListener('loadedmetadata', onMeta)
        video.removeEventListener('playing', onMeta)
        window.removeEventListener('unhandledrejection', onRenderCrash)
      }
    }
    start()

    return () => {
      cancelled = true
      clearTimeout(readyTimer)
      destroyAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.url, source?.isAss, resetKey])

  // Live-apply style changes. Fallback overlay: restyle directly (cue text is
  // style-independent). libass TEXT tracks: rebuild the ASS document from the
  // cached VTT and swap the track in place (no re-fetch). Authored ASS keeps
  // its own styling and is left untouched.
  useEffect(() => {
    if (fallbackRef.current) {
      fallbackRef.current.applyStyle(style)
      return
    }
    const inst = instanceRef.current
    const vtt = vttCacheRef.current
    if (!inst || source?.isAss || !vtt) return
    const ass = buildAssFromVtt(vtt, style)
    let disposed = false
    // renderer is a worker proxy that only exists once ready resolves.
    inst.ready
      .then(() => { if (!disposed) inst.renderer.setTrack(ass) })
      .catch(() => { /* renderer torn down mid-update */ })
    return () => { disposed = true }
  }, [style, source?.isAss])

  // Final unmount safety net.
  useEffect(() => () => destroyAll(), [])
}
