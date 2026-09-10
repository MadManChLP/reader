import React, { memo, useEffect, useRef, useState } from 'react'
import { Settings as SettingsIcon, LogOut, Shield, RefreshCw, Search } from 'lucide-react'
import { RequesterProvider, useRequester } from './RequesterContext'
import { AppTabs, type AppTab } from '../AppTabs'
import { RequesterSetup } from './RequesterSetup'
import { RequesterHome } from './RequesterHome'
import { DownloadCenter } from '../downloads'
import { registerTabReset } from '../../utils/navigationBus'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '../PullToRefreshIndicator'

interface RequesterViewProps {
  onBackToReader: () => void
  onSwitchToJellyfin: () => void
  onSwitchToJellyMusic: () => void
  onOpenSettings?: () => void
  onSwitchToLiveTV?: () => void
  onSwitchToAudiobooks?: () => void
  // Open the app-wide global search modal
  onOpenSearch?: () => void
}

function RequesterContent({
  onBackToReader,
  onSwitchToJellyfin,
  onSwitchToJellyMusic,
  onOpenSettings,
  onSwitchToLiveTV,
  onSwitchToAudiobooks,
  onOpenSearch,
}: RequesterViewProps) {
  const { isAuthenticated, isLoggingIn, userInfo, isAdmin, logout } = useRequester()

  // Refresh: remount the home content so it refetches
  const [refreshKey, setRefreshKey] = useState(0)

  // Smart re-tap on the Requester tab: scroll the content back to top.
  // Requester is a single-view tab (no sub-navigation), so there is no
  // "go home" step and no back handler here.
  const mainScrollRef = useRef<HTMLElement>(null)
  useEffect(() => {
    return registerTabReset('requester', () => {
      mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }, [])

  // Pull-to-refresh (phone): same remount-based refresh as the toolbar button
  const pullState = usePullToRefresh(mainScrollRef, () => setRefreshKey(k => k + 1))

  // App tab bar navigation (fixed tab order, active tab highlighted)
  const handleTabNavigate = (tab: AppTab) => {
    switch (tab) {
      case 'calibre': onBackToReader(); break
      case 'jellyfin': onSwitchToJellyfin(); break
      case 'jellymusic': onSwitchToJellyMusic(); break
      case 'livetv': onSwitchToLiveTV?.(); break
      case 'audiobookshelf': onSwitchToAudiobooks?.(); break
    }
  }

  if (isLoggingIn) {
    return (
      <div className="h-full bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-theme-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-white/60">Connecting...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="h-full bg-gradient-to-br from-gray-900 via-theme-900/20 to-gray-900 overflow-auto">
        <div className="absolute top-4 left-4 z-50">
          <AppTabs active="requester" onNavigate={handleTabNavigate} />
        </div>
        <RequesterSetup />
      </div>
    )
  }

  return (
    <div className="h-full bg-gray-900 text-white overflow-hidden flex flex-col">
      {/* Top Bar */}
      <div className="flex-shrink-0 h-14 phone:h-auto phone:min-h-14 phone:pt-safe px-4 flex items-center justify-between bg-black/40 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3">
          <AppTabs active="requester" onNavigate={handleTabNavigate} />
        </div>

        <div className="flex items-center gap-2">
          {userInfo && (
            <div className="flex items-center gap-2 mr-2">
              {isAdmin && <span title="Admin"><Shield size={14} className="text-amber-400" /></span>}
              <span className="text-sm text-white/60 phone:hidden">{userInfo.display_name || userInfo.username}</span>
            </div>
          )}
          {/* Global Search */}
          {onOpenSearch && (
            <button onClick={onOpenSearch}
              className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Search (Ctrl+K)">
              <Search size={18} className="text-white/60" />
            </button>
          )}
          {/* Unified download manager (all apps) */}
          <DownloadCenter />
          <button onClick={() => setRefreshKey(k => k + 1)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Refresh">
            <RefreshCw size={18} className="text-white/60" />
          </button>
          {onOpenSettings && (
            <button onClick={onOpenSettings}
              className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Settings">
              <SettingsIcon size={18} className="text-white/60" />
            </button>
          )}
          <button onClick={logout}
            className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Disconnect">
            <LogOut size={18} className="text-white/60" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 flex flex-col">
        <main ref={mainScrollRef} className="flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-b from-gray-900/50 to-black">
          <RequesterHome key={refreshKey} />
        </main>
        {/* Outside the keyed subtree so the refresh remount can't unmount it */}
        <PullToRefreshIndicator {...pullState} />
      </div>
    </div>
  )
}

export const RequesterView = memo(function RequesterView(props: RequesterViewProps) {
  return (
    <RequesterProvider>
      <RequesterContent {...props} />
    </RequesterProvider>
  )
})
