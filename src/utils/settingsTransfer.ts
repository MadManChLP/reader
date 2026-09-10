// Export / import app settings so a configuration can be moved between a PC and
// a phone (or restored after a reset).
//
// SECURITY: the export deliberately excludes every secret — the LDAP username &
// password and ALL per-session auth tokens (Jellyfin/ABS access tokens, the sync
// token). The receiving device keeps its own login and simply signs in once.
//
// DEVICE-SPECIFIC fields (download path, audio output device IDs) are written
// into the file for completeness but are NOT applied on import: a Windows folder
// path or an audio-device GUID is meaningless — and can silently break downloads
// or playback — on another machine.

import type { AppSettings } from '../types/settings'

const APP_TAG = 'mediamaster'
const KIND = 'settings-export'
const EXPORT_VERSION = 1

export interface SettingsExportPayload {
  app: typeof APP_TAG
  kind: typeof KIND
  version: number
  exportedAt: string
  /** Requester server URL (kept in its own store, not in AppSettings). */
  requesterUrl?: string
  settings: Partial<AppSettings>
}

export interface ImportResult {
  /** Settings to merge via updateSettings (credentials/device fields removed). */
  incoming: Partial<AppSettings>
  /** Requester URL to apply to the requester store, if present. */
  requesterUrl?: string
}

/**
 * Build the export JSON text. Strips all secrets from a deep copy of the current
 * settings; adds the requester URL that lives outside AppSettings.
 */
export function buildSettingsExport(settings: AppSettings, requesterUrl?: string): string {
  const clone: AppSettings = JSON.parse(JSON.stringify(settings))

  // Credentials — never exported.
  clone.credentials = { username: '', password: '' }

  // Jellyfin: keep server identity + URL, drop per-server auth tokens.
  clone.jellyfinServers = (clone.jellyfinServers || []).map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
  }))

  // Audiobookshelf: keep the URL (+ default library preference), drop tokens.
  clone.audiobookshelf = {
    url: clone.audiobookshelf?.url || '',
    defaultLibraryId: clone.audiobookshelf?.defaultLibraryId,
  }

  // Device-specific fields never leave this machine: a download path or an audio
  // output device GUID from one device is meaningless (and can break downloads /
  // silence playback) on another. Removed from the export entirely.
  delete (clone as Partial<AppSettings>).downloadPath
  delete (clone as Partial<AppSettings>).audioOutputDevices

  const payload: SettingsExportPayload = {
    app: APP_TAG,
    kind: KIND,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    requesterUrl: requesterUrl || undefined,
    settings: clone,
  }
  return JSON.stringify(payload, null, 2)
}

/**
 * Parse and validate an export file. Throws on anything that isn't a Mediamaster
 * settings export. Returns the settings to merge (with credentials and
 * device-specific fields removed) plus the requester URL.
 */
export function parseSettingsImport(raw: string): ImportResult {
  let payload: SettingsExportPayload
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  if (!payload || payload.app !== APP_TAG || payload.kind !== KIND || !payload.settings) {
    throw new Error('That is not a Mediamaster settings export.')
  }

  const incoming: Partial<AppSettings> = { ...payload.settings }

  // Never import another device's login…
  delete (incoming as Partial<AppSettings>).credentials
  // …nor device-specific fields that don't transfer meaningfully.
  delete (incoming as Partial<AppSettings>).downloadPath
  delete (incoming as Partial<AppSettings>).audioOutputDevices

  return { incoming, requesterUrl: payload.requesterUrl }
}
