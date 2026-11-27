// Rebase download indexes onto the current download folder.
//
// The Jellyfin / JellyMusic / Audiobookshelf download indexes store ABSOLUTE
// file paths. On iOS the app's sandbox container path (it contains a UUID)
// changes on every app update; iOS moves the files along, but every stored
// path still points into the old, dead container. The startup verification
// then pruned every entry — the whole offline library vanished while the
// files stayed on disk.
//
// This runs before verification: for every distinct old root found in the
// indexes (the part before the fixed /Jellyfin/, /JellyMusic/ or
// /Audiobookshelf/ segment) it checks one sample file. If the file is gone at
// the old location but present under the current download folder, every path
// with that old root is rewritten. Roots whose files still exist (a desktop
// user who changed the download folder but kept the old one) are left alone.

import { api } from './api'

/** localStorage keys of all indexes that hold absolute download paths. */
const INDEX_KEYS = [
  'jellyfin_downloads',
  'jellyfin_download_queue',
  'downloaded_music_tracks',
  'downloaded_music_albums',
  'downloaded_music_playlists',
  'music_download_queue',
  'abs_downloads',
]

const ROOT_MARKER = /^(.+?)[/\\](Jellyfin|JellyMusic|Audiobookshelf)[/\\]/

function trimSlash(p: string): string {
  return p.replace(/[/\\]+$/, '')
}

/** Every string value inside a JSON structure. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach(v => collectStrings(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach(v => collectStrings(v, out))
}

/** Replace the `oldRoot` prefix in every string value. */
function replaceRoot(value: unknown, oldRoot: string, newRoot: string): unknown {
  if (typeof value === 'string') {
    return value.startsWith(oldRoot) && ROOT_MARKER.test(value)
      ? newRoot + value.slice(oldRoot.length)
      : value
  }
  if (Array.isArray(value)) return value.map(v => replaceRoot(v, oldRoot, newRoot))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = replaceRoot(v, oldRoot, newRoot)
    return out
  }
  return value
}

/**
 * Rewrite stale absolute paths in all download indexes onto `currentRoot`.
 * Returns the number of old roots that were rebased.
 */
export async function rebaseDownloadIndexes(currentRoot: string): Promise<number> {
  const root = trimSlash(currentRoot)
  if (!root) return 0

  const indexes = new Map<string, unknown>()
  const samplesByRoot = new Map<string, string[]>()
  for (const key of INDEX_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      indexes.set(key, parsed)
      const strings: string[] = []
      collectStrings(parsed, strings)
      for (const s of strings) {
        const m = ROOT_MARKER.exec(s)
        if (!m) continue
        const oldRoot = m[1]
        if (oldRoot === root) continue
        const list = samplesByRoot.get(oldRoot) ?? []
        if (list.length < 5 && !list.includes(s)) list.push(s)
        samplesByRoot.set(oldRoot, list)
      }
    } catch { /* unreadable index — verification handles it */ }
  }

  let rebased = 0
  for (const [oldRoot, samples] of samplesByRoot) {
    try {
      // Samples can be queued-but-never-downloaded paths, so check several:
      // any file still at the old root -> leave it; any at the new root -> rebase.
      let oldValid = false
      let newValid = false
      for (const s of samples) {
        if (await api.fileExists(s)) { oldValid = true; break }
        if (!newValid && await api.fileExists(root + s.slice(oldRoot.length))) newValid = true
      }
      if (oldValid || !newValid) continue
      for (const [key, value] of indexes) {
        const next = replaceRoot(value, oldRoot, root)
        indexes.set(key, next)
        localStorage.setItem(key, JSON.stringify(next))
      }
      console.log(`[Downloads] Rebased download paths from ${oldRoot} to ${root}`)
      rebased++
    } catch (e) {
      console.warn('[Downloads] Path rebase failed for', oldRoot, e)
    }
  }
  return rebased
}

// Views that verify their own downloads (Audiobookshelf) must wait until the
// startup rebase is done, or they prune entries that are about to be fixed.
let resolveReady: () => void = () => {}
export const downloadIndexesReady: Promise<void> = new Promise(r => { resolveReady = r })
export function markDownloadIndexesReady(): void { resolveReady() }
