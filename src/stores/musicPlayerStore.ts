import { create } from 'zustand'
import api, { isLocalFileUrl } from '../utils/api'
import { getDownloadedTrack } from '../utils/musicDownloadManager'
import { loadSettings } from '../types/settings'

export interface Track {
  id: string
  name: string
  artists: string[]
  artistIds: string[]
  albumId: string
  albumName: string
  duration: number      // ticks (100ns units)
  indexNumber?: number | null
  /** Disc number (ParentIndexNumber) — multi-disc albums */
  discNumber?: number | null
  imageUrl?: string
  /** Local filesystem path to audio file (book-file:// URL). Set for downloaded tracks. */
  localPath?: string
}

export interface LyricLine {
  text: string
  start?: number  // Start time in ticks (100ns units)
}

// Convert ticks to seconds for lyrics comparison
export function lyricsTicksToSeconds(ticks: number | undefined): number | undefined {
  if (ticks === undefined) return undefined
  return ticks / 10000000
}

/**
 * Track.imageUrl holds EITHER a local cover path (downloaded albums — raw
 * filesystem path or book-file:// URL) OR a remote Jellyfin thumbnail URL
 * (streaming, often only 120px wide). Only the former should ever be passed
 * as LocalOrRemoteImage's localPath — otherwise the low-res thumb wins over a
 * properly sized remote artwork URL.
 */
