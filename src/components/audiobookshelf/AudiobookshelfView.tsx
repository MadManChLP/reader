import React, { useCallback, useEffect, useRef, useState } from 'react'
import { LogOut, Settings as SettingsIcon, WifiOff, Headphones, RefreshCw, Search } from 'lucide-react'
import { AudiobookshelfProvider, useAudiobookshelf } from './AudiobookshelfContext'
import { AppTabs, type AppTab } from '../AppTabs'
import AbsSetup from './AbsSetup'
import { AbsSidebar } from './AbsSidebar'
import { AbsPhoneNav } from './AbsPhoneNav'
import { AbsHome } from './AbsHome'
import { AbsLibrary } from './AbsLibrary'
import { AbsSeriesGrid } from './AbsSeriesGrid'
import { AbsSeriesDetails } from './AbsSeriesDetails'
import { AbsItemDetails } from './AbsItemDetails'
import { AbsPodcastDetails } from './AbsPodcastDetails'
import { AbsDownloads } from './AbsDownloads'
import { AbsPlayerBar } from './AbsPlayerBar'
import { useAudiobookPlayer } from '../../stores/audiobookPlayerStore'
import { startItemPlayback } from './absHelpers'
import { processAbsQueue } from '../../utils/absOfflineQueue'
import { verifyAbsDownloads } from '../../utils/absDownloadManager'
import type { AbsLibrary as AbsLibraryType } from '../../types/audiobookshelf'
import { DownloadCenter } from '../downloads'
import { clearGridStates } from '../../utils/viewStateCache'
import { registerTabReset, registerBackHandler, smartTabReset } from '../../utils/navigationBus'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '../PullToRefreshIndicator'

export type AbsViewType =
  | { type: 'home' }
  | { type: 'library'; library: AbsLibraryType }
  | { type: 'series'; library: AbsLibraryType }
  | { type: 'series-details'; seriesId: string; seriesName: string; libraryId: string }
  | { type: 'item-details'; itemId: string }
  | { type: 'podcast-details'; itemId: string }
  | { type: 'downloads' }

export interface AudiobookshelfViewProps {
  onBackToReader: () => void
  onSwitchToJellyfin: () => void
  onSwitchToJellyMusic: () => void
  onOpenSettings?: () => void
  onSwitchToRequester?: () => void
  onSwitchToLiveTV?: () => void
  // Deep linking from global search: open + play an item immediately
  initialPlayItemId?: string | null
  onInitialPlayHandled?: () => void
  // Open the app-wide global search modal
  onOpenSearch?: () => void
}

