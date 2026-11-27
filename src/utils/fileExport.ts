// Save arbitrary text to a file the user can move between devices.
//
// There is no cross-platform "save file" dialog in the app's API layer, so we
// write into the app's download folder (which always exists and is reachable in
// the Files app on mobile) and fall back to the clipboard when a file can't be
// written. Used by the debug-report export and the settings export.

import api, { IS_IOS, IS_PHONE, IS_TAURI } from './api'

export interface SaveResult {
  ok: boolean
  /** Absolute path written, when method === 'file'. */
  path?: string
  method: 'file' | 'clipboard' | 'none'
  error?: string
}

function joinPath(folder: string, filename: string): string {
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/'
  return folder.replace(/[\\/]+$/, '') + sep + filename
}

/**
 * Write `content` as `filename` inside `folder`. If that fails (or no folder is
 * given), copy the content to the clipboard instead so the user can still move
 * it. Returns which path was taken so the caller can craft the right message.
 */
export async function saveTextToFolder(
  folder: string,
  filename: string,
  content: string,
): Promise<SaveResult> {
  if (folder) {
    try {
      const path = joinPath(folder, filename)
      const res = await api.writeFile({ path, content })
      if (res.success) return { ok: true, path, method: 'file' }
    } catch {
      // fall through to clipboard
    }
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(content)
      return { ok: true, method: 'clipboard' }
    }
  } catch {
    // fall through
  }

  return { ok: false, method: 'none', error: 'Could not write a file or copy to the clipboard.' }
}

export type SaveMethod = 'share' | 'dialog' | 'file' | 'clipboard' | 'cancelled' | 'none'
export interface SaveOutcome {
  ok: boolean
  method: SaveMethod
  path?: string
  error?: string
}

/**
 * Save `content` the best way for the platform, always letting the user choose
 * where it goes:
 *   - phone/iOS: the OS share sheet (Save to Files, AirDrop, send to another
 *     device). Dismissing it counts as an intentional cancel.
 *   - desktop (Tauri): a native "Save As…" dialog.
 *   - anything else, or on failure: write into `fallbackFolder`, else clipboard.
 */
export async function saveOrShareText(
  filename: string,
  content: string,
  mimeType: string,
  fallbackFolder: string,
): Promise<SaveOutcome> {
  // Mobile: OS share sheet.
  if (IS_PHONE || IS_IOS) {
    try {
      const file = new File([content], filename, { type: mimeType })
      const nav = navigator as Navigator & { canShare?: (d: any) => boolean; share?: (d: any) => Promise<void> }
      if (nav.share && (nav.canShare ? nav.canShare({ files: [file] }) : true)) {
        await nav.share({ files: [file], title: filename })
        return { ok: true, method: 'share' }
      }
    } catch (e: any) {
      // User dismissed the share sheet → intentional cancel, do nothing else.
      if (e?.name === 'AbortError') return { ok: false, method: 'cancelled' }
      // Any other failure falls through to the file/clipboard fallback.
    }
  }

  // Desktop: native Save As dialog.
  if (IS_TAURI) {
    const res = await api.saveFileDialog({ defaultName: filename, content })
    if (res.canceled) return { ok: false, method: 'cancelled' }
    if (res.success) return { ok: true, method: 'dialog', path: res.path }
    // error → fall through to the folder/clipboard fallback below
  }

  const res = await saveTextToFolder(fallbackFolder, filename, content)
  const method: SaveMethod = res.method === 'file' ? 'file' : res.method === 'clipboard' ? 'clipboard' : 'none'
  return { ok: res.ok, method, path: res.path, error: res.error }
}

/** Timestamp suffix like 20260727-143002 for unique export filenames. */
export function fileTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}
