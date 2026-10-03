// Coordinates which player owns navigator.mediaSession (lock screen / control
// center / hardware media keys). Three players can write to it — music,
// audiobook and video — and without coordination the last writer wins forever:
// e.g. the lock screen kept showing a Jellyfin movie while music was playing,
// because the video player set metadata and nobody ever replaced or cleared it.
//
// Rules:
//   • A player CLAIMS the session when it starts playing (or asserts content
//     while nothing else owns it). Only the owner writes metadata/handlers.
//   • A player RELEASES on unmount / when its content goes away. Release
//     clears the session and offers it to the remaining players (music first,
//     then audiobook) so a paused-in-background player reappears on the lock
//     screen instead of leaving it empty.

export type MediaSessionOwnerId = 'music' | 'audiobook' | 'video'

let owner: MediaSessionOwnerId | null = null

// Each player registers a re-assert callback: "write your metadata to the
// session if you have content; return true if you did".
const reasserts = new Map<MediaSessionOwnerId, () => boolean>()

export function claimMediaSession(who: MediaSessionOwnerId): void {
  owner = who
}

/** True when `who` may write to the session (owns it, or nobody does). */
export function canWriteMediaSession(who: MediaSessionOwnerId): boolean {
  return owner === null || owner === who
}

export function registerMediaSessionReassert(
  who: MediaSessionOwnerId,
  fn: () => boolean,
): () => void {
  reasserts.set(who, fn)
  return () => {
    if (reasserts.get(who) === fn) reasserts.delete(who)
  }
}

export function releaseMediaSession(who: MediaSessionOwnerId): void {
  if (owner !== who) return
  owner = null
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
    try {
      navigator.mediaSession.setPositionState()
    } catch {
      // Older engines require arguments — nothing to reset then.
    }
  }
  // Hand the lock screen to whichever remaining player has content.
  for (const candidate of ['music', 'audiobook'] as const) {
    if (candidate === who) continue
    if (reasserts.get(candidate)?.()) return
  }
}
