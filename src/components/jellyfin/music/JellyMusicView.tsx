import React, { useState, useEffect, useRef, useCallback } from 'react'
import { LogOut, Settings as SettingsIcon, Music, WifiOff, RefreshCw, Search } from 'lucide-react'
import { JellyfinProvider, useJellyfin, getItemsApi, getUserViewsApi, type BaseItemDto } from '../JellyfinContext'
import { JellyfinSetup } from '../JellyfinSetup'
import { AppTabs, type AppTab } from '../../AppTabs'
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
import { PlaylistCover } from './PlaylistCover'
import { MusicGenreDetails } from './MusicGenreDetails'
import { MusicLyrics } from './MusicLyrics'
import { MusicDownloads } from './MusicDownloads'
import { MusicLikedSongs } from './MusicLikedSongs'
import { DownloadCenter } from '../../downloads'
import { clearGridStates } from '../../../utils/viewStateCache'
import { registerTabReset, registerBackHandler, smartTabReset } from '../../../utils/navigationBus'
import { usePullToRefresh } from '../../../hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '../../PullToRefreshIndicator'

export type MusicViewType =
  | { type: 'home' }
  | { type: 'search' }
  | { type: 'albums' }
  | { type: 'artists' }
  | { type: 'playlists' }
  | { type: 'downloads' }
  | { type: 'liked-songs' }
  | { type: 'album-details'; album: BaseItemDto }
  | { type: 'artist-details'; artist: BaseItemDto }
  | { type: 'playlist-details'; playlist: BaseItemDto }
  | { type: 'genre-details'; genre: BaseItemDto }

interface JellyMusicViewProps {
  onBackToReader: () => void
  onSwitchToJellyfin: () => void
  onOpenSettings?: () => void
  onSwitchToRequester?: () => void
  onSwitchToLiveTV?: () => void
  onSwitchToAudiobooks?: () => void
  // Deep linking: Play a track immediately when the view opens
  initialPlayTrack?: BaseItemDto | null
  // Callback to clear the initial play track after it's handled
  onInitialPlayHandled?: () => void
  // Deep linking: open an album/artist details page (from global search)
  initialOpenItem?: BaseItemDto | null
  onInitialOpenHandled?: () => void
  // Open the app-wide global search modal
  onOpenSearch?: () => void
  // Offline mode: server is unreachable, show downloaded music only
  isOffline?: boolean
}

