// JellyfinPlayer - Decomposed video player using sub-components
// All playback logic, session management, and Jellyfin API interaction lives here.
// UI is composed from PlayerControls, ProgressSlider, VolumeOverlay, etc.

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useJellyfin, getItemsApi, getUserApi, type BaseItemDto } from '../JellyfinContext'
import { api as appApi, toLocalUrl, IS_PHONE, IS_IOS } from '../../../utils/api'
import { lockLandscape, unlockOrientation } from '../../../utils/orientation'
import { claimMediaSession, releaseMediaSession } from '../../../utils/mediaSessionOwner'
import { SYSTEM_VOLUME_SUPPORTED, getSystemVolume, setSystemVolume, subscribeSystemVolume } from '../../../utils/systemVolume'
import { SCREEN_BRIGHTNESS_SUPPORTED, getScreenBrightness, setScreenBrightness, restoreScreenBrightness } from '../../../utils/screenBrightness'
import {
  getDownloadedItem,
  addPendingProgress,
  getPendingProgress,
  clearPendingProgress,
  deleteDownloadedMedia,
  addToQueue as addToDownloadQueue,
} from '../../../utils/jellyfinDownloadManager'
import { addToJellyfinQueue } from '../../../utils/jellyfinOfflineQueue'
import { getJellyfinDeviceId } from '../../../utils/jellyfinDeviceId'
import { claimMediaKeys } from '../../../utils/navigationBus'
import { loadSettings } from '../../../types/settings'
import { useJellyfinSeekDurations, useSubtitleStyle } from '../../../stores/settingsStore'
import { useSubtitleRenderer, type SubtitleSource } from './subtitles/useSubtitleRenderer'
import { useMusicPlayer } from '../../../stores/musicPlayerStore'
import { useAudiobookPlayer } from '../../../stores/audiobookPlayerStore'
import { useSleepTimer, type SleepTimerHandlers } from '../../../stores/sleepTimerStore'
import { useAudioOutputDevice } from '../../../hooks/useAudioOutputDevice'
import {
  getSeriesTrackPref,
  saveSeriesAudio,
  saveSeriesSubtitle,
  matchAudioPref,
  matchSubtitlePref,
  resolveServerSubtitle,
} from '../../../utils/seriesTrackPrefs'

import type { Chapter, MediaSource, MediaStream, MediaSegment, TrickplayInfo, PlayMethod, CodecCapabilities } from './types'
import { detectCodecCapabilities, refineVideoCodecSupport, loadPlaybackRate, savePlaybackRate, stepPlaybackRate, formatRate } from './types'

import { FastForward, RotateCcw } from 'lucide-react'
import PlayerControls from './PlayerControls'
import VolumeOverlay from './VolumeOverlay'
import BrightnessOverlay from './BrightnessOverlay'
import StatsForNerds from './StatsForNerds'
import type { VideoStats } from './StatsForNerds'
import SkipIntroButton from './SkipIntroButton'
import UpNextFlyout from './UpNextFlyout'
import ErrorDisplay from './ErrorDisplay'
import LoadingIndicator from './LoadingIndicator'
import PhoneSeekIndicator, { type SeekIndicatorState } from './PhoneSeekIndicator'
import PhoneLockOverlay from './PhoneLockOverlay'

interface JellyfinPlayerProps {
  item: BaseItemDto
  onClose: () => void
  startPosition?: number // in ticks (100ns units)
  /** Ignore the saved position and start at 0 ("Play from beginning") */
  startFromBeginning?: boolean
  localPath?: string
  episodeQueue?: BaseItemDto[]
  onPlayNext?: (item: BaseItemDto) => void
}

/** Audio track to play: server default (already honours the user's language
 *  preference) → client-side preference match → container default → first. */
function pickPreferredAudioIndex(
  audio: MediaStream[],
  serverDefault: number | null | undefined,
  preference: string | null,
): number | null {
  if (audio.length === 0) return null
  if (serverDefault != null && audio.some(t => t.Index === serverDefault)) return serverDefault
  if (preference) {
    const pref = preference.toLowerCase()
    const match = audio.find(t => t.Language?.toLowerCase() === pref || t.Language?.toLowerCase().startsWith(pref.slice(0, 2)))
    if (match) return match.Index
  }
  return (audio.find(t => t.IsDefault) || audio[0]).Index
}

type SkipSegmentType = 'Intro' | 'Recap' | 'Preview' | 'Commercial' | 'Outro'
const SKIP_SEGMENT_TYPES: SkipSegmentType[] = ['Intro', 'Recap', 'Preview', 'Commercial', 'Outro']
const SKIP_LABELS: Record<SkipSegmentType, string> = {
  Intro: 'Skip Intro',
  Recap: 'Skip Recap',
  Preview: 'Skip Preview',
  Commercial: 'Skip Ad',
  Outro: 'Skip Credits',
}

