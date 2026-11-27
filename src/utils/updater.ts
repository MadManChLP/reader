// In-app updater core.
//
// Fetches the per-channel update manifest published by the CI pipeline
// (reader-source/latest/updates.json), compares it to this build's metadata
// (src/buildInfo.ts) and reports whether an update is available and how it is
// delivered on the current platform:
//   - desktop (Windows/macOS/Linux): download the installer and run it
//   - Android: download/open the APK (sideload) + link to releases
//   - iOS: notice only — SideStore performs the actual install/update
//
// Channel resolution: the Stable/Dev toggle drives DESKTOP. Android ships a
// single (stable) APK; iOS relies on SideStore. See resolveChannel().

import { BUILD_INFO } from '../buildInfo'
import { api, IS_IOS } from './api'
import type { UpdateChannel } from '../types/settings'

export type UpdatePlatform = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown'

// desktop-installer = download the installer and run it in-app.
// mobile-store = informational only; the OS "app store" (Obtainium on Android,
// SideStore on iOS) performs the actual install/update.
export type UpdateMethod = 'desktop-installer' | 'mobile-store'

type DownloadKey =
  | 'windows' | 'macos' | 'linux' | 'linux-deb' | 'linux-rpm' | 'linux-tar' | 'linux-arch' | 'android'

// A selectable Linux install format.
//  - `install`   deb/rpm → handed to the system package installer in-app.
//  - `selfupdate` tar.gz → downloaded, extracted, the running binary swapped in
//                 place and relaunched (works on Arch etc. where the AppImage's
//                 bundled WebKit is incompatible). AppImage can't self-update
//                 this way (it runs from a read-only mount), so it stays download.
//  - `download`  AppImage → downloaded in the browser for the user to run.
export interface LinuxFormat {
  key: 'deb' | 'rpm' | 'appimage' | 'tar' | 'arch'
  label: string
  url: string
  //  - `pacman`  .pkg.tar.zst → installed via `pkexec pacman -U` (root prompt).
  mode: 'install' | 'download' | 'selfupdate' | 'pacman'
}

interface ChannelManifest {
  version: string
  buildId?: number
  devVersion?: string
  date?: string
  releaseUrl?: string
  /** Release-notes markdown shown in the update notice (may be empty). */
  notes?: string
  downloads: Partial<Record<DownloadKey, string>>
}

interface UpdateManifest {
  stable: ChannelManifest | null
  dev: ChannelManifest | null
}

export interface UpdateInfo {
  channel: UpdateChannel
  platform: UpdatePlatform
  method: UpdateMethod
  /** Version label to show the user (dev shows the -dev.<pipeline> form). */
  displayVersion: string
  /** The running build's version label, for "you have X" copy. */
  currentVersion: string
  date?: string
  releaseUrl?: string
  /** Direct installer URL for desktop (undefined on mobile). On Linux this is
   *  the default format (deb → AppImage); use `linuxFormats` for the chooser. */
  downloadUrl?: string
  /** Available Linux install formats (only set on Linux) for the format picker. */
  linuxFormats?: LinuxFormat[]
  /** Release-notes markdown to show in the notice (may be empty). */
  notes?: string
  /** Name of the store to update from on mobile (Obtainium / SideStore). */
  storeName?: string
}

/** Detect the current runtime platform. */
export function getPlatform(): UpdatePlatform {
  if (IS_IOS) return 'ios'
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Android/i.test(ua)) return 'android'
  if (/Windows/i.test(ua)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos'
  if (/Linux/i.test(ua)) return 'linux'
  return 'unknown'
}

export const IS_DESKTOP = ['windows', 'macos', 'linux'].includes(getPlatform())

/**
 * Resolve which channel to check on this platform.
 * Desktop honours the user's toggle; Android has only a stable APK; iOS relies
 * on SideStore so we surface the stable notice (the toggle is hidden there).
 */
export function resolveChannel(setting: UpdateChannel): UpdateChannel {
  const p = getPlatform()
  if (p === 'windows' || p === 'macos' || p === 'linux') return setting
  return 'stable'
}