export function getLocalTrackImage(track: Track | null): string | null {
  const url = track?.imageUrl
  if (!url) return null
  if (isLocalFileUrl(url)) return url
  if (/^https?:\/\//i.test(url)) return null
  return url
}

/**
 * Local audio file for a track, or null if it isn't downloaded.
 *
 * `Track.localPath` is only set when the queue was built from the Downloads
 * view. Queues built from any online view (album/playlist/search/MusicHome)
 * go through dtoToTrack(), which cannot know about downloads — so the
 * download index is the authoritative source and is consulted on every
 * lookup here. Without this, a fully downloaded playlist still streams and
 * dies the moment the connection drops.
 */
export function resolveLocalAudioPath(track: Track | null): string | null {
  if (!track) return null
  if (track.localPath) return track.localPath
  return getDownloadedTrack(track.id)?.localPath || null
}

/** True when this track can play with no network at all. */
export function isTrackPlayableOffline(track: Track | null): boolean {
  return resolveLocalAudioPath(track) !== null
}

// ---- Streaming availability ----
//
// navigator.onLine is not trustworthy on iOS: a cell connection that has
// dropped to no usable data still reports online, which is exactly the
// driving scenario. So an actual stream failure sets a sticky flag, and any
// successful load (or a browser 'online' event) clears it again.
const STREAM_FAIL_TTL = 30000
let streamFailedAt = 0

export function markStreamFailed(): void {
  streamFailedAt = Date.now()
}

export function markStreamOk(): void {
  streamFailedAt = 0
}

export function isStreamingAvailable(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  return Date.now() - streamFailedAt > STREAM_FAIL_TTL
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', markStreamOk)
}

const OFFLINE_QUEUE_END = 'Offline — no more downloaded tracks in the queue'

interface MusicPlayerState {
  // Playback
  currentTrack: Track | null
  /** True when currentTrack was taken from the manual "Next in Queue" lane */
  currentIsManual: boolean
  isPlaying: boolean
  currentTime: number   // seconds
  duration: number      // seconds
  volume: number        // 0-1
  isMuted: boolean

  // Queue — two lanes, Spotify-style:
  // - queue: the playing context (album / playlist / mix), advances via queueIndex
  // - manualQueue: user-added "Next in Queue" tracks, always play before the context continues
  queue: Track[]
  queueIndex: number
  originalQueue: Track[]  // For unshuffle
  manualQueue: Track[]
  /** Name of the playing context, shown as "Next from: X" (album/playlist name, 'Autoplay', …) */
  queueContextName: string | null

  // Modes
  shuffleMode: boolean
  repeatMode: 'off' | 'all' | 'one'
  /** When the queue runs out, continue with similar music via Jellyfin Instant Mix */
  autoplayEnabled: boolean
  isFetchingAutoplay: boolean

  /** User-visible playback problem (offline, missing file, …). Cleared on the next success. */
  playbackError: string | null

  // UI state
  isQueueOpen: boolean
  isLyricsOpen: boolean

  // Lyrics
  lyrics: LyricLine[] | null
  lyricsLoading: boolean
  lyricsError: string | null

  // Audio element reference (managed externally)
  audioRef: HTMLAudioElement | null

  // Jellyfin config (synced from JellyMusicView so PersistentMusicPlayer can stream)
  jellyfinServerUrl: string | null
  jellyfinAccessToken: string | null
  jellyfinServerId: string | null
  jellyfinUserId: string | null

  // Actions
  setAudioRef: (ref: HTMLAudioElement | null) => void
  setJellyfinConfig: (serverUrl: string, accessToken: string, serverId: string | null, userId?: string | null) => void
  clearJellyfinConfig: () => void
  play: (track?: Track) => void
  pause: () => void
  toggle: () => void
  /** Skip to the next track (buttons, lock screen, headphones, error path). Always advances, also on repeat-one. */
  next: () => void
  /** The current track played to its end — honours repeat-one, otherwise advances. */
  onTrackEnded: () => void
  previous: () => void
  seek: (time: number) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setQueue: (tracks: Track[], startIndex?: number, contextName?: string | null) => void
  /** Start a context in shuffle mode from a random track (album/playlist "Shuffle" buttons) */
  playShuffled: (tracks: Track[], contextName?: string | null) => void
  addToQueue: (tracks: Track[], position?: 'next' | 'end') => void
  removeFromQueue: (index: number) => void
  reorderQueue: (from: number, to: number) => void
  removeFromManualQueue: (index: number) => void
  reorderManualQueue: (from: number, to: number) => void
  playManualTrackAt: (index: number) => void
  clearQueue: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  toggleAutoplay: () => void
  startAutoplay: () => Promise<void>
  /** Full queue in listening order: played context + current + manual lane + upcoming context */
  getQueueSnapshot: () => Track[]
  setIsPlaying: (playing: boolean) => void
  setPlaybackError: (error: string | null) => void
  toggleQueueOpen: () => void
  setQueueOpen: (open: boolean) => void
  playTrackAtIndex: (index: number) => void
  toggleLyricsOpen: () => void
  setLyricsOpen: (open: boolean) => void
  setLyrics: (lyrics: LyricLine[] | null) => void
  setLyricsLoading: (loading: boolean) => void
  setLyricsError: (error: string | null) => void
  clearLyrics: () => void
}

// Fisher-Yates shuffle
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

const AUTOPLAY_STORAGE_KEY = 'musicAutoplayEnabled'

function loadAutoplaySetting(): boolean {
  // Default ON — Spotify-style continuation
  return localStorage.getItem(AUTOPLAY_STORAGE_KEY) !== 'false'
}

/** Map a Jellyfin BaseItemDto-shaped object to a Track (used for Instant Mix results) */
function dtoToTrack(item: any, serverUrl: string): Track {
  return {
    id: item.Id,
    name: item.Name || 'Unknown Track',
    artists: item.Artists?.length ? item.Artists : [item.AlbumArtist || 'Unknown Artist'],
    artistIds: (item.ArtistItems || []).map((a: any) => a.Id).filter(Boolean),
    albumId: item.AlbumId || '',
    albumName: item.Album || '',
    duration: item.RunTimeTicks || 0,
    indexNumber: item.IndexNumber,
    discNumber: item.ParentIndexNumber ?? null,
    imageUrl: item.AlbumId ? `${serverUrl}/Items/${item.AlbumId}/Images/Primary?maxWidth=300&quality=90` : undefined,
  }
}

export const useMusicPlayer = create<MusicPlayerState>((set, get) => ({
  // Initial state
  currentTrack: null,
  currentIsManual: false,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMuted: false,
  queue: [],
  queueIndex: 0,
  originalQueue: [],
  manualQueue: [],
  queueContextName: null,
  shuffleMode: false,
  repeatMode: 'off',
  autoplayEnabled: loadAutoplaySetting(),
  isFetchingAutoplay: false,
  playbackError: null,
  isQueueOpen: false,
  isLyricsOpen: false,
  lyrics: null,
  lyricsLoading: false,
  lyricsError: null,
  audioRef: null,
  jellyfinServerUrl: null,
  jellyfinAccessToken: null,
  jellyfinServerId: null,
  jellyfinUserId: null,

  setAudioRef: (ref) => set({ audioRef: ref }),
  setJellyfinConfig: (serverUrl, accessToken, serverId, userId = null) =>
    set({ jellyfinServerUrl: serverUrl, jellyfinAccessToken: accessToken, jellyfinServerId: serverId, jellyfinUserId: userId }),
  clearJellyfinConfig: () => set({ jellyfinServerUrl: null, jellyfinAccessToken: null, jellyfinServerId: null, jellyfinUserId: null }),

  play: (track) => {
    const state = get()
    if (track) {
      // Play specific track - find it in queue or add it
      const queueIndex = state.queue.findIndex(t => t.id === track.id)
      if (queueIndex >= 0) {
        set({ queueIndex, currentTrack: track, currentIsManual: false, isPlaying: true })
      } else {
        // Track not in queue - set it as the only track
        set({
          queue: [track],
          originalQueue: [track],
          queueIndex: 0,
          currentTrack: track,
          currentIsManual: false,
          queueContextName: null,
          isPlaying: true
        })
      }
    } else if (state.currentTrack) {
      set({ isPlaying: true })
    } else if (state.queue.length > 0) {
      set({
        currentTrack: state.queue[0],
        queueIndex: 0,
        currentIsManual: false,
        isPlaying: true
      })
    }
  },

  pause: () => set({ isPlaying: false }),

  toggle: () => {
    const state = get()
    if (state.isPlaying) {
      set({ isPlaying: false })
    } else if (state.currentTrack) {
      set({ isPlaying: true })
    } else if (state.queue.length > 0) {
      set({
        currentTrack: state.queue[0],
        queueIndex: 0,
        currentIsManual: false,
        isPlaying: true
      })
    }
  },

  onTrackEnded: () => {
    const state = get()
    if (state.repeatMode === 'one') {
      // Repeat current track. Restart the audio element directly: the media
      // element fires 'pause' before 'ended', so isPlaying may already be
      // false and no React effect re-runs for an unchanged track id.
      set({ currentTime: 0, isPlaying: true })
      if (state.audioRef) {
        state.audioRef.currentTime = 0
        void state.audioRef.play().catch(console.error)
      }
      return
    }
    get().next()
  },

  next: () => {
    const state = get()
    // Repeat-one is handled in onTrackEnded: an explicit skip (or a track
    // that failed to load) always moves on, like every music app does.

    // While the server is unreachable only downloaded tracks can play, so
    // advancing skips the rest instead of letting the music die mid-playlist.
    const canStream = isStreamingAvailable()
    const isPlayable = (track: Track | undefined) =>
      !!track && (canStream || isTrackPlayableOffline(track))

    // Manual "Next in Queue" lane always plays before the context continues
    let manualRest = state.manualQueue
    while (manualRest.length > 0) {
      const [head, ...tail] = manualRest
      manualRest = tail
      if (isPlayable(head)) {
        set({
          manualQueue: manualRest,
          currentTrack: head,
          currentIsManual: true,
          currentTime: 0,
          isPlaying: true,
          playbackError: null
        })
        return
      }
    }
    // Nothing in the manual lane was playable — it is drained now, so every
    // set() below must persist that.

    if (state.queue.length === 0) {
      // No context left — try autoplay from the last played track
      if (state.autoplayEnabled && state.currentTrack && canStream) {
        set({ manualQueue: manualRest })
        void get().startAutoplay()
      } else {
        set({
          manualQueue: manualRest,
          isPlaying: false,
          playbackError: canStream ? null : OFFLINE_QUEUE_END
        })
      }
      return
    }

    // Resume the context: if a manual track was playing, the context position
    // (queueIndex) still points at the last played context track.
    const findPlayable = (from: number, to: number): number => {
      for (let i = from; i < to; i++) {
        if (isPlayable(state.queue[i])) return i
      }
      return -1
    }

    let nextIndex = findPlayable(state.queueIndex + 1, state.queue.length)

    if (nextIndex < 0) {
      if (state.repeatMode === 'all') {
        // Wrap — offline this may land back on the current track if it is the
        // only downloaded one, which is the right behaviour for repeat-all.
        nextIndex = findPlayable(0, state.queue.length)
        if (nextIndex < 0) {
          set({ manualQueue: manualRest, isPlaying: false, playbackError: OFFLINE_QUEUE_END })
          return
        }
      } else if (state.autoplayEnabled && canStream) {
        // Queue exhausted — continue with similar music (Instant Mix)
        set({ manualQueue: manualRest })
        void get().startAutoplay()
        return
      } else {
        // End of queue, or nothing left that can play without the network
        set({
          manualQueue: manualRest,
          isPlaying: false,
          currentIsManual: false,
          playbackError: canStream ? null : OFFLINE_QUEUE_END
        })
        return
      }
    }

    const nextTrack = state.queue[nextIndex]
    // isPlaying: true is required for natural advances — the 'pause' event
    // (fired before 'ended') has already set isPlaying to false by now.
    set({
      manualQueue: manualRest,
      queueIndex: nextIndex,
      currentTrack: nextTrack,
      currentIsManual: false,
      currentTime: 0,
      isPlaying: true,
      playbackError: null
    })
    // Same track id (e.g. single-song queue on repeat-all): the src effect
    // won't re-run, so restart the audio element directly.
    if (nextTrack.id === state.currentTrack?.id && state.audioRef) {
      state.audioRef.currentTime = 0
      void state.audioRef.play().catch(console.error)
    }
  },

  previous: () => {
    const state = get()

    // If more than 3 seconds into track, restart it
    if (state.currentTime > 3) {
      set({ currentTime: 0 })
      if (state.audioRef) {
        state.audioRef.currentTime = 0
      }
      return
    }

    // Manual-lane tracks have no history position — just restart them
    if (state.currentIsManual) {
      set({ currentTime: 0 })
      if (state.audioRef) {
        state.audioRef.currentTime = 0
      }
      return
    }

    if (state.queue.length === 0) return

    let prevIndex = state.queueIndex - 1
    if (prevIndex < 0) {
      if (state.repeatMode === 'all') {
        prevIndex = state.queue.length - 1
      } else {
        prevIndex = 0
      }
    }

    const prevTrack = state.queue[prevIndex]
    set({
      queueIndex: prevIndex,
      currentTrack: prevTrack,
      currentIsManual: false,
      currentTime: 0,
      isPlaying: true
    })
    // Same track id (first track, or a one-song repeat-all queue): the src
    // effect won't re-run, so restart the element directly.
    if (prevTrack.id === state.currentTrack?.id && state.audioRef) {
      state.audioRef.currentTime = 0
      void state.audioRef.play().catch(console.error)
    }
  },

  seek: (time) => {
    const state = get()
    const clamped = Math.max(0, Math.min(time, state.duration || 0))
    set({ currentTime: clamped })
    if (state.audioRef) {
      state.audioRef.currentTime = clamped
    }
  },

  setCurrentTime: (time) => set({ currentTime: time }),

  setDuration: (duration) => set({ duration }),

  setVolume: (volume) => {
    set({ volume: Math.max(0, Math.min(1, volume)), isMuted: false })
  },

  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),

  setQueue: (tracks, startIndex = 0, contextName = null) => {
    const state = get()
    let queue = [...tracks]
    let originalQueue = [...tracks]
    let queueIndex = startIndex

    if (state.shuffleMode) {
      // Keep the start track at position 0, shuffle the rest
      const startTrack = queue[startIndex]
      const otherTracks = queue.filter((_, i) => i !== startIndex)
      queue = [startTrack, ...shuffleArray(otherTracks)]
      queueIndex = 0
    }

    // Note: the manual "Next in Queue" lane intentionally survives context
    // changes (Spotify behavior) — user-queued tracks still play next.
    set({
      queue,
      originalQueue,
      queueIndex,
      queueContextName: contextName,
      currentTrack: queue[queueIndex] || null,
      currentIsManual: false,
      isPlaying: true,
      currentTime: 0
    })
  },

  playShuffled: (tracks, contextName = null) => {
    if (tracks.length === 0) return
    set({ shuffleMode: true })
    // setQueue keeps the start track first and shuffles the rest
    get().setQueue(tracks, Math.floor(Math.random() * tracks.length), contextName)
  },

  addToQueue: (tracks, position = 'end') => {
    const state = get()
    // Both go to the manual "Next in Queue" lane (played before the context
    // continues). 'next' puts them at the front, 'end' appends.
    const manualQueue = position === 'next'
      ? [...tracks, ...state.manualQueue]
      : [...state.manualQueue, ...tracks]

    // If nothing is playing, start with the first queued track immediately
    if (!state.currentTrack) {
      const [first, ...rest] = manualQueue
      set({
        manualQueue: rest,
        currentTrack: first,
        currentIsManual: true,
        currentTime: 0,
        isPlaying: true
      })
      return
    }

    set({ manualQueue })
  },

  removeFromQueue: (index) => {
    const state = get()
    if (index < 0 || index >= state.queue.length) return

    const newQueue = state.queue.filter((_, i) => i !== index)
    let newQueueIndex = state.queueIndex

    // Keep the unshuffled order in sync, or the track comes back when shuffle
    // is turned off. Queue entries share object identity with originalQueue.
    const removed = state.queue[index]
    let origAt = state.originalQueue.indexOf(removed)
    if (origAt < 0) origAt = state.originalQueue.findIndex(t => t.id === removed.id)
    const originalQueue = origAt >= 0
      ? state.originalQueue.filter((_, i) => i !== origAt)
      : state.originalQueue

    // Adjust index if we removed a track before current
    if (index < state.queueIndex) {
      newQueueIndex--
    } else if (index === state.queueIndex && !state.currentIsManual) {
      // Current context track was removed
      if (newQueue.length === 0 && state.manualQueue.length === 0) {
        set({
          queue: [],
          originalQueue: [],
          queueIndex: 0,
          currentTrack: null,
          currentIsManual: false,
          queueContextName: null,
          isPlaying: false
        })
        return
      }
      // Play next track (or previous if at end)
      if (newQueueIndex >= newQueue.length) {
        newQueueIndex = Math.max(0, newQueue.length - 1)
      }
      set({
        queue: newQueue,
        originalQueue,
        queueIndex: newQueueIndex,
        currentTrack: newQueue[newQueueIndex] || null
      })
      return
    }

    set({
      queue: newQueue,
      originalQueue,
      queueIndex: newQueueIndex
    })
  },

  reorderQueue: (from, to) => {
    const state = get()
    const newQueue = [...state.queue]
    const [movedItem] = newQueue.splice(from, 1)
    newQueue.splice(to, 0, movedItem)

    // Adjust current index
    let newQueueIndex = state.queueIndex
    if (from === state.queueIndex) {
      newQueueIndex = to
    } else if (from < state.queueIndex && to >= state.queueIndex) {
      newQueueIndex--
    } else if (from > state.queueIndex && to <= state.queueIndex) {
      newQueueIndex++
    }

    // Unshuffled, a manual reorder IS the new order; while shuffled it only
    // affects the shuffled play order (unshuffle restores the context order).
    set({
      queue: newQueue,
      queueIndex: newQueueIndex,
      ...(state.shuffleMode ? {} : { originalQueue: newQueue })
    })
  },

  removeFromManualQueue: (index) => {
    const state = get()
    if (index < 0 || index >= state.manualQueue.length) return
    set({ manualQueue: state.manualQueue.filter((_, i) => i !== index) })
  },

  reorderManualQueue: (from, to) => {
    const state = get()
    const manualQueue = [...state.manualQueue]
    const [moved] = manualQueue.splice(from, 1)
    manualQueue.splice(to, 0, moved)
    set({ manualQueue })
  },

  playManualTrackAt: (index) => {
    const state = get()
    const track = state.manualQueue[index]
    if (!track) return
    set({
      manualQueue: state.manualQueue.filter((_, i) => i !== index),
      currentTrack: track,
      currentIsManual: true,
      currentTime: 0,
      isPlaying: true
    })
  },

  clearQueue: () => {
    set({
      queue: [],
      originalQueue: [],
      manualQueue: [],
      queueIndex: 0,
      queueContextName: null,
      currentTrack: null,
      currentIsManual: false,
      isPlaying: false,
      currentTime: 0
    })
  },

  toggleShuffle: () => {
    const state = get()
    const newShuffleMode = !state.shuffleMode

    // queue[queueIndex] is the context anchor: the playing context track, or —
    // while a manual-lane track plays — the last context track that played.
    // Everything up to it counts as heard.
    if (state.queue.length === 0) {
      set({ shuffleMode: newShuffleMode })
      return
    }

    if (newShuffleMode) {
      // Shuffle only what is still to come (Spotify): played tracks stay
      // played, duplicates of the current track are kept.
      const heard = state.queue.slice(0, state.queueIndex + 1)
      const upcoming = state.queue.slice(state.queueIndex + 1)
      set({
        shuffleMode: true,
        queue: [...heard, ...shuffleArray(upcoming)]
      })
    } else {
      // Restore the context order and continue after the anchor track
      const anchor = state.queue[state.queueIndex]
      let newIndex = state.originalQueue.indexOf(anchor)
      if (newIndex < 0 && anchor) newIndex = state.originalQueue.findIndex(t => t.id === anchor.id)
      set({
        shuffleMode: false,
        queue: [...state.originalQueue],
        queueIndex: newIndex >= 0 ? newIndex : 0
      })
    }
  },

  cycleRepeat: () => {
    const state = get()
    const modes: ('off' | 'all' | 'one')[] = ['off', 'all', 'one']
    const currentIndex = modes.indexOf(state.repeatMode)
    const nextIndex = (currentIndex + 1) % modes.length
    set({ repeatMode: modes[nextIndex] })
  },

  toggleAutoplay: () => {
    const enabled = !get().autoplayEnabled
    localStorage.setItem(AUTOPLAY_STORAGE_KEY, String(enabled))
    set({ autoplayEnabled: enabled })
  },

  startAutoplay: async () => {
    const state = get()
    if (state.isFetchingAutoplay) return

    // Instant Mix is a server call — offline there is nothing to continue with
    if (!isStreamingAvailable()) {
      set({ isPlaying: false, playbackError: OFFLINE_QUEUE_END })
      return
    }

    const seed = state.currentTrack
    const { jellyfinServerUrl, jellyfinAccessToken, jellyfinUserId } = state
    if (!seed || seed.localPath || !jellyfinServerUrl || !jellyfinAccessToken) {
      set({ isPlaying: false })
      return
    }

    set({ isFetchingAutoplay: true })
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (jellyfinUserId) params.set('userId', jellyfinUserId)
      const res = await api.request({
        method: 'GET',
        url: `${jellyfinServerUrl}/Items/${seed.id}/InstantMix?${params}`,
        headers: { 'Authorization': `MediaBrowser Token="${jellyfinAccessToken}"` },
      })

      const items: any[] = res.success ? (res.data?.Items || []) : []

      // The user started something else while the mix was loading (new album,
      // queued a track, …) — never overwrite that.
      const now = get()
      if (now.currentTrack?.id !== seed.id || now.queue !== state.queue) {
        set({ isFetchingAutoplay: false })
        return
      }
      if (now.manualQueue.length > 0) {
        // Something was queued while we waited — that plays first
        set({ isFetchingAutoplay: false })
        get().next()
        return
      }

      // Avoid repeating the seed, the finished context or earlier mixes
      const knownIds = new Set([seed.id, ...now.queue.map(t => t.id), ...now.manualQueue.map(t => t.id)])
      const tracks = items
        .filter(i => i?.Id && !knownIds.has(i.Id))
        .map(i => dtoToTrack(i, jellyfinServerUrl))

      if (tracks.length === 0) {
        set({ isPlaying: false, isFetchingAutoplay: false })
        return
      }

      // Append instead of replacing, so Previous can still go back into the
      // album that just ended. History is capped so endless autoplay stays small.
      const HISTORY_CAP = 100
      const heard = now.queue.slice(Math.max(0, now.queueIndex + 1 - HISTORY_CAP), now.queueIndex + 1)
      const queue = [...heard, ...tracks]
      set({
        queue,
        originalQueue: queue,
        queueIndex: heard.length,
        queueContextName: 'Autoplay',
        currentTrack: tracks[0],
        currentIsManual: false,
        currentTime: 0,
        isPlaying: true,
        isFetchingAutoplay: false
      })
    } catch (e) {
      console.error('[Music] Autoplay (Instant Mix) failed:', e)
      set({ isPlaying: false, isFetchingAutoplay: false })
    }
  },

  getQueueSnapshot: () => {
    const state = get()
    const played = state.queue.slice(0, state.queueIndex + (state.currentIsManual ? 1 : 0))
    const current = state.currentIsManual
      ? (state.currentTrack ? [state.currentTrack] : [])
      : state.queue.slice(state.queueIndex, state.queueIndex + 1)
    const upcoming = state.queue.slice(state.queueIndex + 1)
    return [...played, ...current, ...state.manualQueue, ...upcoming]
  },

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setPlaybackError: (error) => set({ playbackError: error }),

  toggleQueueOpen: () => set((state) => ({ isQueueOpen: !state.isQueueOpen })),

  setQueueOpen: (open) => set({ isQueueOpen: open }),

  playTrackAtIndex: (index) => {
    const state = get()
    if (index >= 0 && index < state.queue.length) {
      set({
        queueIndex: index,
        currentTrack: state.queue[index],
        currentIsManual: false,
        currentTime: 0,
        isPlaying: true
      })
    }
  },

  toggleLyricsOpen: () => set((state) => ({ isLyricsOpen: !state.isLyricsOpen })),

  setLyricsOpen: (open) => set({ isLyricsOpen: open }),

  setLyrics: (lyrics) => set({ lyrics, lyricsLoading: false, lyricsError: null }),

  setLyricsLoading: (loading) => set({ lyricsLoading: loading }),

  setLyricsError: (error) => set({ lyricsError: error, lyricsLoading: false }),

  clearLyrics: () => set({ lyrics: null, lyricsLoading: false, lyricsError: null })
}))