function AudiobookshelfContent({
  onBackToReader,
  onSwitchToJellyfin,
  onSwitchToJellyMusic,
  onOpenSettings,
  onSwitchToRequester,
  onSwitchToLiveTV,
  initialPlayItemId,
  onInitialPlayHandled,
  onOpenSearch,
}: AudiobookshelfViewProps) {
  const { isAuthenticated, isLoading, isOffline, user, serverUrl, api, logout } = useAudiobookshelf()

  const [absView, setAbsView] = useState<AbsViewType>({ type: 'home' })
  const [viewHistory, setViewHistory] = useState<AbsViewType[]>([{ type: 'home' }])
  const [libraries, setLibraries] = useState<AbsLibraryType[]>([])

  // Refresh: remount the current content (refetch) without losing navigation
  const [refreshKey, setRefreshKey] = useState(0)
  const handleRefresh = () => {
    clearGridStates('abs-library:')
    setRefreshKey(k => k + 1)
  }

  const setAbsApi = useAudiobookPlayer((s) => s.setAbsApi)

  // Mirror the API client into the player store so the App-level
  // PersistentAudiobookPlayer can stream + sync sessions
  useEffect(() => {
    setAbsApi(api)
  }, [api, setAbsApi])

  // Load libraries once authenticated; also flush offline progress queue
  useEffect(() => {
    if (!api || !isAuthenticated || isOffline) return
    let active = true
    api
      .getLibraries()
      .then((libs) => active && setLibraries(libs))
      .catch((e) => console.error('[Abs] Failed to load libraries:', e))
    processAbsQueue(api).catch(() => {})
    return () => {
      active = false
    }
  }, [api, isAuthenticated, isOffline, refreshKey])

  // Prune download entries whose files were deleted from disk (once per mount)
  useEffect(() => {
    verifyAbsDownloads().catch(() => {})
  }, [])

  // Deep linking: play an item from global search
  useEffect(() => {
    if (!initialPlayItemId || !api || !isAuthenticated) return
    api
      .getItem(initialPlayItemId)
      .then((item) => {
        if (item.mediaType === 'podcast') {
          // Podcasts have no single "play" target — open the episode list
          navigateTo({ type: 'podcast-details', itemId: item.id })
        } else {
          navigateTo({ type: 'item-details', itemId: item.id })
          return startItemPlayback(api, item)
        }
      })
      .catch((e) => console.error('[Abs] Deep-link play failed:', e))
      .finally(() => onInitialPlayHandled?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPlayItemId, api, isAuthenticated])

  // Navigate to downloads automatically when offline
  useEffect(() => {
    if (isOffline) {
      setViewHistory([{ type: 'downloads' }])
      setAbsView({ type: 'downloads' })
    }
  }, [isOffline])

  const navigateTo = useCallback((view: AbsViewType) => {
    setViewHistory((prev) => [...prev, view])
    setAbsView(view)
  }, [])

  const goBack = useCallback(() => {
    setViewHistory((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.slice(0, -1)
      setAbsView(next[next.length - 1])
      return next
    })
  }, [])

  const goHome = useCallback(() => {
    setViewHistory([{ type: 'home' }])
    setAbsView({ type: 'home' })
  }, [])

  // Main content scroller — used by the smart tab re-tap to scroll to top
  const mainScrollRef = useRef<HTMLElement>(null)

  // Smart re-tap on the Audiobooks tab: scroll the content to top, or
  // (already at top / in a sub-view) return to the Audiobookshelf home
  useEffect(() => {
    return registerTabReset('audiobookshelf', () => {
      smartTabReset(mainScrollRef.current, absView.type === 'home', goHome)
    })
  }, [absView.type, goHome])

  // Pull-to-refresh (phone): same remount-based refresh as the toolbar
  // button, on the browsing views only (not details/downloads)
  const pullState = usePullToRefresh(
    mainScrollRef,
    handleRefresh,
    absView.type === 'home' || absView.type === 'library' || absView.type === 'series'
  )

  // Back gestures (Esc / mouse back): walk the view history
  useEffect(() => {
    return registerBackHandler(() => {
      if (viewHistory.length > 1) { goBack(); return true }
      return false
    })
  }, [viewHistory, goBack])

  // App tab bar navigation (fixed tab order, active tab highlighted)
  const handleTabNavigate = (tab: AppTab) => {
    switch (tab) {
      case 'calibre': onBackToReader(); break
      case 'jellyfin': onSwitchToJellyfin(); break
      case 'jellymusic': onSwitchToJellyMusic(); break
      case 'requester': onSwitchToRequester?.(); break
      case 'livetv': onSwitchToLiveTV?.(); break
    }
  }

  const switchButtons = <AppTabs active="audiobookshelf" onNavigate={handleTabNavigate} />

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

  // Not connected (and not usable offline) — show the SSO setup screen
  if (!isAuthenticated && !isOffline) {
    return (
      <div className="h-screen phone:h-full bg-gradient-to-br from-gray-900 via-theme-900/10 to-gray-900 text-white flex flex-col">
        <div className="p-4 flex items-center gap-2">{switchButtons}</div>
        <AbsSetup />
      </div>
    )
  }

  const renderContent = () => {
    switch (absView.type) {
      case 'home':
        return <AbsHome key={`home-${refreshKey}`} libraries={libraries} onNavigate={navigateTo} />
      case 'library':
        return <AbsLibrary key={`${absView.library.id}-${refreshKey}`} library={absView.library} onNavigate={navigateTo} />
      case 'series':
        return <AbsSeriesGrid key={`series-${absView.library.id}-${refreshKey}`} library={absView.library} onNavigate={navigateTo} />
      case 'series-details':
        return (
          <AbsSeriesDetails
            key={`${absView.seriesId}-${refreshKey}`}
            seriesId={absView.seriesId}
            seriesName={absView.seriesName}
            libraryId={absView.libraryId}
            onBack={goBack}
            onNavigate={navigateTo}
          />
        )
      case 'item-details':
        return <AbsItemDetails key={`${absView.itemId}-${refreshKey}`} itemId={absView.itemId} onBack={goBack} onNavigate={navigateTo} />
      case 'podcast-details':
        return <AbsPodcastDetails key={`${absView.itemId}-${refreshKey}`} itemId={absView.itemId} onBack={goBack} />
      case 'downloads':
        return <AbsDownloads key={`downloads-${refreshKey}`} offlineMode={isOffline} />
      default:
        return null
    }
  }

  return (
    <div className="h-screen phone:h-full bg-gray-900 text-white overflow-hidden flex flex-col">
      {/* Top bar */}
      <div className="flex-shrink-0 h-14 phone:h-auto phone:min-h-14 phone:pt-safe px-4 flex items-center justify-between bg-black/40 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3">
          {switchButtons}
          <div className="h-5 w-px bg-white/10 phone:hidden" />
          <div className="flex items-center gap-2">
            <Headphones size={16} className="text-theme-400" />
            <span className="text-sm text-white/60 phone:hidden">{serverUrl.replace(/^https?:\/\//, '')}</span>
            {isOffline && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-medium">
                <WifiOff size={10} />
                OFFLINE
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user && <span className="text-sm text-white/60 mr-2 phone:hidden">{user.username}</span>}
          {/* Global Search */}
          {onOpenSearch && (
            <button onClick={onOpenSearch} className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Search (Ctrl+K)">
              <Search size={18} className="text-white/60" />
            </button>
          )}
          {/* Unified download manager (all apps) */}
          <DownloadCenter />
          <button onClick={handleRefresh} className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Refresh">
            <RefreshCw size={18} className="text-white/60" />
          </button>
          <button onClick={onOpenSettings} className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Settings">
            <SettingsIcon size={18} className="text-white/60" />
          </button>
          <button onClick={() => logout()} className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Sign out">
            <LogOut size={18} className="text-white/60" />
          </button>
        </div>
      </div>

      {/* Phone navigation (chip row; renders nothing on desktop) */}
      <AbsPhoneNav currentView={absView} libraries={libraries} onNavigate={navigateTo} />

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        <AbsSidebar currentView={absView} libraries={libraries} onNavigate={navigateTo} />
        <div className="relative flex-1 min-w-0 flex">
          <main ref={mainScrollRef} className="flex-1 overflow-y-auto phone:overflow-x-hidden custom-scrollbar bg-gradient-to-b from-gray-900/50 to-black">
            {renderContent()}
          </main>
          {/* Outside the keyed subtree so the refresh remount can't unmount it */}
          <PullToRefreshIndicator {...pullState} />
        </div>
      </div>

      {/* Player bar (only visible while something is loaded) */}
      <AbsPlayerBar />
    </div>
  )
}

export function AudiobookshelfView(props: AudiobookshelfViewProps) {
  return (
    <AudiobookshelfProvider>
      <AudiobookshelfContent {...props} />
    </AudiobookshelfProvider>
  )
}

export default AudiobookshelfView
