import { create } from 'zustand'
import api, { isLocalFileUrl } from '../utils/api'

export interface Track {
  id: string
  name: string
  artists: string[]
  artistIds: string[]
  albumId: string
  albumName: string
  duration: number      // ticks (100ns units)
  indexNumber?: number | null
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
  next: () => void
  previous: () => void
  seek: (time: number) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setQueue: (tracks: Track[], startIndex?: number, contextName?: string | null) => void
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

  next: () => {
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

    // Manual "Next in Queue" lane always plays before the context continues
    if (state.manualQueue.length > 0) {
      const [track, ...rest] = state.manualQueue
      set({
        manualQueue: rest,
        currentTrack: track,
        currentIsManual: true,
        currentTime: 0,
        isPlaying: true
      })
      return
    }

    if (state.queue.length === 0) {
      // No context left — try autoplay from the last played track
      if (state.autoplayEnabled && state.currentTrack) {
        void get().startAutoplay()
      } else {
        set({ isPlaying: false })
      }
      return
    }

    // Resume the context: if a manual track was playing, the context position
    // (queueIndex) still points at the last played context track.
    let nextIndex = state.queueIndex + 1

    if (nextIndex >= state.queue.length) {
      if (state.repeatMode === 'all') {
        nextIndex = 0
      } else if (state.autoplayEnabled) {
        // Queue exhausted — continue with similar music (Instant Mix)
        void get().startAutoplay()
        return
      } else {
        // End of queue
        set({ isPlaying: false, currentIsManual: false })
        return
      }
    }

    const nextTrack = state.queue[nextIndex]
    // isPlaying: true is required for natural advances — the 'pause' event
    // (fired before 'ended') has already set isPlaying to false by now.
    set({
      queueIndex: nextIndex,
      currentTrack: nextTrack,
      currentIsManual: false,
      currentTime: 0,
      isPlaying: true
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

    set({
      queueIndex: prevIndex,
      currentTrack: state.queue[prevIndex],
      currentIsManual: false,
      currentTime: 0
    })
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
        queueIndex: newQueueIndex,
        currentTrack: newQueue[newQueueIndex] || null
      })
      return
    }

    set({
      queue: newQueue,
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

    set({ queue: newQueue, queueIndex: newQueueIndex })
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

    if (newShuffleMode) {
      // Enable shuffle - keep current track, shuffle rest
      const currentTrack = state.currentTrack
      if (currentTrack && !state.currentIsManual) {
        const otherTracks = state.queue.filter(t => t.id !== currentTrack.id)
        const shuffled = [currentTrack, ...shuffleArray(otherTracks)]
        set({
          shuffleMode: true,
          queue: shuffled,
          queueIndex: 0
        })
      } else {
        set({
          shuffleMode: true,
          queue: shuffleArray(state.queue),
          queueIndex: 0
        })
      }
    } else {
      // Disable shuffle - restore original order
      const currentTrack = state.currentTrack
      const newIndex = currentTrack && !state.currentIsManual
        ? state.originalQueue.findIndex(t => t.id === currentTrack.id)
        : 0
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
      // Avoid immediately repeating the seed or tracks from the finished queue
      const knownIds = new Set([seed.id, ...get().queue.map(t => t.id)])
      const tracks = items
        .filter(i => i?.Id && !knownIds.has(i.Id))
        .map(i => dtoToTrack(i, jellyfinServerUrl))

      if (tracks.length === 0) {
        set({ isPlaying: false, isFetchingAutoplay: false })
        return
      }

      set({
        queue: tracks,
        originalQueue: tracks,
        queueIndex: 0,
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
