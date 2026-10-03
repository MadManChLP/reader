import { create } from 'zustand'
import { useMusicPlayer } from './musicPlayerStore'
import type { AbsApi } from '../utils/absApi'
import type { AbsChapter, AbsLibraryItem, AbsPlaybackSession } from '../types/audiobookshelf'

// Audiobook/podcast playback state (Audiobookshelf).
//
// An audiobook is ONE long timeline that may span multiple audio files
// ("tracks"). All positions in this store are ABSOLUTE seconds across the
// whole book; the mapping to (track, offset) happens in seek/track logic.
// The <audio> element lives in PersistentAudiobookPlayer at the App root so
// playback survives tab switches (same pattern as PersistentMusicPlayer).
//
// IMPORTANT (project rule): components must use granular selectors —
// only isolated scrubber/time components may subscribe to currentTime.

export interface AbsPlayerTrack {
  /** Server-relative content URL (streaming) — build the real URL at render time */
  contentUrl?: string
  /** Local file path (offline playback) */
  localPath?: string
  mimeType?: string
  startOffset: number // absolute start of this track in seconds
  duration: number
}

export type AbsSleepTimer =
  | { kind: 'time'; endsAtMs: number }          // wall clock
  | { kind: 'chapter'; endsAtMediaTime: number } // absolute media seconds
  | null

interface StartPlaybackParams {
  item: AbsLibraryItem
  episodeId?: string | null
  sessionId: string | null // null for offline playback
  tracks: AbsPlayerTrack[]
  chapters: AbsChapter[]
  duration: number
  startTime: number
  displayTitle: string
  displayAuthor: string
  coverUrl: string | null
  isOfflinePlayback: boolean
}

interface AudiobookPlayerState {
  // Current media
  currentItem: AbsLibraryItem | null
  currentEpisodeId: string | null
  displayTitle: string
  displayAuthor: string
  coverUrl: string | null
  sessionId: string | null
  isOfflinePlayback: boolean

  tracks: AbsPlayerTrack[]
  trackIndex: number
  chapters: AbsChapter[]

  // Playback state (currentTime/duration are absolute seconds)
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  playbackRate: number
  sleepTimer: AbsSleepTimer

  // Seek offset (within the new track) to apply once the element loads it
  pendingTrackSeek: number | null

  // Wiring (set by PersistentAudiobookPlayer / AudiobookshelfView)
  audioRef: HTMLAudioElement | null
  absApi: AbsApi | null

  // Actions
  setAudioRef: (ref: HTMLAudioElement | null) => void
  setAbsApi: (api: AbsApi | null) => void
  startPlayback: (params: StartPlaybackParams) => void
  /** Start streaming playback from a server playback session */
  startFromSession: (item: AbsLibraryItem, session: AbsPlaybackSession, api: AbsApi) => void
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (absoluteTime: number) => void
  seekRelative: (delta: number) => void
  nextChapter: () => void
  prevChapter: () => void
  setCurrentTime: (time: number) => void
  setTrackIndex: (index: number) => void
  clearPendingTrackSeek: () => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setPlaybackRate: (rate: number) => void
  setSleepTimer: (timer: AbsSleepTimer) => void
  stop: () => void

  // Derived helpers
  getCurrentChapterIndex: () => number
}

const PLAYBACK_RATE_KEY = 'abs_playback_rate'
const VOLUME_KEY = 'abs_volume'

function loadNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key)
  const num = raw !== null ? parseFloat(raw) : NaN
  return Number.isFinite(num) ? num : fallback
}

/** Index of the track containing the given absolute time */
function findTrackIndex(tracks: AbsPlayerTrack[], time: number): number {
  for (let i = tracks.length - 1; i >= 0; i--) {
    if (time >= tracks[i].startOffset) return i
  }
  return 0
}

