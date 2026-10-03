import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, LogOut, Settings as SettingsIcon, Server, Download, HardDrive, Home, WifiOff, RefreshCw, Search } from 'lucide-react'
import { JellyfinProvider, useJellyfin, getItemsApi, type BaseItemDto } from './JellyfinContext'
import { JellyfinSetup } from './JellyfinSetup'
import { JellyfinHome } from './JellyfinHome'
import { JellyfinPlayer } from './player/JellyfinPlayer'
import { JellyfinLibrary } from './JellyfinLibrary'
import { JellyfinItemDetails } from './JellyfinItemDetails'
import { JellyfinOfflineLibrary } from './JellyfinOfflineLibrary'
import { MusicView } from './music'
import { getDownloadStats, subscribeToDownloadUpdates, getDownloadedItem } from '../../utils/jellyfinDownloadManager'
import { api as appApi } from '../../utils/api'
import { AppTabs, type AppTab } from '../AppTabs'
import { DownloadCenter } from '../downloads'
import { clearGridStates } from '../../utils/viewStateCache'
import { isRealItem, isSpecial } from './itemFilters'
import { registerTabReset, registerBackHandler, blockGlobalEsc, smartTabReset } from '../../utils/navigationBus'
import { requestJellyfinSoftRefresh } from '../../utils/jellyfinRefreshBus'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '../PullToRefreshIndicator'

interface JellyfinViewProps {
  onBackToReader: () => void
  onOpenSettings?: () => void
  onSwitchToJellyMusic?: () => void
  onSwitchToRequester?: () => void
  onSwitchToLiveTV?: () => void
  onSwitchToAudiobooks?: () => void
  // Deep linking: Play an item immediately when the view opens
  initialPlayItem?: BaseItemDto | null
  // Callback to clear the initial play item after it's handled
  onInitialPlayHandled?: () => void
  // Deep linking: open an item's details page (Series from global search)
  initialOpenItem?: BaseItemDto | null
  onInitialOpenHandled?: () => void
  // Open the app-wide global search modal
  onOpenSearch?: () => void
  // Offline mode: server is unreachable, show downloaded content
  isOffline?: boolean
}

type ViewState =
  | { type: 'home' }
  | { type: 'library'; library: BaseItemDto }
  | { type: 'details'; item: BaseItemDto }
  | { type: 'downloads' }
  | { type: 'music' }

