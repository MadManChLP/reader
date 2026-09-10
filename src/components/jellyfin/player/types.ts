// Shared types for the Jellyfin player components

import type { BaseItemDto } from '../JellyfinContext'

export type PlayMethod = 'DirectPlay' | 'DirectStream' | 'Transcode'

export interface MediaStream {
  Index: number
  Type: 'Audio' | 'Subtitle' | 'Video' | string
  Codec?: string
  Language?: string
  DisplayTitle?: string
  Title?: string
  IsDefault?: boolean
  IsForced?: boolean
  IsExternal?: boolean
  SupportsExternalStream?: boolean
  DeliveryMethod?: string
  DeliveryUrl?: string
  Channels?: number
}

export interface Chapter {
  StartPositionTicks: number
  Name?: string
  ImageTag?: string
}

export interface MediaSource {
  Id?: string
  Name?: string
  Container?: string
  ETag?: string
  SupportsTranscoding?: boolean
  TranscodingUrl?: string
  MediaStreams?: MediaStream[]
  Chapters?: Chapter[]
}

export interface MediaSegment {
  Type: 'Intro' | 'Outro' | 'Preview' | 'Recap' | 'Commercial' | string
  StartTicks: number
  EndTicks: number
}

export interface TrickplayInfo {
  width: number
  height: number
  interval: number // ms between frames
  tileWidth: number
  tileHeight: number
}

export interface JellyfinPlayerProps {
  item: BaseItemDto
  onClose: () => void
  startPosition?: number // in ticks (100ns units)
  localPath?: string
  episodeQueue?: BaseItemDto[]
  onPlayNext?: (item: BaseItemDto) => void
}

// Language code to display name mapping
export const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English', en: 'English',
  ger: 'German', de: 'German', deu: 'German',
  fra: 'French', fr: 'French', fre: 'French',
  spa: 'Spanish', es: 'Spanish',
  ita: 'Italian', it: 'Italian',
  jpn: 'Japanese', ja: 'Japanese',
  kor: 'Korean', ko: 'Korean',
  chi: 'Chinese', zh: 'Chinese', zho: 'Chinese',
  por: 'Portuguese', pt: 'Portuguese',
  rus: 'Russian', ru: 'Russian',
  ara: 'Arabic', ar: 'Arabic',
  hin: 'Hindi', hi: 'Hindi',
  und: 'Unknown',
}

// Format seconds to HH:MM:SS or MM:SS
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Get display name for a track
export function getTrackDisplayName(track: MediaStream): string {
  if (track.DisplayTitle) return track.DisplayTitle
  if (track.Title) return track.Title

  const parts: string[] = []
  if (track.Language) {
    parts.push(LANGUAGE_NAMES[track.Language.toLowerCase()] || track.Language)
  }
  if (track.Codec) {
    parts.push(track.Codec.toUpperCase())
  }
  if (track.IsDefault) {
    parts.push('(Default)')
  }
  if (track.IsForced) {
    parts.push('(Forced)')
  }

  return parts.length > 0 ? parts.join(' - ') : `Track ${track.Index}`
}

// Codec capability detection
export function detectCodecCapabilities() {
  const video = document.createElement('video')
  return {
    h264: video.canPlayType('video/mp4; codecs="avc1.640033"') !== '',
    hevc: video.canPlayType('video/mp4; codecs="hvc1.1.4.L123"') !== '' ||
          video.canPlayType('video/mp4; codecs="hev1.1.4.L123"') !== '',
    vp9: video.canPlayType('video/webm; codecs="vp9"') !== '',
    av1: video.canPlayType('video/mp4; codecs="av01.0.08M.08"') !== '',
    aac: video.canPlayType('audio/mp4; codecs="mp4a.40.2"') !== '',
    opus: video.canPlayType('audio/webm; codecs="opus"') !== '',
    flac: video.canPlayType('audio/flac') !== '' || video.canPlayType('audio/x-flac') !== '',
    // Dolby Digital / Digital Plus. WebView2/Edge on Windows decodes these via
    // the OS Dolby codecs, but Chromium and (usually) Linux WebKitGTK do not —
    // so we must probe rather than assume. When unsupported, advertising them as
    // direct-play makes Jellyfin ship an AC3 track the WebView can't decode, i.e.
    // video with no audio; gating on this forces an AAC transcode instead.
    ac3: video.canPlayType('audio/mp4; codecs="ac-3"') !== '',
    eac3: video.canPlayType('audio/mp4; codecs="ec-3"') !== ''
  }
}