// ─── Session persistence ─────────────────────────────────────────────────────
// Queue, current track + position, shuffle/repeat and volume survive a
// restart (Spotify/Finamp resume where you left off). Restored paused: the
// first play continues at the saved second (PersistentMusicPlayer asks for it
// with takeRestoredMusicPosition when it loads the restored track).

const SESSION_KEY = 'musicSession'
const SESSION_VERSION = 1
/** localStorage is ~5 MB per origin and shared with everything else */
const SESSION_MAX_BYTES = 1_500_000

interface MusicSessionSnapshot {
  v: number
  currentTrack: Track | null
  currentIsManual: boolean
  currentTime: number
  queue: Track[]
  queueIndex: number
  originalQueue: Track[]
  manualQueue: Track[]
  queueContextName: string | null
  shuffleMode: boolean
  repeatMode: 'off' | 'all' | 'one'
  volume: number
  isMuted: boolean
  /** Server the queue's tracks stream from (token looked up in settings on restore) */
  serverUrl: string | null
  serverId: string | null
}

/** Paths are re-resolved through the download index (the iOS container path changes per launch) */
function stripTrack(t: Track): Track {
  if (!t.localPath) return t
  const { localPath: _drop, ...rest } = t
  return rest
}

let restoredPosition: { trackId: string; time: number } | null = null

