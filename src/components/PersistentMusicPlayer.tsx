import React, { useRef, useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { useMusicPlayer, getLocalTrackImage } from '../stores/musicPlayerStore'
import { useAudiobookPlayer } from '../stores/audiobookPlayerStore'
import { useSleepTimer, type SleepTimerHandlers } from '../stores/sleepTimerStore'
import { useAudioOutputDevice } from '../hooks/useAudioOutputDevice'
import { addToJellyfinQueue } from '../utils/jellyfinOfflineQueue'
import { toLocalUrl } from '../utils/api'
import { getUniversalAudioUrl } from '../utils/audioStream'
import {
  claimMediaSession,
  canWriteMediaSession,
  registerMediaSessionReassert,
  releaseMediaSession,
} from '../utils/mediaSessionOwner'

export function PersistentMusicPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const trackTransitionRef = useRef(false)
  const isPlayingRef = useRef(false)

  // useShallow WITHOUT currentTime/duration — this component only writes them,
  // so it must not re-render 4x/sec on every timeupdate it produces itself
  const {
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    jellyfinServerUrl,
    jellyfinAccessToken,
    jellyfinServerId,
    setAudioRef,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    next,
  } = useMusicPlayer(useShallow(s => ({
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    volume: s.volume,
    isMuted: s.isMuted,
    jellyfinServerUrl: s.jellyfinServerUrl,
    jellyfinAccessToken: s.jellyfinAccessToken,
    jellyfinServerId: s.jellyfinServerId,
    setAudioRef: s.setAudioRef,
    setCurrentTime: s.setCurrentTime,
    setDuration: s.setDuration,
    setIsPlaying: s.setIsPlaying,
    next: s.next,
  })))

  isPlayingRef.current = isPlaying

  // Refs so event handlers see latest values without re-attaching
  const currentTrackRef = useRef(currentTrack)
  const jellyfinServerUrlRef = useRef(jellyfinServerUrl)
  const jellyfinAccessTokenRef = useRef(jellyfinAccessToken)
  const jellyfinServerIdRef = useRef(jellyfinServerId)
  currentTrackRef.current = currentTrack
  jellyfinServerUrlRef.current = jellyfinServerUrl
  jellyfinAccessTokenRef.current = jellyfinAccessToken
  jellyfinServerIdRef.current = jellyfinServerId

  // Register audio element with store
  useEffect(() => {
    if (audioRef.current) setAudioRef(audioRef.current)
    return () => setAudioRef(null)
  }, [setAudioRef])

  // Sleep timer: register pause/fade handlers for the 'music' target. This
  // component is always mounted at the App root, so minute timers fire even
  // while the user browses other tabs. The fade scales the element volume
  // directly; the volume effect below restores it on the next volume change,
  // and setFade(1) after pause restores it immediately.
  useEffect(() => {
    const handlers: SleepTimerHandlers = {
      pause: () => useMusicPlayer.getState().pause(),
      setFade: (scale) => {
        const audio = audioRef.current
        if (!audio) return
        const s = useMusicPlayer.getState()
        audio.volume = Math.max(0, Math.min(1, (s.isMuted ? 0 : s.volume) * scale))
      },
    }
    useSleepTimer.getState().registerHandlers('music', handlers)
    return () => useSleepTimer.getState().unregisterHandlers('music', handlers)
  }, [])

  // Audio event handlers (stable deps, only attaches once)
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleLoadedMetadata = () => setDuration(audio.duration)
    const handleEnded = () => {
      // Report play to Jellyfin (queued if offline, sent directly if online)
      const track = currentTrackRef.current
      const serverUrl = jellyfinServerUrlRef.current
      const token = jellyfinAccessTokenRef.current
      const serverId = jellyfinServerIdRef.current || 'default'

      if (track && serverUrl && token) {
        const op = {
          type: 'music_played' as const,
          trackId: track.id,
          albumId: track.albumId,
          serverId,
          serverUrl,
          token,
          userId: '',  // filled by server from token
          timestamp: Date.now(),
        }
        if (!navigator.onLine) {
          addToJellyfinQueue(op)
        } else {
          fetch(`${serverUrl}/UserPlayedItems/${track.id}`, {
            method: 'POST',
            headers: { 'Authorization': `MediaBrowser Token="${token}"` },
            keepalive: true,
          }).catch(() => addToJellyfinQueue(op))
        }
      }

      // Sleep timer "end of current track": stop here instead of advancing
      // (the scrobble above still ran). Rewind so a later play restarts the track.
      if (useSleepTimer.getState().consumeEndOfItem('music')) {
        audio.currentTime = 0
        setCurrentTime(0)
        setIsPlaying(false)
        return
      }

      next()
    }
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => {
      if (!trackTransitionRef.current) setIsPlaying(false)
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
    }
  }, [setCurrentTime, setDuration, setIsPlaying, next])

  // Update audio source when track changes
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return

    let streamUrl: string

    if (currentTrack.localPath) {
      // Downloaded track — play from local filesystem via book-file:// protocol
      // In compiled Tauri: toLocalUrl() converts to http://book-file.localhost/<path>
      // In dev/Electron: book-file:// is served natively
      streamUrl = toLocalUrl(currentTrack.localPath)
    } else {
      // Streaming track — requires Jellyfin server to be reachable
      if (!jellyfinServerUrl || !jellyfinAccessToken) return
      streamUrl = getUniversalAudioUrl(jellyfinServerUrl, currentTrack.id, jellyfinAccessToken)
    }

    trackTransitionRef.current = true
    audio.src = streamUrl
    audio.load()
    setTimeout(() => { trackTransitionRef.current = false }, 500)

    if (isPlayingRef.current) {
      audio.play().catch(console.error)
    }
  }, [currentTrack?.id, currentTrack?.localPath, jellyfinServerUrl, jellyfinAccessToken])

  // Playback control
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      // Only one thing plays at a time — audiobook yields to music
      useAudiobookPlayer.getState().pause()
      audio.play().catch(console.error)
    } else {
      audio.pause()
    }
  }, [isPlaying])

  // Volume control
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = isMuted ? 0 : volume
  }, [volume, isMuted])

  // ---- MediaSession: lock screen / control center / hardware media keys ----
  // Writes metadata + transport controls whenever this player owns the OS
  // media session (see mediaSessionOwner — playing claims ownership, so the
  // lock screen always shows the most recently started player).
  const applyMediaSessionRef = useRef<() => boolean>(() => false)
  applyMediaSessionRef.current = () => {
    if (!('mediaSession' in navigator)) return false
    const track = currentTrackRef.current
    if (!track) return false
    claimMediaSession('music')

    const serverUrl = jellyfinServerUrlRef.current
    const token = jellyfinAccessTokenRef.current
    const localImage = getLocalTrackImage(track)
    const artwork: MediaImage[] = []
    if (localImage) {
      artwork.push({ src: toLocalUrl(localImage), sizes: '1000x1000', type: 'image/jpeg' })
    } else if (track.albumId && serverUrl) {
      const tokenParam = token ? `&ApiKey=${token}` : ''
      for (const size of [300, 600, 1200]) {
        artwork.push({
          src: `${serverUrl}/Items/${track.albumId}/Images/Primary?maxWidth=${size}&quality=90${tokenParam}`,
          sizes: `${size}x${size}`,
          type: 'image/jpeg',
        })
      }
    }

    const ms = navigator.mediaSession
    ms.metadata = new MediaMetadata({
      title: track.name,
      artist: track.artists.join(', '),
      album: track.albumName,
      artwork,
    })
    ms.setActionHandler('play', () => useMusicPlayer.getState().play())
    ms.setActionHandler('pause', () => useMusicPlayer.getState().pause())
    ms.setActionHandler('previoustrack', () => useMusicPlayer.getState().previous())
    ms.setActionHandler('nexttrack', () => useMusicPlayer.getState().next())
    ms.setActionHandler('seekto', (d) => {
      if (d.seekTime !== undefined && d.seekTime !== null) useMusicPlayer.getState().seek(d.seekTime)
    })
    ms.playbackState = useMusicPlayer.getState().isPlaying ? 'playing' : 'paused'
    return true
  }

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!currentTrack) {
      releaseMediaSession('music')
      return
    }
    if (isPlaying) claimMediaSession('music')
    if (!canWriteMediaSession('music')) return
    applyMediaSessionRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.imageUrl, isPlaying])

  // Position state for the lock-screen seek bar. The OS interpolates between
  // updates, so events (not timeupdate polling) are enough.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !('mediaSession' in navigator)) return
    const update = () => {
      if (!canWriteMediaSession('music')) return
      const duration = audio.duration
      if (!Number.isFinite(duration) || duration <= 0) return
      try {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.min(audio.currentTime, duration),
          playbackRate: audio.playbackRate,
        })
      } catch {
        // Invalid transient state (e.g. position > duration mid-load) — skip.
      }
    }
    const events = ['loadedmetadata', 'seeked', 'play', 'pause', 'ratechange'] as const
    for (const ev of events) audio.addEventListener(ev, update)
    return () => {
      for (const ev of events) audio.removeEventListener(ev, update)
    }
  }, [])

  // Re-assert on release by another player (e.g. closing the video player
  // returns paused music to the lock screen), release on unmount.
  useEffect(() => {
    const unregister = registerMediaSessionReassert('music', () => applyMediaSessionRef.current())
    return () => {
      unregister()
      releaseMediaSession('music')
    }
  }, [])

  // Audio output device (Settings → Advanced, JellyMusic device)
  useAudioOutputDevice(audioRef, 'music')

  return <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
}
