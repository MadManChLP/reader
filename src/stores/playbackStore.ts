// Playback Store - Zustand store for video player state management
// Adapted from Blink player architecture for our Tailwind + Lucide player

import { create } from 'zustand'

// ==================== TYPES ====================

export interface SubtitleTrackInfo {
  Index: number
  Codec?: string
  Language?: string
  DisplayTitle?: string
  Title?: string
  IsDefault?: boolean
  IsForced?: boolean
  IsExternal?: boolean
  DeliveryMethod?: string
  DeliveryUrl?: string
}

export interface AudioTrackInfo {
  Index: number
  Codec?: string
  Language?: string
  DisplayTitle?: string
  Title?: string
  IsDefault?: boolean
  Channels?: number
}

export interface SubtitlePlaybackInfo {
  url?: string
  track: number        // -1 = off
  format: string       // 'ass' | 'ssa' | 'subrip' | 'vtt' | 'PGSSUB' | 'nosub'
  allTracks?: SubtitleTrackInfo[]
  enable: boolean
}

export interface AudioPlaybackInfo {
  track: number
  allTracks?: AudioTrackInfo[]
}

export interface MediaSegment {
  Type: 'Intro' | 'Outro' | 'Preview' | 'Recap' | 'Commercial' | string
  StartTicks: number
  EndTicks: number
  Id?: string
}

export type PlayMethod = 'DirectPlay' | 'DirectStream' | 'Transcode'

export interface Chapter {
  StartPositionTicks: number
  Name?: string
  ImageTag?: string
}

// ==================== STATE ====================

interface PlaybackState {
  // Media source info
  mediaSource: {
    videoTrack: number
    audioTrack: number
    container: string
    id: string | undefined
    subtitle: SubtitlePlaybackInfo
    audio: AudioPlaybackInfo
    bitrate?: number
    videoCodec?: string
    audioCodec?: string
    playMethod?: PlayMethod
    transcodingUrl?: string
  }

  // Playback
  playbackStream: string        // Current video URL
  playsessionId: string | null

  // Metadata
  metadata: {
    itemName: string
    episodeTitle?: string
    isEpisode: boolean
    itemDuration: number        // ticks (100ns units)
    chapters: Chapter[]
    mediaSegments: MediaSegment[]
    userDataLastPlayedPositionTicks: number
    trickplay?: Record<string, Record<number, {
      Width: number
      Height: number
      TileWidth: number
      TileHeight: number
      Interval: number
    }>>
    itemId?: string
  }

  // Player state
  playerState: {
    volume: number              // 0-1
    isPlayerMuted: boolean
    isPlayerPlaying: boolean
    isPlayerReady: boolean
    isBuffering: boolean
    currentTime: number         // seconds
    duration: number            // seconds
    isPlayerFullscreen: boolean
    isUserSeeking: boolean
    seekValue: number           // 0-100 percentage
    isUserHovering: boolean
    isLoading: boolean
    showStatsForNerds: boolean
    bufferedPercent: number
  }

  // Media segments
  nextSegmentIndex: number
  activeSegmentId: string | null

  // Volume overlay
  isVolumeIndicatorVisible: boolean
  volumeIndicatorTimeoutId: NodeJS.Timeout | null
}

interface PlaybackActions {
  // Volume
  setVolume: (volume: number) => void
  increaseVolume: (step: number) => void
  decreaseVolume: (step: number) => void
  toggleMute: () => void
  triggerVolumeIndicator: () => void

  // Playback control
  togglePlay: () => void
  setIsPlaying: (playing: boolean) => void
  setIsBuffering: (buffering: boolean) => void
  setCurrentTime: (seconds: number) => void
  setDuration: (seconds: number) => void
  setPlayerReady: (ready: boolean) => void
  setBufferedPercent: (percent: number) => void

  // Fullscreen
  toggleFullscreen: () => void
  setIsFullscreen: (fs: boolean) => void

  // Controls visibility
  setIsUserHovering: (hovering: boolean) => void

  // Seeking
  handleStartSeek: (percent: number) => void
  handleStopSeek: (percent: number, duration: number) => void

  // Subtitle & Audio
  changeSubtitleTrack: (trackIndex: number, allTracks: SubtitleTrackInfo[]) => void
  toggleSubtitleTrack: () => void
  changeAudioTrack: (trackIndex: number) => void

  // Stats
  toggleShowStatsForNerds: () => void

  // Segments
  setActiveSegment: (segmentIndex: number) => void
  clearActiveSegment: () => void
  skipSegment: () => void

  // Player ref actions (registered by video element)
  _playerActions: {
    seekTo: (seconds: number) => void
    getCurrentTime: () => number
  }
  registerPlayerActions: (actions: PlaybackActions['_playerActions']) => void
  seekTo: (seconds: number) => void
  seekForward: (seconds: number) => void
  seekBackward: (seconds: number) => void
  getCurrentTime: () => number
  seekToNextChapter: () => void
  seekToPrevChapter: () => void

