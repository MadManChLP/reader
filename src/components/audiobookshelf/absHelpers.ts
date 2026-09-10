import type { AbsApi } from '../../utils/absApi'
import type { AbsLibraryItem, AbsSeriesRef } from '../../types/audiobookshelf'
import { useAudiobookPlayer } from '../../stores/audiobookPlayerStore'

/** "5h 32m" / "48m" / "0m" */
export function formatAbsDuration(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return '0m'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/** "1:23:45" / "23:45" for player time displays */
export function formatAbsTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function getItemTitle(item: AbsLibraryItem): string {
  return item.media?.metadata?.title || 'Unknown Title'
}

export function getItemAuthor(item: AbsLibraryItem): string {
  const meta = item.media?.metadata
  if (!meta) return ''
  return meta.authorName || meta.authors?.map((a) => a.name).join(', ') || ''
}

/**
 * First series reference of a book. metadata.series is an array on expanded
 * items but a single object on items filtered by series.
 */
export function getItemSeries(item: AbsLibraryItem): AbsSeriesRef | null {
  const series = item.media?.metadata?.series
  if (!series) return null
  if (Array.isArray(series)) return series[0] ?? null
  return series
}

/** Sequence number of a book within its series ("2", "3.5", ...) or null */
export function getItemSeriesSequence(item: AbsLibraryItem): string | null {
  return getItemSeries(item)?.sequence ?? null
}

/**
 * Start streaming playback of an item (or podcast episode): opens a playback
 * session on the server and hands the tracks to the audiobook player store.
 */
export async function startItemPlayback(
  api: AbsApi,
  item: AbsLibraryItem,
  episodeId?: string | null,
): Promise<void> {
  const session = await api.play(item.id, episodeId)
  useAudiobookPlayer.getState().startFromSession(item, session, api)
}
