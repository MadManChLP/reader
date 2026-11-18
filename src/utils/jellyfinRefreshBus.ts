import type { BaseItemDto } from '../components/jellyfin/JellyfinContext'

// A tiny pub/sub the Jellyfin views subscribe to so they can quietly refetch
// their data in the background — no full remount, no loading spinner. Only the
// view that is currently mounted (home OR details OR library — the player is an
// overlay that doesn't subscribe) reacts. Triggered by JellyfinView after
// playback (player close, next-episode advance) and on a periodic timer, so the
// watched marks / Continue Watching / Up Next stay fresh without a hard reload.

type SoftRefreshListener = () => void

const listeners = new Set<SoftRefreshListener>()

/** Subscribe a mounted Jellyfin view to background soft-refresh signals. */
export function onJellyfinSoftRefresh(cb: SoftRefreshListener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Ask whatever Jellyfin view is mounted to refetch-and-diff in the background. */
export function requestJellyfinSoftRefresh(): void {
  listeners.forEach((cb) => {
    try {
      cb()
    } catch (e) {
      console.error('[JellyfinSoftRefresh] listener failed:', e)
    }
  })
}

/**
 * Signature of the watch-state-relevant fields of an item list. Two lists with
 * the same signature are visually identical for our purposes, so a background
 * refetch can bail out of setState (returning the previous reference so React
 * skips the re-render) when the signature is unchanged. The item ids are part
 * of the signature, so additions, removals and reordering all register.
 */
export function itemsWatchSig(items: BaseItemDto[]): string {
  return items
    .map(
      (i) =>
        `${i.Id}:${i.UserData?.Played ? 1 : 0}:${Math.round(i.UserData?.PlayedPercentage || 0)}` +
        `:${i.UserData?.PlaybackPositionTicks || 0}:${i.UserData?.UnplayedItemCount ?? ''}` +
        `:${i.UserData?.IsFavorite ? 1 : 0}`,
    )
    .join('|')
}