/**
 * Position to continue a restored track at — returned once, for the restored
 * track only. Anything the user starts afterwards plays from the beginning.
 */
export function takeRestoredMusicPosition(trackId: string): number {
  const r = restoredPosition
  restoredPosition = null
  return r && r.trackId === trackId ? r.time : 0
}

function snapshotOf(s: MusicPlayerState): MusicSessionSnapshot {
  return {
    v: SESSION_VERSION,
    currentTrack: s.currentTrack ? stripTrack(s.currentTrack) : null,
    currentIsManual: s.currentIsManual,
    currentTime: Math.floor(s.currentTime || 0),
    queue: s.queue.map(stripTrack),
    queueIndex: s.queueIndex,
    originalQueue: s.originalQueue.map(stripTrack),
    manualQueue: s.manualQueue.map(stripTrack),
    queueContextName: s.queueContextName,
    shuffleMode: s.shuffleMode,
    repeatMode: s.repeatMode,
    volume: s.volume,
    isMuted: s.isMuted,
    serverUrl: s.jellyfinServerUrl,
    serverId: s.jellyfinServerId,
  }
}

function saveMusicSession(): void {
  try {
    const snap = snapshotOf(useMusicPlayer.getState())
    let json = JSON.stringify(snap)
    if (json.length > SESSION_MAX_BYTES) {
      // Huge queue (whole library shuffled): keep the track and the modes
      const cur = snap.currentTrack
      json = JSON.stringify({
        ...snap,
        queue: cur ? [cur] : [], queueIndex: 0, originalQueue: [], manualQueue: [], currentIsManual: false,
      })
    }
    localStorage.setItem(SESSION_KEY, json)
  } catch { /* storage full or unavailable — not worth failing playback over */ }
}

