// Per-install Jellyfin device id (shared by the SDK client, stream URLs and
// the offline queue). Jellyfin tracks sessions and kills transcode jobs per
// DeviceId, so a hard-coded id made two devices fight over one transcode.

const STORAGE_KEY = 'jellyfin_device_id'
let cached: string | null = null

export function getJellyfinDeviceId(): string {
  if (cached) return cached
  let id: string | null = null
  try { id = localStorage.getItem(STORAGE_KEY) } catch { /* storage blocked */ }
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `reader-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    try { localStorage.setItem(STORAGE_KEY, id) } catch { /* keep it in memory */ }
  }
  cached = id
  return id
}
