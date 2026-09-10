import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useShallow } from 'zustand/shallow'
import { useJellyfin, getItemsApi, getUserViewsApi, type BaseItemDto } from '../JellyfinContext'
import { useMusicPlayer, type Track, ticksToSeconds } from '../../../stores/musicPlayerStore'
import { MusicSidebar } from './MusicSidebar'
import { MusicPhoneNav } from './MusicPhoneNav'
import { MusicPlayerBar } from './MusicPlayerBar'
import { MusicHome } from './MusicHome'
import { MusicAlbumGrid } from './MusicAlbumGrid'
import { MusicAlbumDetails } from './MusicAlbumDetails'
import { MusicArtistGrid } from './MusicArtistGrid'
import { MusicArtistDetails } from './MusicArtistDetails'
import { MusicSearch } from './MusicSearch'
import { MusicQueue } from './MusicQueue'
import { MusicPlaylistDetails } from './MusicPlaylistDetails'
import { MusicGenreDetails } from './MusicGenreDetails'
import { MusicLyrics } from './MusicLyrics'
import { getUniversalAudioUrl } from '../../../utils/audioStream'
import { useAudioOutputDevice } from '../../../hooks/useAudioOutputDevice'
import { registerBackHandler } from '../../../utils/navigationBus'
import type { MusicViewType } from './JellyMusicView'

// Re-export the type for backward compatibility
export type { MusicViewType }

interface MusicViewProps {
  onBack: () => void
}

