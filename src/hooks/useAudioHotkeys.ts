import { useEffect } from 'react'
import { useMusicPlayer } from '../stores/musicPlayerStore'
import { useAudiobookPlayer } from '../stores/audiobookPlayerStore'
import { areMediaKeysClaimed, isEditableTarget } from '../utils/navigationBus'
import { api as appApi, IS_PHONE } from '../utils/api'

// Desktop keyboard shortcuts for the two background audio players.
//
// Music (Spotify / Feishin map):
//   Space play/pause · Ctrl+←/→ previous/next · Shift+←/→ seek ∓10 s
//   Ctrl+↑/↓ volume · L like / unlike the playing track
// Audiobooks:
//   Space play/pause · ←/→ back/forward 30 s · Shift+←/→ previous/next chapter
//   [ / ] slower / faster
//
// The keys go to whichever player is "current": the audiobook when it is
// playing (or loaded while music is idle), otherwise music. They stay silent
// while a video/Live TV player or a reader is open (those claim the keys via
// navigationBus.claimMediaKeys), and inside text fields.

export const AUDIOBOOK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

type Notify = (message: string) => void

async function toggleTrackFavorite(notify: Notify): Promise<void> {
  const { currentTrack, jellyfinServerUrl, jellyfinAccessToken } = useMusicPlayer.getState()
  if (!currentTrack || !jellyfinServerUrl || !jellyfinAccessToken) return
  const headers = { Authorization: `MediaBrowser Token="${jellyfinAccessToken}"` }
  try {
    // Current state first — tracks in the queue carry no favorite flag.
    // Both routes take the user from the token (Jellyfin 10.9+/12).
    const data = await appApi.request({
      method: 'GET',
      url: `${jellyfinServerUrl}/UserItems/${currentTrack.id}/UserData`,
      headers,
    })
    const isFavorite = !!(data.success && (data.data as any)?.IsFavorite)
    const res = await appApi.request({
      method: isFavorite ? 'DELETE' : 'POST',
      url: `${jellyfinServerUrl}/UserFavoriteItems/${currentTrack.id}`,
      headers,
    })
    if (!res.success) throw new Error(`HTTP ${res.status}`)
    notify(isFavorite ? `Removed "${currentTrack.name}" from favorites` : `Liked "${currentTrack.name}"`)
  } catch {
    notify('Could not update favorite')
  }
}

export function useAudioHotkeys(notify: Notify) {
  useEffect(() => {
    if (IS_PHONE) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || areMediaKeysClaimed() || isEditableTarget(e.target)) return
      if (e.altKey || e.metaKey) return

      const ab = useAudiobookPlayer.getState()
      const music = useMusicPlayer.getState()
      const target: 'audiobook' | 'music' | null =
        ab.currentItem && (ab.isPlaying || !music.isPlaying) ? 'audiobook'
        : music.currentTrack ? 'music'
        : null
      if (!target) return

      // Space on a focused button already "clicks" it
      if (e.key === ' ') {
        const el = e.target as HTMLElement | null
        if (el && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute?.('role') === 'button')) return
      }

      const handled = (() => {
        if (target === 'audiobook') {
          if (e.ctrlKey) return false
          switch (e.key) {
            case ' ': ab.toggle(); return true
            case 'ArrowLeft':
              if (e.shiftKey) ab.prevChapter(); else ab.seekRelative(-30)
              return true
            case 'ArrowRight':
              if (e.shiftKey) ab.nextChapter(); else ab.seekRelative(30)
              return true
            case '[': case ']': {
              const i = AUDIOBOOK_SPEEDS.findIndex(s => s >= ab.playbackRate - 0.001)
              const cur = i === -1 ? AUDIOBOOK_SPEEDS.length - 1 : i
              const next = AUDIOBOOK_SPEEDS[Math.max(0, Math.min(AUDIOBOOK_SPEEDS.length - 1, cur + (e.key === ']' ? 1 : -1)))]
              ab.setPlaybackRate(next)
              notify(`Speed ${next}x`)
              return true
            }
          }
          return false
        }

        // Music
        switch (e.key) {
          case ' ':
            if (e.ctrlKey || e.shiftKey) return false
            music.toggle(); return true
          case 'ArrowLeft':
          case 'ArrowRight': {
            const fwd = e.key === 'ArrowRight'
            if (e.ctrlKey) { if (fwd) music.next(); else music.previous(); return true }
            if (e.shiftKey) {
              const t = Math.max(0, Math.min(music.duration || 0, music.currentTime + (fwd ? 10 : -10)))
              music.seek(t)
              return true
            }
            return false
          }
          case 'ArrowUp':
          case 'ArrowDown':
            if (!e.ctrlKey) return false
            music.setVolume(Math.max(0, Math.min(1, music.volume + (e.key === 'ArrowUp' ? 0.05 : -0.05))))
            return true
          case 'l': case 'L':
            if (e.ctrlKey) return false
            void toggleTrackFavorite(notify)
            return true
        }
        return false
      })()

      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [notify])
}
