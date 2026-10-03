import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Settings as SettingsIcon,
  LogOut, Loader2, RefreshCw, Radio, Search,
} from 'lucide-react'
import { JellyfinProvider, useJellyfin } from '../jellyfin/JellyfinContext'
import { AppTabs, type AppTab } from '../AppTabs'
import { JellyfinSetup } from '../jellyfin/JellyfinSetup'
import { api as appApi } from '../../utils/api'
import { getLiveTvApi } from '@jellyfin/sdk/lib/utils/api/live-tv-api'
import { EPGGrid, type LiveTVChannel, type EPGProgram } from './EPGGrid'
import { LiveTVPlayer } from './LiveTVPlayer'
import { DownloadCenter } from '../downloads'
import { registerTabReset, registerBackHandler, blockGlobalEsc } from '../../utils/navigationBus'

// ─── Types ────────────────────────────────────────────────────────────────────
type ViewMode = 'guide' | 'player' | 'pip'

interface LiveTVViewProps {
  onBackToReader: () => void
  onSwitchToJellyfin: () => void
  onSwitchToJellyMusic: () => void
  onSwitchToRequester?: () => void
  onOpenSettings?: () => void
  onSwitchToAudiobooks?: () => void
  // Open the app-wide global search modal
  onOpenSearch?: () => void
}