function restoreMusicSession(): void {
  let snap: MusicSessionSnapshot | null = null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw) snap = JSON.parse(raw)
  } catch { snap = null }
  if (!snap || snap.v !== SESSION_VERSION) return

  const patch: Partial<MusicPlayerState> = {
    shuffleMode: !!snap.shuffleMode,
    repeatMode: snap.repeatMode === 'all' || snap.repeatMode === 'one' ? snap.repeatMode : 'off',
    volume: typeof snap.volume === 'number' ? Math.max(0, Math.min(1, snap.volume)) : 1,
    isMuted: !!snap.isMuted,
  }

  const track = snap.currentTrack
  if (track?.id && Array.isArray(snap.queue)) {
    const queue = snap.queue
    patch.currentTrack = track
    patch.currentIsManual = !!snap.currentIsManual
    patch.queue = queue
    patch.queueIndex = Math.max(0, Math.min(queue.length - 1, snap.queueIndex || 0))
    patch.originalQueue = Array.isArray(snap.originalQueue) ? snap.originalQueue : []
    patch.manualQueue = Array.isArray(snap.manualQueue) ? snap.manualQueue : []
    patch.queueContextName = snap.queueContextName ?? null
    patch.isPlaying = false
    const time = Math.max(0, snap.currentTime || 0)
    const total = track.duration ? track.duration / 10_000_000 : 0
    // Ended (or nearly): start the track over instead of resuming at its last second
    const resumeAt = total && time > total - 5 ? 0 : time
    patch.currentTime = resumeAt
    patch.duration = total
    restoredPosition = resumeAt > 0 ? { trackId: track.id, time: resumeAt } : null

    // Streams need a server + token before the Music tab has been opened (the
    // phone mini player can resume from any tab). Only reuse a token the
    // settings already hold for that same server.
    if (snap.serverUrl) {
      try {
        const server = loadSettings().jellyfinServers.find(s => s.url === snap!.serverUrl && s.accessToken)
        if (server?.accessToken) {
          patch.jellyfinServerUrl = server.url
          patch.jellyfinAccessToken = server.accessToken
          patch.jellyfinServerId = snap.serverId ?? server.id
          patch.jellyfinUserId = server.userId ?? null
        }
      } catch { /* settings unreadable — the Music tab fills the config in */ }
    }
  }

  useMusicPlayer.setState(patch)
}