export function JellyfinPlayer({ item, onClose, startPosition = 0, startFromBeginning = false, localPath, episodeQueue = [], onPlayNext }: JellyfinPlayerProps) {
  const { api, serverUrl, user } = useJellyfin()
  const { seekBackSeconds, seekForwardSeconds } = useJellyfinSeekDurations()
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Route audio to the output device chosen in Settings → Advanced (video device).
  // The <video> is remounted per play session (key={playSessionId}, e.g. on an
  // audio-track switch), so the sink must be re-applied to each new element.
  const [sinkKey, setSinkKey] = useState<string | null>(null)
  useAudioOutputDevice(videoRef, 'video', sinkKey)

  // One medium at a time: pause background music/audiobook when the video player opens
  useEffect(() => {
    useMusicPlayer.getState().pause()
    useAudiobookPlayer.getState().pause()
  }, [])

  // ==================== PLAYBACK STATE ====================
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const isMutedRef = useRef(false)
  isMutedRef.current = isMuted
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPictureInPicture, setIsPictureInPicture] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [bufferedPercent, setBufferedPercent] = useState(0)

  // ==================== TRACK STATE ====================
  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number | null>(null)
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number>(-1) // -1 = Off
  const [userAudioPreference, setUserAudioPreference] = useState<string | null>(null)
  const userAudioPreferenceRef = useRef<string | null>(null)
  userAudioPreferenceRef.current = userAudioPreference
  const userPreferencesLoadedRef = useRef(false)

  // ==================== MEDIA SOURCE STATE ====================
  const [fetchedMediaSources, setFetchedMediaSources] = useState<MediaSource[] | null>(null)
  // Chapters only come with the item when asked for (fields=Chapters)
  const [fetchedChapters, setFetchedChapters] = useState<Chapter[] | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [mediaSourceId, setMediaSourceId] = useState<string | null>(null)
  const [playSessionId, setPlaySessionId] = useState<string | null>(null)
  const [playMethod, setPlayMethod] = useState<PlayMethod>('DirectStream')
  const [fetchedResumePosition, setFetchedResumePosition] = useState<number | null>(null)

  // ==================== INTRO / SEGMENTS ====================
  const [introStart, setIntroStart] = useState<number | null>(null)
  const [introEnd, setIntroEnd] = useState<number | null>(null)
  const [mediaSegments, setMediaSegments] = useState<MediaSegment[]>([])

  // ==================== TRICKPLAY ====================
  const [trickplayInfo, setTrickplayInfo] = useState<TrickplayInfo | null>(null)

  // ==================== UP NEXT ====================
  const [showUpNext, setShowUpNext] = useState(false)
  const [upNextDismissed, setUpNextDismissed] = useState(false)
  /** Without credits data, Up Next appears this long before the end (no auto-advance before the end) */
  const CREDITS_THRESHOLD_SECONDS = 120
  /** With an Outro segment, the next episode starts this many seconds into the credits */
  const UP_NEXT_COUNTDOWN = 10
  /** Last seconds of an episode without credits data — the ring counts down to the end */
  const UP_NEXT_END_RING = 15
  const [upNextCountdown, setUpNextCountdown] = useState<number | null>(null)
  // "Are you still watching?": after this many episodes advanced on their own
  // without any input, the next auto-advance asks first
  const STILL_WATCHING_AFTER = 3
  const autoAdvanceCountRef = useRef(0)
  const autoAdvanceRef = useRef<() => void>(() => {})
  const [stillWatching, setStillWatching] = useState(false)
  const stillWatchingRef = useRef(false)
  stillWatchingRef.current = stillWatching

  // "Start from beginning" chip for a few seconds after resuming mid-item
  const [startOverVisible, setStartOverVisible] = useState(false)
  const startOverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const startOverItemRef = useRef<string | null | undefined>(null)

  // ==================== STATS ====================
  const [showStats, setShowStats] = useState(false)
  // Playback speed — remembered across videos and restarts
  const [playbackRate, setPlaybackRateState] = useState(loadPlaybackRate)
  const [rateFlash, setRateFlash] = useState(false)
  const rateFlashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const setPlaybackRate = useCallback((rate: number, flash = false) => {
    setPlaybackRateState(rate)
    savePlaybackRate(rate)
    if (flash) {
      setRateFlash(true)
      clearTimeout(rateFlashTimer.current)
      rateFlashTimer.current = setTimeout(() => setRateFlash(false), 1000)
    }
  }, [])
  const [videoStats, setVideoStats] = useState<VideoStats | null>(null)
  const playbackRateRef = useRef(playbackRate)
  playbackRateRef.current = playbackRate
  // Long-press on the picture = 2× while held (not saved as the speed)
  const [holdBoost, setHoldBoost] = useState(false)
  const holdRef = useRef({ timer: null as ReturnType<typeof setTimeout> | null, x: 0, y: 0, active: false, swallowClick: false })

  // ==================== VOLUME OVERLAY ====================
  const [showVolumeOverlay, setShowVolumeOverlay] = useState(false)
  const volumeOverlayTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // ==================== PHONE GESTURES / LOCK ====================
  // Double-tap seek zones (left/right thirds) with YouTube-style accumulation,
  // single tap toggles controls, lock button freezes all touch input.
  const [seekIndicator, setSeekIndicator] = useState<SeekIndicatorState | null>(null)
  const [isLocked, setIsLocked] = useState(false)
  const isLockedRef = useRef(false)
  isLockedRef.current = isLocked
  const phoneTapStateRef = useRef({
    lastTapTime: 0,
    lastZone: 'mid' as 'left' | 'mid' | 'right',
    chainSide: null as 'left' | 'right' | null,
    chainUntil: 0,
    accumulated: 0,
  })
  const singleTapTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const seekIndicatorTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Vertical-swipe zones (phone): right third ↕ = volume, left third ↕ =
  // brightness. On mobile builds with the system-volume plugin this drives the
  // REAL screen backlight (UIScreen.brightness / window screenBrightness);
  // elsewhere it falls back to an in-app black dim layer (1 = no dim).
  const [brightness, setBrightness] = useState(1)
  const brightnessRef = useRef(1)
  brightnessRef.current = brightness
  const [showBrightnessOverlay, setShowBrightnessOverlay] = useState(false)
  const brightnessOverlayTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const vSwipeRef = useRef({
    active: false,
    axis: null as 'v' | 'h' | null,
    zone: 'mid' as 'left' | 'mid' | 'right',
    startX: 0,
    startY: 0,
    startValue: 0, // volume or brightness at gesture start
  })
  // Set right after a vertical swipe so the synthesized click doesn't toggle controls
  const swipeConsumedTapRef = useRef(false)

  // ==================== SLEEP TIMER ====================
  // True while an "end of current episode" sleep timer targets the video player
  const sleepEndOfEpisode = useSleepTimer(s => s.target === 'video' && s.mode?.kind === 'endOfItem')

  // ==================== REFS ====================
  const controlsTimeoutRef = useRef<NodeJS.Timeout>(null)
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const playbackStartedRef = useRef(false)
  const lastReportedPausedRef = useRef<boolean | null>(null)
  const lastKnownTimeRef = useRef<number>(0)
  /** Last currentTime pushed into React state (see handleTimeUpdate throttle) */
  const lastPushedTimeRef = useRef<number>(0)
  /** Mirrors showControls for the timeupdate handler, which never re-attaches */
  const showControlsRef = useRef(true)
  /** Mirrors currentTime so the progress reporter doesn't re-run 4x/sec */
  const currentTimeRef = useRef(0)
  /** canplaythrough starts playback once per source, never force-resumes later */
  const hasAutoPlayedRef = useRef(false)
  const isInitialLoadRef = useRef(true)
  const hasResumedRef = useRef(false)
  const effectiveResumePositionRef = useRef<number>(0)
  const lastInitializedItemIdRef = useRef<string | null>(null)
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null)
  const pendingSeekTimeRef = useRef<number | null>(null)
  const nextEpisodeRef = useRef<BaseItemDto | null>(null)
  const onPlayNextRef = useRef(onPlayNext)
  const volumeRef = useRef(1)
  /** Item whose media has actually started playing — gates the Playing report
   *  so an episode switch never reports the new item with the old session. */
  const playingItemIdRef = useRef<string | null>(null)
  const itemIdRef = useRef(item.Id)
  itemIdRef.current = item.Id
  /** Item whose saved subtitle choice was applied to a local (downloaded) file */
  const localTracksAppliedRef = useRef<string | null>(null)
  /** Direct play failed once for this item → the retry forced a transcode */
  const autoTranscodeTriedRef = useRef(false)
  const playMethodRef = useRef<PlayMethod>('DirectStream')
  const retryPlaybackRef = useRef<(forceTranscode: boolean) => void>(() => {})

  // ==================== DERIVED VALUES ====================
  const codecCapabilities = useMemo(() => detectCodecCapabilities(), [])
  const downloadedItem = item.Id ? getDownloadedItem(item.Id) : null
  const isPlayingLocally = !!(localPath || downloadedItem?.localPath)

  const currentEpisodeIndex = useMemo(() => {
    if (!item.Id || episodeQueue.length === 0) return -1
    return episodeQueue.findIndex(ep => ep.Id === item.Id)
  }, [item.Id, episodeQueue])

  const nextEpisode = useMemo(() => {
    if (currentEpisodeIndex === -1 || currentEpisodeIndex >= episodeQueue.length - 1) return null
    return episodeQueue[currentEpisodeIndex + 1]
  }, [currentEpisodeIndex, episodeQueue])

  const previousEpisode = useMemo(() => {
    if (currentEpisodeIndex <= 0) return null
    return episodeQueue[currentEpisodeIndex - 1]
  }, [currentEpisodeIndex, episodeQueue])

  // Keep refs in sync with derived values
  nextEpisodeRef.current = nextEpisode
  onPlayNextRef.current = onPlayNext

  // Chapters
  const chapters = useMemo(() => {
    const itemChapters = (item as any).Chapters as Chapter[] | undefined
    if (itemChapters && itemChapters.length > 0) return itemChapters
    if (fetchedChapters && fetchedChapters.length > 0) return fetchedChapters
    return fetchedMediaSources?.[0]?.Chapters || []
  }, [item, fetchedChapters, fetchedMediaSources])

  const currentChapter = useMemo(() => {
    if (chapters.length === 0) return null
    const currentTicks = currentTime * 10000000
    let current: Chapter | null = null
    for (const chapter of chapters) {
      if (chapter.StartPositionTicks <= currentTicks) current = chapter
      else break
    }
    return current
  }, [chapters, currentTime])

  const currentChapterIndex = useMemo(() => {
    if (!currentChapter || chapters.length === 0) return -1
    return chapters.findIndex(ch => ch.StartPositionTicks === currentChapter.StartPositionTicks)
  }, [chapters, currentChapter])

  // Audio and subtitle tracks
  const { audioTracks, subtitleTracks } = useMemo(() => {
    const mediaSources = fetchedMediaSources || (item as any).MediaSources as MediaSource[] | undefined
    const mediaStreams = mediaSources?.[0]?.MediaStreams || []
    return {
      audioTracks: mediaStreams.filter(s => s.Type === 'Audio'),
      subtitleTracks: mediaStreams.filter(s => s.Type === 'Subtitle'),
    }
  }, [item, fetchedMediaSources])

  // Effective resume position
  const effectiveResumePosition = startFromBeginning ? 0 : (fetchedResumePosition ?? startPosition)
  effectiveResumePositionRef.current = effectiveResumePosition
  const resumePositionReady = fetchedResumePosition !== null || isPlayingLocally

  // Video URL
  const videoUrl = useMemo(() => {
    if (localPath) return toLocalUrl(localPath)
    if (downloadedItem?.localPath) return toLocalUrl(downloadedItem.localPath)
    if (playbackUrl) return playbackUrl
    return null
  }, [localPath, downloadedItem, playbackUrl])

  // Active subtitle track (the MediaStream currently selected, if any).
  const activeSubtitleTrack = useMemo(
    () => subtitleTracks.find(t => t.Index === selectedSubtitleIndex) || null,
    [subtitleTracks, selectedSubtitleIndex]
  )

  // Subtitle source for the libass (JASSUB) renderer. ASS/SSA are fetched in
  // their native format so libass renders them exactly as authored; everything
  // text-based is fetched as VTT and re-styled from the user's SubtitleStyle.
  // Image-based subs (PGS/DVD/DVB) can't be rendered as text — they're skipped
  // here (the track picker still lists them, they just won't display yet).
  const subtitleSource = useMemo<SubtitleSource | null>(() => {
    if (!serverUrl || !api?.accessToken || !item.Id || selectedSubtitleIndex < 0 || !activeSubtitleTrack) return null
    const codec = (activeSubtitleTrack.Codec || '').toLowerCase()
    const isImage = ['pgssub', 'pgs', 'hdmv_pgs_subtitle', 'dvdsub', 'dvd_subtitle', 'dvbsub', 'dvb_subtitle', 'xsub'].includes(codec)
    if (isImage) return null
    const isAss = codec === 'ass' || codec === 'ssa'
    const mediaSrc = mediaSourceId || item.Id
    const ext = isAss ? 'ass' : 'vtt'
    const url = `${serverUrl}/Videos/${item.Id}/${mediaSrc}/Subtitles/${selectedSubtitleIndex}/Stream.${ext}?ApiKey=${api.accessToken}`
    return { url, isAss }
  }, [serverUrl, api?.accessToken, item.Id, mediaSourceId, selectedSubtitleIndex, activeSubtitleTrack])

  // Render subtitles with libass (JASSUB). resetKey ties the renderer to the
  // current <video> element, which React remounts (key={playSessionId}) on each
  // new play session.
  const subtitleStyle = useSubtitleStyle()
  useSubtitleRenderer({
    videoRef,
    source: subtitleSource,
    style: subtitleStyle,
    resetKey: playSessionId || 'initial',
  })

  // ==================== DEVICE PROFILE ====================
  const buildDeviceProfile = useCallback((caps: CodecCapabilities) => {
    const videoCodecs = ['h264']
    if (caps.hevc) videoCodecs.push('hevc', 'h265')
    if (caps.vp9) videoCodecs.push('vp9')
    if (caps.av1) videoCodecs.push('av1')

    const audioCodecs = ['aac', 'mp3']
    if (caps.opus) audioCodecs.push('opus')
    if (caps.flac) audioCodecs.push('flac')
    // Only advertise AC3/E-AC3 direct-play when this WebView can actually decode
    // them (Windows WebView2 can; Chromium / most Linux WebKitGTK cannot). If we
    // advertised them blindly the WebView would play the video silently — the
    // audio-in-Jellyfin-tab-only bug — so unsupported platforms transcode to AAC.
    if (caps.ac3) audioCodecs.push('ac3')
    if (caps.eac3) audioCodecs.push('eac3')

    // iOS WKWebView's <video> can DIRECT-PLAY only MP4/MOV with H.264/HEVC and
    // AAC/MP3 audio. It cannot play MKV/WebM containers at all, nor AC3/EAC3/DTS/
    // FLAC/Opus audio or VP9/AV1 video. Advertising those as direct-play (as the
    // desktop profile does — WebView2 falls back to Windows system codecs) makes
    // Jellyfin return an unplayable static stream for MKV / multi-track files.
    // So on iOS we advertise only the truly playable set; everything else falls
    // through to the HLS TranscodingProfile below, which iOS plays natively.
    const directPlayProfiles = IS_IOS
      ? [
          { Type: 'Video', Container: 'mp4,m4v,mov', VideoCodec: videoCodecs.join(','), AudioCodec: 'aac,mp3' },
          { Type: 'Audio', Container: 'mp3', AudioCodec: 'mp3' },
          { Type: 'Audio', Container: 'aac', AudioCodec: 'aac' },
        ]
      : [
          { Type: 'Video', Container: 'mp4', VideoCodec: videoCodecs.join(','), AudioCodec: audioCodecs.join(',') },
          { Type: 'Video', Container: 'webm', VideoCodec: caps.vp9 ? 'vp8,vp9' : 'vp8', AudioCodec: 'vorbis,opus' },
          { Type: 'Video', Container: 'mkv', VideoCodec: videoCodecs.join(','), AudioCodec: audioCodecs.join(',') },
          { Type: 'Audio', Container: 'mp3', AudioCodec: 'mp3' },
          { Type: 'Audio', Container: 'aac', AudioCodec: 'aac' },
          { Type: 'Audio', Container: 'flac', AudioCodec: 'flac' },
          { Type: 'Audio', Container: 'wav', AudioCodec: 'wav' },
        ]

    return {
      MaxStreamingBitrate: 120000000,
      MaxStaticBitrate: 100000000,
      MusicStreamingTranscodingBitrate: 192000,
      DirectPlayProfiles: directPlayProfiles,
      TranscodingProfiles: [
        { Type: 'Video', Container: 'ts', VideoCodec: 'h264', AudioCodec: caps.ac3 ? 'aac,mp3,ac3' : 'aac,mp3', Context: 'Streaming', Protocol: 'hls', MaxAudioChannels: '6', MinSegments: 1, BreakOnNonKeyFrames: true },
        { Type: 'Video', Container: 'mp4', VideoCodec: 'h264', AudioCodec: 'aac,mp3', Context: 'Streaming', MaxAudioChannels: '6' },
        { Type: 'Video', Container: 'mkv', VideoCodec: videoCodecs.join(','), AudioCodec: audioCodecs.join(','), Context: 'Streaming', MaxAudioChannels: '6', CopyTimestamps: true },
      ],
      ContainerProfiles: [],
      CodecProfiles: [
        { Type: 'Video', Codec: 'h264', Conditions: [
          { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false },
          { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '51', IsRequired: false },
          { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false },
          { Condition: 'NotEquals', Property: 'IsInterlaced', Value: 'true', IsRequired: false },
        ]},
        { Type: 'Video', Codec: 'hevc,h265', Conditions: [
          { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: caps.hevc ? '10' : '8', IsRequired: false },
          { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '120', IsRequired: false },
          { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false },
        ]},
        { Type: 'Audio', Codec: 'aac', Conditions: [
          { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: '6', IsRequired: false },
        ]},
      ],
      SubtitleProfiles: [
        { Format: 'vtt', Method: 'External' },
        { Format: 'srt', Method: 'External' },
        { Format: 'ass', Method: 'External' },
        { Format: 'ssa', Method: 'External' },
      ],
    }
  }, [])

  // ==================== FETCH PLAYBACK INFO ====================
  const fetchPlaybackInfoWithTrack = async (
    audioIndex: number | null,
    subtitleIndex: number | null,
    forceTranscode: boolean = false
  ): Promise<{ url: string; mediaSources: MediaSource[]; mediaSourceId: string; playSessionId: string; playMethod: PlayMethod } | null> => {
    if (!serverUrl || !api?.accessToken || !item.Id || !user?.Id) return null

    try {
      // Only advertise direct-play for codecs this device decodes SMOOTHLY at
      // this stream's resolution — otherwise WebView2 happily accepts an HEVC
      // file it can only software-decode, which drops frames steadily while
      // the network and server sit idle.
      const probeStream = (item as any).MediaSources?.[0]?.MediaStreams?.find(
        (st: any) => st?.Type === 'Video'
      )
      const refinedCaps = await refineVideoCodecSupport(codecCapabilities, {
        width: probeStream?.Width ?? (item as any).Width,
        height: probeStream?.Height ?? (item as any).Height,
        bitrate: probeStream?.BitRate,
        framerate: probeStream?.RealFrameRate ?? probeStream?.AverageFrameRate,
      })
      const deviceProfile = buildDeviceProfile(refinedCaps)

      const existingMediaSourceId = (item as any).MediaSources?.[0]?.Id
      const queryParams = new URLSearchParams({ userId: user.Id })
      if (audioIndex !== null) queryParams.set('audioStreamIndex', audioIndex.toString())
      if (subtitleIndex !== null) queryParams.set('subtitleStreamIndex', subtitleIndex.toString())
      if (existingMediaSourceId) queryParams.set('mediaSourceId', existingMediaSourceId)

      const res = await appApi.request({
        method: 'POST',
        url: `${serverUrl}/Items/${item.Id}/PlaybackInfo?${queryParams.toString()}`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `MediaBrowser Token="${api.accessToken}"`,
        },
        data: {
          DeviceProfile: deviceProfile,
          StartTimeTicks: 0,
          EnableDirectPlay: !forceTranscode,
          EnableDirectStream: !forceTranscode,
          EnableTranscoding: true,
          AllowVideoStreamCopy: true,
          AllowAudioStreamCopy: !forceTranscode,
        },
      })

      if (!res.success || !res.data) return null

      const data = res.data
      const mediaSources = data.MediaSources as MediaSource[]
      const sessionId = data.PlaySessionId as string
      if (!mediaSources || mediaSources.length === 0) return null

      const source = mediaSources[0]
      const sourceId = source.Id || item.Id

      let method: PlayMethod = 'DirectStream'
      if ((source as any).SupportsDirectPlay) method = 'DirectPlay'
      else if (source.TranscodingUrl || forceTranscode) method = 'Transcode'

      let streamUrl: string
      if (source.TranscodingUrl) {
        let transcodingUrl = source.TranscodingUrl
        if (audioIndex !== null) {
          if (/AudioStreamIndex=\d+/.test(transcodingUrl)) {
            transcodingUrl = transcodingUrl.replace(/AudioStreamIndex=\d+/, `AudioStreamIndex=${audioIndex}`)
          } else if (transcodingUrl.includes('?')) {
            transcodingUrl = transcodingUrl + `&AudioStreamIndex=${audioIndex}`
          }
        }
        if (subtitleIndex !== null) {
          if (/SubtitleStreamIndex=-?\d+/.test(transcodingUrl)) {
            transcodingUrl = transcodingUrl.replace(/SubtitleStreamIndex=-?\d+/, `SubtitleStreamIndex=${subtitleIndex}`)
          } else if (transcodingUrl.includes('?')) {
            transcodingUrl = transcodingUrl + `&SubtitleStreamIndex=${subtitleIndex}`
          }
        }
        streamUrl = `${serverUrl}${transcodingUrl}`
      } else if (
        forceTranscode ||
        // iOS safety net: if the server gave no TranscodingUrl but the container
        // isn't one WebKit can play as a static file, force HLS rather than
        // handing the <video> element an unplayable static MKV/WebM stream.
        (IS_IOS && !['mp4', 'm4v', 'mov'].includes((source.Container || '').toLowerCase()))
      ) {
        const params = new URLSearchParams({ DeviceId: getJellyfinDeviceId(), ApiKey: api.accessToken, AudioStreamIndex: (audioIndex ?? 0).toString() })
        if (subtitleIndex !== null) params.set('SubtitleStreamIndex', subtitleIndex.toString())
        streamUrl = `${serverUrl}/Videos/${item.Id}/master.m3u8?${params.toString()}`
        if (method === 'DirectStream') method = 'Transcode'
      } else {
        const container = source.Container || 'mp4'
        const params = new URLSearchParams({ Static: 'true', mediaSourceId: sourceId!, deviceId: getJellyfinDeviceId(), ApiKey: api.accessToken })
        streamUrl = `${serverUrl}/Videos/${item.Id}/stream.${container}?${params.toString()}`
      }

      return { url: streamUrl, mediaSources, mediaSourceId: sourceId!, playSessionId: sessionId, playMethod: method }
    } catch (e) {
      console.error('Failed to fetch playback info:', e)
      return null
    }
  }

  // ==================== EFFECTS ====================

  // Fetch user preferences
  useEffect(() => {
    if (userPreferencesLoadedRef.current || !api || !user?.Id) return
    const fetchUserPreferences = async () => {
      try {
        const userApi = getUserApi(api)
        const response = await userApi.getUserById({ userId: user.Id! })
        const config = response.data?.Configuration
        if (config?.AudioLanguagePreference) setUserAudioPreference(config.AudioLanguagePreference)
        userPreferencesLoadedRef.current = true
      } catch {
        userPreferencesLoadedRef.current = true
      }
    }
    fetchUserPreferences()
  }, [api, user?.Id])

  // Initial playback info + resume position
  useEffect(() => {
    if (lastInitializedItemIdRef.current === item.Id) return
    playbackStartedRef.current = false
    lastReportedPausedRef.current = null
    hasResumedRef.current = false

    // Next/previous episode reuses this player instance (remounting it would
    // drop the user out of fullscreen). Everything that belongs to the
    // previous item must be reset here, or it leaks into the new one: resume
    // position, play session, track choice, intro segments, trickplay, Up Next.
    if (lastInitializedItemIdRef.current !== null) {
      const video = videoRef.current
      if (video) { try { video.pause() } catch {} }
      playingItemIdRef.current = null
      autoTranscodeTriedRef.current = false
      hasAutoPlayedRef.current = false
      currentTimeRef.current = 0
      lastKnownTimeRef.current = 0
      lastPushedTimeRef.current = 0
      pendingSeekTimeRef.current = null
      setPendingSeekTime(null)
      setIsPlaying(false)
      setIsLoading(true)
      setError(null)
      setCurrentTime(0)
      setDuration(0)
      setBufferedPercent(0)
      setFetchedResumePosition(null)
      setFetchedMediaSources(null)
      setFetchedChapters(null)
      setPlaybackUrl(null)
      setMediaSourceId(null)
      setPlaySessionId(null)
      setSelectedAudioIndex(null)
      setSelectedSubtitleIndex(-1)
      setMediaSegments([])
      setIntroStart(null)
      setIntroEnd(null)
      setTrickplayInfo(null)
      setShowUpNext(false)
      setUpNextDismissed(false)
      setStillWatching(false)
      setStartOverVisible(false)
    }

    const initializePlayback = async () => {
      if (isPlayingLocally) {
        lastInitializedItemIdRef.current = item.Id || null
        // Offline/local playback: resume from locally queued progress (from an
        // earlier offline session) or the item's last known server position.
        // Always set it — 0 included — so a previous episode's position never sticks.
        const pendingTicks = getPendingProgress().find(p => p.itemId === item.Id)?.positionTicks || 0
        const localTicks = Math.max(pendingTicks, item.UserData?.PlaybackPositionTicks || 0)
        setFetchedResumePosition(localTicks)
        return
      }
      lastInitializedItemIdRef.current = item.Id || null

      // Fetch resume position
      if (serverUrl && api?.accessToken && item.Id && user?.Id) {
        try {
          const itemsApi = getItemsApi(api)
          const response = await itemsApi.getItems({ userId: user.Id, ids: [item.Id], fields: ['Chapters'] as any, enableUserData: true })
          const fetchedItem = response.data.Items?.[0]
          if (itemIdRef.current !== item.Id) return
          const itemChapters = (fetchedItem as any)?.Chapters as Chapter[] | undefined
          if (itemChapters?.length) setFetchedChapters(itemChapters)

          // A watched item stays watched when it is opened again (the server
          // handles re-watch progress) — it used to be un-marked here.

          // Prefer locally queued (not yet synced) progress over the server
          // position when it's further in — e.g. watched offline, reconnected,
          // and hit play before the background sync finished.
          const serverTicks = fetchedItem?.UserData?.PlaybackPositionTicks || 0
          const pendingTicks = getPendingProgress().find(p => p.itemId === item.Id)?.positionTicks || 0
          setFetchedResumePosition(Math.max(serverTicks, pendingTicks))
        } catch {
          setFetchedResumePosition(startPosition || 0)
        }
      }

      let result = await fetchPlaybackInfoWithTrack(null, null)
      if (itemIdRef.current !== item.Id) return // switched again meanwhile
      if (result) {
        // Preferred audio track. The server picks it (user's audio language
        // preference → DefaultAudioStreamIndex) and a transcode URL honours
        // it, but direct play hands the container to <video>, which always
        // plays the file's own default track. Re-request with the preferred
        // track forced through the server when the two differ.
        //
        // A choice saved for this series (menu pick on an earlier episode)
        // wins over the server's defaults.
        const seriesPref = getSeriesTrackPref(item.SeriesId)
        const source = result.mediaSources[0] as any
        const audio = ((source?.MediaStreams || []) as MediaStream[]).filter(st => st.Type === 'Audio')
        const preferred = matchAudioPref(audio, seriesPref?.audio)
          ?? pickPreferredAudioIndex(audio, source?.DefaultAudioStreamIndex, userAudioPreferenceRef.current)
        const containerDefault = (audio.find(t => t.IsDefault) || audio[0])?.Index
        if (preferred != null && audio.length > 1 && preferred !== containerDefault && result.playMethod !== 'Transcode') {
          const forced = await fetchPlaybackInfoWithTrack(preferred, null, true)
          if (itemIdRef.current !== item.Id) return
          if (forced) result = forced
        }
        if (preferred != null) setSelectedAudioIndex(preferred)

        // Subtitles: the saved series choice, else the server's default —
        // DefaultSubtitleStreamIndex applies the user's Jellyfin subtitle mode
        // (Default / Smart / Always / Only forced / None) and language, so
        // forced subs for foreign-language scenes come on by themselves.
        // Read from the final response: Smart mode depends on the audio track.
        const finalSource = result.mediaSources[0] as any
        const subs = ((finalSource?.MediaStreams || []) as MediaStream[]).filter(st => st.Type === 'Subtitle')
        const subtitle = matchSubtitlePref(subs, seriesPref?.subtitle)
          ?? resolveServerSubtitle(subs, finalSource?.DefaultSubtitleStreamIndex)
        setSelectedSubtitleIndex(subtitle)

        setFetchedMediaSources(result.mediaSources)
        setPlaybackUrl(result.url)
        setMediaSourceId(result.mediaSourceId)
        setPlaySessionId(result.playSessionId)
        setPlayMethod(result.playMethod)
      } else {
        // Used to leave an endless spinner: no URL, no error, no retry
        setError('Could not get playback information from the server')
        setIsLoading(false)
      }
    }
    initializePlayback()
  }, [serverUrl, api?.accessToken, item.Id, user?.Id, isPlayingLocally, startPosition])

  // Downloaded files: apply the series' saved subtitle choice once the
  // item's tracks are known (streams do this in initializePlayback). The
  // audio track can't be switched in a local file, so it isn't applied.
  useEffect(() => {
    if (!isPlayingLocally || !item.Id || localTracksAppliedRef.current === item.Id || subtitleTracks.length === 0) return
    localTracksAppliedRef.current = item.Id
    const sub = matchSubtitlePref(subtitleTracks, getSeriesTrackPref(item.SeriesId)?.subtitle)
    if (sub !== undefined) setSelectedSubtitleIndex(sub)
  }, [isPlayingLocally, item.Id, item.SeriesId, subtitleTracks])

  // Default audio track
  useEffect(() => {
    // Fallback (local files; streams set it in initializePlayback). Local
    // files play the container default, so the menu must show that one.
    if (selectedAudioIndex === null && audioTracks.length > 0) {
      const defaultAudio = audioTracks.find(t => t.IsDefault) || audioTracks[0]
      setSelectedAudioIndex(defaultAudio.Index)
    }
  }, [audioTracks, selectedAudioIndex])

  // Fetch media segments
  useEffect(() => {
    const fetchMediaSegments = async () => {
      if (!serverUrl || !api?.accessToken || !item.Id || isPlayingLocally) return
      try {
        const res = await appApi.request({
          method: 'GET',
          url: `${serverUrl}/MediaSegments/${item.Id}?ApiKey=${api.accessToken}`,
          headers: { 'Authorization': `MediaBrowser Token="${api.accessToken}"` },
        })
        if (res.success && res.data) {
          const segments = res.data.Items || res.data || []
          if (Array.isArray(segments) && segments.length > 0) {
            setMediaSegments(segments)
            return
          }
        }
      } catch {}
      const itemSegments = (item as any).MediaSegments
      if (Array.isArray(itemSegments) && itemSegments.length > 0) setMediaSegments(itemSegments)
    }
    fetchMediaSegments()
  }, [serverUrl, api?.accessToken, item.Id, isPlayingLocally, item])

  // Intro detection
  useEffect(() => {
    const introSegment = mediaSegments.find(seg => seg.Type === 'Intro')
    if (introSegment) {
      setIntroStart(introSegment.StartTicks / 10000000)
      setIntroEnd(introSegment.EndTicks / 10000000)
      return
    }
    for (let i = 0; i < chapters.length; i++) {
      const name = chapters[i].Name?.toLowerCase() || ''
      if (name.includes('intro') || name.includes('opening')) {
        const start = chapters[i].StartPositionTicks / 10000000
        const end = chapters[i + 1] ? chapters[i + 1].StartPositionTicks / 10000000 : start + 90
        setIntroStart(start)
        setIntroEnd(end)
        return
      }
    }
    const userData = (item as any).UserData
    if (userData?.IntroStart !== undefined && userData?.IntroEnd !== undefined) {
      setIntroStart(userData.IntroStart)
      setIntroEnd(userData.IntroEnd)
      return
    }
    setIntroStart(null)
    setIntroEnd(null)
  }, [chapters, item, mediaSegments])

  // Skippable segments: Intro (segment, chapter or UserData fallback),
  // Recap, Preview, Commercial and Outro from the MediaSegments API
  const skipSegments = useMemo(() => {
    const out: { type: SkipSegmentType; start: number; end: number }[] = []
    for (const seg of mediaSegments) {
      if (!SKIP_SEGMENT_TYPES.includes(seg.Type as SkipSegmentType)) continue
      const start = seg.StartTicks / 10000000
      const end = seg.EndTicks / 10000000
      if (end - start >= 1) out.push({ type: seg.Type as SkipSegmentType, start, end })
    }
    if (!out.some(s => s.type === 'Intro') && introStart !== null && introEnd !== null && introEnd > introStart) {
      out.push({ type: 'Intro', start: introStart, end: introEnd })
    }
    return out
  }, [mediaSegments, introStart, introEnd])

  // Where the credits start: the Outro segment, else a chapter named like
  // credits. Ignored when it would be in the first half (bad data).
  const creditsStart = useMemo(() => {
    let start: number | null = skipSegments.find(s => s.type === 'Outro')?.start ?? null
    if (start === null) {
      const ch = chapters.find(c => /credits|abspann|outro|ending|^ed$/i.test((c.Name || '').trim()))
      if (ch) start = ch.StartPositionTicks / 10000000
    }
    if (start === null || (duration > 0 && start < duration * 0.5)) return null
    return start
  }, [skipSegments, chapters, duration])

  // Fetch trickplay info.
  // There is no `GET /Videos/{id}/Trickplay` endpoint — the manifest lives on the
  // item DTO as `Trickplay: { [mediaSourceId]: { [width]: TrickplayInfoDto } }`,
  // populated when the item is requested with all fields (GET /Items/{id}).
  useEffect(() => {
    const fetchTrickplay = async () => {
      if (!serverUrl || !api?.accessToken || !item.Id || isPlayingLocally) return

      const pickInfo = (manifest: Record<string, Record<string, any>> | undefined) => {
        if (!manifest) return null
        const source = manifest[mediaSourceId || ''] || manifest[item.Id!] || Object.values(manifest)[0]
        if (!source) return null
        // Prefer the highest available tile resolution — sheets are small either way.
        const widths = Object.keys(source).map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => b - a)
        return widths.length > 0 ? source[String(widths[0])] : null
      }

      let info = pickInfo((item as any).Trickplay)

      if (!info) {
        try {
          const params = new URLSearchParams()
          if (user?.Id) params.set('userId', user.Id)
          const res = await appApi.request({
            method: 'GET',
            url: `${serverUrl}/Items/${item.Id}?${params.toString()}`,
            headers: { 'Authorization': `MediaBrowser Token="${api.accessToken}"` },
          })
          if (res.success && res.data) info = pickInfo(res.data.Trickplay)
        } catch {}
      }

      if (!info) return
      setTrickplayInfo({
        width: info.Width || 320, height: info.Height || 180,
        interval: info.Interval || 10000, tileWidth: info.TileWidth || 10, tileHeight: info.TileHeight || 10,
      })
    }
    fetchTrickplay()
  }, [serverUrl, api?.accessToken, item, item.Id, mediaSourceId, user?.Id, isPlayingLocally])

  // Online/Offline
  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline) }
  }, [])

  // Sync volume to video. On mobile the OS owns the real volume (iOS ignores
  // element volume entirely) — the element stays at 1 and the player's volume
  // UI drives the SYSTEM volume through the native plugin instead.
  // playSessionId: the <video> is remounted per session (audio-track switch),
  // and a fresh element starts at volume 1 — re-apply volume and audio sink.
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = SYSTEM_VOLUME_SUPPORTED ? 1 : volume
  }, [volume, playSessionId])
  useEffect(() => { setSinkKey(playSessionId) }, [playSessionId])
  volumeRef.current = volume
  playMethodRef.current = playMethod

  // ---- System-volume / real-brightness bridge (mobile) ---------------------
  const lastLocalVolumeSetRef = useRef(0)
  const sysVolThrottleRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null; pending: number }>({ last: 0, timer: null, pending: 1 })
  // Single entry point for every volume control (swipe, wheel, keys, slider):
  // updates the UI state and, on mobile, the OS volume (throttled — gestures
  // fire per-frame, and each set is an IPC round trip).
  const applyVolume = useCallback((v: number) => {
    setVolume(v)
    if (!SYSTEM_VOLUME_SUPPORTED) return
    lastLocalVolumeSetRef.current = Date.now()
    const t = sysVolThrottleRef.current
    t.pending = v
    const now = Date.now()
    if (now - t.last >= 80) {
      t.last = now
      setSystemVolume(v)
    } else if (!t.timer) {
      t.timer = setTimeout(() => {
        t.timer = null
        t.last = Date.now()
        setSystemVolume(sysVolThrottleRef.current.pending)
      }, 90)
    }
  }, [])

  const brightThrottleRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null; pending: number }>({ last: 0, timer: null, pending: 1 })
  const applyBrightness = useCallback((b: number) => {
    setBrightness(b)
    if (!SCREEN_BRIGHTNESS_SUPPORTED) return
    const t = brightThrottleRef.current
    t.pending = b
    const now = Date.now()
    if (now - t.last >= 80) {
      t.last = now
      setScreenBrightness(b)
    } else if (!t.timer) {
      t.timer = setTimeout(() => {
        t.timer = null
        t.last = Date.now()
        setScreenBrightness(brightThrottleRef.current.pending)
      }, 90)
    }
  }, [])

  // Init the volume UI from the OS and follow external changes (hardware
  // buttons) while the player is open.
  useEffect(() => {
    if (!SYSTEM_VOLUME_SUPPORTED) return
    let mounted = true
    getSystemVolume().then((v) => {
      if (mounted && v !== null) setVolume(v)
    })
    const unsubscribe = subscribeSystemVolume((v) => {
      // Ignore echoes of our own writes (iOS snaps to 1/16 steps, which would
      // otherwise fight an in-progress swipe).
      if (Date.now() - lastLocalVolumeSetRef.current < 500) return
      setVolume(v)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  // Real screen brightness: start from the current level, hand control back
  // when the player closes (iOS writes persist system-wide — restore needs
  // the captured original; Android just drops the window override).
  useEffect(() => {
    if (!SCREEN_BRIGHTNESS_SUPPORTED) return
    let original: number | null = null
    getScreenBrightness().then((b) => {
      original = b
      if (b !== null) setBrightness(b)
    })
    return () => restoreScreenBrightness(original)
  }, [])

  // Sleep timer: register pause/fade handlers for the 'video' target while the
  // player is open. Minute-timer expiry pauses via these; the fade scales the
  // element volume directly (the [volume] sync effect restores it on change).
  useEffect(() => {
    const handlers: SleepTimerHandlers = {
      pause: () => videoRef.current?.pause(),
      setFade: (scale) => {
        const v = videoRef.current
        // Mobile: element volume is pinned to 1 (system volume rules) — fade
        // scales from 1 so the ramp still works where the engine honors it.
        if (v) v.volume = Math.max(0, Math.min(1, (SYSTEM_VOLUME_SUPPORTED ? 1 : volumeRef.current) * scale))
      },
    }
    useSleepTimer.getState().registerHandlers('video', handlers)
    return () => {
      useSleepTimer.getState().unregisterHandlers('video', handlers)
      // A video timer with no player to pause would just expire silently —
      // cancel it when the player closes.
      const timer = useSleepTimer.getState()
      if (timer.target === 'video') timer.cancel()
    }
  }, [])

  // Subtitle rendering is handled by libass (useSubtitleRenderer above); the
  // browser's native <track> text-track machinery is no longer used.

  // EFFECT 1: Video Source Management
  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoUrl) return
    if (video.src === videoUrl) return
    try {
      const currentPath = new URL(video.src).pathname
      const newPath = new URL(videoUrl, window.location.origin).pathname
      if (currentPath === newPath) return
    } catch {}

    hasResumedRef.current = false
    isInitialLoadRef.current = false
    hasAutoPlayedRef.current = false
    video.src = videoUrl
    video.load()
  }, [videoUrl])

  // EFFECT 2: Event Listeners
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleLoadedMetadata = () => {
      setDuration(video.duration)
      if (!hasResumedRef.current) {
        const seekTime = pendingSeekTimeRef.current
        const resumePos = effectiveResumePositionRef.current
        if (seekTime !== null && seekTime > 0) {
          video.currentTime = seekTime
          pendingSeekTimeRef.current = null
          setPendingSeekTime(null)
        } else if (resumePos > 0) {
          video.currentTime = resumePos / 10000000
          // Offer "Start from beginning" once per item (not again after a retry)
          if (resumePos / 10000000 > 30 && startOverItemRef.current !== itemIdRef.current) {
            startOverItemRef.current = itemIdRef.current
            setStartOverVisible(true)
            clearTimeout(startOverTimerRef.current)
            startOverTimerRef.current = setTimeout(() => setStartOverVisible(false), 8000)
          }
        }
        hasResumedRef.current = true
      }
    }

    const handleCanPlayThrough = () => {
      setIsLoading(false)
      if (loadingTimeoutRef.current) { clearTimeout(loadingTimeoutRef.current); loadingTimeoutRef.current = null }
      // Start playback once per source. canplaythrough fires again after every
      // re-buffer, and an unconditional play() there force-resumed a video the
      // user had deliberately paused.
      if (hasAutoPlayedRef.current) return
      hasAutoPlayedRef.current = true
      video.play().catch(() => {})
    }

    // timeupdate fires ~4x/sec. Pushing it into React state re-renders the whole
    // player tree (including the controls, which stay mounted while hidden) and
    // that main-thread work competes with frame presentation — it shows up as
    // climbing dropped frames even on DirectPlay over a LAN. While the controls
    // are hidden nothing on screen shows sub-second time, so the clock only has
    // to be accurate enough for the skip-intro and up-next checks (~1s).
    const handleTimeUpdate = () => {
      const t = video.currentTime
      lastKnownTimeRef.current = t
      currentTimeRef.current = t

      const controlsVisible = showControlsRef.current
      if (controlsVisible || Math.abs(t - lastPushedTimeRef.current) >= 1) {
        lastPushedTimeRef.current = t
        setCurrentTime(t)
      }

      // The buffer bar only exists inside the controls — don't compute or
      // publish it while they're hidden.
      if (!controlsVisible) return
      if (video.buffered.length > 0 && video.duration > 0) {
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= t && video.buffered.end(i) >= t) {
            setBufferedPercent((video.buffered.end(i) / video.duration) * 100)
            break
          }
        }
      }
    }

    const handlePlay = () => {
      playingItemIdRef.current = itemIdRef.current ?? null
      setIsPlaying(true)
    }
    const handlePause = () => setIsPlaying(false)
    const handleError = () => {
      // Direct play over-promised (canPlayType / MediaCapabilities can lie):
      // retry once as a server transcode before showing an error
      if (!isPlayingLocally && playMethodRef.current !== 'Transcode' && !autoTranscodeTriedRef.current) {
        autoTranscodeTriedRef.current = true
        console.warn('[JellyfinPlayer] Direct play failed, retrying with a transcode')
        retryPlaybackRef.current(true)
        return
      }
      setError('Failed to load video')
      setIsLoading(false)
    }
    const handleWaiting = () => setIsLoading(true)
    const handleCanPlay = () => {
      setIsLoading(false)
      if (loadingTimeoutRef.current) { clearTimeout(loadingTimeoutRef.current); loadingTimeoutRef.current = null }
    }
    const handleEnded = () => {
      setIsPlaying(false)

      // Mark item as played (works offline by queuing, online by sending directly)
      if (item.Id && api?.accessToken && serverUrl) {
        const settings = loadSettings()
        const serverId = settings.activeJellyfinServerId || 'default'
        const userId = user?.Id || ''
        if (!navigator.onLine) {
          // Queue for when server comes back
          addToJellyfinQueue({
            type: 'video_played',
            itemId: item.Id,
            serverId,
            serverUrl,
            token: api.accessToken,
            userId,
            timestamp: Date.now(),
          })
        } else {
          // Mark played immediately (request resolves with success:false on
          // network errors — must check the result, not just .catch())
          appApi.request({
            method: 'POST',
            url: `${serverUrl}/UserPlayedItems/${item.Id}`,
            headers: { 'Authorization': `MediaBrowser Token="${api.accessToken}"` },
          }).then(res => {
            if (!res.success) {
              addToJellyfinQueue({ type: 'video_played', itemId: item.Id!, serverId, serverUrl, token: api!.accessToken!, userId, timestamp: Date.now() })
            }
          }).catch(() => {
            // Queue on failure
            addToJellyfinQueue({ type: 'video_played', itemId: item.Id!, serverId, serverUrl, token: api!.accessToken!, userId, timestamp: Date.now() })
          })
        }
      }

      // Sleep timer "end of current episode": consume the timer and stop here
      // (suppresses the auto-advance exactly once, then the timer is cleared)
      if (useSleepTimer.getState().consumeEndOfItem('video')) return

      autoAdvanceRef.current()
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('canplaythrough', handleCanPlayThrough)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('error', handleError)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('ended', handleEnded)

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('canplaythrough', handleCanPlayThrough)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('error', handleError)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('ended', handleEnded)
    }
  }, [videoUrl])

  // Up Next dialog: from the start of the credits when the server knows
  // them (Outro segment / credits chapter), else a fixed time before the end
  const upNextAt = creditsStart ?? (duration ? duration - CREDITS_THRESHOLD_SECONDS : null)
  useEffect(() => {
    if (!nextEpisode || !duration || upNextDismissed || upNextAt === null) return
    // Sleep timer will stop after this episode — don't tease the next one
    if (sleepEndOfEpisode) {
      if (showUpNext) setShowUpNext(false)
      return
    }
    const timeRemaining = duration - currentTime
    const shouldShow = currentTime >= upNextAt && timeRemaining > 0 && isPlaying
    if (shouldShow && !showUpNext) setShowUpNext(true)
    // Seeked back out of the credits
    else if (showUpNext && currentTime < upNextAt - 1) setShowUpNext(false)
  }, [currentTime, duration, nextEpisode, isPlaying, showUpNext, upNextDismissed, sleepEndOfEpisode, upNextAt])

  // Report playback start.
  // IMPORTANT: playbackStartedRef gates the progress reporter AND the stop
  // handler. It must be set even when offline or when the server call fails —
  // otherwise offline sessions never queue any progress at all.
  useEffect(() => {
    if (!item.Id || !isPlaying || playbackStartedRef.current || !api?.accessToken || !serverUrl) return
    // Only once THIS item's media plays (not the previous episode still
    // running while the new PlaybackInfo loads)
    if (playingItemIdRef.current !== item.Id) return
    playbackStartedRef.current = true
    if (!navigator.onLine) return  // Offline: session is "started" locally, no server report
    const reportStart = async () => {
      try {
        await appApi.request({
          method: 'POST', url: `${serverUrl}/Sessions/Playing`,
          headers: { 'Content-Type': 'application/json', 'Authorization': `MediaBrowser Token="${api.accessToken}"` },
          data: { ItemId: item.Id, MediaSourceId: mediaSourceId || item.Id, PlaySessionId: playSessionId, PositionTicks: Math.floor(currentTime * 10000000), VolumeLevel: Math.round(volume * 100), IsMuted: isMuted, IsPaused: false, PlayMethod: playMethod, RepeatMode: 'RepeatNone' },
        })
      } catch {}
    }
    reportStart()
  }, [item.Id, isPlaying, api?.accessToken, serverUrl, currentTime, mediaSourceId, playSessionId, volume, isMuted, playMethod])

  // Report progress every 10s
  useEffect(() => {
    if (!item.Id || !api?.accessToken || !serverUrl) return
    const reportProgress = async () => {
      if (!playbackStartedRef.current) return
      // Read the live position from a ref: having currentTime in this effect's
      // deps rebuilt the interval on every timeupdate (~4x/sec), so the 10s
      // timer never once reached 10s and progress was only ever reported on
      // pause/play transitions and on unmount.
      const positionTicks = Math.floor(currentTimeRef.current * 10000000)
      const settings = loadSettings()
      const serverId = settings.activeJellyfinServerId || 'default'

      if (navigator.onLine) {
        try {
          // NOTE: appApi.request resolves with success:false on network errors
          // (it does NOT throw) — the result must be checked explicitly or
          // unreachable-server progress is silently dropped.
          const res = await appApi.request({
            method: 'POST', url: `${serverUrl}/Sessions/Playing/Progress`,
            headers: { 'Content-Type': 'application/json', 'Authorization': `MediaBrowser Token="${api.accessToken}"` },
            data: { ItemId: item.Id, MediaSourceId: mediaSourceId || item.Id, PlaySessionId: playSessionId, PositionTicks: positionTicks, VolumeLevel: Math.round(volume * 100), IsMuted: isMuted, IsPaused: !isPlaying, PlayMethod: playMethod, RepeatMode: 'RepeatNone' },
          })
          if (!res.success) {
            addPendingProgress(item.Id!, serverId, serverUrl, api.accessToken!, positionTicks)
          }
        } catch {
          addPendingProgress(item.Id!, serverId, serverUrl, api.accessToken!, positionTicks)
        }
      } else {
        addPendingProgress(item.Id!, serverId, serverUrl, api.accessToken!, positionTicks)
      }
    }
    if (lastReportedPausedRef.current !== null && lastReportedPausedRef.current !== !isPlaying) reportProgress()
    lastReportedPausedRef.current = !isPlaying
    if (!isPlaying) return
    const interval = setInterval(reportProgress, 10000)
    return () => clearInterval(interval)
  }, [api?.accessToken, serverUrl, item.Id, isPlaying, mediaSourceId, playSessionId, volume, isMuted, playMethod])

  // Report playback stopped on unmount
  useEffect(() => {
    const capturedItemId = item.Id, capturedServerUrl = serverUrl, capturedAccessToken = api?.accessToken
    const capturedMediaSourceId = mediaSourceId, capturedPlaySessionId = playSessionId, capturedPlayMethod = playMethod
    return () => {
      if (!capturedItemId || !capturedAccessToken || !capturedServerUrl) return
      const lastKnownTime = lastKnownTimeRef.current
      if (!playbackStartedRef.current || !lastKnownTime || isNaN(lastKnownTime) || lastKnownTime <= 0) {
        playbackStartedRef.current = false
        // Closed before playback got going: still end the server session so a
        // transcode started by PlaybackInfo/HLS stops now instead of at the
        // server's timeout. Failed=true keeps the watch state untouched —
        // a Stopped report without a position would mark the item played.
        if (capturedPlaySessionId && navigator.onLine) {
          appApi.request({
            method: 'POST', url: `${capturedServerUrl}/Sessions/Playing/Stopped`,
            headers: { 'Content-Type': 'application/json', 'Authorization': `MediaBrowser Token="${capturedAccessToken}"` },
            data: { ItemId: capturedItemId, MediaSourceId: capturedMediaSourceId || capturedItemId, PlaySessionId: capturedPlaySessionId, Failed: true },
          }).catch(() => { /* best effort */ })
        }
        return
      }
      const finalPositionTicks = Math.floor(lastKnownTime * 10000000)
      const settings = loadSettings()
      const serverId = settings.activeJellyfinServerId || 'default'
      if (navigator.onLine) {
        // Queue the position FIRST — if the report succeeds we clear it again.
        // This way the position survives even if the app quits before the
        // request settles (request resolves with success:false, never throws).
        addPendingProgress(capturedItemId!, serverId, capturedServerUrl, capturedAccessToken!, finalPositionTicks)
        appApi.request({
          method: 'POST', url: `${capturedServerUrl}/Sessions/Playing/Stopped`,
          headers: { 'Content-Type': 'application/json', 'Authorization': `MediaBrowser Token="${capturedAccessToken}"` },
          data: { ItemId: capturedItemId, MediaSourceId: capturedMediaSourceId || capturedItemId, PlaySessionId: capturedPlaySessionId, PositionTicks: finalPositionTicks, PlayMethod: capturedPlayMethod },
        }).then(res => {
          if (res.success) clearPendingProgress(capturedItemId!)
        }).catch(() => { /* stays queued for the next sync */ })
      } else {
        addPendingProgress(capturedItemId!, serverId, capturedServerUrl, capturedAccessToken!, finalPositionTicks)
      }
      playbackStartedRef.current = false
    }
  }, [item.Id, api?.accessToken, serverUrl, mediaSourceId, playSessionId, playMethod])

  // Auto-hide controls (desktop: mouse-driven; phone uses the tap-toggle effect below)
  useEffect(() => {
    if (IS_PHONE) return
    const startHideTimer = () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current)
      controlsTimeoutRef.current = setTimeout(() => { if (isPlaying) setShowControls(false) }, 3000)
    }
    const handleMouseMove = () => { setShowControls(true); startHideTimer() }
    const handleMouseLeave = () => { if (isPlaying) { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); setShowControls(false) } }
    const handleMouseEnter = () => { setShowControls(true); startHideTimer() }

    const container = containerRef.current
    container?.addEventListener('mousemove', handleMouseMove)
    container?.addEventListener('mouseleave', handleMouseLeave)
    container?.addEventListener('mouseenter', handleMouseEnter)
    if (isPlaying) startHideTimer()

    return () => {
      container?.removeEventListener('mousemove', handleMouseMove)
      container?.removeEventListener('mouseleave', handleMouseLeave)
      container?.removeEventListener('mouseenter', handleMouseEnter)
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current)
    }
  }, [isPlaying])

  // Phone: auto-hide controls 3s after they were shown. Taps toggle them (see
  // handleVideoAreaClick); the mouse-driven effect above is disabled on phone
  // because WebViews synthesize mouse events from taps, which would instantly
  // re-show controls the user just tapped away.
  // Any touch restarts the countdown, and the controls never hide while a
  // finger is down (scrubbing the progress bar, scrolling the chapter list).
  const [controlsTouchTick, setControlsTouchTick] = useState(0)
  const fingerDownRef = useRef(false)
  useEffect(() => {
    if (!IS_PHONE) return
    const container = containerRef.current
    if (!container) return
    const down = () => { fingerDownRef.current = true; setControlsTouchTick(n => n + 1) }
    const up = (e: TouchEvent) => {
      if (e.touches.length > 0) return
      fingerDownRef.current = false
      setControlsTouchTick(n => n + 1)
    }
    container.addEventListener('touchstart', down, { passive: true, capture: true })
    container.addEventListener('touchend', up, { passive: true, capture: true })
    container.addEventListener('touchcancel', up, { passive: true, capture: true })
    return () => {
      container.removeEventListener('touchstart', down, { capture: true })
      container.removeEventListener('touchend', up, { capture: true })
      container.removeEventListener('touchcancel', up, { capture: true })
    }
  }, [])
  useEffect(() => {
    if (!IS_PHONE) return
    if (!showControls || !isPlaying || isLocked) return
    const timeout = setTimeout(() => {
      if (!fingerDownRef.current) setShowControls(false)
    }, 3000)
    return () => clearTimeout(timeout)
  }, [showControls, isPlaying, isLocked, controlsTouchTick])

  // Phone: rotate to landscape while the player is open (Android/Chromium; iOS
  // WKWebView ignores it — see utils/orientation.ts). Restored on unmount.
  useEffect(() => {
    if (!IS_PHONE) return
    lockLandscape()
    return () => unlockOrientation()
  }, [])

  // Phone vertical-swipe zones: right third ↕ = volume, left third ↕ = dim.
  // Attached natively so touchmove can be non-passive (preventDefault stops the
  // gesture from being interpreted as a scroll/tap). Mid third is left to taps.
  useEffect(() => {
    if (!IS_PHONE) return
    const container = containerRef.current
    if (!container) return

    const SLOP = 10          // px before we commit to an axis
    const EDGE = 24          // ignore left screen edge (belongs to swipe-back)
    const RANGE = 0.6        // fraction of screen height for a full 0→1 sweep

    const showVol = () => {
      setShowVolumeOverlay(true)
      if (volumeOverlayTimeoutRef.current) clearTimeout(volumeOverlayTimeoutRef.current)
      volumeOverlayTimeoutRef.current = setTimeout(() => setShowVolumeOverlay(false), 1000)
    }
    const showBright = () => {
      setShowBrightnessOverlay(true)
      if (brightnessOverlayTimeoutRef.current) clearTimeout(brightnessOverlayTimeoutRef.current)
      brightnessOverlayTimeoutRef.current = setTimeout(() => setShowBrightnessOverlay(false), 1000)
    }

    const onStart = (e: TouchEvent) => {
      // A finished swipe's click never came (no click after a moved touch) —
      // don't let the stale flag eat this new tap
      swipeConsumedTapRef.current = false
      if (isLockedRef.current || e.touches.length !== 1) return
      const t = e.touches[0]
      const w = container.clientWidth
      const zone: 'left' | 'mid' | 'right' =
        t.clientX < w / 3 ? 'left' : t.clientX > (w * 2) / 3 ? 'right' : 'mid'
      const g = vSwipeRef.current
      g.active = false
      g.axis = null
      g.zone = zone
      g.startX = t.clientX
      g.startY = t.clientY
      g.startValue = zone === 'right' ? volumeRef.current : brightnessRef.current
    }

    const onMove = (e: TouchEvent) => {
      const g = vSwipeRef.current
      if (isLockedRef.current || g.zone === 'mid') return
      const t = e.touches[0]
      const dx = t.clientX - g.startX
      const dy = t.clientY - g.startY

      if (g.axis === null) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        // Left-edge horizontal drags belong to the back gesture; bail out
        if (g.zone === 'left' && g.startX < EDGE && Math.abs(dx) > Math.abs(dy)) {
          g.zone = 'mid'
          return
        }
        g.axis = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h'
        if (g.axis !== 'v') { g.zone = 'mid'; return } // horizontal → not ours
        g.active = true
      }
      if (g.axis !== 'v') return

      e.preventDefault() // own the gesture: no scroll, no follow-up tap
      // Swipe up (negative dy) increases the value
      const delta = (-dy / container.clientHeight) / RANGE
      const next = Math.max(0, Math.min(1, g.startValue + delta))
      if (g.zone === 'right') {
        applyVolume(next)
        if (next > 0 && isMutedRef.current) setIsMuted(false)
        showVol()
      } else {
        applyBrightness(next)
        showBright()
      }
    }

    const onEnd = () => {
      const g = vSwipeRef.current
      if (g.active) swipeConsumedTapRef.current = true
      g.active = false
      g.axis = null
      g.zone = 'mid'
    }

    container.addEventListener('touchstart', onStart, { passive: true })
    container.addEventListener('touchmove', onMove, { passive: false })
    container.addEventListener('touchend', onEnd)
    container.addEventListener('touchcancel', onEnd)
    return () => {
      container.removeEventListener('touchstart', onStart)
      container.removeEventListener('touchmove', onMove)
      container.removeEventListener('touchend', onEnd)
      container.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  // Apply the speed; a new source resets playbackRate to defaultPlaybackRate,
  // so set both and re-apply once the new stream's metadata is in
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const apply = () => {
      video.defaultPlaybackRate = playbackRate
      if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate
    }
    apply()
    video.addEventListener('loadedmetadata', apply)
    return () => video.removeEventListener('loadedmetadata', apply)
  }, [playbackRate, videoUrl])

  // The player owns Space/arrows while open (no music hotkeys underneath)
  useEffect(() => claimMediaKeys(), [])

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current
      if (!video) return
      // "Are you still watching?" is up: Enter/Space/Tab go to its buttons
      if (stillWatchingRef.current && e.key !== 'Escape') return
      // Already handled (an open popover closed itself on Esc)
      if (e.defaultPrevented) return
      // Shortcuts with modifiers belong to the app (Ctrl+K search, …)
      if (e.ctrlKey || e.metaKey || e.altKey) return
      // Typing / choosing in a field: arrows move the selection, not the video
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        if (e.key !== 'Escape') return
      }
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); isPlaying ? video.pause() : video.play(); break
        case 'ArrowLeft': video.currentTime = Math.max(0, video.currentTime - seekBackSeconds); break
        case 'ArrowRight': video.currentTime = Math.min(duration, video.currentTime + seekForwardSeconds); break
        case 'ArrowUp': applyVolume(Math.min(1, volume + 0.1)); break
        case 'ArrowDown': applyVolume(Math.max(0, volume - 0.1)); break
        case 'm': setIsMuted(!isMuted); break
        case 'f': toggleFullscreen(); break
        case 'Escape': if (isFullscreen) document.exitFullscreen(); else onClose(); break
        case 'i': setShowStats(prev => !prev); break
        case '>': setPlaybackRate(stepPlaybackRate(playbackRate, 1), true); break
        case '<': setPlaybackRate(stepPlaybackRate(playbackRate, -1), true); break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPlaying, volume, isMuted, duration, isFullscreen, onClose, seekBackSeconds, seekForwardSeconds, playbackRate, setPlaybackRate])

  // Fullscreen change
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // PiP events
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const enterPiP = () => setIsPictureInPicture(true)
    const leavePiP = () => setIsPictureInPicture(false)
    video.addEventListener('enterpictureinpicture', enterPiP)
    video.addEventListener('leavepictureinpicture', leavePiP)
    return () => { video.removeEventListener('enterpictureinpicture', enterPiP); video.removeEventListener('leavepictureinpicture', leavePiP) }
  }, [playSessionId]) // re-bind to the remounted <video> of a new play session

  // MediaSession API — the fullscreen player owns the OS media session while
  // mounted; on unmount it releases so music/audiobook metadata returns
  // (previously the video's metadata lingered on the lock screen forever).
  const seekSecondsRef = useRef({ back: seekBackSeconds, forward: seekForwardSeconds })
  seekSecondsRef.current = { back: seekBackSeconds, forward: seekForwardSeconds }
  const mediaNextRef = useRef<() => void>(() => {})
  const mediaPrevRef = useRef<() => void>(() => {})
  const hasNextEpisode = !!nextEpisode
  const hasPreviousEpisode = !!previousEpisode
  useEffect(() => {
    if (!('mediaSession' in navigator) || !item) return
    claimMediaSession('video')
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.Name || 'Video',
      artist: item.SeriesName || '',
      album: item.SeriesName ? `S${item.ParentIndexNumber}:E${item.IndexNumber}` : '',
      artwork: serverUrl && item.Id ? [{ src: `${serverUrl}/Items/${item.Id}/Images/Primary?maxWidth=512`, sizes: '512x512', type: 'image/jpeg' }] : [],
    })
    navigator.mediaSession.setActionHandler('play', () => videoRef.current?.play())
    navigator.mediaSession.setActionHandler('pause', () => videoRef.current?.pause())
    // Seek steps follow the user's seek settings (the OS may pass its own offset)
    navigator.mediaSession.setActionHandler('seekbackward', (d) => {
      const v = videoRef.current
      if (v) v.currentTime = Math.max(0, v.currentTime - (d.seekOffset || seekSecondsRef.current.back))
    })
    navigator.mediaSession.setActionHandler('seekforward', (d) => {
      const v = videoRef.current
      if (v) v.currentTime = Math.min(Number.isFinite(v.duration) ? v.duration : Infinity, v.currentTime + (d.seekOffset || seekSecondsRef.current.forward))
    })
    navigator.mediaSession.setActionHandler('seekto', (d) => { if (videoRef.current && d.seekTime !== undefined) videoRef.current.currentTime = d.seekTime })
    // Next/previous track keys = next/previous episode
    try {
      navigator.mediaSession.setActionHandler('nexttrack', hasNextEpisode ? () => mediaNextRef.current() : null)
      navigator.mediaSession.setActionHandler('previoustrack', hasPreviousEpisode ? () => mediaPrevRef.current() : null)
    } catch { /* action not supported */ }
    return () => {
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('seekbackward', null)
      navigator.mediaSession.setActionHandler('seekforward', null)
      navigator.mediaSession.setActionHandler('seekto', null)
      try {
        navigator.mediaSession.setActionHandler('nexttrack', null)
        navigator.mediaSession.setActionHandler('previoustrack', null)
      } catch { /* action not supported */ }
    }
  }, [item, serverUrl, hasNextEpisode, hasPreviousEpisode])

  // Play/pause only updates the state (used to rebuild metadata + artwork)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  }, [isPlaying, item])

  // MediaSession position state
  useEffect(() => {
    if (!('mediaSession' in navigator) || !duration) return
    const rate = videoRef.current?.playbackRate || 1
    try { navigator.mediaSession.setPositionState({ duration, playbackRate: rate, position: Math.min(currentTime, duration) }) } catch {}
  }, [currentTime, duration, playbackRate, holdBoost])

  // Release the OS media session on unmount (clears metadata and lets a
  // paused music/audiobook player take the lock screen back).
  useEffect(() => () => releaseMediaSession('video'), [])

  // Mirror showControls into a ref for handleTimeUpdate (which is attached once
  // per source), and resync the displayed clock the moment they reappear so the
  // throttled value above can't show up to a second stale.
  useEffect(() => {
    showControlsRef.current = showControls
    if (showControls) {
      const video = videoRef.current
      if (video) {
        lastPushedTimeRef.current = video.currentTime
        setCurrentTime(video.currentTime)
      }
    }
  }, [showControls])

  // Stats for Nerds
  useEffect(() => {
    if (!showStats) return
    const collectStats = () => {
      const video = videoRef.current
      if (!video) return
      const quality = (video as any).getVideoPlaybackQuality?.()
      const ms = fetchedMediaSources?.[0]
      const videoStream = ms?.MediaStreams?.find(s => s.Type === 'Video')
      const audioStream = ms?.MediaStreams?.find(s => s.Type === 'Audio' && s.Index === selectedAudioIndex)
      let bufferedSeconds = 0
      if (video.buffered.length > 0) {
        const idx = Array.from({ length: video.buffered.length }).findIndex((_, i) => video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime)
        if (idx >= 0) bufferedSeconds = video.buffered.end(idx) - video.currentTime
      }
      setVideoStats({
        resolution: `${video.videoWidth}x${video.videoHeight}`,
        videoCodec: videoStream?.Codec?.toUpperCase() || 'Unknown',
        audioCodec: audioStream?.Codec?.toUpperCase() || 'Unknown',
        container: ms?.Container?.toUpperCase() || 'Unknown',
        bitrate: 0,
        playMethod,
        buffered: Math.round(bufferedSeconds),
        droppedFrames: quality?.droppedVideoFrames || 0,
        decodedFrames: quality?.totalVideoFrames || 0,
      })
    }
    collectStats()
    const interval = setInterval(collectStats, 1000)
    return () => clearInterval(interval)
  }, [showStats, fetchedMediaSources, selectedAudioIndex, playMethod])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current)
      if (singleTapTimeoutRef.current) clearTimeout(singleTapTimeoutRef.current)
      if (seekIndicatorTimeoutRef.current) clearTimeout(seekIndicatorTimeoutRef.current)
      if (volumeOverlayTimeoutRef.current) clearTimeout(volumeOverlayTimeoutRef.current)
      if (brightnessOverlayTimeoutRef.current) clearTimeout(brightnessOverlayTimeoutRef.current)
    }
  }, [])

  // ==================== CALLBACKS ====================

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen()
    else containerRef.current?.requestFullscreen()
  }, [])

  const togglePictureInPicture = useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await video.requestPictureInPicture()
    } catch {}
  }, [])

  // Phone tap gestures: double-tap left/right third seeks back/forward with
  // YouTube-style accumulation (rapid re-taps on the same side keep adding
  // ±step while the chain window is open); double-tap middle toggles
  // play/pause; single tap toggles the controls (after the double-tap window).
  const handlePhoneTap = useCallback((e: React.MouseEvent) => {
    if (isLockedRef.current) return
    // A vertical volume/brightness swipe synthesizes a trailing click — ignore it
    if (swipeConsumedTapRef.current) { swipeConsumedTapRef.current = false; return }
    const video = videoRef.current
    const container = containerRef.current
    if (!video || !container) return

    const DOUBLE_TAP_MS = 300
    const CHAIN_WINDOW_MS = 900

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const zone: 'left' | 'mid' | 'right' =
      x < rect.width / 3 ? 'left' : x > (rect.width * 2) / 3 ? 'right' : 'mid'
    const now = Date.now()
    const tap = phoneTapStateRef.current

    const cancelSingleTap = () => {
      if (singleTapTimeoutRef.current) { clearTimeout(singleTapTimeoutRef.current); singleTapTimeoutRef.current = null }
    }

    const doSeek = (side: 'left' | 'right') => {
      const step = side === 'left' ? seekBackSeconds : seekForwardSeconds
      const max = isFinite(video.duration) ? video.duration : Infinity
      video.currentTime = side === 'left'
        ? Math.max(0, video.currentTime - step)
        : Math.min(max, video.currentTime + step)
      tap.accumulated += step
      tap.chainSide = side
      tap.chainUntil = now + CHAIN_WINDOW_MS
      setSeekIndicator({ side, amount: Math.round(tap.accumulated), tapId: now })
      if (seekIndicatorTimeoutRef.current) clearTimeout(seekIndicatorTimeoutRef.current)
      seekIndicatorTimeoutRef.current = setTimeout(() => {
        setSeekIndicator(null)
        phoneTapStateRef.current.chainSide = null
        phoneTapStateRef.current.accumulated = 0
      }, CHAIN_WINDOW_MS)
    }

    const chainActive = tap.chainSide !== null && now < tap.chainUntil
    const isDoubleTap = now - tap.lastTapTime < DOUBLE_TAP_MS && tap.lastZone === zone

    if (chainActive && zone !== 'mid' && zone === tap.chainSide) {
      // Continue an active seek chain with single taps on the same side
      cancelSingleTap()
      doSeek(zone)
    } else if (isDoubleTap) {
      cancelSingleTap()
      if (zone === 'mid') {
        isPlaying ? video.pause() : video.play()
      } else {
        tap.accumulated = 0
        doSeek(zone)
      }
    } else {
      // Possible single tap — wait out the double-tap window, then toggle controls
      cancelSingleTap()
      singleTapTimeoutRef.current = setTimeout(() => {
        singleTapTimeoutRef.current = null
        setShowControls(prev => !prev)
      }, DOUBLE_TAP_MS)
    }

    tap.lastTapTime = now
    tap.lastZone = zone
  }, [isPlaying, seekBackSeconds, seekForwardSeconds])

  // Long-press = 2× while held. Moving the finger/mouse first cancels it (so
  // the phone swipe zones keep working); releasing restores the saved speed.
  const HOLD_DELAY_MS = 450
  const HOLD_RATE = 2
  const endHold = useCallback(() => {
    const h = holdRef.current
    if (h.timer) { clearTimeout(h.timer); h.timer = null }
    if (!h.active) return
    h.active = false
    // The release would otherwise count as a click (pause / controls toggle)
    h.swallowClick = true
    setTimeout(() => { h.swallowClick = false }, 400)
    const v = videoRef.current
    if (v) v.playbackRate = playbackRateRef.current
    setHoldBoost(false)
  }, [])
  const handleHoldStart = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary || isLockedRef.current) return
    const v = videoRef.current
    if (!v || v.paused || playbackRateRef.current >= HOLD_RATE) return
    const h = holdRef.current
    h.x = e.clientX
    h.y = e.clientY
    if (h.timer) clearTimeout(h.timer)
    h.timer = setTimeout(() => {
      h.timer = null
      const vid = videoRef.current
      if (!vid || vid.paused) return
      h.active = true
      vid.playbackRate = HOLD_RATE
      setHoldBoost(true)
    }, HOLD_DELAY_MS)
  }, [])
  const handleHoldMove = useCallback((e: React.PointerEvent) => {
    const h = holdRef.current
    if (h.timer && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 12) { clearTimeout(h.timer); h.timer = null }
  }, [])
  useEffect(() => () => { if (holdRef.current.timer) clearTimeout(holdRef.current.timer) }, [])
  // A new source resets the element's rate — drop a boost that was running
  useEffect(() => { endHold() }, [videoUrl, endHold])

  const handleVideoAreaClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, [role="button"]')) return
    if (holdRef.current.swallowClick) { holdRef.current.swallowClick = false; return }
    if (IS_PHONE) { handlePhoneTap(e); return }
    if (e.detail === 2) {
      if (clickTimeoutRef.current) { clearTimeout(clickTimeoutRef.current); clickTimeoutRef.current = null }
      toggleFullscreen()
    } else if (e.detail === 1) {
      clickTimeoutRef.current = setTimeout(() => {
        if (videoRef.current) { isPlaying ? videoRef.current.pause() : videoRef.current.play() }
        clickTimeoutRef.current = null
      }, 200)
    }
  }, [isPlaying, toggleFullscreen, handlePhoneTap])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (!videoRef.current) return
    const delta = e.deltaY > 0 ? -0.02 : 0.02
    const newVolume = Math.max(0, Math.min(1, volume + delta))
    applyVolume(newVolume)
    if (newVolume > 0 && isMuted) setIsMuted(false)
    setShowVolumeOverlay(true)
    if (volumeOverlayTimeoutRef.current) clearTimeout(volumeOverlayTimeoutRef.current)
    volumeOverlayTimeoutRef.current = setTimeout(() => setShowVolumeOverlay(false), 1200)
  }, [volume, isMuted])

  // The skip button for the segment playing right now. Credits get no button
  // while Up Next handles them, nor when nothing follows them.
  const activeSkip = useMemo(() => {
    const seg = skipSegments.find(s => currentTime >= s.start && currentTime < s.end - 1)
    if (!seg) return null
    if (seg.type === 'Outro') {
      if (nextEpisode && !upNextDismissed && !sleepEndOfEpisode) return null
      if (duration > 0 && seg.end >= duration - 3) return null
    }
    return seg
  }, [skipSegments, currentTime, nextEpisode, upNextDismissed, sleepEndOfEpisode, duration])

  const handleSkipIntro = useCallback(() => {
    if (videoRef.current && activeSkip) videoRef.current.currentTime = activeSkip.end
  }, [activeSkip])

  const handlePlayNext = useCallback(() => {
    // Chosen by the user — the "still watching" count starts over
    autoAdvanceCountRef.current = 0
    if (nextEpisode && onPlayNext) { setShowUpNext(false); onPlayNext(nextEpisode) }
  }, [nextEpisode, onPlayNext])

  const handlePlayPrevious = useCallback(() => {
    autoAdvanceCountRef.current = 0
    if (previousEpisode && onPlayNext) onPlayNext(previousEpisode)
  }, [previousEpisode, onPlayNext])
  mediaNextRef.current = handlePlayNext
  mediaPrevRef.current = handlePlayPrevious

  // Next episode without user input (credits countdown, end of the file).
  // After STILL_WATCHING_AFTER of those in a row, ask instead.
  autoAdvanceRef.current = () => {
    const next = nextEpisodeRef.current
    if (!next || !onPlayNextRef.current) return
    setShowUpNext(false)
    if (autoAdvanceCountRef.current >= STILL_WATCHING_AFTER) {
      videoRef.current?.pause()
      setStillWatching(true)
      return
    }
    autoAdvanceCountRef.current += 1
    onPlayNextRef.current(next)
  }

  const handleStillWatchingContinue = useCallback(() => {
    autoAdvanceCountRef.current = 0
    setStillWatching(false)
    const next = nextEpisodeRef.current
    if (next && onPlayNextRef.current) onPlayNextRef.current(next)
  }, [])

  // Any input counts as "still here"
  useEffect(() => {
    const reset = () => { autoAdvanceCountRef.current = 0 }
    const container = containerRef.current
    window.addEventListener('keydown', reset)
    container?.addEventListener('pointerdown', reset)
    container?.addEventListener('wheel', reset, { passive: true })
    return () => {
      window.removeEventListener('keydown', reset)
      container?.removeEventListener('pointerdown', reset)
      container?.removeEventListener('wheel', reset)
    }
  }, [])

  // Resuming playback (e.g. Space) answers the question as well
  useEffect(() => {
    if (isPlaying && stillWatching) setStillWatching(false)
  }, [isPlaying, stillWatching])

  const handleStartOver = useCallback(() => {
    if (videoRef.current) videoRef.current.currentTime = 0
    clearTimeout(startOverTimerRef.current)
    setStartOverVisible(false)
  }, [])
  useEffect(() => () => clearTimeout(startOverTimerRef.current), [])

  const handleDismissUpNext = useCallback(() => { setShowUpNext(false); setUpNextDismissed(true) }, [])

  // Up Next countdown. In the credits it runs for UP_NEXT_COUNTDOWN seconds
  // of playback (paused video = paused countdown) and then starts the next
  // episode. Without credits data it only shows the last seconds — the
  // natural end advances.
  const upNextFromCredits = creditsStart !== null
  useEffect(() => {
    if (!showUpNext || !upNextFromCredits) { setUpNextCountdown(null); return }
    setUpNextCountdown(c => c ?? UP_NEXT_COUNTDOWN)
  }, [showUpNext, upNextFromCredits])
  useEffect(() => {
    if (!showUpNext || !upNextFromCredits || !isPlaying) return
    const id = setInterval(() => setUpNextCountdown(c => (c === null ? null : Math.max(0, c - 1))), 1000)
    return () => clearInterval(id)
  }, [showUpNext, upNextFromCredits, isPlaying])
  useEffect(() => {
    if (upNextCountdown === 0 && showUpNext) autoAdvanceRef.current()
  }, [upNextCountdown, showUpNext])
  const upNextRing = upNextFromCredits
    ? (upNextCountdown !== null ? { left: upNextCountdown, total: UP_NEXT_COUNTDOWN } : null)
    : (duration > 0 && duration - currentTime <= UP_NEXT_END_RING
        ? { left: Math.max(0, Math.ceil(duration - currentTime)), total: UP_NEXT_END_RING }
        : null)

  const handleTogglePlay = useCallback(() => {
    if (videoRef.current) { isPlaying ? videoRef.current.pause() : videoRef.current.play() }
  }, [isPlaying])

  const handleSeekBack = useCallback(() => {
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - seekBackSeconds)
  }, [seekBackSeconds])

  const handleSeekForward = useCallback(() => {
    if (videoRef.current) videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + seekForwardSeconds)
  }, [duration, seekForwardSeconds])

  const handlePreviousChapter = useCallback(() => {
    if (!videoRef.current || chapters.length === 0) return
    const currentTicks = currentTime * 10000000
    let targetChapter: Chapter | null = null
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (chapters[i].StartPositionTicks < currentTicks - 30000000) { targetChapter = chapters[i]; break }
    }
    videoRef.current.currentTime = targetChapter ? targetChapter.StartPositionTicks / 10000000 : 0
  }, [chapters, currentTime])

  const handleNextChapter = useCallback(() => {
    if (!videoRef.current || chapters.length === 0) return
    const next = chapters.find(ch => ch.StartPositionTicks > currentTime * 10000000)
    if (next) videoRef.current.currentTime = next.StartPositionTicks / 10000000
  }, [chapters, currentTime])

  const handleChapterSelect = useCallback((chapter: Chapter) => {
    if (videoRef.current) videoRef.current.currentTime = chapter.StartPositionTicks / 10000000
  }, [])

  const handleVolumeChange = useCallback((v: number) => { applyVolume(v); setIsMuted(false) }, [applyVolume])
  const handleToggleMute = useCallback(() => setIsMuted(prev => !prev), [])

  const handleAudioTrackChange = useCallback(async (index: number) => {
    if (index === selectedAudioIndex) return
    // Remember for the following episodes of this series
    saveSeriesAudio(item.SeriesId, audioTracks.find(t => t.Index === index))
    const video = videoRef.current
    const currentTimeBeforeSwitch = video?.currentTime || 0
    setPendingSeekTime(currentTimeBeforeSwitch)
    pendingSeekTimeRef.current = currentTimeBeforeSwitch
    setSelectedAudioIndex(index)
    setIsLoading(true)
    if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current)
    loadingTimeoutRef.current = setTimeout(() => setIsLoading(false), 5000)
    video?.pause()

    const result = await fetchPlaybackInfoWithTrack(index, selectedSubtitleIndex, true)
    if (result) {
      setPlaySessionId(result.playSessionId)
      setPlaybackUrl(result.url)
      setMediaSourceId(result.mediaSourceId)
      setPlayMethod(result.playMethod)
    } else {
      setIsLoading(false)
      video?.play()
    }
  }, [selectedAudioIndex, selectedSubtitleIndex, audioTracks, item.SeriesId])

  const handleSubtitleTrackChange = useCallback((index: number) => {
    if (index === selectedSubtitleIndex) return
    saveSeriesSubtitle(item.SeriesId, index < 0 ? null : subtitleTracks.find(t => t.Index === index) || null)
    // Subtitles are delivered as an external stream and drawn by libass, fully
    // independent of the (possibly transcoding) video stream — so switching a
    // track is just a state change. No PlaybackInfo re-fetch, no video reload.
    setSelectedSubtitleIndex(index)
  }, [selectedSubtitleIndex, subtitleTracks, item.SeriesId])

  const handleToggleCaptions = useCallback(() => {
    if (selectedSubtitleIndex === -1) {
      const defaultSub = subtitleTracks.find(t => t.IsDefault) || subtitleTracks[0]
      if (defaultSub) handleSubtitleTrackChange(defaultSub.Index)
    } else {
      handleSubtitleTrackChange(-1)
    }
  }, [selectedSubtitleIndex, subtitleTracks, handleSubtitleTrackChange])

  // Retry: local files just reload. Streams request new PlaybackInfo — with a
  // forced transcode when a URL already failed (reloading the same direct-play
  // URL fails the same way, and an expired transcode session needs a new one).
  const retryPlayback = async (forceTranscode: boolean) => {
    setError(null)
    setIsLoading(true)
    if (isPlayingLocally) {
      videoRef.current?.load()
      return
    }
    const resumeAt = videoRef.current?.currentTime || lastKnownTimeRef.current || 0
    if (resumeAt > 0) {
      pendingSeekTimeRef.current = resumeAt
      setPendingSeekTime(resumeAt)
    }
    const forItem = item.Id
    const result = await fetchPlaybackInfoWithTrack(selectedAudioIndex, selectedSubtitleIndex, forceTranscode)
    if (itemIdRef.current !== forItem) return
    if (result) {
      hasResumedRef.current = false
      setFetchedMediaSources(result.mediaSources)
      setPlaySessionId(result.playSessionId)
      setPlaybackUrl(result.url)
      setMediaSourceId(result.mediaSourceId)
      setPlayMethod(result.playMethod)
    } else {
      setError('Could not reach the server')
      setIsLoading(false)
    }
  }
  retryPlaybackRef.current = (force) => { void retryPlayback(force) }

  const handleRetry = useCallback(() => {
    retryPlaybackRef.current(!!videoUrl)
  }, [videoUrl])

  // A downloaded file that fails to play is most likely truncated or corrupt:
  // drop it and queue a fresh download (the old file would fail every time).
  const handleRedownload = useCallback(async () => {
    if (!item.Id || !serverUrl || !api?.accessToken) return
    const serverId = loadSettings().activeJellyfinServerId || 'default'
    await deleteDownloadedMedia(item.Id)
    addToDownloadQueue(item, serverUrl, serverId, api.accessToken)
    onClose()
  }, [item, serverUrl, api, onClose])

  const handlePlayEpisode = useCallback((episode: BaseItemDto) => {
    if (onPlayNext) onPlayNext(episode)
  }, [onPlayNext])

  // Phone lock: freeze all touch input behind an overlay until unlocked
  const handleLock = useCallback(() => {
    setIsLocked(true)
    setShowControls(false)
  }, [])

  const handleUnlock = useCallback(() => {
    setIsLocked(false)
    setShowControls(true)
  }, [])

  const getEpisodeThumbnail = useCallback((episode: BaseItemDto) => {
    if (!serverUrl || !episode.Id) return null
    return `${serverUrl}/Items/${episode.Id}/Images/Primary?maxWidth=200&quality=80`
  }, [serverUrl])

  const isVideoReady = !!videoUrl

  // ==================== RENDER ====================

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center player-container"
      style={{ cursor: showControls ? 'default' : 'none' }}
      onWheel={handleWheel}
    >
      {/* Video Element. Subtitles are drawn by libass (JASSUB), which injects
          its own <canvas> as a DOM sibling right after the <video>. That canvas
          is kept in this dedicated wrapper — whose ONLY React child is the
          <video> — so React's reconciliation of the overlay siblings below can
          never displace or remove the injected subtitle canvas.
          MUST be block layout, NOT flex: JASSUB positions its injected sibling
          assuming normal block flow (it compensates vertical displacement only).
          As a flex item the sibling got placed BESIDE the video → the subtitle
          canvas landed at x≈1984, fully off-screen. object-contain already
          centers the video content, so flex centering is redundant anyway. */}
      <div className="absolute inset-0">
        <video
          key={playSessionId || 'initial'}
          ref={videoRef}
          className="w-full h-full object-contain"
          muted={isMuted}
          onClick={handleVideoAreaClick}
          onPointerDown={handleHoldStart}
          onPointerMove={handleHoldMove}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onPointerLeave={endHold}
          // Touch long-press would open the context menu / iOS callout
          onContextMenu={(e) => { if (holdRef.current.timer || holdRef.current.active) e.preventDefault() }}
          style={{ WebkitTouchCallout: 'none' }}
          // playsInline keeps iOS from hijacking playback into the native system
          // fullscreen player — the video plays inline so our own fixed-inset
          // container + custom controls ARE the fullscreen experience.
          playsInline
        />
      </div>

      {/* Loading */}
      <LoadingIndicator visible={(isLoading || !isVideoReady) && !error} />

      {/* Error */}
      <ErrorDisplay
        error={error}
        onRetry={handleRetry}
        onClose={onClose}
        onRedownload={isPlayingLocally && navigator.onLine ? () => void handleRedownload() : undefined}
      />

      {/* Phone brightness fallback: in-app dim layer (left-zone swipe) for
          builds WITHOUT the native plugin — with it, the real backlight is
          driven instead and this layer must stay off. */}
      {IS_PHONE && !SCREEN_BRIGHTNESS_SUPPORTED && brightness < 1 && (
        <div
          className="absolute inset-0 z-20 pointer-events-none bg-black"
          style={{ opacity: (1 - brightness) * 0.8 }}
        />
      )}

      {/* Volume Overlay */}
      <VolumeOverlay visible={showVolumeOverlay} volume={volume} isMuted={isMuted} />
      {rateFlash && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none px-5 py-3 rounded-2xl bg-black/60 backdrop-blur-md border border-white/10 text-white text-2xl font-semibold tabular-nums">
          {formatRate(playbackRate)}
        </div>
      )}

      {/* Long-press speed boost */}
      {holdBoost && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white text-sm font-semibold tabular-nums">
          <FastForward size={14} fill="currentColor" />
          {formatRate(HOLD_RATE)}
        </div>
      )}

      {/* Phone: brightness (dim) swipe feedback */}
      {IS_PHONE && <BrightnessOverlay visible={showBrightnessOverlay} brightness={brightness} />}

      {/* Phone: double-tap seek feedback */}
      {IS_PHONE && <PhoneSeekIndicator indicator={seekIndicator} />}

      {/* Stats for Nerds */}
      <StatsForNerds
        visible={showStats}
        stats={videoStats}
        itemId={item.Id}
        mediaSourceId={mediaSourceId}
        playSessionId={playSessionId}
        playMethod={playMethod}
        volume={volume}
        isMuted={isMuted}
        onClose={() => setShowStats(false)}
      />

      {/* Player Controls */}
      <PlayerControls
        showControls={showControls}
        isPlaying={isPlaying}
        item={item}
        currentChapter={currentChapter}
        currentChapterIndex={currentChapterIndex}
        currentTime={currentTime}
        duration={duration}
        bufferedPercent={bufferedPercent}
        volume={volume}
        isMuted={isMuted}
        isFullscreen={isFullscreen}
        isPictureInPicture={isPictureInPicture}
        isPlayingLocally={isPlayingLocally}
        isOffline={isOffline}
        audioTracks={audioTracks}
        subtitleTracks={subtitleTracks}
        selectedAudioIndex={selectedAudioIndex}
        selectedSubtitleIndex={selectedSubtitleIndex}
        showStats={showStats}
        seekBackSeconds={seekBackSeconds}
        seekForwardSeconds={seekForwardSeconds}
        chapters={chapters}
        previousEpisode={previousEpisode}
        nextEpisode={nextEpisode}
        hasOnPlayNext={!!onPlayNext}
        episodeQueue={episodeQueue}
        currentEpisodeIndex={currentEpisodeIndex}
        trickplayInfo={trickplayInfo}
        serverUrl={serverUrl}
        accessToken={api?.accessToken || null}
        videoRef={videoRef}
        onClose={onClose}
        onTogglePlay={handleTogglePlay}
        onSeekBack={handleSeekBack}
        onSeekForward={handleSeekForward}
        onPrevChapter={handlePreviousChapter}
        onNextChapter={handleNextChapter}
        onPlayPrevious={handlePlayPrevious}
        onPlayNext={handlePlayNext}
        onToggleFullscreen={toggleFullscreen}
        onTogglePiP={togglePictureInPicture}
        onVolumeChange={handleVolumeChange}
        onToggleMute={handleToggleMute}
        onAudioTrackChange={handleAudioTrackChange}
        onSubtitleTrackChange={handleSubtitleTrackChange}
        onToggleCaptions={handleToggleCaptions}
        onToggleStats={() => setShowStats(prev => !prev)}
        playbackRate={playbackRate}
        onPlaybackRateChange={setPlaybackRate}
        onPlayEpisode={handlePlayEpisode}
        onChapterSelect={handleChapterSelect}
        onVideoAreaClick={handleVideoAreaClick}
        onLock={handleLock}
      />

      {/* Skip Intro */}
      <SkipIntroButton
        visible={!!activeSkip}
        label={activeSkip ? SKIP_LABELS[activeSkip.type] : ''}
        onSkip={handleSkipIntro}
        controlsVisible={showControls}
      />

      {/* Up Next */}
      <UpNextFlyout
        visible={showUpNext}
        nextEpisode={nextEpisode}
        thumbnailUrl={nextEpisode ? getEpisodeThumbnail(nextEpisode) : null}
        onPlayNext={handlePlayNext}
        onDismiss={handleDismissUpNext}
        countdown={upNextRing}
      />

      {/* Resumed mid-item: offer to start over */}
      {startOverVisible && !stillWatching && (
        <button
          onClick={handleStartOver}
          className={`absolute left-8 phone:left-4 z-40 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/15 text-white text-sm font-medium hover:bg-black/80 transition-all ${
            showControls ? 'bottom-32 phone:bottom-28' : 'bottom-12 phone:bottom-8'
          }`}
        >
          <RotateCcw size={16} />
          Start from beginning
        </button>
      )}

      {/* Are you still watching? */}
      {stillWatching && (
        <div className="absolute inset-0 z-[45] flex items-center justify-center bg-black/75 backdrop-blur-sm px-6">
          <div className="text-center max-w-md">
            <p className="text-2xl phone:text-xl font-semibold text-white">Are you still watching?</p>
            {item.SeriesName && <p className="mt-2 text-white/60 truncate">{item.SeriesName}</p>}
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <button
                autoFocus
                onClick={handleStillWatchingContinue}
                className="px-6 py-3 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-colors"
              >
                Continue watching
              </button>
              <button
                onClick={onClose}
                className="px-6 py-3 rounded-lg bg-white/15 text-white font-semibold hover:bg-white/25 transition-colors"
              >
                I'm done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phone: lock overlay — swallows all touch input while locked */}
      {IS_PHONE && <PhoneLockOverlay visible={isLocked} onUnlock={handleUnlock} />}
    </div>
  )
}

export default JellyfinPlayer