// ─── Content (inside JellyfinProvider) ───────────────────────────────────────
function LiveTVContent({
  onBackToReader,
  onSwitchToJellyfin,
  onSwitchToJellyMusic,
  onSwitchToRequester,
  onOpenSettings,
  onSwitchToAudiobooks,
  onOpenSearch,
}: LiveTVViewProps) {
  const { api, user, isAuthenticated, isLoading: authLoading, serverUrl, serverName, logout } = useJellyfin()

  // App tab bar navigation (fixed tab order, active tab highlighted)
  const handleTabNavigate = (tab: AppTab) => {
    switch (tab) {
      case 'calibre': onBackToReader(); break
      case 'jellyfin': onSwitchToJellyfin(); break
      case 'jellymusic': onSwitchToJellyMusic(); break
      case 'requester': onSwitchToRequester?.(); break
      case 'audiobookshelf': onSwitchToAudiobooks?.(); break
    }
  }

  const [channels, setChannels] = useState<LiveTVChannel[]>([])
  const [programMap, setProgramMap] = useState<Record<string, EPGProgram[]>>({})

  // Refresh: refetch channels (the EPG effect follows automatically because
  // setChannels always produces a new array reference)
  const [refreshKey, setRefreshKey] = useState(0)
  const handleRefresh = useCallback(() => setRefreshKey(k => k + 1), [])
  const [isLoadingChannels, setIsLoadingChannels] = useState(false)
  const [isLoadingEPG, setIsLoadingEPG] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>('guide')
  const [selectedChannel, setSelectedChannel] = useState<LiveTVChannel | null>(null)

  // Smart re-tap on the Live TV tab: the "home" here is the channel guide.
  // From the fullscreen player a re-tap drops to picture-in-picture (guide
  // visible, stream keeps playing). The EPG grid manages its own internal
  // scrolling, so there is no scroll-to-top step for this tab (fallback).
  useEffect(() => {
    return registerTabReset('livetv', () => {
      if (selectedChannel && viewMode === 'player') setViewMode('pip')
    })
  }, [selectedChannel, viewMode])

  // Back gestures: fullscreen player → picture-in-picture (mouse back /
  // edge-swipe only; Esc is blocked below because LiveTVPlayer maps Escape to
  // stop itself), pip → stop playback and return to the plain guide.
  useEffect(() => {
    return registerBackHandler((source) => {
      if (!selectedChannel) return false
      if (viewMode === 'player') {
        if (source !== 'esc') setViewMode('pip')
        return true
      }
      // pip (or guide with a lingering channel): stop the stream
      setSelectedChannel(null)
      setViewMode('guide')
      return true
    })
  }, [selectedChannel, viewMode])

  // The fullscreen Live TV player owns Escape (stops playback) — keep the
  // global Esc-as-back dispatcher silent while it is up. In pip mode the
  // player removes its key listener, so Esc falls through to our handler.
  useEffect(() => {
    if (selectedChannel && viewMode === 'player') return blockGlobalEsc()
  }, [selectedChannel, viewMode])

  // ── Fetch channels ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!api || !user?.Id || !isAuthenticated) return

    const fetchChannels = async () => {
      setIsLoadingChannels(true)
      setFetchError(null)
      try {
        const liveTvApi = getLiveTvApi(api)
        const res = await liveTvApi.getLiveTvChannels({
          userId: user.Id!,
          limit: 1000,
          addCurrentProgram: true,
          enableUserData: true,
          sortBy: 'Number' as any,
          sortOrder: 'Ascending' as any,
        })

        const rawChannels = res.data.Items || []
        const mapped: LiveTVChannel[] = rawChannels.map((ch: any) => ({
          id: ch.Id,
          name: ch.Name || 'Unknown Channel',
          number: ch.Number || '',
          channelType: ch.ChannelType === 'Radio' ? 'Radio' : 'TV',
          imageUrl: ch.ImageTags?.Primary && serverUrl
            ? `${serverUrl}/Items/${ch.Id}/Images/Primary?maxWidth=80&quality=80&ApiKey=${api.accessToken}`
            : null,
        }))
        setChannels(mapped)
      } catch (e: any) {
        console.error('Failed to fetch channels:', e)
        setFetchError('Failed to load channels. Is Live TV configured in Jellyfin?')
      }
      setIsLoadingChannels(false)
    }

    fetchChannels()
  }, [api, user?.Id, isAuthenticated, serverUrl, refreshKey])

  // ── Fetch EPG ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!api || !user?.Id || channels.length === 0 || !serverUrl) return

    const fetchEPG = async () => {
      setIsLoadingEPG(true)
      try {
        const now = new Date()
        const minEndDate = new Date(now.getTime() - 60 * 60 * 1000)    // 1h ago
        const maxStartDate = new Date(now.getTime() + 5 * 60 * 60 * 1000) // +5h

        const channelIds = channels.map(c => c.id).join(',')

        const res = await appApi.request({
          method: 'GET',
          url: `${serverUrl}/LiveTv/Programs?userId=${user.Id}&channelIds=${channelIds}&minEndDate=${minEndDate.toISOString()}&maxStartDate=${maxStartDate.toISOString()}&limit=5000&fields=Overview`,
          headers: {
            'Authorization': `MediaBrowser Token="${api.accessToken}"`,
          },
        })

        if (!res.success || !res.data) return

        const programs: EPGProgram[] = (res.data.Items || []).map((p: any) => ({
          id: p.Id,
          channelId: p.ChannelId,
          name: p.Name || 'Unknown Program',
          startDate: new Date(p.StartDate),
          endDate: new Date(p.EndDate),
          overview: p.Overview || undefined,
        }))

        // Group by channelId
        const map: Record<string, EPGProgram[]> = {}
        for (const prog of programs) {
          if (!map[prog.channelId]) map[prog.channelId] = []
          map[prog.channelId].push(prog)
        }
        setProgramMap(map)
      } catch (e) {
        console.error('Failed to fetch EPG:', e)
      }
      setIsLoadingEPG(false)
    }

    fetchEPG()
  }, [api, user?.Id, channels, serverUrl])

  // ── Current program for selected channel ───────────────────────────────────
  const currentProgram = useMemo(() => {
    if (!selectedChannel) return null
    const progs = programMap[selectedChannel.id] || []
    const now = new Date()
    return progs.find(p => p.startDate <= now && p.endDate >= now) ?? null
  }, [selectedChannel, programMap])

  // ── Channel navigation ──────────────────────────────────────────────────────
  const handleSelectChannel = useCallback((channel: LiveTVChannel) => {
    setSelectedChannel(channel)
    setViewMode('player')
  }, [])

  const handleChannelUp = useCallback(() => {
    if (!selectedChannel || channels.length === 0) return
    const idx = channels.findIndex(c => c.id === selectedChannel.id)
    const next = channels[(idx - 1 + channels.length) % channels.length]
    setSelectedChannel(next)
  }, [selectedChannel, channels])

  const handleChannelDown = useCallback(() => {
    if (!selectedChannel || channels.length === 0) return
    const idx = channels.findIndex(c => c.id === selectedChannel.id)
    const next = channels[(idx + 1) % channels.length]
    setSelectedChannel(next)
  }, [selectedChannel, channels])

  // ── Auth states ─────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="h-full bg-gray-900 flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-theme-500" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="relative h-full bg-gradient-to-br from-gray-900 via-theme-900/20 to-gray-900 overflow-auto">
        <div className="absolute top-4 left-4 z-50">
          <AppTabs active="livetv" onNavigate={handleTabNavigate} />
        </div>
        <JellyfinSetup onComplete={() => {}} />
      </div>
    )
  }

  // ── Main layout ─────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-gray-900 text-white overflow-hidden">
      {/* Top bar */}
      <div className="flex-shrink-0 h-14 phone:h-auto phone:min-h-14 phone:pt-safe px-4 flex items-center justify-between bg-black/40 backdrop-blur-md border-b border-white/5 z-30">
        <div className="flex items-center gap-2">
          {/* App switchers */}
          <AppTabs active="livetv" onNavigate={handleTabNavigate} />

          {serverName && (
            <>
              <div className="w-px h-5 bg-white/10 mx-1 phone:hidden" />
              <span className="text-xs text-white/40 phone:hidden">{serverName}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isLoadingEPG && (
            <div className="flex items-center gap-1.5 text-xs text-white/40">
              <Loader2 size={12} className="animate-spin" /> <span className="phone:hidden">Loading guide…</span>
            </div>
          )}
          {fetchError && (
            <span className="text-xs text-red-400">{fetchError}</span>
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
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
              title="Settings"
            >
              <SettingsIcon size={18} className="text-white/60" />
            </button>
          )}
          <button
            onClick={logout}
            className="p-2 hover:bg-white/10 rounded-full transition-colors phone:hidden"
            title="Logout"
          >
            <LogOut size={18} className="text-white/60" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 relative">

        {/* Loading state */}
        {isLoadingChannels && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-20 bg-gray-900">
            <Loader2 size={40} className="animate-spin text-theme-500" />
            <p className="text-white/60 text-sm">Loading channels…</p>
          </div>
        )}

        {/* Error state (no channels) */}
        {!isLoadingChannels && fetchError && channels.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-20">
            <Radio size={48} className="text-white/20" />
            <p className="text-white/50 text-center max-w-sm">{fetchError}</p>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            >
              <RefreshCw size={16} />
              Retry
            </button>
          </div>
        )}

        {/* EPG — shown in guide or pip mode */}
        {(viewMode === 'guide' || viewMode === 'pip') && !isLoadingChannels && channels.length > 0 && (
          <EPGGrid
            channels={channels}
            programMap={programMap}
            activeChannelId={selectedChannel?.id ?? null}
            serverUrl={serverUrl}
            onSelectChannel={handleSelectChannel}
          />
        )}

        {/* Single player instance — kept mounted across fullscreen ↔ pip transitions
            so the stream never reloads. Mode prop controls CSS layout only. */}
        {selectedChannel && serverUrl && api && user?.Id && (
          <LiveTVPlayer
            channel={selectedChannel}
            serverUrl={serverUrl}
            accessToken={api.accessToken}
            userId={user.Id}
            currentProgram={currentProgram}
            mode={viewMode === 'pip' ? 'pip' : 'fullscreen'}
            onOpenGuide={() => setViewMode(prev => prev === 'pip' ? 'player' : 'pip')}
            onChannelUp={handleChannelUp}
            onChannelDown={handleChannelDown}
            onStop={() => { setSelectedChannel(null); setViewMode('guide') }}
          />
        )}
      </div>
    </div>
  )
}

// ─── Main export with JellyfinProvider ───────────────────────────────────────
export function LiveTVView(props: LiveTVViewProps) {
  return (
    <JellyfinProvider>
      <LiveTVContent {...props} />
    </JellyfinProvider>
  )
}