function JellyMusicContent({ onBackToReader, onSwitchToJellyfin, onOpenSettings, onSwitchToRequester, onSwitchToLiveTV, onSwitchToAudiobooks, initialPlayTrack, onInitialPlayHandled, initialOpenItem, onInitialOpenHandled, onOpenSearch, isOffline }: JellyMusicViewProps) {
  const { isAuthenticated, isLoading, user, serverName, logout, api, serverUrl, serverId } = useJellyfin()

  // App tab bar navigation (fixed tab order, active tab highlighted)
  const handleTabNavigate = (tab: AppTab) => {
    switch (tab) {
      case 'calibre': onBackToReader(); break
      case 'jellyfin': onSwitchToJellyfin(); break
      case 'requester': onSwitchToRequester?.(); break
      case 'livetv': onSwitchToLiveTV?.(); break
      case 'audiobookshelf': onSwitchToAudiobooks?.(); break
    }
  }

  const [musicView, setMusicView] = useState<MusicViewType>({ type: 'home' })
  const [viewHistory, setViewHistory] = useState<MusicViewType[]>([{ type: 'home' }])

  // Refresh: remount the current content (refetch) without losing navigation
  const [refreshKey, setRefreshKey] = useState(0)
  const handleRefresh = () => {
    clearGridStates('music-')
    setRefreshKey(k => k + 1)
  }
  const autoNavigatedOfflineRef = useRef(false)
  const [musicLibraries, setMusicLibraries] = useState<BaseItemDto[]>([])
  const [playlists, setPlaylists] = useState<BaseItemDto[]>([])

  // Granular selectors — the whole music view must not re-render on timeupdates
  const currentTrack = useMusicPlayer(s => s.currentTrack)
  const setQueue = useMusicPlayer(s => s.setQueue)
  const setJellyfinConfig = useMusicPlayer(s => s.setJellyfinConfig)
  const clearJellyfinConfig = useMusicPlayer(s => s.clearJellyfinConfig)

  // Handle initial play track (deep linking from global search)
  useEffect(() => {
    if (initialPlayTrack && isAuthenticated && serverUrl && api?.accessToken) {
      console.log('Deep linking: Playing track from search', initialPlayTrack.Name)

      // Convert BaseItemDto to Track format
      const track: Track = {
        id: initialPlayTrack.Id!,
        name: initialPlayTrack.Name || 'Unknown Track',
        artists: initialPlayTrack.Artists || [],
        artistIds: initialPlayTrack.ArtistItems?.map(a => a.Id!).filter(Boolean) || [],
        albumId: initialPlayTrack.AlbumId || '',
        albumName: initialPlayTrack.Album || '',
        duration: initialPlayTrack.RunTimeTicks || 0,
        indexNumber: initialPlayTrack.IndexNumber,
        imageUrl: initialPlayTrack.AlbumId
          ? `${serverUrl}/Items/${initialPlayTrack.AlbumId}/Images/Primary?maxWidth=300&quality=90&ApiKey=${api.accessToken}`
          : undefined
      }

      // Set queue with single track and play
      setQueue([track], 0)
      onInitialPlayHandled?.()
    }
  }, [initialPlayTrack, isAuthenticated, serverUrl, api?.accessToken, setQueue, onInitialPlayHandled])

  // Sync Jellyfin config to music store so PersistentMusicPlayer can use it
  useEffect(() => {
    if (isAuthenticated && serverUrl && api?.accessToken) {
      setJellyfinConfig(serverUrl, api.accessToken, serverId, user?.Id ?? null)
    } else if (!isLoading && !isAuthenticated) {
      clearJellyfinConfig()
    }
  }, [isAuthenticated, isLoading, serverUrl, api?.accessToken, serverId, user?.Id, setJellyfinConfig, clearJellyfinConfig])

  // Fetch music libraries and playlists.
  // Re-runs when the server comes back (isOffline flips) so playlists created
  // externally while we were away appear without a manual refresh.
  const lastPlaylistFetchRef = useRef(0)
  useEffect(() => {
    const fetchMusicData = async () => {
      if (!api || !user?.Id) return
      lastPlaylistFetchRef.current = Date.now()

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
          // Filter to only music playlists
          const musicPlaylists = (playlistsResponse.data.Items || []).filter(
            p => p.MediaType === 'Audio' || !p.MediaType
          )
          setPlaylists(musicPlaylists)
        }
      } catch (e) {
        console.error('Failed to fetch music data:', e)
      }
    }

    if (isAuthenticated) {
      fetchMusicData()
    }

    // A playlist generator can add or rewrite playlists while the app sits in the
    // background. Re-read them when the window is focused again (throttled), so
    // the sidebar isn't stuck on whatever existed when this view mounted.
    const refetchOnFocus = () => {
      if (document.hidden || !isAuthenticated) return
      if (Date.now() - lastPlaylistFetchRef.current < 30_000) return
      fetchMusicData()
    }
    window.addEventListener('focus', refetchOnFocus)
    document.addEventListener('visibilitychange', refetchOnFocus)
    return () => {
      window.removeEventListener('focus', refetchOnFocus)
      document.removeEventListener('visibilitychange', refetchOnFocus)
    }
  }, [api, user?.Id, isAuthenticated, refreshKey, isOffline])

  // Auto-navigate to downloads when server becomes unreachable
  useEffect(() => {
    if (isOffline && !autoNavigatedOfflineRef.current) {
      autoNavigatedOfflineRef.current = true
      setViewHistory([{ type: 'downloads' }])
      setMusicView({ type: 'downloads' })
    } else if (!isOffline && autoNavigatedOfflineRef.current) {
      autoNavigatedOfflineRef.current = false
      setViewHistory([{ type: 'home' }])
      setMusicView({ type: 'home' })
    }
  }, [isOffline])

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

  // Main content scroller — used by the smart tab re-tap to scroll to top
  const mainScrollRef = useRef<HTMLElement>(null)

  // Smart re-tap on the JellyMusic tab: scroll the content to top, or
  // (already at top / in a sub-view) go back to the music home view
  useEffect(() => {
    return registerTabReset('jellymusic', () => {
      smartTabReset(mainScrollRef.current, musicView.type === 'home', goHome)
    })
  }, [musicView.type, goHome])

  // Pull-to-refresh (phone): same remount-based refresh as the toolbar
  // button, on the browsing grids only (not details/search/downloads)
  const pullState = usePullToRefresh(
    mainScrollRef,
    handleRefresh,
    musicView.type === 'home' || musicView.type === 'albums' ||
      musicView.type === 'artists' || musicView.type === 'playlists'
  )

  // Back gestures (Esc / mouse back): close the queue drawer / lyrics panel
  // first (neither handles Escape itself), then walk the view history
  useEffect(() => {
    return registerBackHandler(() => {
      const player = useMusicPlayer.getState()
      if (player.isLyricsOpen) { player.setLyricsOpen(false); return true }
      if (player.isQueueOpen) { player.setQueueOpen(false); return true }
      if (viewHistory.length > 1) { goBack(); return true }
      return false
    })
  }, [viewHistory, goBack])

  // Spotify-style navigation from the player bar / queue (only IDs are known —
  // details views resolve the rest, same stub pattern MusicHome already uses)
  const navigateToAlbumById = useCallback((albumId: string, albumName?: string) => {
    navigateTo({ type: 'album-details', album: { Id: albumId, Name: albumName, Type: 'MusicAlbum' } as BaseItemDto })
  }, [navigateTo])

  const navigateToArtistById = useCallback((artistId: string, artistName?: string) => {
    navigateTo({ type: 'artist-details', artist: { Id: artistId, Name: artistName, Type: 'MusicArtist' } as BaseItemDto })
  }, [navigateTo])

  // Deep linking from global search: albums/artists open their details page
  useEffect(() => {
    if (!initialOpenItem || !isAuthenticated) return
    if (initialOpenItem.Type === 'MusicAlbum') {
      navigateTo({ type: 'album-details', album: initialOpenItem })
    } else if (initialOpenItem.Type === 'MusicArtist') {
      navigateTo({ type: 'artist-details', artist: initialOpenItem })
    }
    onInitialOpenHandled?.()
  }, [initialOpenItem, isAuthenticated, navigateTo, onInitialOpenHandled])

  // Loading state
  if (isLoading) {
    return (
      <div className="h-screen phone:h-full bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-theme-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-white/60">Loading...</p>
        </div>
      </div>
    )
  }

  // Not authenticated - show setup, unless offline (then fall through to downloads view)
  if (!isAuthenticated && !isOffline) {
    return (
      <div className="h-screen phone:h-full bg-gradient-to-br from-gray-900 via-theme-900/20 to-gray-900 overflow-auto">
        {/* Client switch buttons */}
        <div className="absolute top-4 left-4 z-50">
          <AppTabs active="jellymusic" onNavigate={handleTabNavigate} />
        </div>

        <JellyfinSetup onComplete={() => {}} />
      </div>
    )
  }

  // Render main content — every case carries refreshKey in its key so the
  // refresh button can remount (= refetch) the current screen in place
  const renderContent = () => {
    switch (musicView.type) {
      case 'home':
        return (
          <MusicHome
            key={`home-${refreshKey}`}
            onNavigate={navigateTo}
            musicLibraries={musicLibraries}
          />
        )
      case 'search':
        return (
          <MusicSearch
            key={`search-${refreshKey}`}
            onNavigate={navigateTo}
            musicLibraries={musicLibraries}
          />
        )
      case 'albums':
        return (
          <MusicAlbumGrid
            key={`albums-${refreshKey}`}
            onNavigate={navigateTo}
            musicLibraries={musicLibraries}
          />
        )
      case 'artists':
        return (
          <MusicArtistGrid
            key={`artists-${refreshKey}`}
            onNavigate={navigateTo}
            musicLibraries={musicLibraries}
          />
        )
      case 'liked-songs':
        return (
          <MusicLikedSongs
            key={`liked-${refreshKey}`}
            onNavigate={navigateTo}
          />
        )
      case 'album-details':
        return (
          <MusicAlbumDetails
            key={`${musicView.album.Id}-${refreshKey}`}
            album={musicView.album}
            onNavigate={navigateTo}
            onBack={goBack}
          />
        )
      case 'artist-details':
        return (
          <MusicArtistDetails
            key={`${musicView.artist.Id}-${refreshKey}`}
            artist={musicView.artist}
            onNavigate={navigateTo}
            onBack={goBack}
          />
        )
      case 'playlist-details':
        return (
          <MusicPlaylistDetails
            key={`${musicView.playlist.Id}-${refreshKey}`}
            playlist={musicView.playlist}
            onNavigate={navigateTo}
            onBack={goBack}
          />
        )
      case 'genre-details':
        return (
          <MusicGenreDetails
            key={`${musicView.genre.Id}-${refreshKey}`}
            genre={musicView.genre}
            onNavigate={navigateTo}
            onBack={goBack}
          />
        )
      case 'playlists':
        // Simple playlist list (reached from the phone chip nav; the desktop
        // sidebar lists playlists inline instead)
        return (
          <div className="p-4 space-y-1">
            <h2 className="text-lg font-semibold text-white mb-3">Playlists</h2>
            {playlists.length === 0 && (
              <p className="text-sm text-white/40">No playlists yet</p>
            )}
            {playlists.map((playlist) => (
              <button
                key={playlist.Id}
                onClick={() => navigateTo({ type: 'playlist-details', playlist })}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-white/80 hover:bg-white/5 active:bg-white/10 transition-colors"
              >
                <PlaylistCover
                  playlist={playlist}
                  serverUrl={serverUrl}
                  maxWidth={100}
                  className="w-10 h-10 rounded flex-shrink-0"
                  iconSize={16}
                />
                <span className="text-sm truncate">{playlist.Name}</span>
              </button>
            ))}
          </div>
        )
      case 'downloads':
        return <MusicDownloads key={`downloads-${refreshKey}`} offlineMode={isOffline} />
      default:
        return null
    }
  }

  return (
    <div className="h-screen phone:h-full bg-gray-900 text-white overflow-hidden flex flex-col">
      {/* Top Bar */}
      <div className="flex-shrink-0 h-14 phone:h-auto phone:min-h-14 phone:pt-safe px-4 flex items-center justify-between bg-black/40 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3">
          <AppTabs active="jellymusic" onNavigate={handleTabNavigate} />

          <div className="h-5 w-px bg-white/10 phone:hidden" />

          <div className="flex items-center gap-2">
            <Music size={16} className="text-theme-400" />
            <span className="text-sm text-white/60">{serverName}</span>
            {isOffline && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-medium">
                <WifiOff size={10} />
                OFFLINE
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user && (
            <span className="text-sm text-white/60 mr-2 phone:hidden">
              {user.Name}
            </span>
          )}

          {/* Global Search */}
          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
              title="Search (Ctrl+K)"
            >
              <Search size={18} className="text-white/60" />
            </button>
          )}

          {/* Unified download manager (all apps) */}
          <DownloadCenter />

          <button
            onClick={handleRefresh}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title="Refresh"
          >
            <RefreshCw size={18} className="text-white/60" />
          </button>

          <button
            onClick={onOpenSettings}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title="Settings"
          >
            <SettingsIcon size={18} className="text-white/60" />
          </button>

          <button
            onClick={logout}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title="Sign out"
          >
            <LogOut size={18} className="text-white/60" />
          </button>
        </div>
      </div>

      {/* Phone navigation (chip row; renders nothing on desktop) */}
      <MusicPhoneNav currentView={musicView} onNavigate={navigateTo} />

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <MusicSidebar
          currentView={musicView}
          onNavigate={navigateTo}
          onBack={goHome}
          playlists={playlists}
        />

        {/* Main content */}
        <div className="relative flex-1 min-w-0 flex">
          <main ref={mainScrollRef} className="flex-1 overflow-y-auto phone:overflow-x-hidden custom-scrollbar bg-gradient-to-b from-gray-900/50 to-black">
            {renderContent()}
          </main>
          {/* Outside the keyed subtree so the refresh remount can't unmount it */}
          <PullToRefreshIndicator {...pullState} />
        </div>

        {/* Queue drawer */}
        <MusicQueue onNavigateToAlbum={navigateToAlbumById} onNavigateToArtist={navigateToArtistById} />

        {/* Lyrics panel */}
        <MusicLyrics />
      </div>

      {/* Player bar */}
      <MusicPlayerBar onNavigateToAlbum={navigateToAlbumById} onNavigateToArtist={navigateToArtistById} />
    </div>
  )
}

// Main export with provider
export function JellyMusicView(props: JellyMusicViewProps) {
  return (
    <JellyfinProvider>
      <JellyMusicContent {...props} />
    </JellyfinProvider>
  )
}