export function MusicView({ onBack }: MusicViewProps) {
  const { api, serverUrl, user } = useJellyfin()
  const audioRef = useRef<HTMLAudioElement>(null)

  // Route audio to the output device chosen in Settings → Advanced
  useAudioOutputDevice(audioRef, 'music')

  const [musicView, setMusicView] = useState<MusicViewType>({ type: 'home' })
  const [viewHistory, setViewHistory] = useState<MusicViewType[]>([{ type: 'home' }])
  const [musicLibraries, setMusicLibraries] = useState<BaseItemDto[]>([])
  const [playlists, setPlaylists] = useState<BaseItemDto[]>([])

  // useShallow without currentTime — this view writes it, so it must not
  // re-render 4x/sec on the timeupdates it produces itself
  const {
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    setAudioRef,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    next,
    repeatMode
  } = useMusicPlayer(useShallow(s => ({
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    volume: s.volume,
    isMuted: s.isMuted,
    setAudioRef: s.setAudioRef,
    setCurrentTime: s.setCurrentTime,
    setDuration: s.setDuration,
    setIsPlaying: s.setIsPlaying,
    next: s.next,
    repeatMode: s.repeatMode,
  })))

  // Fetch music libraries and playlists
  useEffect(() => {
    const fetchMusicData = async () => {
      if (!api || !user?.Id) return

      try {
        const userViewsApi = getUserViewsApi(api)
        const response = await userViewsApi.getUserViews({ userId: user.Id })
        const libraries = response.data.Items || []
        const musicLibs = libraries.filter(lib => lib.CollectionType === 'music')
        setMusicLibraries(musicLibs)

        // Fetch playlists
        if (musicLibs.length > 0) {
          const itemsApi = getItemsApi(api)
          const playlistsResponse = await itemsApi.getItems({
            userId: user.Id,
            includeItemTypes: ['Playlist'],
            recursive: true,
            sortBy: ['SortName'],
            sortOrder: ['Ascending']
          })
          const musicPlaylists = (playlistsResponse.data.Items || []).filter(
            p => p.MediaType === 'Audio' || !p.MediaType
          )
          setPlaylists(musicPlaylists)
        }
      } catch (e) {
        console.error('Failed to fetch music data:', e)
      }
    }

    fetchMusicData()
  }, [api, user?.Id])

  // Register audio element
  useEffect(() => {
    if (audioRef.current) {
      setAudioRef(audioRef.current)
    }
    return () => setAudioRef(null)
  }, [setAudioRef])

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleLoadedMetadata = () => setDuration(audio.duration)
    const handleEnded = () => next()
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)

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

  // Control audio playback
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.play().catch(console.error)
    } else {
      audio.pause()
    }
  }, [isPlaying])

  // Update audio source when track changes
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack || !serverUrl || !api?.accessToken) return

    const streamUrl = getUniversalAudioUrl(serverUrl, currentTrack.id, api.accessToken)
    audio.src = streamUrl
    audio.load()

    if (isPlaying) {
      audio.play().catch(console.error)
    }
  }, [currentTrack?.id, serverUrl, api?.accessToken])

  // Volume control
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = isMuted ? 0 : volume
  }, [volume, isMuted])

  // Navigation
  const navigateTo = useCallback((view: MusicViewType) => {
    setViewHistory(prev => [...prev, view])
    setMusicView(view)
  }, [])

  const goBack = useCallback(() => {
    if (viewHistory.length > 1) {
      const newHistory = viewHistory.slice(0, -1)
      setViewHistory(newHistory)
      setMusicView(newHistory[newHistory.length - 1])
    }
  }, [viewHistory])

  const goHome = useCallback(() => {
    setViewHistory([{ type: 'home' }])
    setMusicView({ type: 'home' })
  }, [])

  // Back gestures (Esc / mouse back): walk the embedded music view history.
  // Registered while mounted (as a child of JellyfinView) so it sits above
  // JellyfinView's own back handler on the stack; unhandled gestures (already
  // at the music home) fall through to the parent.
  useEffect(() => {
    return registerBackHandler(() => {
      if (viewHistory.length > 1) { goBack(); return true }
      return false
    })
  }, [viewHistory, goBack])

  // Render main content
  const renderContent = () => {
    switch (musicView.type) {
      case 'home':
        return (
          <MusicHome
            onNavigate={navigateTo}
            musicLibraries={musicLibraries}
          />
        )
      case 'search':
        return (
          <MusicSearch
            onNavigate={navigateTo}
            musicLibraries={musicLibraries}
          />
        )
      case 'albums':
        return (
          <MusicAlbumGrid
            onNavigate={navigateTo}
            musicLibraries={musicLibraries}
          />
        )
      case 'artists':
        return (
          <MusicArtistGrid
            onNavigate={navigateTo}
            musicLibraries={musicLibraries}
          />
        )
      case 'album-details':
        return (
          <MusicAlbumDetails
            key={musicView.album.Id}
            album={musicView.album}
            onNavigate={navigateTo}
            onBack={goBack}
          />
        )
      case 'artist-details':
        return (
          <MusicArtistDetails
            key={musicView.artist.Id}
            artist={musicView.artist}
            onNavigate={navigateTo}
            onBack={goBack}
          />
        )
      case 'playlist-details':
        return (
          <MusicPlaylistDetails
            key={musicView.playlist.Id}
            playlist={musicView.playlist}
            onNavigate={navigateTo}
            onBack={goBack}
          />
        )
      case 'genre-details':
        return (
          <MusicGenreDetails
            key={musicView.genre.Id}
            genre={musicView.genre}
            onNavigate={navigateTo}
            onBack={goBack}
          />
        )
      case 'playlists':
      case 'downloads':
        return (
          <div className="flex items-center justify-center h-full text-white/60">
            Coming soon...
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-900 to-black">
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="auto" />

      {/* Phone navigation (chip row; renders nothing on desktop) */}
      <MusicPhoneNav currentView={musicView} onNavigate={navigateTo} />

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <MusicSidebar
          currentView={musicView}
          onNavigate={navigateTo}
          onBack={onBack}
          playlists={playlists}
        />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto phone:overflow-x-hidden custom-scrollbar">
          {renderContent()}
        </main>

        {/* Queue drawer */}
        <MusicQueue />

        {/* Lyrics panel */}
        <MusicLyrics />
      </div>

      {/* Player bar */}
      <MusicPlayerBar />
    </div>
  )
}
