// src/utils/coverCache.ts
import { api, toLocalUrl } from './api';

// Cache the getCachePath() result — it never changes and avoids a repeated async IPC call
let _cacheDirPromise: Promise<string> | null = null
function getDefaultCacheDir(): Promise<string> {
  if (!_cacheDirPromise) _cacheDirPromise = api.getCachePath()
  return _cacheDirPromise
}

// In-memory index of which safeIds are confirmed cached on disk.
// Keyed by the covers_cache directory path so it works with both default and custom basePaths.
// One IPC call (listDirectoryNames) at first access per directory, then all checks are O(1).
const _diskIndex = new Map<string, Set<string>>()
const _building = new Map<string, Promise<Set<string>>>()

async function getCacheDirIndex(coversCacheDir: string): Promise<Set<string>> {
  if (_diskIndex.has(coversCacheDir)) return _diskIndex.get(coversCacheDir)!
  if (_building.has(coversCacheDir)) return _building.get(coversCacheDir)!

  const promise = (async () => {
    try {
      const names = await api.listDirectoryNames(coversCacheDir)
      const ids = new Set(
        names
          .filter(n => n.toLowerCase().endsWith('.jpg'))
          .map(n => n.slice(0, -4))
      )
      _diskIndex.set(coversCacheDir, ids)
      return ids
    } catch {
      const empty = new Set<string>()
      _diskIndex.set(coversCacheDir, empty)
      return empty
    } finally {
      _building.delete(coversCacheDir)
    }
  })()
  _building.set(coversCacheDir, promise)
  return promise
}

export const CoverCache = {
  async ensureCached(url: string, id: string, headers: any, basePath?: string): Promise<string | null> {
    if (!url || !url.startsWith('http')) return null

    try {
      const cacheDir = basePath
        ? `${basePath}/covers_cache`
        : await getDefaultCacheDir()

      const safeId = id.replace(/[^a-z0-9]/gi, '_').toLowerCase()
      const fileName = `${safeId}.jpg`
      const filePath = `${cacheDir}/${fileName}`

      // Ensure cache dir exists (fast no-op if already there)
      await api.createDirectory(cacheDir)

      // Check in-memory index instead of per-file IPC call
      const index = await getCacheDirIndex(cacheDir)
      if (index.has(safeId)) {
        return toLocalUrl(filePath)
      }

      // Not cached — download it
      const res = await api.downloadFile({
        url,
        folderPath: cacheDir,
        fileName,
        headers
      })

      if (res.success && res.path) {
        index.add(safeId)   // keep in-memory index up to date
        return toLocalUrl(res.path)
      }
    } catch (e) {
      console.error("[Cache] Failed to cache cover", e)
    }
    return null
  },

  async deleteCached(id: string, basePath?: string) {
    try {
      const cacheDir = basePath
        ? `${basePath}/covers_cache`
        : await getDefaultCacheDir()

      const safeId = id.replace(/[^a-z0-9]/gi, '_').toLowerCase()
      const fileName = `${safeId}.jpg`
      const filePath = `${cacheDir}/${fileName}`
      await api.deleteFile(filePath)

      // Remove from in-memory index
      _diskIndex.get(cacheDir)?.delete(safeId)
    } catch {
      // Ignore
    }
  }
}
