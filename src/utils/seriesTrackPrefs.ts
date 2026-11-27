// Per-series audio/subtitle choice for the Jellyfin player.
//
// Pick German audio + English subtitles once and every following episode of
// that series starts with them (Netflix/Infuse behaviour). Stored by language
// rather than stream index: indices differ from file to file. Only an explicit
// choice in the player menu is saved — the server's defaults are not.

import type { MediaStream } from '../components/jellyfin/player/types'

const KEY = 'jellyfinSeriesTrackPrefs'
const MAX_SERIES = 300

export interface SeriesTrackPref {
  audio?: { lang: string; title?: string; channels?: number }
  /** null = subtitles explicitly turned off */
  subtitle?: { lang: string; forced: boolean; title?: string } | null
  at: number
}

type Store = Record<string, SeriesTrackPref>

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function write(store: Store): void {
  try {
    const keys = Object.keys(store)
    if (keys.length > MAX_SERIES) {
      keys.sort((a, b) => (store[a].at || 0) - (store[b].at || 0))
      for (const k of keys.slice(0, keys.length - MAX_SERIES)) delete store[k]
    }
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch { /* storage unavailable */ }
}

export function getSeriesTrackPref(seriesId: string | null | undefined): SeriesTrackPref | null {
  if (!seriesId) return null
  return read()[seriesId] || null
}

export function saveSeriesAudio(seriesId: string | null | undefined, track: MediaStream | undefined): void {
  if (!seriesId || !track) return
  const store = read()
  store[seriesId] = {
    ...store[seriesId],
    audio: { lang: (track.Language || '').toLowerCase(), title: track.Title || undefined, channels: track.Channels ?? undefined },
    at: Date.now(),
  }
  write(store)
}

export function saveSeriesSubtitle(seriesId: string | null | undefined, track: MediaStream | null): void {
  if (!seriesId) return
  const store = read()
  store[seriesId] = {
    ...store[seriesId],
    subtitle: track
      ? { lang: (track.Language || '').toLowerCase(), forced: !!track.IsForced, title: track.Title || undefined }
      : null,
    at: Date.now(),
  }
  write(store)
}

const IMAGE_SUB_CODECS = ['pgssub', 'pgs', 'hdmv_pgs_subtitle', 'dvdsub', 'dvd_subtitle', 'dvbsub', 'dvb_subtitle', 'xsub']

/** Image-based subtitles can't be drawn by the player (no burn-in yet) */
export function isImageSubtitle(track: MediaStream | null | undefined): boolean {
  return IMAGE_SUB_CODECS.includes((track?.Codec || '').toLowerCase())
}

/** Same language code, case-insensitive */
function sameLang(a: string | null | undefined, b: string): boolean {
  return (a || '').toLowerCase() === b
}

/** Audio track matching a saved choice: same language, then the closest title/channel layout */
export function matchAudioPref(audio: MediaStream[], pref: SeriesTrackPref['audio']): number | null {
  if (!pref) return null
  const candidates = audio.filter(t => sameLang(t.Language, pref.lang))
  if (candidates.length === 0) return null
  const best =
    candidates.find(t => pref.title && t.Title === pref.title) ||
    candidates.find(t => pref.channels != null && t.Channels === pref.channels) ||
    candidates.find(t => t.IsDefault) ||
    candidates[0]
  return best.Index
}

/**
 * Subtitle index for a saved choice: -1 when the user turned them off,
 * undefined when the saved language doesn't exist in this file (then the
 * server's default applies). Text tracks are preferred over image tracks.
 */
export function matchSubtitlePref(subs: MediaStream[], pref: SeriesTrackPref['subtitle'] | undefined): number | undefined {
  if (pref === undefined) return undefined
  if (pref === null) return -1
  const candidates = subs.filter(t => sameLang(t.Language, pref.lang))
  if (candidates.length === 0) return undefined
  const text = candidates.filter(t => !isImageSubtitle(t))
  const pool = text.length > 0 ? text : candidates
  const best =
    pool.find(t => !!t.IsForced === pref.forced && pref.title && t.Title === pref.title) ||
    pool.find(t => !!t.IsForced === pref.forced) ||
    pool[0]
  return best.Index
}

/**
 * The server's DefaultSubtitleStreamIndex already applies the user's Jellyfin
 * subtitle mode + language. When it points at an image track the player can't
 * draw, use a text track of the same language and forced-ness instead.
 */
export function resolveServerSubtitle(subs: MediaStream[], serverDefault: number | null | undefined): number {
  if (serverDefault == null || serverDefault < 0) return -1
  const chosen = subs.find(t => t.Index === serverDefault)
  if (!chosen) return -1
  if (!isImageSubtitle(chosen)) return chosen.Index
  const alt = subs.find(t => !isImageSubtitle(t) && sameLang(t.Language, (chosen.Language || '').toLowerCase()) && !!t.IsForced === !!chosen.IsForced)
  return alt ? alt.Index : chosen.Index
}