  // Initialize from props
  initializePlayback: (config: {
    playbackStream: string
    playsessionId: string | null
    mediaSource: PlaybackState['mediaSource']
    metadata: PlaybackState['metadata']
  }) => void

  // Reset
  reset: () => void
}

// ==================== INITIAL STATE ====================

const getInitialState = (): PlaybackState => ({
  mediaSource: {
    videoTrack: 0,
    audioTrack: 0,
    container: '',
    id: undefined,
    subtitle: { track: -1, format: 'nosub', enable: false },
    audio: { track: 0 },
  },
  playbackStream: '',
  playsessionId: null,
  metadata: {
    itemName: '',
    episodeTitle: undefined,
    isEpisode: false,
    itemDuration: 0,
    chapters: [],
    mediaSegments: [],
    userDataLastPlayedPositionTicks: 0,
    itemId: undefined,
  },
  playerState: {
    volume: parseFloat(localStorage.getItem('player_volume') || '1'),
    isPlayerMuted: localStorage.getItem('player_muted') === 'true',
    isPlayerPlaying: true,
    isPlayerReady: false,
    isBuffering: true,
    currentTime: 0,
    duration: 0,
    isPlayerFullscreen: false,
    isUserSeeking: false,
    seekValue: 0,
    isUserHovering: true,
    isLoading: true,
    showStatsForNerds: false,
    bufferedPercent: 0,
  },
  nextSegmentIndex: 0,
  activeSegmentId: null,
  isVolumeIndicatorVisible: false,
  volumeIndicatorTimeoutId: null,
})

// ==================== STORE ====================