function initMusicSessionPersistence(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
  restoreMusicSession()

  // Throttled: currentTime changes 4×/s while playing, a few seconds of drift
  // on restore don't matter
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    if (timer) return
    timer = setTimeout(() => { timer = null; saveMusicSession() }, 3000)
  }
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    saveMusicSession()
  }

  useMusicPlayer.subscribe((s, prev) => {
    if (
      s.currentTrack !== prev.currentTrack || s.queue !== prev.queue || s.queueIndex !== prev.queueIndex ||
      s.manualQueue !== prev.manualQueue || s.originalQueue !== prev.originalQueue ||
      s.shuffleMode !== prev.shuffleMode || s.repeatMode !== prev.repeatMode ||
      s.volume !== prev.volume || s.isMuted !== prev.isMuted || s.jellyfinServerUrl !== prev.jellyfinServerUrl
    ) {
      flush() // structural change: write now (cheap compared with losing a queue)
    } else if (s.currentTime !== prev.currentTime || s.isPlaying !== prev.isPlaying) {
      if (!s.isPlaying && prev.isPlaying) flush()
      else schedule()
    }
  })

  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush() })
}

initMusicSessionPersistence()

// Helper to format time
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// Helper to convert ticks to seconds
export function ticksToSeconds(ticks: number): number {
  return ticks / 10000000
}