/** Numeric-dotted version compare (stable X.Y.Z). Returns -1 | 0 | 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

async function fetchManifest(): Promise<UpdateManifest | null> {
  const url = BUILD_INFO.updateManifestUrl
  if (!url) return null // local/dev build — nothing to check against
  try {
    const res = await api.request({
      method: 'GET',
      url,
      responseType: 'json',
      // Self-hosted GitLab may use a self-signed cert (SSL is relaxed app-wide).
      allowInsecureSsl: true,
    })
    if (!res.success || res.data == null) return null
    return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as UpdateManifest
  } catch {
    return null
  }
}

function methodForPlatform(p: UpdatePlatform): UpdateMethod {
  return p === 'android' || p === 'ios' ? 'mobile-store' : 'desktop-installer'
}

function storeNameForPlatform(p: UpdatePlatform): string | undefined {
  if (p === 'android') return 'Obtainium'
  if (p === 'ios') return 'SideStore'
  return undefined
}

function downloadUrlForPlatform(entry: ChannelManifest, p: UpdatePlatform): string | undefined {
  switch (p) {
    case 'windows': return entry.downloads.windows
    case 'macos': return entry.downloads.macos
    // Prefer the .deb — opening it launches the system package installer (a
    // real in-place "install"). Fall back to the portable AppImage.
    case 'linux': return entry.downloads['linux-deb'] ?? entry.downloads.linux
    default: return undefined // mobile is informational (store handles install)
  }
}

function linuxFormatsFor(entry: ChannelManifest): LinuxFormat[] {
  const d = entry.downloads
  const out: LinuxFormat[] = []
  if (d['linux-deb']) out.push({ key: 'deb', label: '.deb', url: d['linux-deb'], mode: 'install' })
  if (d['linux-rpm']) out.push({ key: 'rpm', label: '.rpm', url: d['linux-rpm'], mode: 'install' })
  if (d.linux) out.push({ key: 'appimage', label: 'AppImage', url: d.linux, mode: 'download' })
  if (d['linux-tar']) out.push({ key: 'tar', label: '.tar.gz', url: d['linux-tar'], mode: 'selfupdate' })
  // Arch package: installed in-app via `pkexec pacman -U` (root prompt).
  if (d['linux-arch']) out.push({ key: 'arch', label: '.pkg.tar.zst', url: d['linux-arch'], mode: 'pacman' })
  return out
}

function devLabel(version: string, buildId?: number, devVersion?: string): string {
  if (devVersion) return devVersion
  return buildId ? `${version}-dev.${buildId}` : version
}

/**
 * Check for an available update on the given channel setting.
 * Returns null when up to date, offline, or on a local build with no manifest.
 */
export async function checkForUpdate(setting: UpdateChannel): Promise<UpdateInfo | null> {
  const channel = resolveChannel(setting)
  const manifest = await fetchManifest()
  if (!manifest) return null

  const entry = channel === 'dev' ? manifest.dev : manifest.stable
  if (!entry) return null

  // Is the manifest build newer than what we're running?
  const isNewer =
    channel === 'dev'
      ? (entry.buildId ?? 0) > BUILD_INFO.buildId
      : compareVersions(entry.version, BUILD_INFO.version) > 0
  if (!isNewer) return null

  const platform = getPlatform()
  const displayVersion =
    channel === 'dev'
      ? devLabel(entry.version, entry.buildId, entry.devVersion)
      : entry.version
  const currentVersion =
    channel === 'dev'
      ? devLabel(BUILD_INFO.version, BUILD_INFO.buildId || undefined)
      : BUILD_INFO.version

  return {
    channel,
    platform,
    method: methodForPlatform(platform),
    displayVersion,
    currentVersion,
    date: entry.date,
    releaseUrl: entry.releaseUrl,
    downloadUrl: downloadUrlForPlatform(entry, platform),
    linuxFormats: platform === 'linux' ? linuxFormatsFor(entry) : undefined,
    notes: entry.notes,
    storeName: storeNameForPlatform(platform),
  }
}
