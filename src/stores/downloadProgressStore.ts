// Byte-level download progress, fed by the Rust `download-progress` Tauri
// event (emitted by the download_file command every ~512KB). Downloads
// register a logical key (book id, ABS download key, …) together with the
// URL being fetched; UI components look the fraction up by key.
//
// Electron has no byte events — entries stay at totalBytes 0, which the UI
// renders as an indeterminate spinner instead of a progress ring.

import { create } from 'zustand'

interface DownloadByteProgress {
  url: string
  downloadedBytes: number
  totalBytes: number // 0 = unknown (no Content-Length / no events)
}

export interface DownloadByteEvent {
  url: string
  downloadedBytes: number
  totalBytes: number
}

interface DownloadProgressState {
  active: Record<string, DownloadByteProgress>
  /**
   * Latest raw byte event, regardless of whether any key registered its URL.
   * The unified download center matches this against URLs it can reconstruct
   * itself (the Jellyfin video/music managers run their own transfers and
   * never call begin()), giving smooth byte progress without touching them.
   */
  lastEvent: DownloadByteEvent | null
  begin: (key: string, url: string) => void
  end: (key: string) => void
}

export const useDownloadProgressStore = create<DownloadProgressState>((set) => ({
  active: {},
  lastEvent: null,

  begin: (key, url) => {
    ensureListener()
    set((s) => ({ active: { ...s.active, [key]: { url, downloadedBytes: 0, totalBytes: 0 } } }))
  },

  end: (key) =>
    set((s) => {
      if (!(key in s.active)) return s
      const active = { ...s.active }
      delete active[key]
      return { active }
    }),
}))

// Single global Tauri event listener, created on first use. Events are keyed
// by URL — every registered entry with a matching URL gets the update (the
// Rust side emits url + downloadedBytes + totalBytes).
let listenerStarted = false
function ensureListener(): void {
  if (listenerStarted) return
  listenerStarted = true
  if (typeof window === 'undefined' || !('__TAURI__' in window)) return
  import('@tauri-apps/api/event')
    .then(({ listen }) =>
      listen<{ url: string; downloadedBytes: number; totalBytes: number }>('download-progress', (event) => {
        const { url, downloadedBytes, totalBytes } = event.payload
        const state = useDownloadProgressStore.getState()
        let changed = false
        const active: Record<string, DownloadByteProgress> = {}
        for (const [key, entry] of Object.entries(state.active)) {
          if (entry.url === url) {
            active[key] = { ...entry, downloadedBytes, totalBytes }
            changed = true
          } else {
            active[key] = entry
          }
        }
        const lastEvent: DownloadByteEvent = { url, downloadedBytes, totalBytes }
        if (changed) {
          useDownloadProgressStore.setState({ active, lastEvent })
        } else {
          useDownloadProgressStore.setState({ lastEvent })
        }
      })
    )
    .catch(() => { /* no event API — indeterminate spinners only */ })
}

/**
 * Start the global byte-event listener without registering a key.
 * The unified download center calls this so `lastEvent` flows even when no
 * keyed download (Calibre / ABS) has run yet this session.
 */
export function ensureProgressListener(): void {
  ensureListener()
}

// Non-React entry points for download managers / stores
export function beginDownloadTracking(key: string, url: string): void {
  useDownloadProgressStore.getState().begin(key, url)
}

export function endDownloadTracking(key: string): void {
  useDownloadProgressStore.getState().end(key)
}

/**
 * Download progress for a key as a 0..1 fraction.
 *   undefined — no download active for this key
 *   null      — active, but size unknown (render an indeterminate spinner)
 */
export function useDownloadFraction(key: string | null | undefined): number | null | undefined {
  return useDownloadProgressStore((s) => {
    if (!key) return undefined
    const entry = s.active[key]
    if (!entry) return undefined
    if (!entry.totalBytes) return null
    return Math.min(1, entry.downloadedBytes / entry.totalBytes)
  })
}
