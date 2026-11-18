// Jellyfin playback-session reporting for music.
//
// Previously this lived in MusicPlayerBar, which only exists inside the
// JellyMusic view: nothing was reported while music played under another tab,
// the progress interval never started on a normal play (it checked a flag the
// async start report had not set yet), and /Sessions/Playing/Stopped was never
// sent — the server kept a stale "now playing" session and lost play data.
//
// Driven by the always-mounted <audio> element of PersistentMusicPlayer:
//   playing (new track) → Stopped for the previous track, Playing for this one
//   every 10 s while playing, and on pause → Progress
//   ended / track cleared → Stopped

import { useEffect, type RefObject } from 'react'
import { api as appApi } from '../utils/api'
import { useMusicPlayer } from '../stores/musicPlayerStore'

interface MusicSession {
  trackId: string
  serverUrl: string
  token: string
  playSessionId: string
  /** Last known position (s) of THIS track — the element resets on a switch */
  position: number
}

const TICKS_PER_SECOND = 10_000_000

function newPlaySessionId(): string {
  try { return crypto.randomUUID().replace(/-/g, '') } catch { return `${Date.now()}${Math.random()}`.replace('.', '') }
}

function post(s: MusicSession, path: string, data: Record<string, unknown>): void {
  if (!navigator.onLine) return // the ended handler queues "played" offline
  void appApi.request({
    method: 'POST',
    url: `${s.serverUrl}/Sessions/Playing${path}`,
    headers: { 'Authorization': `MediaBrowser Token="${s.token}"`, 'Content-Type': 'application/json' },
    data: {
      ItemId: s.trackId,
      MediaSourceId: s.trackId,
      PlaySessionId: s.playSessionId,
      PositionTicks: Math.round(s.position * TICKS_PER_SECOND),
      CanSeek: true,
      PlayMethod: 'DirectStream',
      ...data,
    },
  }).catch(() => { /* best-effort */ })
}

export function useMusicSessionReporting(audioRef: RefObject<HTMLAudioElement | null>): void {
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    let session: MusicSession | null = null
    let progressTimer: ReturnType<typeof setInterval> | null = null

    const stopTimer = () => {
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
    }
    const endSession = (finalPosition?: number) => {
      stopTimer()
      if (!session) return
      if (finalPosition !== undefined) session.position = finalPosition
      post(session, '/Stopped', {})
      session = null
    }

    const onTimeUpdate = () => {
      const id = useMusicPlayer.getState().currentTrack?.id
      if (session && id === session.trackId) session.position = audio.currentTime || session.position
    }

    const onPlaying = () => {
      const { currentTrack, jellyfinServerUrl, jellyfinAccessToken } = useMusicPlayer.getState()
      if (!currentTrack || !jellyfinServerUrl || !jellyfinAccessToken) return
      if (session?.trackId === currentTrack.id) {
        post(session, '/Progress', { IsPaused: false }) // resumed after a pause
      } else {
        endSession() // skipped away from the previous track
        session = {
          trackId: currentTrack.id,
          serverUrl: jellyfinServerUrl,
          token: jellyfinAccessToken,
          playSessionId: newPlaySessionId(),
          position: audio.currentTime || 0,
        }
        post(session, '', { IsPaused: false })
      }
      stopTimer()
      progressTimer = setInterval(() => {
        if (session) post(session, '/Progress', { IsPaused: audio.paused })
      }, 10_000)
    }

    const onPause = () => {
      stopTimer()
      if (session && !audio.ended) post(session, '/Progress', { IsPaused: true })
    }

    const onEnded = () => endSession(audio.duration || session?.position)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)

    // Playback stopped/cleared (mini player ✕, queue cleared)
    const unsubscribe = useMusicPlayer.subscribe((state, prev) => {
      if (!state.currentTrack && prev.currentTrack) endSession()
    })

    // App closing
    const onUnload = () => endSession()
    window.addEventListener('beforeunload', onUnload)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      window.removeEventListener('beforeunload', onUnload)
      unsubscribe()
      endSession()
    }
  }, [audioRef])
}