export const usePlaybackStore = create<PlaybackState & PlaybackActions>()((set, get) => ({
  ...getInitialState(),

  // -- Volume --
  setVolume: (volume) => {
    const clamped = Math.min(1, Math.max(0, volume))
    set({
      playerState: {
        ...get().playerState,
        volume: clamped,
        isPlayerMuted: clamped === 0,
      },
    })
    localStorage.setItem('player_volume', String(clamped))
    localStorage.setItem('player_muted', String(clamped === 0))
    get().triggerVolumeIndicator()
  },

  increaseVolume: (step) => {
    const newVol = Math.min(1, get().playerState.volume + step)
    get().setVolume(newVol)
  },

  decreaseVolume: (step) => {
    const newVol = Math.max(0, get().playerState.volume - step)
    get().setVolume(newVol)
  },

  toggleMute: () => {
    const isMuted = !get().playerState.isPlayerMuted
    set({
      playerState: { ...get().playerState, isPlayerMuted: isMuted },
    })
    localStorage.setItem('player_muted', String(isMuted))
  },

  triggerVolumeIndicator: () => {
    const existing = get().volumeIndicatorTimeoutId
    if (existing) clearTimeout(existing)
    const timeoutId = setTimeout(() => {
      set({ isVolumeIndicatorVisible: false })
    }, 1000)
    set({ isVolumeIndicatorVisible: true, volumeIndicatorTimeoutId: timeoutId })
  },

  // -- Playback control --
  togglePlay: () => {
    set({
      playerState: {
        ...get().playerState,
        isPlayerPlaying: !get().playerState.isPlayerPlaying,
      },
    })
  },

  setIsPlaying: (playing) => {
    set({ playerState: { ...get().playerState, isPlayerPlaying: playing } })
  },

  setIsBuffering: (buffering) => {
    set({ playerState: { ...get().playerState, isBuffering: buffering } })
  },

  setCurrentTime: (seconds) => {
    const { nextSegmentIndex, activeSegmentId, metadata } = get()

    // Check if we've exited the active segment
    if (activeSegmentId) {
      const active = metadata.mediaSegments.find(s => s.Id === activeSegmentId)
      if (active && seconds * 10_000_000 > active.EndTicks) {
        set({ activeSegmentId: null })
      }
    }

    // Check if we've entered the next segment
    if (nextSegmentIndex < metadata.mediaSegments.length) {
      const next = metadata.mediaSegments[nextSegmentIndex]
      if (next && seconds * 10_000_000 >= next.StartTicks) {
        set({
          activeSegmentId: next.Id || null,
          nextSegmentIndex: nextSegmentIndex + 1,
        })
      }
    }

    set({ playerState: { ...get().playerState, currentTime: seconds } })
  },

  setDuration: (seconds) => {
    set({ playerState: { ...get().playerState, duration: seconds } })
  },

  setPlayerReady: (ready) => {
    set({
      playerState: {
        ...get().playerState,
        isPlayerReady: ready,
        isLoading: !ready,
      },
    })
  },

  setBufferedPercent: (percent) => {
    set({ playerState: { ...get().playerState, bufferedPercent: percent } })
  },

  // -- Fullscreen --
  toggleFullscreen: () => {
    const container = document.querySelector('.player-container')
    if (!container) return

    if (document.fullscreenElement) {
      document.exitFullscreen()
      set({ playerState: { ...get().playerState, isPlayerFullscreen: false } })
    } else {
      container.requestFullscreen()
      set({ playerState: { ...get().playerState, isPlayerFullscreen: true } })
    }
  },

  setIsFullscreen: (fs) => {
    set({ playerState: { ...get().playerState, isPlayerFullscreen: fs } })
  },

  // -- Controls visibility --
  setIsUserHovering: (hovering) => {
    set({ playerState: { ...get().playerState, isUserHovering: hovering } })
  },

  // -- Seeking --
  handleStartSeek: (percent) => {
    set({
      playerState: {
        ...get().playerState,
        isUserSeeking: true,
        seekValue: percent,
      },
    })
  },

  handleStopSeek: (percent, duration) => {
    const seconds = (percent / 100) * duration
    get()._playerActions.seekTo(seconds)
    set({
      playerState: {
        ...get().playerState,
        isUserSeeking: false,
        currentTime: seconds,
      },
    })
  },

  // -- Subtitle & Audio --
  changeSubtitleTrack: (trackIndex, allTracks) => {
    const track = allTracks.find(t => t.Index === trackIndex)
    set({
      mediaSource: {
        ...get().mediaSource,
        subtitle: {
          url: track?.DeliveryUrl,
          track: trackIndex,
          format: track?.Codec || 'nosub',
          allTracks,
          enable: trackIndex !== -1,
        },
      },
    })
  },

  toggleSubtitleTrack: () => {
    const sub = get().mediaSource.subtitle
    if (sub.track !== -1) {
      set({
        mediaSource: {
          ...get().mediaSource,
          subtitle: { ...sub, enable: !sub.enable },
        },
      })
    }
  },

  changeAudioTrack: (trackIndex) => {
    set({
      mediaSource: {
        ...get().mediaSource,
        audioTrack: trackIndex,
        audio: { ...get().mediaSource.audio, track: trackIndex },
      },
    })
  },

  // -- Stats --
  toggleShowStatsForNerds: () => {
    set({
      playerState: {
        ...get().playerState,
        showStatsForNerds: !get().playerState.showStatsForNerds,
      },
    })
  },

  // -- Segments --
  setActiveSegment: (segmentIndex) => {
    const segment = get().metadata.mediaSegments[segmentIndex]
    set({
      nextSegmentIndex: segmentIndex + 1,
      activeSegmentId: segment?.Id || null,
    })
  },

  clearActiveSegment: () => {
    set({ activeSegmentId: null })
  },

  skipSegment: () => {
    const id = get().activeSegmentId
    const segment = get().metadata.mediaSegments.find(s => s.Id === id)
    if (!segment) return
    get()._playerActions.seekTo(segment.EndTicks / 10_000_000)
    set({ activeSegmentId: null })
  },

  // -- Player ref actions --
  _playerActions: {
    seekTo: () => console.warn('Player not ready yet'),
    getCurrentTime: () => 0,
  },

  registerPlayerActions: (actions) => {
    set({ _playerActions: actions })
  },

  seekTo: (seconds) => {
    get()._playerActions.seekTo(seconds)
  },

  seekForward: (seconds) => {
    const cur = get()._playerActions.getCurrentTime()
    get()._playerActions.seekTo(cur + seconds)
  },

  seekBackward: (seconds) => {
    const cur = get()._playerActions.getCurrentTime()
    get()._playerActions.seekTo(Math.max(0, cur - seconds))
  },

  getCurrentTime: () => get()._playerActions.getCurrentTime(),

  seekToNextChapter: () => {
    const cur = get()._playerActions.getCurrentTime()
    const curTicks = cur * 10_000_000
    const next = get().metadata.chapters.find(c => c.StartPositionTicks > curTicks)
    if (next) {
      get()._playerActions.seekTo(next.StartPositionTicks / 10_000_000)
    }
  },

  seekToPrevChapter: () => {
    const cur = get()._playerActions.getCurrentTime()
    const curTicks = cur * 10_000_000
    const prev = get().metadata.chapters
      .filter(c => c.StartPositionTicks < curTicks)
    if (prev.length === 0) {
      get()._playerActions.seekTo(0)
    } else if (prev.length === 1) {
      get()._playerActions.seekTo(prev[0].StartPositionTicks / 10_000_000)
    } else {
      get()._playerActions.seekTo(prev[prev.length - 2].StartPositionTicks / 10_000_000)
    }
  },

  // -- Initialize --
  initializePlayback: (config) => {
    set({
      ...getInitialState(),
      playbackStream: config.playbackStream,
      playsessionId: config.playsessionId,
      mediaSource: config.mediaSource,
      metadata: config.metadata,
      playerState: {
        ...getInitialState().playerState,
        volume: parseFloat(localStorage.getItem('player_volume') || '1'),
        isPlayerMuted: localStorage.getItem('player_muted') === 'true',
      },
    })
  },

  // -- Reset --
  reset: () => {
    const timeoutId = get().volumeIndicatorTimeoutId
    if (timeoutId) clearTimeout(timeoutId)
    set(getInitialState())
  },
}))

// Helper: ticks to seconds
export function ticksToSec(ticks: number): number {
  return ticks / 10_000_000
}

// Helper: seconds to ticks
export function secToTicks(seconds: number): number {
  return Math.round(seconds * 10_000_000)
}