function JellyfinContent({ onBackToReader, onOpenSettings, onSwitchToJellyMusic, onSwitchToRequester, onSwitchToLiveTV, onSwitchToAudiobooks, initialPlayItem, onInitialPlayHandled, initialOpenItem, onInitialOpenHandled, onOpenSearch, isOffline }: JellyfinViewProps) {
  const { isAuthenticated, isLoading, user, serverName, serverUrl, logout, disconnect, api } = useJellyfin()

  const [viewHistory, setViewHistory] = useState<ViewState[]>([{ type: 'home' }])
  const currentView = viewHistory[viewHistory.length - 1]
  const contentScrollRef = useRef<HTMLDivElement>(null)

  // Refresh: bump the key so the current content remounts and refetches,
  // keeping navigation history and the current screen
  const [refreshKey, setRefreshKey] = useState(0)
  const handleRefresh = () => {
    clearGridStates('jellyfin-library:')
    setRefreshKey(k => k + 1)
  }

  // Reset the shared content scroller when navigating between views so a
  // details page never opens mid-scroll (the library view has its own
  // internal scroller and restores its position itself)
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0 })
  }, [currentView])
  const [currentItem, setCurrentItem] = useState<BaseItemDto | null>(null)
  const [localPlaybackPath, setLocalPlaybackPath] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [downloadStats, setDownloadStats] = useState(() => getDownloadStats())
  const [episodeQueue, setEpisodeQueue] = useState<BaseItemDto[]>([])
  // Track whether we auto-navigated to downloads due to offline mode
  const autoNavigatedOfflineRef = useRef(false)

  // Background soft-refresh: after playback (and on a periodic timer) ask the
  // mounted content view to quietly refetch its watched marks / Continue
  // Watching / Up Next and diff them into place — no remount, no spinner.
  // Debounced through a single timer so a burst of triggers coalesces, and
  // delayed a little after playback so the server has processed the "stopped"
  // report before we read it back.
  const softRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSoftRefresh = useCallback((delayMs = 1500) => {
    if (softRefreshTimerRef.current) clearTimeout(softRefreshTimerRef.current)
    softRefreshTimerRef.current = setTimeout(() => {
      softRefreshTimerRef.current = null
      requestJellyfinSoftRefresh()
    }, delayMs)
  }, [])
  useEffect(() => () => {
    if (softRefreshTimerRef.current) clearTimeout(softRefreshTimerRef.current)
  }, [])

  // Subscribe to download stats updates
  useEffect(() => {
    const update = () => setDownloadStats(getDownloadStats())
    const unsubscribe = subscribeToDownloadUpdates(update)
    return unsubscribe
  }, [])

  // Handle initial play item (deep linking from global search)
  useEffect(() => {
    if (initialPlayItem && isAuthenticated && !isPlaying) {
      console.log('Deep linking: Playing item from search', initialPlayItem.Name)
      handlePlayItem(initialPlayItem)
      onInitialPlayHandled?.()
    }
  }, [initialPlayItem, isAuthenticated, isPlaying, onInitialPlayHandled])

  // Handle initial open item (deep linking from global search: Series etc.
  // open their details page instead of playing)
  useEffect(() => {
    if (initialOpenItem && isAuthenticated) {
      setViewHistory(h => [...h, { type: 'details', item: initialOpenItem }])
      onInitialOpenHandled?.()
    }
  }, [initialOpenItem, isAuthenticated, onInitialOpenHandled])

  // Auto-navigate to offline library when server becomes unreachable
  useEffect(() => {
    if (isOffline && !autoNavigatedOfflineRef.current) {
      autoNavigatedOfflineRef.current = true
      setViewHistory([{ type: 'downloads' }])
    } else if (!isOffline && autoNavigatedOfflineRef.current) {
      autoNavigatedOfflineRef.current = false
      // Return to home when server comes back
      setViewHistory([{ type: 'home' }])
    }
  }, [isOffline])

  // Pull-to-refresh (phone): home scrolls in the shared content div, but the
  // library view scrolls inside VirtuosoGrid's own scroller (populated by
  // JellyfinLibrary below) — resolve the active one at touch time
  const libraryScrollerRef = useRef<HTMLElement | null>(null)
  const currentViewTypeRef = useRef(currentView.type)
  currentViewTypeRef.current = currentView.type
  const pullState = usePullToRefresh(
    () => (currentViewTypeRef.current === 'library' ? libraryScrollerRef.current : contentScrollRef.current),
    handleRefresh,
    !isPlaying && (currentView.type === 'home' || currentView.type === 'library')
  )

  // Smart re-tap on the Jellyfin tab: scroll the shared content scroller to
  // top, or (already at top / in a sub-view) pop back to home. The library
  // grid has its own internal scroller (VirtuosoGrid) the shared ref can't
  // reach — there a re-tap falls back to "navigate home".
  useEffect(() => {
    return registerTabReset('jellyfin', () => {
      if (isPlaying) return // player overlay open — leave it alone
      smartTabReset(contentScrollRef.current, currentView.type === 'home', () => {
        setViewHistory([{ type: 'home' }])
      })
    })
  }, [isPlaying, currentView.type])

  // Back gestures (Esc / mouse back / edge-swipe): pop the navigation history
  // stack. While the player is open, Esc is suppressed via blocker (the player
  // has its own Escape handling: exit fullscreen, then close); the mouse back
  // button and phone edge-swipe close the player directly.
  useEffect(() => {
    return registerBackHandler((source) => {
      if (isPlaying) {
        if (source !== 'esc') {
          setIsPlaying(false)
          setCurrentItem(null)
          setLocalPlaybackPath(null)
          scheduleSoftRefresh()
        }
        return true
      }
      if (viewHistory.length > 1) {
        setViewHistory(prev => prev.slice(0, -1))
        return true
      }
      return false
    })
  }, [isPlaying, viewHistory.length])

  // The video player owns Escape (fullscreen exit / close) — keep global
  // Esc-as-back silent while it is mounted
  useEffect(() => {
    if (isPlaying) return blockGlobalEsc()
  }, [isPlaying])

  // Periodic background refresh: keep the mounted view's watched marks /
  // Continue Watching / Up Next current while the user browses. Paused while
  // the player is open, and each tick is skipped when the tab is hidden so we
  // don't poll in the background. 60s cadence.
  useEffect(() => {
    if (isPlaying) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') requestJellyfinSoftRefresh()
    }, 60000)
    return () => clearInterval(id)
  }, [isPlaying])

  const pushView = (view: ViewState) => {
    setViewHistory(prev => [...prev, view])
  }

  const popView = () => {
    if (viewHistory.length > 1) {
      setViewHistory(prev => prev.slice(0, -1))
    }
  }

  // Series/Seasons are folders — handing them to the player opens an empty
  // player with nothing to stream. Resolve them to the episode that should
  // play: NextUp for series, else first unwatched, else the first episode.
  const resolvePlayableItem = async (item: BaseItemDto): Promise<BaseItemDto | null> => {
    if (item.Type !== 'Series' && item.Type !== 'Season') return item
    if (!api || !user?.Id) return null
    try {
      if (item.Type === 'Series' && serverUrl) {
        const res = await appApi.request({
          method: 'GET',
          url: `${serverUrl}/Shows/NextUp?seriesId=${item.Id}&userId=${user.Id}&limit=1&fields=Overview`,
          headers: {
            'Authorization': `MediaBrowser Token="${api.accessToken}"`,
          },
        })
        const next = res.success ? res.data?.Items?.[0] : null
        if (next && isRealItem(next)) return next
      }
      const itemsApi = getItemsApi(api)
      const eps = await itemsApi.getItems({
        userId: user.Id,
        parentId: item.Id!,
        includeItemTypes: ['Episode'],
        recursive: true,
        isMissing: false,
        sortBy: ['ParentIndexNumber', 'IndexNumber'] as any,
        sortOrder: ['Ascending'],
        fields: ['UserData', 'Overview'] as any,
      })
      let list = (eps.data.Items || []).filter(isRealItem)
      if (item.Type === 'Series') {
        // A series should start at S1E1, not at a special
        const regular = list.filter(ep => !isSpecial(ep))
        if (regular.length > 0) list = regular
      }
      return list.find(ep => !ep.UserData?.Played) || list[0] || null
    } catch (e) {
      console.error('Failed to resolve playable episode:', e)
      return null
    }
  }

  const handlePlayItem = async (item: BaseItemDto, localPath?: string) => {
    if (item.Type === 'Series' || item.Type === 'Season') {
      const resolved = await resolvePlayableItem(item)
      if (!resolved) return
      item = resolved
      localPath = undefined
    }
    setCurrentItem(item)
    setLocalPlaybackPath(localPath || null)
    setIsPlaying(true)

    // For episodes, fetch the episode list of the WHOLE series so "Up Next"
    // keeps going across season boundaries (a season-scoped queue used to
    // dead-end on every season finale)
    if (item.Type === 'Episode' && (item.SeriesId || item.SeasonId) && api && user?.Id) {
      try {
        const itemsApi = getItemsApi(api)
        const response = await itemsApi.getItems({
          userId: user.Id,
          parentId: (item.SeriesId || item.SeasonId)!,
          includeItemTypes: ['Episode'],
          recursive: true,
          isMissing: false,
          sortBy: ['ParentIndexNumber', 'IndexNumber'] as any,
          sortOrder: ['Ascending'],
          fields: ['UserData', 'Overview'] as any
        })
        let queue = (response.data.Items || []).filter(isRealItem)
        // Specials (season 0) sort before season 1 and would wedge themselves
        // into the episode order — drop them unless we're playing one
        if (!isSpecial(item)) {
          queue = queue.filter(ep => !isSpecial(ep))
        }
        setEpisodeQueue(queue)
      } catch (e) {
        console.error('Failed to fetch episode queue:', e)
        setEpisodeQueue([])
      }
    } else {
      setEpisodeQueue([])
    }
  }

  // Handle playing the next episode from the queue
  const handlePlayNext = (nextItem: BaseItemDto) => {
    setCurrentItem(nextItem)
    setLocalPlaybackPath(null)
    // The episode we just left finished (or was skipped) — quietly refresh the
    // view behind the player so its watched marks are current when we exit
    scheduleSoftRefresh()
    // The queue covers the whole series, so it stays valid across seasons
  }

  // Play from offline library with local path
  const handlePlayOfflineItem = (itemId: string, localPath: string) => {
    const downloadedItem = getDownloadedItem(itemId)
    if (downloadedItem) {
      // Create a minimal BaseItemDto for the player
      const item: BaseItemDto = {
        Id: itemId,
        Name: downloadedItem.name,
        Type: downloadedItem.type,
        SeriesName: downloadedItem.seriesName,
        ParentIndexNumber: downloadedItem.seasonNumber,
        IndexNumber: downloadedItem.episodeNumber,
        RunTimeTicks: downloadedItem.runTimeTicks,
        Overview: downloadedItem.overview,
        ProductionYear: downloadedItem.productionYear,
        Genres: downloadedItem.genres,
      }
      setCurrentItem(item)
      setLocalPlaybackPath(localPath)
      setIsPlaying(true)
    }
  }

  const handleViewItem = (item: BaseItemDto) => {
    // Check item type and navigate appropriately
    const itemType = item.Type || item.CollectionType

    if (item.CollectionType || itemType === 'CollectionFolder' || itemType === 'UserView') {
      // It's a library - open library view
      pushView({ type: 'library', library: item })
    } else if (itemType === 'Series') {
      // It's a series - open details view
      pushView({ type: 'details', item })
    } else if (itemType === 'Movie' || itemType === 'Episode') {
      // Playable content - open details view (NOT play directly!)
      pushView({ type: 'details', item })
    } else if (itemType === 'Season') {
      // Season - open details view to show episode list
      pushView({ type: 'details', item })
    } else {
      // Unknown type - try to browse it
      pushView({ type: 'library', library: item })
    }
  }

  const handleBack = () => {
    popView()
  }

  const handleClosePlayer = () => {
    setIsPlaying(false)
    setCurrentItem(null)
    setLocalPlaybackPath(null)
    // Refresh the view we're returning to so what we just watched shows up in
    // Continue Watching / Up Next / watched marks without a hard reload
    scheduleSoftRefresh()
  }

  const handleOpenDownloads = () => {
    pushView({ type: 'downloads' })
  }

  const handleOpenMusic = () => {
    setViewHistory([{ type: 'music' }])
  }

  const handleGoHome = () => {
    setViewHistory([{ type: 'home' }])
  }

  // App tab bar navigation (fixed tab order, active tab highlighted)
  const handleTabNavigate = (tab: AppTab) => {
    switch (tab) {
      case 'calibre': onBackToReader(); break
      case 'jellymusic': (onSwitchToJellyMusic ?? handleOpenMusic)(); break
      case 'requester': onSwitchToRequester?.(); break
      case 'livetv': onSwitchToLiveTV?.(); break
      case 'audiobookshelf': onSwitchToAudiobooks?.(); break
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full bg-gray-900 flex items-center justify-center">
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
      <div className="h-full bg-gradient-to-br from-gray-900 via-theme-900/20 to-gray-900 overflow-auto">
        {/* Client switch buttons */}
        <div className="absolute top-4 left-4 z-50">
          <AppTabs active="jellyfin" onNavigate={handleTabNavigate} />
        </div>

        <JellyfinSetup onComplete={() => {}} />
      </div>
    )
  }

  // Authenticated - show home
  return (
    <div className="h-full bg-gray-900 text-white overflow-hidden flex flex-col">
      {/* Top Bar */}
      <div className="flex-shrink-0 h-16 phone:h-auto phone:min-h-14 phone:pt-safe px-4 flex items-center justify-between bg-black/30 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-4">
          <AppTabs active="jellyfin" onNavigate={handleTabNavigate} />

          <div className="h-6 w-px bg-white/10 phone:hidden" />

          <div className="flex items-center gap-2">
            <Server size={16} className="text-theme-400" />
            <span className="text-sm text-white/60 phone:hidden">{serverName}</span>
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
              <Search size={20} className="text-white/60" />
            </button>
          )}

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title="Refresh"
          >
            <RefreshCw size={20} className="text-white/60" />
          </button>

          {/* Home Button */}
          <button
            onClick={handleGoHome}
            className={`p-2 hover:bg-white/10 rounded-full transition-colors ${
              currentView.type === 'home' ? 'text-theme-400' : 'text-white/60'
            }`}
            title="Home"
          >
            <Home size={20} />
          </button>

          {/* Unified download manager (all apps) */}
          <DownloadCenter />

          {/* Offline library */}
          <button
            onClick={handleOpenDownloads}
            className={`relative p-2 hover:bg-white/10 rounded-full transition-colors ${
              currentView.type === 'downloads' ? 'bg-white/10' : ''
            }`}
            title="Downloads"
          >
            <HardDrive size={20} className="text-white/60" />
            {(downloadStats.queueCount + downloadStats.downloadingCount > 0) && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-theme-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                {downloadStats.queueCount + downloadStats.downloadingCount}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              if (onOpenSettings) {
                onOpenSettings()
              } else {
                setShowSettings(!showSettings)
              }
            }}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title="Settings"
          >
            <SettingsIcon size={20} className="text-white/60" />
          </button>

          <button
            onClick={logout}
            className="p-2 hover:bg-white/10 rounded-full transition-colors phone:hidden"
            title="Sign out"
          >
            <LogOut size={20} className="text-white/60" />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="absolute top-16 right-4 phone:right-2 z-40 w-80 phone:w-[min(20rem,calc(100vw-1rem))] bg-gray-800 rounded-xl border border-white/10 shadow-2xl p-4 space-y-4">
          <h3 className="font-semibold text-white">Settings</h3>

          <div className="space-y-2">
            <p className="text-sm text-white/60">Server: {serverName}</p>
            <p className="text-sm text-white/60">User: {user?.Name}</p>
          </div>

          <div className="pt-2 border-t border-white/10 space-y-2">
            <button
              onClick={() => {
                logout()
                setShowSettings(false)
              }}
              className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
            >
              Sign out
            </button>

            <button
              onClick={() => {
                disconnect()
                setShowSettings(false)
              }}
              className="w-full px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm transition-colors"
            >
              Disconnect from server
            </button>
          </div>
        </div>
      )}

      {/* Click outside to close settings */}
      {showSettings && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setShowSettings(false)}
        />
      )}

      {/* Main Content */}
      <div className="relative flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto phone:overflow-x-hidden custom-scrollbar" ref={contentScrollRef}>
        {currentView.type === 'home' && (
          <JellyfinHome key={`home-${refreshKey}`} onPlayItem={handlePlayItem} onViewItem={handleViewItem} />
        )}
        {currentView.type === 'library' && (
          <JellyfinLibrary
            key={`${currentView.library.Id}-${refreshKey}`}
            library={currentView.library}
            onPlayItem={handlePlayItem}
            onViewItem={handleViewItem}
            onBack={handleBack}
            scrollerElRef={libraryScrollerRef}
          />
        )}
        {currentView.type === 'details' && (
          <JellyfinItemDetails
            key={`${currentView.item.Id}-${refreshKey}`}
            item={currentView.item}
            onPlay={handlePlayItem}
            onBack={handleBack}
            onViewItem={handleViewItem}
          />
        )}
        {currentView.type === 'downloads' && (
          <JellyfinOfflineLibrary
            key={`downloads-${refreshKey}`}
            onBack={handleBack}
            onPlayItem={handlePlayOfflineItem}
            offlineMode={isOffline}
          />
        )}
        {currentView.type === 'music' && (
          <MusicView onBack={handleGoHome} />
        )}
      </div>
      {/* Outside the keyed subtree so the refresh remount can't unmount it */}
      <PullToRefreshIndicator {...pullState} />
      </div>

      {/* Player */}
      {isPlaying && currentItem && (
        <JellyfinPlayer
          item={currentItem}
          onClose={handleClosePlayer}
          startPosition={currentItem.UserData?.PlaybackPositionTicks}
          localPath={localPlaybackPath || undefined}
          episodeQueue={episodeQueue}
          onPlayNext={handlePlayNext}
        />
      )}
    </div>
  )
}

// Main export with provider
export function JellyfinView(props: JellyfinViewProps) {
  return (
    <JellyfinProvider>
      <JellyfinContent {...props} />
    </JellyfinProvider>
  )
}
