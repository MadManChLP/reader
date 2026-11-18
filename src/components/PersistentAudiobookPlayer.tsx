import React, { useRef, useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { useAudiobookPlayer, trackKeyOf } from '../stores/audiobookPlayerStore'
import { useSleepTimer, type SleepTimerHandlers } from '../stores/sleepTimerStore'
import { useToast } from './Toast'
import { useAudioOutputDevice } from '../hooks/useAudioOutputDevice'
import { toLocalUrl } from '../utils/api'
import { addToAbsQueue, processAbsQueue, saveLocalAbsProgress } from '../utils/absOfflineQueue'
import {
  claimMediaSession,
  canWriteMediaSession,
  registerMediaSessionReassert,
  releaseMediaSession,
} from '../utils/mediaSessionOwner'

// App-root audio element for audiobook/podcast playback (Audiobookshelf).
// Mounted in AppWithProviders next to PersistentMusicPlayer so playback
// survives tab switches. Also owns the server progress sync loop:
//   - POST /api/session/{id}/sync every 15s while playing (+ on pause)
//   - POST /api/session/{id}/close when the session ends/changes
//   - offline fallback: PATCH payloads queued in absOfflineQueue

const SYNC_INTERVAL_MS = 15000

export function PersistentAudiobookPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null)

  // useShallow WITHOUT currentTime — this component writes it 4x/sec itself
  const {
    currentItem,
    currentEpisodeId,
    displayTitle,
    displayAuthor,
    coverUrl,
    sessionId,
    isOfflinePlayback,
    tracks,
    trackIndex,
    isPlaying,
    volume,
    isMuted,
    playbackRate,
    absApi,
    setAudioRef,
    setCurrentTime,
    setTrackIndex,
    clearPendingTrackSeek,
    pause,
  } = useAudiobookPlayer(useShallow((s) => ({
    currentItem: s.currentItem,
    currentEpisodeId: s.currentEpisodeId,
    displayTitle: s.displayTitle,
    displayAuthor: s.displayAuthor,
    coverUrl: s.coverUrl,
    sessionId: s.sessionId,
    isOfflinePlayback: s.isOfflinePlayback,
    tracks: s.tracks,
    trackIndex: s.trackIndex,
    isPlaying: s.isPlaying,
    volume: s.volume,
    isMuted: s.isMuted,
    playbackRate: s.playbackRate,
    absApi: s.absApi,
    setAudioRef: s.setAudioRef,
    setCurrentTime: s.setCurrentTime,
    setTrackIndex: s.setTrackIndex,
    clearPendingTrackSeek: s.clearPendingTrackSeek,
    pause: s.pause,
  })))

  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying
  const errorRetriesRef = useRef(0)
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  // Session bookkeeping for sync/close (refs so handlers stay stable)
  const lastKnownTimeRef = useRef(0)
  const lastSyncWallClockRef = useRef(0)
  const listenedSinceSyncRef = useRef(0)
  const sessionRef = useRef<{ sessionId: string | null; itemId: string; episodeId: string | null; duration: number } | null>(null)

  // Register audio element with store
  useEffect(() => {
    if (audioRef.current) setAudioRef(audioRef.current)
    return () => setAudioRef(null)
  }, [setAudioRef])

  // The book played to its very end. Kept until playback moves away from the
  // end again, so the pause report that follows the end (and any later
  // report) doesn't send isFinished:false and un-mark the book.
  const finishedRef = useRef(false)

  // Send one progress report (session sync when online, queue otherwise).
  // `override` reports for a session that is no longer the current one.
  const reportProgress = async (
    isFinishedArg = false,
    override?: { session: NonNullable<typeof sessionRef.current>; currentTime: number; finished: boolean },
  ) => {
    const session = override?.session ?? sessionRef.current
    if (!session || !session.duration) return
    const state = useAudiobookPlayer.getState()
    const currentTime = override?.currentTime ?? lastKnownTimeRef.current
    const isFinished = isFinishedArg || (override ? override.finished : finishedRef.current)
    const timeListened = listenedSinceSyncRef.current
    listenedSinceSyncRef.current = 0

    saveLocalAbsProgress(session.itemId, session.episodeId, currentTime, session.duration)

    const queueEntry = {
      itemId: session.itemId,
      episodeId: session.episodeId,
      currentTime,
      duration: session.duration,
      progress: Math.min(1, currentTime / session.duration),
      isFinished,
    }

    const api = state.absApi
    if (!api) {
      addToAbsQueue(queueEntry)
      return
    }

    try {
      if (session.sessionId) {
        await api.syncSession(session.sessionId, { currentTime, timeListened, duration: session.duration })
        if (isFinished) await api.patchProgress(session.itemId, { isFinished: true }, session.episodeId)
      } else {
        // Offline download being played while the server is reachable
        await api.patchProgress(session.itemId, queueEntry, session.episodeId)
      }
      // Server reachable — flush anything queued from offline listening
      processAbsQueue(api).catch(() => {})
    } catch (e) {
      console.warn('[AbsPlayer] Progress sync failed, queueing:', e)
      addToAbsQueue(queueEntry)
    }
  }
  const reportProgressRef = useRef(reportProgress)
  reportProgressRef.current = reportProgress

  // Track the active session; close the previous one when it changes
  useEffect(() => {
    const previous = sessionRef.current
    if (previous?.sessionId && previous.sessionId !== sessionId) {
      const api = useAudiobookPlayer.getState().absApi
      const finalTime = lastKnownTimeRef.current
      const timeListened = listenedSinceSyncRef.current
      listenedSinceSyncRef.current = 0
      api
        ?.closeSession(previous.sessionId, { currentTime: finalTime, timeListened, duration: previous.duration })
        .catch((e) => console.warn('[AbsPlayer] Failed to close session:', e))
    } else if (
      previous && !previous.sessionId &&
      (previous.itemId !== currentItem?.id || previous.episodeId !== currentEpisodeId)
    ) {
      // Downloaded (session-less) playback ended by switching item or stop():
      // nothing else reports its last stretch — save the final position now.
      void reportProgressRef.current(false, {
        session: previous,
        currentTime: lastKnownTimeRef.current,
        finished: finishedRef.current,
      })
    }
    finishedRef.current = false

    if (currentItem) {
      sessionRef.current = {
        sessionId,
        itemId: currentItem.id,
        episodeId: currentEpisodeId,
        duration: useAudiobookPlayer.getState().duration,
      }
      lastKnownTimeRef.current = useAudiobookPlayer.getState().currentTime
    } else {
      sessionRef.current = null
    }
  }, [sessionId, currentItem, currentEpisodeId])

  // Close the session when the app window unloads
  useEffect(() => {
    const handleUnload = () => {
      const session = sessionRef.current
      const api = useAudiobookPlayer.getState().absApi
      if (session?.sessionId && api) {
        // Best effort — no await possible during unload
        api.closeSession(session.sessionId, {
          currentTime: lastKnownTimeRef.current,
          timeListened: listenedSinceSyncRef.current,
          duration: session.duration,
        }).catch(() => {})
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    // Phones background/kill the app without beforeunload — save on hide
    const handleHide = () => {
      if (document.visibilityState === 'hidden' && sessionRef.current) void reportProgressRef.current()
    }
    document.addEventListener('visibilitychange', handleHide)
    window.addEventListener('pagehide', handleHide)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      document.removeEventListener('visibilitychange', handleHide)
      window.removeEventListener('pagehide', handleHide)
    }
  }, [])

  // Shared sleep timer: minutes timers pause (with a volume fade) through these
  const prevTimeRef = useRef<number | null>(null)
  useEffect(() => {
    const handlers: SleepTimerHandlers = {
      pause: () => {
        useAudiobookPlayer.getState().pause()
        void reportProgressRef.current()
      },
      setFade: (scale) => {
        const audio = audioRef.current
        const s = useAudiobookPlayer.getState()
        if (audio) audio.volume = Math.max(0, Math.min(1, (s.isMuted ? 0 : s.volume) * scale))
      },
    }
    useSleepTimer.getState().registerHandlers('audiobook', handlers)
    return () => useSleepTimer.getState().unregisterHandlers('audiobook', handlers)
  }, [])

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    let lastTickWallClock = 0

    const handleTimeUpdate = () => {
      const state = useAudiobookPlayer.getState()
      const track = state.tracks[state.trackIndex]
      if (!track) return
      const absoluteTime = track.startOffset + audio.currentTime
      lastKnownTimeRef.current = absoluteTime
      setCurrentTime(absoluteTime)
      // Listening again after the end → no longer "finished"
      if (finishedRef.current && !audio.paused && absoluteTime < state.duration - 2) finishedRef.current = false

      // Accumulate listened time (wall clock between ticks while playing)
      const now = Date.now()
      if (lastTickWallClock > 0 && !audio.paused) {
        listenedSinceSyncRef.current += Math.min(2, (now - lastTickWallClock) / 1000)
      }
      lastTickWallClock = now

      // Sleep timer "end of chapter": stop when PLAYBACK crosses the end of
      // the chapter it was in. Derived from the live position each tick, so
      // a seek just moves the stop point to the new chapter (the old timer
      // stored a fixed media time and misfired after a seek). Jumps of more
      // than a few seconds are seeks, not playback, and never trigger it.
      const sleep = useSleepTimer.getState()
      const prev = prevTimeRef.current
      prevTimeRef.current = absoluteTime
      if (sleep.target === 'audiobook' && sleep.mode?.kind === 'endOfItem' && !audio.paused
        && prev !== null && absoluteTime > prev && absoluteTime - prev < 5) {
        const ch = state.chapters.find((c) => prev >= c.start && prev < c.end)
        if (ch && absoluteTime >= ch.end - 0.25 && sleep.consumeEndOfItem('audiobook')) {
          pause()
          reportProgressRef.current()
        }
      }
    }

    const handleLoadedMetadata = () => {
      const state = useAudiobookPlayer.getState()
      audio.playbackRate = state.playbackRate
      audio.volume = state.isMuted ? 0 : state.volume
      if (state.pendingTrackSeek !== null) {
        audio.currentTime = state.pendingTrackSeek
        clearPendingTrackSeek()
      }
      errorRetriesRef.current = 0
      // From now on seeks within this file can be applied to the element directly
      useAudiobookPlayer.getState().setLoadedTrackKey(trackKeyOf(state))
    }

    const handleEnded = () => {
      const state = useAudiobookPlayer.getState()
      // No chapters: "end of chapter" means end of the book/episode
      if (state.chapters.length === 0 && state.trackIndex >= state.tracks.length - 1) {
        useSleepTimer.getState().consumeEndOfItem('audiobook')
      }
      if (state.trackIndex < state.tracks.length - 1) {
        // Next file of the same book — the src effect continues playback
        setTrackIndex(state.trackIndex + 1)
      } else {
        // End of the book/episode
        finishedRef.current = true
        lastKnownTimeRef.current = state.duration
        setCurrentTime(state.duration)
        useAudiobookPlayer.setState({ isPlaying: false })
        reportProgressRef.current(true)
      }
    }

    // A seek while paused (chapter tap, scrubbing) is otherwise never synced:
    // closing the app or switching device would lose it
    let seekSyncTimer: ReturnType<typeof setTimeout> | undefined
    const handleSeeked = () => {
      if (!audio.paused) return
      clearTimeout(seekSyncTimer)
      seekSyncTimer = setTimeout(() => { void reportProgressRef.current() }, 1500)
    }

    // Without an error listener a failed stream (expired token in the URL,
    // server restart, deleted download) left the UI "playing" in silence.
    // Streams are rebuilt with the current (refreshed) token and resumed.
    const handleError = () => {
      const state = useAudiobookPlayer.getState()
      const track = state.tracks[state.trackIndex]
      if (!track || !audio.getAttribute('src')) return
      const position = Math.max(0, lastKnownTimeRef.current - track.startOffset)
      if (track.contentUrl && state.absApi && errorRetriesRef.current < 2) {
        errorRetriesRef.current++
        console.warn('[AbsPlayer] Stream error, reloading with a fresh URL')
        void (async () => {
          // Any authenticated call refreshes an expired token (401 → refresh)
          try { await state.absApi!.getProgress(state.currentItem!.id, state.currentEpisodeId) } catch {}
          const s = useAudiobookPlayer.getState()
          if (trackKeyOf(s) !== trackKeyOf(state) || !s.absApi) return
          useAudiobookPlayer.setState({ pendingTrackSeek: position, loadedTrackKey: null })
          audio.src = s.absApi.trackUrl(track.contentUrl!)
          audio.load()
          if (isPlayingRef.current) audio.play().catch(() => {})
        })()
        return
      }
      useAudiobookPlayer.setState({ isPlaying: false })
      void reportProgressRef.current()
      toastRef.current.error(track.localPath
        ? 'Audiobook file could not be played — the download may be missing or damaged'
        : 'Audiobook playback failed — check the connection to Audiobookshelf')
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('seeked', handleSeeked)
    audio.addEventListener('error', handleError)

    return () => {
      clearTimeout(seekSyncTimer)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('seeked', handleSeeked)
      audio.removeEventListener('error', handleError)
    }
  }, [setCurrentTime, setTrackIndex, clearPendingTrackSeek, pause])

  // Source management: set src when the item or track index changes
  const currentTrack = tracks[trackIndex] ?? null
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return

    let src: string | null = null
    if (currentTrack.localPath) {
      src = toLocalUrl(currentTrack.localPath)
    } else if (currentTrack.contentUrl && absApi) {
      src = absApi.trackUrl(currentTrack.contentUrl)
    }
    if (!src) return

    useAudiobookPlayer.getState().setLoadedTrackKey(null) // set again on loadedmetadata
    errorRetriesRef.current = 0
    audio.src = src
    audio.load()
    if (isPlayingRef.current) {
      audio.play().catch((e) => console.error('[AbsPlayer] Autoplay failed:', e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem?.id, currentEpisodeId, trackIndex, isOfflinePlayback])

  // Playback control
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return
    if (isPlaying) {
      audio.play().catch((e) => console.error('[AbsPlayer] play failed:', e))
    } else {
      audio.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // Volume / rate
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = isMuted ? 0 : volume
  }, [volume, isMuted])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.playbackRate = playbackRate
  }, [playbackRate])

  // Periodic progress sync while playing (+ one report on pause)
  useEffect(() => {
    if (!currentItem) return
    if (!isPlaying) {
      reportProgressRef.current()
      return
    }
    lastSyncWallClockRef.current = Date.now()
    const interval = setInterval(() => reportProgressRef.current(), SYNC_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [isPlaying, currentItem, sessionId])

  // MediaSession (hardware media keys / OS media overlay). Ownership rules in
  // mediaSessionOwner: playing claims the lock screen, so music and audiobooks
  // no longer overwrite each other's metadata.
  const applyMediaSessionRef = useRef<() => boolean>(() => false)
  applyMediaSessionRef.current = () => {
    if (!('mediaSession' in navigator)) return false
    const s = useAudiobookPlayer.getState()
    if (!s.currentItem) return false
    claimMediaSession('audiobook')
    const ms = navigator.mediaSession
    ms.metadata = new MediaMetadata({
      title: s.displayTitle,
      artist: s.displayAuthor,
      artwork: s.coverUrl ? [{ src: s.coverUrl, sizes: '600x600' }] : [],
    })
    ms.setActionHandler('play', () => useAudiobookPlayer.getState().play())
    ms.setActionHandler('pause', () => useAudiobookPlayer.getState().pause())
    ms.setActionHandler('seekbackward', () => useAudiobookPlayer.getState().seekRelative(-30))
    ms.setActionHandler('seekforward', () => useAudiobookPlayer.getState().seekRelative(30))
    ms.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined && details.seekTime !== null) {
        useAudiobookPlayer.getState().seek(details.seekTime)
      }
    })
    ms.playbackState = s.isPlaying ? 'playing' : 'paused'
    return true
  }

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!currentItem) {
      releaseMediaSession('audiobook')
      return
    }
    if (isPlaying) claimMediaSession('audiobook')
    if (!canWriteMediaSession('audiobook')) return
    applyMediaSessionRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem, displayTitle, displayAuthor, coverUrl, isPlaying])

  // Lock-screen seek bar: absolute position over the whole book (files are
  // stitched into one timeline via track.startOffset). The OS interpolates
  // between updates, so per-event updates are enough.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !('mediaSession' in navigator)) return
    const update = () => {
      if (!canWriteMediaSession('audiobook')) return
      const s = useAudiobookPlayer.getState()
      const track = s.tracks[s.trackIndex]
      if (!track || !Number.isFinite(s.duration) || s.duration <= 0) return
      const position = Math.min(track.startOffset + audio.currentTime, s.duration)
      try {
        navigator.mediaSession.setPositionState({
          duration: s.duration,
          position,
          playbackRate: audio.playbackRate,
        })
      } catch {
        // Transient invalid state mid-load — skip this update.
      }
    }
    const events = ['loadedmetadata', 'seeked', 'play', 'pause', 'ratechange'] as const
    for (const ev of events) audio.addEventListener(ev, update)
    return () => {
      for (const ev of events) audio.removeEventListener(ev, update)
    }
  }, [])

  // Re-assert when another player releases the session; release on unmount.
  useEffect(() => {
    const unregister = registerMediaSessionReassert('audiobook', () => applyMediaSessionRef.current())
    return () => {
      unregister()
      releaseMediaSession('audiobook')
    }
  }, [])

  // Audio output routing (Settings → Advanced, Audiobookshelf device)
  useAudioOutputDevice(audioRef, 'audiobook', `${currentItem?.id}-${trackIndex}`)

  return <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
}