export const useAudiobookPlayer = create<AudiobookPlayerState>((set, get) => ({
  currentItem: null,
  currentEpisodeId: null,
  displayTitle: '',
  displayAuthor: '',
  coverUrl: null,
  sessionId: null,
  isOfflinePlayback: false,

  tracks: [],
  trackIndex: 0,
  chapters: [],

  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: loadNumber(VOLUME_KEY, 1),
  isMuted: false,
  playbackRate: loadNumber(PLAYBACK_RATE_KEY, 1),
  sleepTimer: null,

  pendingTrackSeek: null,

  audioRef: null,
  absApi: null,

  setAudioRef: (ref) => set({ audioRef: ref }),
  setAbsApi: (api) => set({ absApi: api }),

  startPlayback: (params) => {
    // Pause music — only one thing should play at a time
    useMusicPlayer.getState().pause()

    const trackIndex = findTrackIndex(params.tracks, params.startTime)
    const trackOffset = params.startTime - (params.tracks[trackIndex]?.startOffset ?? 0)

    set({
      currentItem: params.item,
      currentEpisodeId: params.episodeId ?? null,
      displayTitle: params.displayTitle,
      displayAuthor: params.displayAuthor,
      coverUrl: params.coverUrl,
      sessionId: params.sessionId,
      isOfflinePlayback: params.isOfflinePlayback,
      tracks: params.tracks,
      trackIndex,
      chapters: params.chapters,
      duration: params.duration,
      currentTime: params.startTime,
      pendingTrackSeek: trackOffset > 0.5 ? trackOffset : null,
      isPlaying: true,
      sleepTimer: null,
    })
  },

  startFromSession: (item, session, api) => {
    const tracks: AbsPlayerTrack[] = (session.audioTracks || []).map((t) => ({
      contentUrl: t.contentUrl,
      mimeType: t.mimeType,
      startOffset: t.startOffset,
      duration: t.duration,
    }))
    get().startPlayback({
      item,
      episodeId: session.episodeId ?? null,
      sessionId: session.id,
      tracks,
      chapters: session.chapters ?? item.media.chapters ?? [],
      duration: session.duration || item.media.duration || 0,
      startTime: session.currentTime || 0,
      displayTitle: session.displayTitle || item.media.metadata.title || 'Unknown',
      displayAuthor: session.displayAuthor || item.media.metadata.authorName || '',
      coverUrl: api.coverUrl(item.id, 600),
      isOfflinePlayback: false,
    })
  },

  play: () => {
    const { audioRef } = get()
    // Mutual exclusion with music (video pauses us from its own component)
    useMusicPlayer.getState().pause()
    if (audioRef) {
      audioRef.play().catch((e) => console.error('[AbsPlayer] play failed:', e))
    }
    set({ isPlaying: true })
  },

  pause: () => {
    const { audioRef } = get()
    audioRef?.pause()
    set({ isPlaying: false })
  },

  toggle: () => {
    const { isPlaying } = get()
    if (isPlaying) get().pause()
    else get().play()
  },

  seek: (absoluteTime) => {
    const { tracks, trackIndex, audioRef, duration } = get()
    if (tracks.length === 0) return
    const time = Math.max(0, Math.min(absoluteTime, duration))
    const target = findTrackIndex(tracks, time)
    const offset = time - tracks[target].startOffset

    if (target !== trackIndex) {
      // PersistentAudiobookPlayer switches src on trackIndex change and applies
      // pendingTrackSeek once the new track has loaded
      set({ trackIndex: target, pendingTrackSeek: offset, currentTime: time })
    } else {
      if (audioRef) audioRef.currentTime = offset
      set({ currentTime: time })
    }
  },

  seekRelative: (delta) => {
    get().seek(get().currentTime + delta)
  },

  nextChapter: () => {
    const { chapters } = get()
    const idx = get().getCurrentChapterIndex()
    if (idx >= 0 && idx < chapters.length - 1) get().seek(chapters[idx + 1].start)
  },

  prevChapter: () => {
    const { chapters, currentTime } = get()
    const idx = get().getCurrentChapterIndex()
    if (idx < 0) return
    // Within the first 3s of a chapter, jump to the previous one (player convention)
    if (currentTime - chapters[idx].start < 3 && idx > 0) get().seek(chapters[idx - 1].start)
    else get().seek(chapters[idx].start)
  },

  setCurrentTime: (time) => set({ currentTime: time }),
  setTrackIndex: (index) => set({ trackIndex: index }),
  clearPendingTrackSeek: () => set({ pendingTrackSeek: null }),

  setVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume))
    const { audioRef } = get()
    if (audioRef) audioRef.volume = clamped
    localStorage.setItem(VOLUME_KEY, String(clamped))
    set({ volume: clamped, isMuted: clamped === 0 ? get().isMuted : false })
  },

  toggleMute: () => {
    const { audioRef, isMuted } = get()
    if (audioRef) audioRef.muted = !isMuted
    set({ isMuted: !isMuted })
  },

  setPlaybackRate: (rate) => {
    const { audioRef } = get()
    if (audioRef) audioRef.playbackRate = rate
    localStorage.setItem(PLAYBACK_RATE_KEY, String(rate))
    set({ playbackRate: rate })
  },

  setSleepTimer: (timer) => set({ sleepTimer: timer }),

  stop: () => {
    const { audioRef } = get()
    if (audioRef) {
      audioRef.pause()
      audioRef.removeAttribute('src')
      audioRef.load()
    }
    set({
      currentItem: null,
      currentEpisodeId: null,
      displayTitle: '',
      displayAuthor: '',
      coverUrl: null,
      sessionId: null,
      isOfflinePlayback: false,
      tracks: [],
      trackIndex: 0,
      chapters: [],
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      sleepTimer: null,
      pendingTrackSeek: null,
    })
  },

  getCurrentChapterIndex: () => {
    const { chapters, currentTime } = get()
    if (!chapters.length) return -1
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (currentTime >= chapters[i].start) return i
    }
    return 0
  },
}))
