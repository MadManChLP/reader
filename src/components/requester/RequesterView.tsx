import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { Settings as SettingsIcon, LogOut, Shield, RefreshCw, Search, Compass, CalendarClock, History, Search as SearchIcon } from 'lucide-react'
import { RequesterProvider, useRequester } from './RequesterContext'
import { AppTabs, type AppTab } from '../AppTabs'
import { RequesterSetup } from './RequesterSetup'
import { SearchSection } from './SearchSection'
import { DiscoverSection, clearDiscoverCache } from './discover/DiscoverSection'
import { GenrePage } from './discover/GenrePage'
import { TitleDetailPage } from './discover/TitleDetailPage'
import { UpcomingSection } from './upcoming/UpcomingSection'
import { RequestsSection } from './requests/RequestsSection'
import { RequestDetailPage } from './requests/RequestDetailPage'
import { NotificationsPage } from './requests/NotificationsPage'
import { AdminPanel } from './admin/AdminPanel'
import { ReleasePickerPage } from './admin/ReleasePickerPage'
import { useRequesterNav, type RequesterSection, type RequesterPage } from '../../stores/requesterNavStore'
import { useRequesterLive } from '../../stores/requesterLiveStore'
import { DownloadCenter } from '../downloads'
import { registerTabReset, registerBackHandler } from '../../utils/navigationBus'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '../PullToRefreshIndicator'
import { SectionErrorBoundary } from '../SectionErrorBoundary'

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

  const { section, stack, setSection, pop, reset } = useRequesterNav(useShallow(s => ({
    section: s.section, stack: s.stack, setSection: s.setSection, pop: s.pop, reset: s.reset,
  })))
  const topPage = stack[stack.length - 1] ?? null
  // Admin-only section: fall back for regular users (e.g. a remembered tab)
  const activeSection: RequesterSection = section === 'admin' && !isAdmin ? 'discover' : section

  const mainScrollRef = useRef<HTMLElement>(null)

  // Smart re-tap on the Requester tab: close pages → scroll to top → Discover
  useEffect(() => {
    return registerTabReset('requester', () => {
      const nav = useRequesterNav.getState()
      const el = mainScrollRef.current
      if (nav.stack.length > 0) { nav.reset(); return }
      if (el && el.scrollTop > 8) { el.scrollTo({ top: 0, behavior: 'smooth' }); return }
      if (nav.section !== 'discover') nav.setSection('discover')
    })
  }, [])

  // Back / Esc / edge-swipe pop the page stack first
  useEffect(() => {
    if (stack.length === 0) return
    return registerBackHandler(() => pop())
  }, [stack.length, pop])

  // Scroll: pages open at the top, going back restores the position below
  const scrollMemo = useRef<number[]>([])
  const prevDepth = useRef(0)
  useLayoutEffect(() => {
    const el = mainScrollRef.current
    if (!el) return
    if (stack.length > prevDepth.current) {
      el.scrollTop = 0
    } else if (stack.length < prevDepth.current) {
      el.scrollTop = scrollMemo.current[stack.length] ?? 0
    }
    prevDepth.current = stack.length
  }, [stack.length])
  // Remember the position of each depth right before something is pushed on it
  useEffect(() => {
    const el = mainScrollRef.current
    if (!el) return
    const onScroll = () => { scrollMemo.current[useRequesterNav.getState().stack.length] = el.scrollTop }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isAuthenticated])

  const refresh = () => {
    clearDiscoverCache()
    void useRequesterLive.getState().reload()
    setRefreshKey(k => k + 1)
  }

  // Pull-to-refresh (phone): same remount-based refresh as the toolbar button
  const pullState = usePullToRefresh(mainScrollRef, refresh)

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
          <button onClick={refresh}
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
        <SectionNav active={activeSection} isAdmin={isAdmin} onSelect={(s) => { reset(); setSection(s) }} />
        <main ref={mainScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-gradient-to-b from-gray-900/50 to-black">
          {/* Sections stay mounted under an open page, so going back keeps
              search results, filters and loaded rows */}
          <div key={refreshKey} className={topPage ? 'hidden' : ''}>
            {/* A crash in one section must not blank the whole app */}
            <SectionErrorBoundary label={`the ${activeSection} section`} resetKey={activeSection}>
              <SectionBody section={activeSection} />
            </SectionErrorBoundary>
          </div>
          {topPage && (
            <SectionErrorBoundary label="this page" resetKey={stack.length}>
              <PageBody key={`${refreshKey}:${stack.length}`} page={topPage} />
            </SectionErrorBoundary>
          )}
        </main>
        {/* Outside the keyed subtree so the refresh remount can't unmount it */}
        <PullToRefreshIndicator {...pullState} />
      </div>
    </div>
  )
}

// ── Sub-navigation ─────────────────────────────────────────────────────

const SECTIONS: { id: RequesterSection; label: string; Icon: React.ComponentType<{ size?: number }>; adminOnly?: boolean }[] = [
  { id: 'discover', label: 'Discover', Icon: Compass },
  { id: 'search', label: 'Search', Icon: SearchIcon },
  { id: 'upcoming', label: 'Upcoming', Icon: CalendarClock },
  { id: 'requests', label: 'Requests', Icon: History },
  { id: 'admin', label: 'Admin', Icon: Shield, adminOnly: true },
]

function SectionNav({ active, isAdmin, onSelect }: { active: RequesterSection; isAdmin: boolean; onSelect: (s: RequesterSection) => void }) {
  const unseen = useRequesterLive(s => s.unseen)
  const pending = useRequesterLive(s => (isAdmin ? s.history.filter(h => h.status === 'pending').length : 0))
  return (
    <nav className="flex-shrink-0 flex gap-1 px-4 phone:px-2 py-2 border-b border-white/5 bg-black/20 overflow-x-auto scrollbar-hide">
      {SECTIONS.filter(s => !s.adminOnly || isAdmin).map(s => {
        const isActive = s.id === active
        const badge = s.id === 'requests' ? unseen : s.id === 'admin' ? pending : 0
        return (
          <button key={s.id} type="button" onClick={() => onSelect(s.id)}
            className={`relative flex-shrink-0 flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
              isActive ? 'bg-theme-500/20 text-theme-300' : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}>
            <s.Icon size={15} />
            <span>{s.label}</span>
            {badge > 0 && (
              <span className={`min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-4 text-center font-semibold ${s.id === 'admin' ? 'bg-amber-500 text-black' : 'bg-red-500 text-white'}`}>
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

function SectionBody({ section }: { section: RequesterSection }) {
  switch (section) {
    case 'discover': return <DiscoverSection />
    case 'search': return <SearchSection />
    case 'upcoming': return <UpcomingSection />
    case 'requests': return <RequestsSection />
    case 'admin': return <AdminPanel />
  }
}

function PageBody({ page }: { page: RequesterPage }) {
  switch (page.type) {
    case 'title':
      return page.kind === 'movie'
        ? <TitleDetailPage kind="movie" tmdbId={page.tmdbId} title={page.title} poster={page.poster} />
        : <TitleDetailPage kind={page.kind} slug={page.slug} title={page.title} poster={page.poster} />
    case 'genre': return <GenrePage id={page.id} label={page.label} kind={page.kind} />
    case 'request': return <RequestDetailPage id={page.id} />
    case 'release': return <ReleasePickerPage id={page.id} />
    case 'notifications': return <NotificationsPage />
    case 'search': return null
  }
}

export const RequesterView = memo(function RequesterView(props: RequesterViewProps) {
  return (
    <RequesterProvider>
      <RequesterContent {...props} />
    </RequesterProvider>
  )
})
