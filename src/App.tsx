import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense, Component } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  BookOpen, Settings as SettingsIcon, Download, Cloud, Wifi, WifiOff, Check, RefreshCw,
  Library, User, Layers, BookMarked, Clock, ArrowLeft, Tv, Play, Server, Trash2, Plus, Key, Globe, Home, Music, Send, Speaker, Eye,
  SlidersHorizontal, ChevronDown, Headphones, Save, Link, Bug, Upload, FileJson
} from 'lucide-react'

// ... existing code ...

// Advanced Settings Component (collapsible)
const AUDIO_OUTPUT_TARGETS: { target: AudioOutputTarget; label: string; hint: string }[] = [
  { target: 'music', label: 'JellyMusic (Music)', hint: 'Music playback, including background playback in other tabs' },
  { target: 'video', label: 'Jellyfin (Video)', hint: 'Movies and TV episodes' },
  { target: 'livetv', label: 'Live TV & Radio', hint: 'Live TV channels and radio streams' },
  { target: 'audiobook', label: 'Audiobookshelf (Audiobooks)', hint: 'Audiobook and podcast playback, including background playback in other tabs' },
]

// A single fake poster tile used in the card-size live preview. Mirrors the real
// Jellyfin cards: 2/3 poster with a rounded corner, optional title/meta lines.
function PreviewPoster({ width, showMeta }: { width?: number; showMeta?: boolean }) {
  const iconSize = Math.max(16, Math.min(48, Math.round((width ?? 130) / 6)))
  return (
    <div className="flex-shrink-0" style={width ? { width: `${width}px` } : undefined}>
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-gradient-to-br from-theme-900/60 to-pink-900/50 flex items-center justify-center">
        <Tv size={iconSize} className="text-white/25" />
      </div>
      {showMeta && (
        <>
          <div className="h-2 w-3/4 rounded bg-white/20 mt-2" />
          <div className="h-2 w-1/2 rounded bg-white/10 mt-1" />
        </>
      )}
    </div>
  )
}

// Live demo shown under the card-size sliders so you can see the actual size
// without leaving settings. 'row' mirrors a Home scroll row (fixed-px cards);
// 'grid' mirrors the Library's auto-fill grid (min-width columns).
function CardSizePreview({ width, layout }: { width: number; layout: 'row' | 'grid' }) {
  return (
    <div className="relative rounded-lg border border-white/10 bg-black/20 p-3 overflow-hidden">
      {layout === 'row' ? (
        <div className="flex gap-3 h-44 overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <PreviewPoster key={i} width={width} showMeta />
          ))}
        </div>
      ) : (
        <div
          className="grid gap-2 h-44 overflow-hidden"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${width}px, 1fr))` }}
        >
          {Array.from({ length: 12 }, (_, i) => (
            <PreviewPoster key={i} />
          ))}
        </div>
      )}
      {/* Bottom fade hints that tall cards continue past the preview window */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/40 to-transparent" />
    </div>
  )
}

// ── Reusable settings primitives ───────────────────────────────────────────

// Top-level collapsible "folder" section (icon + title + chevron), used for the
// Server URLs, Jellyfin and Advanced groups so long settings can be tucked away.
function SettingsFolder({
  icon, iconClass, title, subtitle, right, defaultOpen = false, children,
}: {
  icon: React.ReactNode
  iconClass: string
  title: string
  subtitle?: string
  right?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="space-y-4">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 text-left group">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconClass}`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-white/50">{subtitle}</p>}
        </div>
        {right}
        <ChevronDown size={20} className={`text-white/40 group-hover:text-white/70 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="bg-white/5 rounded-xl p-6 phone:p-4 border border-white/10 space-y-4">
          {children}
        </div>
      )}
    </div>
  )
}

// Lighter nested collapsible used inside Advanced (Audio / Download). Kept as a
// separate "folder" so the audio block can be hidden on iOS while the download
// location stays reachable.
function SettingsSubFolder({
  icon, title, subtitle, defaultOpen = false, children,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left group">
        <span className="text-white/60">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white/80">{title}</div>
          {subtitle && <div className="text-xs text-white/50">{subtitle}</div>}
        </div>
        <ChevronDown size={16} className={`text-white/40 group-hover:text-white/70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-4 border-t border-white/5">{children}</div>}
    </div>
  )
}

type SaveState = 'idle' | 'saving' | 'saved'

// Button that shows Saving… → Saved ✓ feedback. onSave may return true to signal
// that a reload will follow (the button stays on "Saved" until it happens).
function SaveButton({
  label = 'Save', onSave, className, icon,
}: {
  label?: string
  onSave: () => void | boolean | Promise<void | boolean>
  className?: string
  icon?: React.ReactNode
}) {
  const [state, setState] = useState<SaveState>('idle')
  const run = async () => {
    if (state === 'saving') return
    setState('saving')
    try {
      const willReload = await onSave()
      setState('saved')
      if (willReload) {
        setTimeout(() => window.location.reload(), 650)
      } else {
        setTimeout(() => setState('idle'), 1600)
      }
    } catch {
      setState('idle')
    }
  }
  return (
    <button
      onClick={run}
      disabled={state === 'saving'}
      className={className ?? 'w-full px-6 py-3 bg-white text-gray-900 rounded-lg font-semibold hover:bg-white/90 transition-colors disabled:opacity-70 inline-flex items-center justify-center gap-2'}
    >
      {state === 'saving' ? (
        <><RefreshCw size={18} className="animate-spin" /> Saving…</>
      ) : state === 'saved' ? (
        <><Check size={18} className="text-green-600" /> Saved</>
      ) : (
        <>{icon}{label}</>
      )}
    </button>
  )
}

// Advanced section: Audio output routing (hidden on iOS — setSinkId is
// unsupported in WKWebView) and the shared Download Location, each as its own
// nested folder so audio can be blended out without hiding the download path.
function AdvancedSettingsSection() {
  const audioOutputDevices = useSettingsStore(state => state.audioOutputDevices)
  const setAudioOutputDevice = useSettingsStore(state => state.setAudioOutputDevice)
  const downloadPath = useSettingsStore(state => state.downloadPath)
  const updateDownloadPath = useSettingsStore(state => state.updateDownloadPath)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [audioOpen, setAudioOpen] = useState(false)
  // Stable so the AudioOpenSignal effect fires exactly once when opened.
  const signalAudioOpen = useCallback(() => setAudioOpen(true), [])

  useEffect(() => {
    if (!audioOpen) return

    const listOutputs = async () => {
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      return allDevices.filter(device => device.kind === 'audiooutput')
    }

    const fetchDevices = async () => {
      try {
        let audioOutputs = await listOutputs()
        // Without media permission Chromium hides the device list (one
        // unlabeled placeholder only). A transient mic capture unlocks it;
        // the Rust side auto-grants the permission so no prompt appears.
        if (audioOutputs.length === 0 || audioOutputs.every(d => !d.label)) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            stream.getTracks().forEach(track => track.stop())
            audioOutputs = await listOutputs()
          } catch {
            // No microphone or permission denied — keep the limited list
          }
        }
        setDevices(audioOutputs)
      } catch (err) {
        console.error('Failed to enumerate audio devices:', err)
      }
    }

    fetchDevices()

    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', fetchDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', fetchDevices)
  }, [audioOpen])

  return (
    <SettingsFolder
      icon={<SlidersHorizontal size={20} className="text-white" />}
      iconClass="bg-gradient-to-br from-blue-500 to-indigo-600"
      title="Advanced"
      subtitle="Audio output, download location and other expert settings"
    >
      {/* Audio output routing — unsupported on iOS, so hidden there entirely. */}
      {!IS_IOS && (
        <SettingsSubFolder
          icon={<Speaker size={16} />}
          title="Audio Output Devices"
          subtitle="Route each tab to its own output (e.g. Voicemeeter cables)"
          defaultOpen={audioOpen}
        >
          {/* Trigger enumeration once the sub-folder is opened. */}
          <AudioOpenSignal onOpen={signalAudioOpen} />
          <p className="text-xs text-white/50">
            Changes take effect immediately, even for something already playing.
          </p>
          {AUDIO_OUTPUT_TARGETS.map(({ target, label, hint }) => (
            <div key={target} className="space-y-2">
              <label className="text-sm font-medium text-white/80">{label}</label>
              <select
                value={audioOutputDevices[target] || 'default'}
                onChange={(e) => setAudioOutputDevice(target, e.target.value === 'default' ? null : e.target.value)}
                className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-theme-500 focus:border-theme-500"
              >
                <option value="default" className="bg-zinc-900 text-white">Default System Output</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId} className="bg-zinc-900 text-white">
                    {device.label || `Speaker ${device.deviceId.slice(0, 5)}...`}
                  </option>
                ))}
              </select>
              <p className="text-xs text-white/50">{hint}</p>
            </div>
          ))}
        </SettingsSubFolder>
      )}

      {/* Download location — kept out of the audio block so it stays reachable
          on iOS (where the whole audio sub-folder is hidden). */}
      <SettingsSubFolder
        icon={<Download size={16} />}
        title="Download Location"
        subtitle="Offline storage for books, music and video"
      >
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={downloadPath}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 opacity-50 cursor-not-allowed"
          />
          {!IS_IOS && (
            <button onClick={async () => {
              const path = await api.selectFolder()
              if (path) updateDownloadPath(path)
            }} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors">
              Change...
            </button>
          )}
        </div>
        <p className="text-xs text-white/50">
          Used by all clients: downloaded eBooks, JellyMusic tracks and Jellyfin movies/episodes.
          Already downloaded files are not moved when you change this.
        </p>
      </SettingsSubFolder>
    </SettingsFolder>
  )
}

// Tiny helper: fires once on mount to lazily start audio-device enumeration when
// the Audio sub-folder is first expanded.
function AudioOpenSignal({ onOpen }: { onOpen: () => void }) {
  useEffect(() => { onOpen() }, [onOpen])
  return null
}

// Error boundary for Reader — prevents blank screen if PDF/EPUB engine crashes
class ReaderErrorBoundary extends Component<
  { onClose: () => void; children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { onClose: () => void; children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ReaderErrorBoundary]', error, info.componentStack)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col items-center justify-center gap-4 text-white">
          <div className="text-red-400 text-lg font-bold">Failed to load reader</div>
          <div className="text-white/60 text-sm max-w-md text-center">{this.state.error}</div>
          <button
            onClick={this.props.onClose}
            className="mt-4 px-6 py-2 bg-theme-600 hover:bg-theme-700 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// Lazy load heavy components
const Reader = lazy(() => import('./components/Reader'))
import { BookCard } from './components/BookCard'
import { AlphabetScrollRail } from './components/AlphabetScrollRail'
import { BookDetails } from './components/BookDetails'
import { SectionRow } from './components/SectionRow'
import { HeroCarousel } from './components/HeroCarousel'
import { CategoryCard } from './components/CategoryCard'
// Lazy-load heavy views — keeps @jellyfin/sdk and all player components out of the
// initial JS bundle. The user starts on the Calibre dashboard, so these can load
// on first navigation to that view instead of at app startup.
const JellyfinView = lazy(() =>
  import('./components/jellyfin/JellyfinView').then(m => ({ default: m.JellyfinView }))
)
const JellyMusicView = lazy(() =>
  import('./components/jellyfin/music/JellyMusicView').then(m => ({ default: m.JellyMusicView }))
)
const AudiobookshelfView = lazy(() =>
  import('./components/audiobookshelf/AudiobookshelfView').then(m => ({ default: m.AudiobookshelfView }))
)
const LiveTVView = lazy(() =>
  import('./components/livetv').then(m => ({ default: m.LiveTVView }))
)
import { RequesterView } from './components/requester'
import { PersistentMusicPlayer } from './components/PersistentMusicPlayer'
import { PersistentAudiobookPlayer } from './components/PersistentAudiobookPlayer'
import { MusicMiniPlayer } from './components/MusicMiniPlayer'
import { AudiobookMiniPlayer } from './components/AudiobookMiniPlayer'
import { AppTabs, type AppTab } from './components/AppTabs'
import { DownloadCenter, beginCalibreDownload, finishCalibreDownload } from './components/downloads'
import { BottomTabBar } from './components/BottomTabBar'
import { SwipeBackOverlay } from './components/SwipeBackOverlay'
import { useIsPhone } from './hooks/useIsPhone'
import { useMusicPlayer } from './stores/musicPlayerStore'
import { useAudiobookPlayer } from './stores/audiobookPlayerStore'
import { GlobalSearch, SearchButton } from './components/GlobalSearch'
import { ShortcutOverlay } from './components/ShortcutOverlay'
import { UpdateNotice } from './components/UpdateNotice'
import { UpdateSettings } from './components/UpdateSettings'
import { SubtitleStyleSettings } from './components/SubtitleStyleSettings'
import { ToastProvider, useToast } from './components/Toast'
import {
  registerTabReset, registerBackHandler, dispatchBack,
  isGlobalEscBlocked, isEditableTarget, blockGlobalEsc, smartTabReset,
} from './utils/navigationBus'
import { api, IS_IOS } from './utils/api'
import { getItem, setItem } from './utils/storage'
import { fetchBooksList } from './utils/booksListCache'
import { getTokenExpiry, refreshToken } from './utils/syncServerApi'
import { loadGridState, saveGridState, setScrollPos, clearGridStates } from './utils/viewStateCache'
import { useScrollRestore } from './hooks/useScrollRestore'
import { useInfiniteScroll } from './hooks/useInfiniteScroll'
import { usePullToRefresh } from './hooks/usePullToRefresh'
import { PullToRefreshIndicator } from './components/PullToRefreshIndicator'
import { saveSettings, type AudioOutputTarget, type ThemeTab, type AppSettings, SEEK_DURATION_OPTIONS } from './types/settings'
import { applyTabAccent } from './utils/theme'
import { loadLastTab, saveLastTab, type PersistedTab } from './utils/lastTab'
import { ThemeColorSettings } from './components/ThemeColorSettings'
import { BUILD_INFO } from './buildInfo'
import { getPlatform } from './utils/updater'
import { getCapturedLogs, formatLogs } from './utils/debugLog'
import { saveOrShareText, fileTimestamp } from './utils/fileExport'
import { buildSettingsExport, parseSettingsImport } from './utils/settingsTransfer'

// Store imports
import { useSettingsStore } from './stores/settingsStore'
import { useLibraryStore, type Book } from './stores/libraryStore'
import { useRequesterStore } from './stores/requesterStore'

// Requester Settings Component
function RequesterSettings() {
  const { serverUrl, isAuthenticated, userInfo, logout, setServerUrl } = useRequesterStore()
  const [inputUrl, setInputUrl] = useState(serverUrl || '')

  const handleSave = () => {
    setServerUrl(inputUrl.trim())
    if (isAuthenticated) logout()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
          <Send size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Requester</h2>
          <p className="text-xs text-white/50">Media request service</p>
        </div>
        {isAuthenticated && (
          <div className="ml-auto flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span className="text-xs text-white/50">{userInfo?.role}</span>
          </div>
        )}
      </div>

      <div className="bg-white/5 rounded-xl p-6 border border-white/10 space-y-4">
        {isAuthenticated && userInfo ? (
          <>
            <div className="bg-white/5 rounded-lg p-3 space-y-0.5">
              <p className="font-medium">{userInfo.display_name || userInfo.username}</p>
              <p className="text-xs text-white/50">{userInfo.username} · {userInfo.role}</p>
              <p className="text-xs text-white/40 truncate">{serverUrl}</p>
            </div>
            <button
              onClick={logout}
              className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors"
            >
              Disconnect
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Server URL</label>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://media.example.com"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
              />
              <p className="text-xs text-white/40">
                Uses shared credentials from the Credentials section above.
                Open the Requester view to connect.
              </p>
            </div>
            <button
              onClick={handleSave}
              disabled={!inputUrl.trim()}
              className="w-full px-4 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              Save URL
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Legacy per-service sections (Calibre-Web / Audiobookshelf / Requester) are
// kept in the codebase — currently hidden — so future service-specific settings
// have a ready home. Flip this to re-enable them.
const SHOW_LEGACY_SERVICE_SECTIONS = false

// Read the current settings as a plain AppSettings object (no store-only fields
// like syncToken). Shared by export, the debug report and the Save button.
function currentAppSettings(): AppSettings {
  const s = useSettingsStore.getState()
  return {
    credentials: s.credentials,
    calibreWeb: s.calibreWeb,
    audiobookshelf: s.audiobookshelf,
    jellyfinServers: s.jellyfinServers,
    activeJellyfinServerId: s.activeJellyfinServerId,
    downloadPath: s.downloadPath,
    defaultStartPage: s.defaultStartPage,
    jellyfinSeekBackSeconds: s.jellyfinSeekBackSeconds,
    jellyfinSeekForwardSeconds: s.jellyfinSeekForwardSeconds,
    audioOutputDevices: s.audioOutputDevices,
    jellyfinHomeCardSize: s.jellyfinHomeCardSize,
    jellyfinLibraryCardSize: s.jellyfinLibraryCardSize,
    hiddenJellyfinLibraries: s.hiddenJellyfinLibraries,
    themeColors: s.themeColors,
    updateChannel: s.updateChannel,
    autoCheckUpdates: s.autoCheckUpdates,
    subtitleStyle: s.subtitleStyle,
  }
}

// ── Server URLs (collapsible) — all service URLs in one place ───────────────
// Holds Calibre-Web, Audiobookshelf, Requester and the Jellyfin server list.
// URL text fields are edited locally and committed together by "Save URLs",
// which reloads to re-authenticate only when a URL actually changed.
function ServerUrlsFolder() {
  const toast = useToast()
  const calibreWeb = useSettingsStore(s => s.calibreWeb)
  const updateCalibreWeb = useSettingsStore(s => s.updateCalibreWeb)
  const audiobookshelf = useSettingsStore(s => s.audiobookshelf)
  const updateAudiobookshelf = useSettingsStore(s => s.updateAudiobookshelf)
  const jellyfinServers = useSettingsStore(s => s.jellyfinServers)
  const activeJellyfinServerId = useSettingsStore(s => s.activeJellyfinServerId)
  const addJellyfinServer = useSettingsStore(s => s.addJellyfinServer)
  const deleteJellyfinServer = useSettingsStore(s => s.deleteJellyfinServer)
  const setActiveJellyfinServer = useSettingsStore(s => s.setActiveJellyfinServer)
  const isAddingServer = useSettingsStore(s => s.isAddingServer)
  const setIsAddingServer = useSettingsStore(s => s.setIsAddingServer)
  const newJellyfinUrl = useSettingsStore(s => s.newJellyfinUrl)
  const setNewJellyfinUrl = useSettingsStore(s => s.setNewJellyfinUrl)
  const jellyfinServerStatus = useSettingsStore(s => s.jellyfinServerStatus)
  const isOnline = useLibraryStore(s => s.isOnline)
  const isCalibreReachable = useLibraryStore(s => s.isCalibreReachable)

  const requesterUrlStored = useRequesterStore(s => s.serverUrl)
  const setRequesterUrl = useRequesterStore(s => s.setServerUrl)
  const requesterLogout = useRequesterStore(s => s.logout)
  const requesterAuthed = useRequesterStore(s => s.isAuthenticated)

  // Local (uncommitted) URL edits — applied by Save URLs.
  const [calibreUrl, setCalibreUrl] = useState(calibreWeb.url)
  const [absUrl, setAbsUrl] = useState(audiobookshelf.url || '')
  const [requesterUrl, setRequesterUrlLocal] = useState(requesterUrlStored || '')

  const saveUrls = () => {
    const changed =
      calibreUrl.trim() !== calibreWeb.url ||
      absUrl.trim() !== (audiobookshelf.url || '') ||
      requesterUrl.trim() !== (requesterUrlStored || '')
    updateCalibreWeb(calibreUrl.trim())
    updateAudiobookshelf({ url: absUrl.trim() })
    if (requesterUrl.trim() !== (requesterUrlStored || '')) {
      setRequesterUrl(requesterUrl.trim())
      if (requesterAuthed) requesterLogout()
    }
    // Reload (re-auth) only when a URL actually changed.
    return changed
  }

  return (
    <SettingsFolder
      icon={<Link size={20} className="text-white" />}
      iconClass="bg-gradient-to-br from-sky-500 to-cyan-600"
      title="Server URLs"
      subtitle="Connection addresses for every service"
    >
      {/* Calibre-Web */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-white/80 flex items-center gap-2">
            <BookOpen size={14} className="text-white/50" /> Calibre-Web API Server
          </label>
          <div className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} title="Network" />
            <div className={`w-2.5 h-2.5 rounded-full ${isCalibreReachable ? 'bg-green-500' : 'bg-red-500'}`} title="API Server" />
          </div>
        </div>
        <input
          type="text"
          value={calibreUrl}
          onChange={(e) => setCalibreUrl(e.target.value)}
          placeholder="https://reader.mydomain.com:8787"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-theme-500 focus:border-theme-500"
        />
      </div>

      {/* Audiobookshelf */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-white/80 flex items-center gap-2">
            <Headphones size={14} className="text-white/50" /> Audiobookshelf
          </label>
          {audiobookshelf.accessToken && (
            <span className="text-xs text-white/50 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500" />{audiobookshelf.username || 'Signed in'}
            </span>
          )}
        </div>
        <input
          type="text"
          value={absUrl}
          onChange={(e) => setAbsUrl(e.target.value)}
          placeholder="https://audiobooks.mydomain.com"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
        />
        <p className="text-xs text-white/40">Login is via your identity provider (SSO) — open the Audiobooks tab to sign in.</p>
        {audiobookshelf.accessToken && (
          <button
            onClick={() => {
              updateAudiobookshelf({ accessToken: undefined, tokenType: undefined, userId: undefined, username: undefined, defaultLibraryId: undefined })
              api.secretDelete('abs-refresh-token')
            }}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-medium transition-colors"
          >
            Sign out
          </button>
        )}
      </div>

      {/* Requester */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-white/80 flex items-center gap-2">
          <Send size={14} className="text-white/50" /> Requester
        </label>
        <input
          type="text"
          value={requesterUrl}
          onChange={(e) => setRequesterUrlLocal(e.target.value)}
          placeholder="https://media.example.com"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
        />
        <p className="text-xs text-white/40">Uses the shared credentials above. Open the Requester view to connect.</p>
      </div>

      <SaveButton
        label="Save URLs"
        onSave={saveUrls}
        icon={<Save size={16} />}
        className="w-full px-4 py-2.5 bg-sky-500 hover:bg-sky-400 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-70 inline-flex items-center justify-center gap-2"
      />

      {/* Jellyfin servers (added/removed live) */}
      <div className="pt-4 mt-2 border-t border-white/10 space-y-3">
        <div className="flex items-center gap-2">
          <Tv size={14} className="text-white/50" />
          <h3 className="text-sm font-medium text-white/80">Jellyfin Servers</h3>
        </div>
        {jellyfinServers.length > 0 ? (
          <div className="space-y-3">
            {jellyfinServers.map(server => (
              <div
                key={server.id}
                className={`flex items-center gap-3 p-4 rounded-xl border transition-colors ${activeJellyfinServerId === server.id
                  ? 'border-theme-500/50 bg-theme-500/10'
                  : 'border-white/10 hover:border-white/20 bg-white/5'
                  }`}
              >
                <button
                  onClick={() => setActiveJellyfinServer(server.id)}
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${activeJellyfinServerId === server.id
                    ? 'border-theme-500 bg-theme-500'
                    : 'border-white/30 hover:border-white/50'
                    }`}
                  title="Set as active server"
                >
                  {activeJellyfinServerId === server.id && <Check size={12} className="text-white" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Server size={16} className="text-white/40 flex-shrink-0" />
                    <span className="font-medium truncate">{server.name}</span>
                    <div
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${jellyfinServerStatus[server.id] ? 'bg-green-500' : 'bg-red-500'}`}
                      title={jellyfinServerStatus[server.id] ? 'Connected' : 'Unreachable'}
                    />
                  </div>
                  <p className="text-xs text-white/50 truncate">{server.url}</p>
                </div>
                <button
                  onClick={() => { if (confirm(`Delete server "${server.name}"?`)) deleteJellyfinServer(server.id) }}
                  className="p-2 text-white/40 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
                  title="Delete server"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/50 text-center py-4">No Jellyfin servers configured</p>
        )}

        {isAddingServer ? (
          <div className="space-y-3 pt-1">
            <input
              type="text"
              value={newJellyfinUrl}
              onChange={(e) => setNewJellyfinUrl(e.target.value)}
              placeholder="https://jellyfin.mydomain.com"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-theme-500 focus:border-theme-500"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (newJellyfinUrl) {
                    const success = await addJellyfinServer(newJellyfinUrl)
                    if (!success) toast.error('Failed to connect to server. Please check the URL.')
                  }
                }}
                className="flex-1 px-4 py-2 bg-theme-500 hover:bg-theme-400 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Add Server
              </button>
              <button
                onClick={() => { setIsAddingServer(false); setNewJellyfinUrl('') }}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAddingServer(true)}
            className="w-full px-4 py-3 border border-dashed border-white/20 hover:border-theme-500/50 hover:bg-theme-500/5 rounded-xl text-white/60 hover:text-theme-400 flex items-center justify-center gap-2 transition-colors"
          >
            <Plus size={18} />
            <span>Add Server</span>
          </button>
        )}
      </div>
    </SettingsFolder>
  )
}

// ── Jellyfin preferences (collapsible) — player + display, no server URLs ───
function JellyfinPrefsFolder({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const jellyfinServers = useSettingsStore(s => s.jellyfinServers)
  const seekBack = useSettingsStore(s => s.jellyfinSeekBackSeconds)
  const seekForward = useSettingsStore(s => s.jellyfinSeekForwardSeconds)
  const setJellyfinSeekBackSeconds = useSettingsStore(s => s.setJellyfinSeekBackSeconds)
  const setJellyfinSeekForwardSeconds = useSettingsStore(s => s.setJellyfinSeekForwardSeconds)
  const homeCardSize = useSettingsStore(s => s.jellyfinHomeCardSize)
  const libraryCardSize = useSettingsStore(s => s.jellyfinLibraryCardSize)
  const setJellyfinHomeCardSize = useSettingsStore(s => s.setJellyfinHomeCardSize)
  const setJellyfinLibraryCardSize = useSettingsStore(s => s.setJellyfinLibraryCardSize)
  const hiddenJellyfinLibraries = useSettingsStore(s => s.hiddenJellyfinLibraries)
  const unhideJellyfinLibrary = useSettingsStore(s => s.unhideJellyfinLibrary)

  return (
    <SettingsFolder
      icon={<Tv size={20} className="text-white" />}
      iconClass="bg-gradient-to-br from-theme-500 to-pink-500"
      title="Jellyfin"
      subtitle="Player controls and display size"
    >
      {jellyfinServers.length > 0 && (
        <div className="flex gap-3">
          <button
            onClick={() => onNavigate?.('jellyfin')}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white text-gray-900 hover:bg-white/90 rounded-lg font-semibold transition-colors"
          >
            <Tv size={18} /> Jellyfin
          </button>
          <button
            onClick={() => onNavigate?.('jellymusic')}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-theme-500 text-white hover:bg-theme-400 rounded-lg font-semibold transition-colors"
          >
            <Music size={18} /> JellyMusic
          </button>
        </div>
      )}

      {/* Player controls */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-white/80">Player Controls</h3>
        <div className="grid grid-cols-2 phone:grid-cols-1 gap-4">
          <div className="space-y-2">
            <label className="text-xs text-white/60">Skip Back</label>
            <div className="flex gap-1">
              {SEEK_DURATION_OPTIONS.map((seconds) => (
                <button
                  key={`back-${seconds}`}
                  onClick={() => setJellyfinSeekBackSeconds(seconds)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${seekBack === seconds ? 'bg-rose-500 text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-white/60">Skip Forward</label>
            <div className="flex gap-1">
              {SEEK_DURATION_OPTIONS.map((seconds) => (
                <button
                  key={`forward-${seconds}`}
                  onClick={() => setJellyfinSeekForwardSeconds(seconds)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${seekForward === seconds ? 'bg-rose-500 text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Display size */}
      <div className="pt-4 mt-2 border-t border-white/10 space-y-4">
        <h3 className="text-sm font-medium text-white/80">Display Settings</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-white/60">Home Page Card Size</label>
            <span className="text-xs text-white/40 tabular-nums">{homeCardSize}px</span>
          </div>
          <input
            type="range" min={100} max={280} step={10} value={homeCardSize}
            onChange={(e) => setJellyfinHomeCardSize(Number(e.target.value))}
            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-theme-500
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-theme-500 [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:hover:bg-theme-400"
          />
          <div className="flex justify-between text-[10px] text-white/30">
            <span>Small</span><span>Default (160)</span><span>Large</span>
          </div>
          <CardSizePreview width={homeCardSize} layout="row" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-white/60">Library Grid Card Size</label>
            <span className="text-xs text-white/40 tabular-nums">{libraryCardSize}px</span>
          </div>
          <input
            type="range" min={80} max={300} step={10} value={libraryCardSize}
            onChange={(e) => setJellyfinLibraryCardSize(Number(e.target.value))}
            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-theme-500
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-theme-500 [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:hover:bg-theme-400"
          />
          <div className="flex justify-between text-[10px] text-white/30">
            <span>Small</span><span>Default (150)</span><span>Large</span>
          </div>
          <CardSizePreview width={libraryCardSize} layout="grid" />
        </div>
      </div>

      {/* Subtitle appearance */}
      <SubtitleStyleSettings />

      {/* Hidden libraries */}
      {hiddenJellyfinLibraries.length > 0 && (
        <div className="pt-4 mt-2 border-t border-white/10 space-y-3">
          <div>
            <h3 className="text-sm font-medium text-white/80">Hidden Libraries</h3>
            <p className="text-xs text-white/50 mt-1">
              Hidden from the Jellyfin home page. Hide more by hovering a library card and clicking the eye icon.
            </p>
          </div>
          <div className="space-y-2">
            {hiddenJellyfinLibraries.map((lib) => (
              <div key={lib.id} className="flex items-center justify-between px-3 py-2 bg-white/5 border border-white/10 rounded-lg">
                <span className="text-sm text-white/70 truncate">{lib.name}</span>
                <button
                  onClick={() => unhideJellyfinLibrary(lib.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-theme-300 hover:text-white hover:bg-theme-500/20 rounded-md transition-colors"
                  title="Show this library again"
                >
                  <Eye size={14} /> Show
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </SettingsFolder>
  )
}

// ── Backup & transfer — export/import all settings (no secrets) ─────────────
function BackupTransferSection() {
  const toast = useToast()
  const fileRef = React.useRef<HTMLInputElement>(null)

  const onExport = async () => {
    const requesterUrl = useRequesterStore.getState().serverUrl
    const text = buildSettingsExport(currentAppSettings(), requesterUrl)
    const res = await saveOrShareText(`mediamaster-settings-${fileTimestamp()}.json`, text, 'application/json', useSettingsStore.getState().downloadPath)
    if (res.method === 'cancelled') return
    if (res.method === 'share') toast.success('Settings ready to share')
    else if (res.method === 'dialog' || res.method === 'file') toast.success(`Settings exported${res.path ? ` to ${res.path}` : ''}`)
    else if (res.method === 'clipboard') toast.success('Settings JSON copied to clipboard')
    else toast.error(res.error || 'Export failed')
  }

  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const { incoming, requesterUrl } = parseSettingsImport(String(reader.result))
        if (!confirm('Import these settings? Your username/password stay unchanged; you may need to sign in to servers again. Download folder and audio outputs are kept as they are on this device.')) return
        useSettingsStore.getState().updateSettings(incoming)
        if (requesterUrl) useRequesterStore.getState().setServerUrl(requesterUrl)
        toast.success('Settings imported — reloading…')
        setTimeout(() => window.location.reload(), 800)
      } catch (err: any) {
        toast.error(err?.message || 'Could not import settings')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
          <FileJson size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Backup &amp; Transfer</h2>
          <p className="text-xs text-white/50">Move your setup between devices</p>
        </div>
      </div>
      <div className="bg-white/5 rounded-xl p-6 phone:p-4 border border-white/10 space-y-4">
        <p className="text-sm text-white/60">
          Export writes a JSON file (to your download folder, or the clipboard if that isn't possible) with all
          preferences and server URLs. Your username, password and all sign-in tokens are never included.
        </p>
        <div className="flex gap-3 phone:flex-col">
          <button
            onClick={onExport}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors"
          >
            <Download size={16} /> Export settings
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors"
          >
            <Upload size={16} /> Import settings
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImportFile} className="hidden" />
        </div>
      </div>
    </div>
  )
}

// ── Troubleshooting — debug report + reset ──────────────────────────────────
function TroubleshootingSection() {
  const toast = useToast()

  const onDebugReport = async () => {
    const s = useSettingsStore.getState()
    const lib = useLibraryStore.getState()
    const logs = getCapturedLogs()
    const lines: string[] = [
      '=== Mediamaster Debug Report ===',
      `Generated: ${new Date().toISOString()}`,
      `Version: ${BUILD_INFO.version}${BUILD_INFO.buildId ? ` (build ${BUILD_INFO.buildId})` : ' (local build)'}`,
    ]
    if (BUILD_INFO.builtAt) lines.push(`Built: ${BUILD_INFO.builtAt}`)
    lines.push(`Platform: ${getPlatform()}`)
    lines.push(`User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`)
    lines.push(`Online: ${lib.isOnline ? 'yes' : 'no'} | Calibre reachable: ${lib.isCalibreReachable ? 'yes' : 'no'}`)
    const jf = s.jellyfinServers.map(sv => `${sv.name}=${s.jellyfinServerStatus[sv.id] ? 'up' : 'down'}`).join(', ')
    lines.push(`Jellyfin servers: ${jf || 'none'}`)
    lines.push('', '--- Settings (secrets removed) ---', buildSettingsExport(currentAppSettings(), useRequesterStore.getState().serverUrl))
    lines.push('', `--- Recent logs (${logs.length}) ---`, formatLogs(logs))

    const res = await saveOrShareText(`mediamaster-debug-${fileTimestamp()}.txt`, lines.join('\n'), 'text/plain', s.downloadPath)
    if (res.method === 'cancelled') return
    if (res.method === 'share') toast.success('Debug report ready to share')
    else if (res.method === 'dialog' || res.method === 'file') toast.success(`Debug report saved${res.path ? ` to ${res.path}` : ''}`)
    else if (res.method === 'clipboard') toast.success('Debug report copied to clipboard')
    else toast.error(res.error || 'Could not generate the report')
  }

  const onReset = async () => {
    const downloadPath = useSettingsStore.getState().downloadPath
    if (!confirm('Reset application? This will clear all data.')) return
    if (downloadPath && confirm(`Also permanently delete all downloaded books in:\n${downloadPath}`)) {
      try {
        await api.deleteDirectory(downloadPath)
      } catch (e) {
        console.error('Failed to delete library folder', e)
        toast.error('Failed to delete library folder. Check permissions.')
      }
    }
    localStorage.clear()
    await api.clearCache()
    window.location.reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
          <RefreshCw size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Troubleshooting</h2>
          <p className="text-xs text-white/50">Diagnostics and reset</p>
        </div>
      </div>

      <div className="bg-white/5 rounded-xl p-6 phone:p-4 border border-white/10 space-y-4">
        <div className="space-y-2">
          <button
            onClick={onDebugReport}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors"
          >
            <Bug size={16} /> Generate Debug Report
          </button>
          <p className="text-xs text-white/50 text-center">
            Saves a text file with version, connection status, sanitized settings and recent logs — attach it when reporting a problem.
          </p>
        </div>

        <div className="pt-2 border-t border-white/10 space-y-2">
          <button
            onClick={onReset}
            className="w-full px-4 py-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors"
          >
            Clear All App Data &amp; Reset
          </button>
          <p className="text-xs text-white/50 text-center">
            Clears Calibre settings, Jellyfin configuration, and optionally downloaded books.
          </p>
        </div>
      </div>
    </div>
  )
}

// Legacy per-service sections, retained but hidden (see SHOW_LEGACY_SERVICE_SECTIONS).
function LegacyServiceSections() {
  const calibreWeb = useSettingsStore(s => s.calibreWeb)
  const updateCalibreWeb = useSettingsStore(s => s.updateCalibreWeb)
  const audiobookshelf = useSettingsStore(s => s.audiobookshelf)
  const updateAudiobookshelf = useSettingsStore(s => s.updateAudiobookshelf)
  const isOnline = useLibraryStore(s => s.isOnline)
  const isCalibreReachable = useLibraryStore(s => s.isCalibreReachable)

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-theme-500 to-blue-500 flex items-center justify-center">
            <BookOpen size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Calibre-Web</h2>
            <p className="text-xs text-white/50">eBook library server</p>
          </div>
          <div className="ml-auto flex gap-2 items-center">
            <span className="text-xs text-white/40 mr-2">Status:</span>
            <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} title="Network" />
            <div className={`w-2.5 h-2.5 rounded-full ${isCalibreReachable ? 'bg-green-500' : 'bg-red-500'}`} title="API Server" />
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-6 border border-white/10 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">API Server URL</label>
            <input
              type="text"
              value={calibreWeb.url}
              onChange={(e) => updateCalibreWeb(e.target.value)}
              placeholder="https://reader.mydomain.com:8787"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-theme-500 focus:border-theme-500"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
            <Headphones size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Audiobookshelf</h2>
            <p className="text-xs text-white/50">Audiobook &amp; podcast server (SSO login)</p>
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-6 border border-white/10 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Server URL</label>
            <input
              type="text"
              value={audiobookshelf.url}
              onChange={(e) => updateAudiobookshelf({ url: e.target.value })}
              placeholder="https://audiobooks.mydomain.com"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
            />
          </div>
        </div>
      </div>

      <RequesterSettings />
    </>
  )
}

// SettingsContent - Standalone settings panel used by the top-level Settings view
function SettingsContent({ onNavigate }: { onNavigate?: (view: string) => void }) {
  // Most settings now live in self-contained folder components; SettingsContent
  // only needs credentials, the start page and the app-wide Save.
  const settings = useSettingsStore(useShallow((state) => ({
    credentials: state.credentials,
    defaultStartPage: state.defaultStartPage,
  })))
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const updateCredentials = useSettingsStore((state) => state.updateCredentials)

  // Snapshot the login at mount so the Save button only forces a reload
  // (re-authentication) when the username/password actually changed here.
  const credentialsSnapshot = React.useRef({
    username: settings.credentials.username,
    password: settings.credentials.password,
  })

  return (
    <div className="max-w-2xl mx-auto p-8 phone:p-4 space-y-8 pb-20 phone:pb-8">
      {/* CREDENTIALS SECTION */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <Key size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Credentials</h2>
            <p className="text-xs text-white/50">LDAP/Active Directory Authentication</p>
          </div>
        </div>

        <div className="bg-white/5 rounded-xl p-6 border border-white/10 space-y-4">
          <p className="text-sm text-white/60">
            These credentials are used for both Calibre-Web and Jellyfin authentication.
          </p>
          <div className="grid grid-cols-2 phone:grid-cols-1 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Username</label>
              <input
                type="text"
                value={settings.credentials.username}
                onChange={(e) => updateCredentials(e.target.value, settings.credentials.password)}
                placeholder="your.username"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-theme-500 focus:border-theme-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Password</label>
              <input
                type="password"
                value={settings.credentials.password}
                onChange={(e) => updateCredentials(settings.credentials.username, e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-theme-500 focus:border-theme-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* GENERAL SECTION */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-500 to-slate-600 flex items-center justify-center">
            <Home size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">General</h2>
            <p className="text-xs text-white/50">Application preferences</p>
          </div>
        </div>

        <div className="bg-white/5 rounded-xl p-6 border border-white/10 space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
            <Home size={16} className="text-theme-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-white/80">Start where you left off</p>
              <p className="text-xs text-white/50">
                The app reopens in the tab you last used. No start page to pick —
                it just remembers.
              </p>
            </div>
          </div>

          {/* Updates moved here from Advanced (channel, auto-check, check now). */}
          <UpdateSettings />
        </div>
      </div>

      {/* SERVER URLS (collapsible) — all service URLs incl. Jellyfin servers */}
      <ServerUrlsFolder />

      {/* JELLYFIN PREFERENCES (collapsible) — player + display only */}
      <JellyfinPrefsFolder onNavigate={onNavigate} />

      {/* Legacy Calibre-Web / Audiobookshelf / Requester sections, hidden but
          retained for future per-service settings. */}
      {SHOW_LEGACY_SERVICE_SECTIONS && <LegacyServiceSections />}


      {/* THEME COLORS (collapsible, own component) */}
      <ThemeColorSettings />

      {/* ADVANCED (collapsible) — Audio output (hidden on iOS) + Download path.
          Always rendered; the iOS-only audio gating happens inside. */}
      <AdvancedSettingsSection />

      {/* BACKUP & TRANSFER — export/import settings between devices */}
      <BackupTransferSection />

      {/* TROUBLESHOOTING — debug report + reset */}
      <TroubleshootingSection />

      {/* Save applies everything and re-authenticates only when the credentials
          changed since this screen opened (URLs have their own Save button). */}
      <SaveButton
        label="Save"
        icon={<Save size={18} />}
        onSave={() => {
          saveSettings(currentAppSettings())
          const s = useSettingsStore.getState()
          return (
            s.credentials.username !== credentialsSnapshot.current.username ||
            s.credentials.password !== credentialsSnapshot.current.password
          )
        }}
      />
    </div>
  )
}

// Phone-only shell: wraps each top-level view with the bottom tab bar and docks
// the mini players directly above it. On desktop it renders children unchanged
// (zero DOM delta — the strongest guarantee against desktop regressions).
function AppShell({ tab, onNavigate, children }: {
  tab: AppTab
  onNavigate: (tab: AppTab) => void
  children: React.ReactNode
}) {
  const isPhone = useIsPhone()
  const currentMusicTrack = useMusicPlayer(state => state.currentTrack)
  const currentAudiobookItem = useAudiobookPlayer(state => state.currentItem)

  if (!isPhone) return <>{children}</>

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-900">
      <SwipeBackOverlay />
      <div className="flex-1 min-h-0">{children}</div>
      {currentMusicTrack && tab !== 'jellymusic' && (
        <MusicMiniPlayer onSwitchToMusic={() => onNavigate('jellymusic')} />
      )}
      {currentAudiobookItem && tab !== 'audiobookshelf' && (
        <AudiobookMiniPlayer onSwitchToAudiobooks={() => onNavigate('audiobookshelf')} />
      )}
      <BottomTabBar active={tab} onNavigate={onNavigate} />
    </div>
  )
}

function App() {
  // ==================== SETTINGS STORE ====================
  const settings = useSettingsStore(useShallow((state) => ({
    credentials: state.credentials,
    calibreWeb: state.calibreWeb,
    jellyfinServers: state.jellyfinServers,
    activeJellyfinServerId: state.activeJellyfinServerId,
    downloadPath: state.downloadPath,
    defaultStartPage: state.defaultStartPage,
    jellyfinSeekBackSeconds: state.jellyfinSeekBackSeconds,
    jellyfinSeekForwardSeconds: state.jellyfinSeekForwardSeconds,
    audioOutputDevices: state.audioOutputDevices,
    jellyfinHomeCardSize: state.jellyfinHomeCardSize,
    jellyfinLibraryCardSize: state.jellyfinLibraryCardSize,
  })))
  const syncToken = useSettingsStore((state) => state.syncToken)
  const isAddingServer = useSettingsStore((state) => state.isAddingServer)
  const newJellyfinUrl = useSettingsStore((state) => state.newJellyfinUrl)
  const jellyfinServerStatus = useSettingsStore((state) => state.jellyfinServerStatus)

  // Settings actions
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const updateCredentials = useSettingsStore((state) => state.updateCredentials)
  const updateCalibreWeb = useSettingsStore((state) => state.updateCalibreWeb)
  const updateDownloadPath = useSettingsStore((state) => state.updateDownloadPath)
  const addJellyfinServer = useSettingsStore((state) => state.addJellyfinServer)
  const deleteJellyfinServer = useSettingsStore((state) => state.deleteJellyfinServer)
  const setActiveJellyfinServer = useSettingsStore((state) => state.setActiveJellyfinServer)
  const setIsAddingServer = useSettingsStore((state) => state.setIsAddingServer)
  const setNewJellyfinUrl = useSettingsStore((state) => state.setNewJellyfinUrl)
  const setSyncToken = useSettingsStore((state) => state.setSyncToken)
  const checkAllServersStatus = useSettingsStore((state) => state.checkAllServersStatus)
  const getAuthHeader = useSettingsStore((state) => state.getAuthHeader)
  const activeJellyfinServerId = useSettingsStore((state) => state.activeJellyfinServerId)
  const setJellyfinSeekBackSeconds = useSettingsStore((state) => state.setJellyfinSeekBackSeconds)
  const setJellyfinSeekForwardSeconds = useSettingsStore((state) => state.setJellyfinSeekForwardSeconds)
  const setJellyfinHomeCardSize = useSettingsStore((state) => state.setJellyfinHomeCardSize)
  const setJellyfinLibraryCardSize = useSettingsStore((state) => state.setJellyfinLibraryCardSize)

  // ==================== LIBRARY STORE ====================
  const localBooks = useLibraryStore((state) => state.localBooks)
  const heroBooks = useLibraryStore((state) => state.heroBooks)
  const recentBooks = useLibraryStore((state) => state.recentBooks)
  const remoteBooks = useLibraryStore((state) => state.remoteBooks)
  const startedBooks = useLibraryStore((state) => state.startedBooks)
  const selectedBook = useLibraryStore((state) => state.selectedBook)
  const isReading = useLibraryStore((state) => state.isReading)
  const isOnline = useLibraryStore((state) => state.isOnline)
  const isCalibreReachable = useLibraryStore((state) => state.isCalibreReachable)
  const checkCalibreReachability = useLibraryStore((state) => state.checkCalibreReachability)
  const isAuthenticated = useLibraryStore((state) => state.isAuthenticated)
  const isLoading = useLibraryStore((state) => state.isLoading)
  const currentFeedUrl = useLibraryStore((state) => state.currentFeedUrl)
  const history = useLibraryStore((state) => state.history)

  // Library actions
  const initializeLibrary = useLibraryStore((state) => state.initialize)
  const checkSession = useLibraryStore((state) => state.checkSession)
  const checkHealth = useLibraryStore((state) => state.checkHealth)
  const loginToSync = useLibraryStore((state) => state.loginToSync)
  const loadDashboard = useLibraryStore((state) => state.loadDashboard)
  const loadLocalBooks = useLibraryStore((state) => state.loadLocalBooks)
  const loadStartedBooks = useLibraryStore((state) => state.loadStartedBooks)
  const fetchFeed = useLibraryStore((state) => state.fetchFeed)
  const handleReadAction = useLibraryStore((state) => state.handleRead)
  const handleDownloadAction = useLibraryStore((state) => state.handleDownload)
  const handleDeleteAction = useLibraryStore((state) => state.handleDelete)
  const updateProgress = useLibraryStore((state) => state.updateProgress)
  const getIsRead = useLibraryStore((state) => state.getIsRead)
  const toggleReadStatus = useLibraryStore((state) => state.toggleReadStatus)
  const setSelectedBook = useLibraryStore((state) => state.setSelectedBook)
  const setIsReading = useLibraryStore((state) => state.setIsReading)
  const setRemoteBooks = useLibraryStore((state) => state.setRemoteBooks)
  const setCurrentFeedUrl = useLibraryStore((state) => state.setCurrentFeedUrl)
  const pushHistory = useLibraryStore((state) => state.pushHistory)
  const popHistory = useLibraryStore((state) => state.popHistory)
  const setIsAuthenticated = useLibraryStore((state) => state.setIsAuthenticated)

  // ==================== LOCAL UI STATE ====================
  const [view, setView] = useState<'dashboard' | 'category' | 'settings' | 'details' | 'jellyfin' | 'jellymusic' | 'requester' | 'livetv' | 'audiobookshelf'>(() => {
    // Reopen in the tab the user last used ("start where I left off").
    const lastTab = loadLastTab()
    if (lastTab) return lastTab
    // Migration for users upgrading from the old manual "default start page"
    // (removed setting): honour it once, then last-used takes over.
    const startPage = settings.defaultStartPage || 'calibre'
    if (startPage === 'jellyfin') return 'jellyfin'
    if (startPage === 'jellymusic') return 'jellymusic'
    if (startPage === 'requester') return 'requester'
    if (startPage === 'livetv') return 'livetv'
    if (startPage === 'audiobookshelf') return 'audiobookshelf'
    return 'dashboard'
  })
  const [previousView, setPreviousView] = useState<'dashboard' | 'category' | 'jellyfin' | 'jellymusic' | 'requester' | 'livetv' | 'audiobookshelf'>('dashboard')

  // Remember the last top-level tab so the app reopens where it left off.
  // Transient views map to their owning tab; 'settings' is skipped so we never
  // restore into settings. Persisted on every change (no reliable close hook).
  useEffect(() => {
    const tabForView: Partial<Record<typeof view, PersistedTab>> = {
      dashboard: 'dashboard',
      category: 'dashboard',
      details: 'dashboard',
      jellyfin: 'jellyfin',
      jellymusic: 'jellymusic',
      requester: 'requester',
      livetv: 'livetv',
      audiobookshelf: 'audiobookshelf',
    }
    const tab = tabForView[view]
    if (tab) saveLastTab(tab)
  }, [view])
  const [detailBook, setDetailBook] = useState<any>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [allBooksLoading, setAllBooksLoading] = useState(false)
  const [allBooksSort, setAllBooksSort] = useState<'title' | 'author' | 'added'>('title')
  // All Books renders progressively out of the full client-side list; this is
  // how many cards are currently mounted (grown by the infinite-scroll sentinel)
  const [allBooksVisible, setAllBooksVisible] = useState(60)
  const [seriesBooks, setSeriesBooks] = useState<Book[]>([])

  // All Books grid element + A–Z rail jump. Because the whole sorted list lives
  // in remoteBooks (only the window is mounted), jumping to a deep letter first
  // grows the window enough to mount the target, then scrolls it into view.
  const categoryGridRef = React.useRef<HTMLDivElement>(null)
  const jumpToBookIndex = useCallback((i: number) => {
    setAllBooksVisible(v => (i >= v ? i + 30 : v))
    requestAnimationFrame(() => {
      (categoryGridRef.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: 'start' })
    })
  }, [])

  // Deep linking: Items to play immediately when switching views
  const [initialPlayVideoItem, setInitialPlayVideoItem] = useState<any>(null)
  const [initialPlayMusicTrack, setInitialPlayMusicTrack] = useState<any>(null)
  const [initialPlayAbsItemId, setInitialPlayAbsItemId] = useState<string | null>(null)
  // Deep linking from global search: open an item's DETAILS (Series, albums,
  // artists — things that can't be played directly) in the target tab
  const [initialOpenVideoItem, setInitialOpenVideoItem] = useState<any>(null)
  const [initialOpenMusicItem, setInitialOpenMusicItem] = useState<any>(null)

  const toast = useToast()
  // Stable ref for effects with empty/minimal dep arrays (reconnect handlers)
  const toastRef = React.useRef(toast)
  toastRef.current = toast

  // Music player state (for MusicMiniPlayer visibility)
  const currentMusicTrack = useMusicPlayer(state => state.currentTrack)
  const currentAudiobookItem = useAudiobookPlayer(state => state.currentItem)

  // Phone layout: mini players + app switcher live in AppShell (bottom tab bar)
  const isPhone = useIsPhone()
  const navigateTab = useCallback((tab: AppTab) => {
    setView(tab === 'calibre' ? 'dashboard' : tab)
  }, [])

  // Apply the active tab's accent palette (CSS variables --theme-*).
  // The settings view keeps whatever accent was active before it opened.
  const themeColors = useSettingsStore(useShallow((state) => state.themeColors))
  useEffect(() => {
    const tabForView: Partial<Record<typeof view, ThemeTab>> = {
      dashboard: 'calibre',
      category: 'calibre',
      details: 'calibre',
      jellyfin: 'jellyfin',
      jellymusic: 'jellymusic',
      requester: 'requester',
      livetv: 'livetv',
      audiobookshelf: 'audiobookshelf',
    }
    const tab = tabForView[view]
    if (tab) applyTabAccent(tab, themeColors)
  }, [view, themeColors])

  // Derived values
  const apiUrl = settings.calibreWeb.url
  const downloadPath = settings.downloadPath
  const password = settings.credentials.password

  // Memoize auth headers so the reference is stable across renders
  // (prevents child components from re-fetching images on every parent re-render)
  const authHeaders = useMemo(() => getAuthHeader(), [syncToken])

  // Offline support
  const hasLocalContent = localBooks.length > 0 || startedBooks.length > 0
  // Use isCalibreReachable (actual server check) rather than navigator.onLine
  // Falls back to isOnline for unknown state (before first check completes)
  const calibreIsOffline = isCalibreReachable === false && !isAuthenticated
  const showOfflineDashboard = calibreIsOffline && hasLocalContent
  // Jellyfin offline: active server was checked and found unreachable
  const jellyfinIsOffline = activeJellyfinServerId
    ? jellyfinServerStatus[activeJellyfinServerId] === false
    : false

  // ==================== INITIALIZATION ====================
  useEffect(() => {
    initializeLibrary()
  }, [initializeLibrary])

  // First run: silently set the default download location
  // (Tauri: %LOCALAPPDATA%\com.reader.app\downloads — created by the backend)
  // iOS: ALWAYS re-resolve — the sandbox container UUID (and therefore the
  // absolute path) changes on every app update/reinstall, so a stored path
  // points into the previous, dead container. iOS migrates the container
  // contents, so previously downloaded files are still there under the new path.
  useEffect(() => {
    if (!downloadPath || IS_IOS) {
      api.getDefaultPath().then(path => {
        if (path && path !== downloadPath) useSettingsStore.getState().updateDownloadPath(path)
      }).catch(() => {})
    }
    // Run once at startup only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Prune download entries whose files were deleted externally, so offline
  // views never list unplayable items
  useEffect(() => {
    Promise.all([
      import('./utils/jellyfinDownloadManager').then(m => m.verifyDownloadedMedia()),
      import('./utils/musicDownloadManager').then(m => m.verifyDownloadedTracks()),
    ]).then(([video, music]) => {
      if (video + music > 0) console.log(`[Downloads] Pruned ${video + music} missing download entries`)
    }).catch(() => {})
  }, [])

  // Tell the user what a downloaded-playlist sync actually changed (silent when
  // nothing did — this runs on every launch and every reconnect)
  const reportPlaylistSync = useCallback((r: { changed: number; added: number; removed: number }) => {
    if (r.changed === 0) return
    const parts: string[] = []
    if (r.added > 0) parts.push(`${r.added} track${r.added === 1 ? '' : 's'} added`)
    if (r.removed > 0) parts.push(`${r.removed} removed`)
    toastRef.current.success(
      `Updated ${r.changed} downloaded playlist${r.changed === 1 ? '' : 's'}${parts.length ? ` — ${parts.join(', ')}` : ''}`
    )
  }, [])

  // Startup flush: sync anything queued in a previous offline session.
  // Covers "closed the app offline, reopened it online" — no reconnect
  // transition ever fires in that case, so flush once shortly after launch.
  useEffect(() => {
    const timer = setTimeout(() => {
      Promise.all([
        import('./utils/jellyfinOfflineQueue').then(m => m.processJellyfinQueue()),
        import('./utils/jellyfinDownloadManager').then(m => m.syncPendingProgress()),
      ]).then(([ops, progress]) => {
        const total = ops + progress.synced
        if (total > 0) {
          console.log(`[Startup] Synced ${ops} queued ops + ${progress.synced} resume positions from previous offline session`)
          toastRef.current.success(`Synced ${total} playback update${total === 1 ? '' : 's'} from your offline session`)
        }
      }).catch(() => {})

      // Externally generated playlists change while the app is closed, so check
      // downloaded playlists for added/removed tracks on every launch too.
      import('./utils/musicDownloadManager')
        .then(m => m.syncDownloadedPlaylists())
        .then(reportPlaylistSync)
        .catch(() => {})
    }, 5000)  // Give connectivity checks a moment to settle first
    return () => clearTimeout(timer)
  }, [])

  // Startup connectivity check — fast single-shot (3s timeout, 1 attempt) to detect offline quickly.
  // The adaptive polling below handles thorough retries once the initial state is known.
  useEffect(() => {
    const fastOpts = { timeout: 3000, retries: 1, retryDelay: 0 }
    if (apiUrl) checkCalibreReachability(apiUrl, getAuthHeader(), fastOpts)
    if (settings.jellyfinServers.length > 0) checkAllServersStatus(fastOpts)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Adaptive polling: 30s when any server is offline, 5 min when all online
  useEffect(() => {
    const anyOffline = !isCalibreReachable ||
      (activeJellyfinServerId && jellyfinServerStatus[activeJellyfinServerId] === false)
    const pollInterval = anyOffline ? 30_000 : 300_000

    const poll = setInterval(() => {
      if (apiUrl) checkCalibreReachability(apiUrl, getAuthHeader())
      if (settings.jellyfinServers.length > 0) checkAllServersStatus()
    }, pollInterval)

    return () => clearInterval(poll)
  }, [isCalibreReachable, activeJellyfinServerId, jellyfinServerStatus, apiUrl, settings.jellyfinServers.length])

  // Check session when credentials/URL change
  useEffect(() => {
    // Show cached local books immediately — reads IndexedDB only, no network requests
    loadStartedBooks(apiUrl, syncToken, downloadPath, getAuthHeader(), true)

    if (apiUrl && isOnline && isCalibreReachable !== false && apiUrl.startsWith('http')) {
      // Debounce so rapid credential edits don't spam the server
      const timer = setTimeout(async () => {
        // Always login to get a fresh JWT token when credentials are available
        if (settings.credentials.username && password) {
          const token = await loginToSync(apiUrl, settings.credentials.username, password)
          if (token) {
            setSyncToken(token)
            // Use the fresh token directly (don't rely on store propagation)
            const freshAuth = { Authorization: `Bearer ${token}` }
            await checkSession(apiUrl, freshAuth)
            checkHealth(apiUrl, freshAuth)
            loadStartedBooks(apiUrl, token, downloadPath, freshAuth)
            return
          }
          // Login failed — confirm unreachable immediately (fast check, no extra retries)
          checkCalibreReachability(apiUrl, {}, { timeout: 2000, retries: 1, retryDelay: 0 })
        }
        // Fallback: try existing token
        await checkSession(apiUrl, getAuthHeader())
        checkHealth(apiUrl, getAuthHeader())
      }, 500)
      return () => clearTimeout(timer)
    }
    // Offline / no URL: local-only call above is sufficient
  }, [apiUrl, settings.credentials.username, password, isOnline, isCalibreReachable])

  // Load dashboard when authenticated
  useEffect(() => {
    if (isAuthenticated && view === 'dashboard') {
      loadDashboard(apiUrl, syncToken, getAuthHeader())
      loadStartedBooks(apiUrl, syncToken, downloadPath, getAuthHeader())
    }
  }, [isAuthenticated, view])

  // Periodic health check (still useful for auth status; polling above handles reachability)
  useEffect(() => {
    const interval = setInterval(() => {
      if (isCalibreReachable) checkHealth(apiUrl, getAuthHeader())
    }, 60000)
    return () => clearInterval(interval)
  }, [isCalibreReachable, apiUrl])

  // Roll the JWT forward before it expires (24h default) so the session survives
  // without re-sending credentials. A full login re-syncs read status from
  // Calibre-Web; /api/refresh skips that, carrying the password claim over.
  useEffect(() => {
    if (!apiUrl || !syncToken || !isOnline) return
    let cancelled = false
    const maybeRefresh = async () => {
      const exp = getTokenExpiry(syncToken)
      if (!exp) return
      const secondsLeft = exp - Date.now() / 1000
      // Refresh only while still valid and within an hour of expiry (an expired
      // token can't be refreshed — the credential effect re-logins instead).
      if (secondsLeft > 0 && secondsLeft < 3600) {
        const fresh = await refreshToken(apiUrl, syncToken)
        if (!cancelled && fresh) {
          setSyncToken(fresh)
          console.log('[Auth] Sync token refreshed')
        }
      }
    }
    maybeRefresh()
    const interval = setInterval(maybeRefresh, 15 * 60 * 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [apiUrl, syncToken, isOnline, setSyncToken])

  // Load local books when download path changes
  useEffect(() => {
    if (downloadPath) loadLocalBooks(downloadPath)
  }, [downloadPath, loadLocalBooks])

  // Offline auto-redirect: when Calibre is unreachable and user is not logged in,
  // navigate straight to the downloaded books page so local content is accessible.
  const autoNavigatedCalibreOffline = React.useRef(false)
  useEffect(() => {
    if (isCalibreReachable === false && !isAuthenticated && localBooks.length > 0) {
      if (!autoNavigatedCalibreOffline.current) {
        autoNavigatedCalibreOffline.current = true
        navigateToCategory('virtual:downloads')
      }
    } else if (isCalibreReachable !== false && autoNavigatedCalibreOffline.current) {
      // Server came back online — go back to dashboard so login flow can run
      autoNavigatedCalibreOffline.current = false
      setView('dashboard')
    }
  }, [isCalibreReachable, isAuthenticated, localBooks.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush pending sync when Calibre server becomes reachable
  // Also keep browser 'online' event as a fast trigger for network reconnect
  const prevCalibreReachable = React.useRef(isCalibreReachable)
  useEffect(() => {
    const wasOffline = prevCalibreReachable.current === false
    prevCalibreReachable.current = isCalibreReachable

    if (wasOffline && isCalibreReachable && apiUrl && syncToken) {
      const baseUrl = apiUrl.replace(/\/$/, '')
      import('./utils/syncServerApi').then(m => m.processPendingChanges(baseUrl, syncToken))
        .then(n => {
          if (n > 0) {
            console.log(`[Reconnect] Synced ${n} pending Calibre changes`)
            toastRef.current.success(`Back online — synced ${n} reading update${n === 1 ? '' : 's'}`)
          }
        })
        .catch(e => console.error('[Reconnect] Calibre sync failed:', e))
    }
  }, [isCalibreReachable, apiUrl, syncToken])

  // Sync pending Jellyfin progress on browser network reconnect
  useEffect(() => {
    const handleOnline = async () => {
      try {
        const { syncPendingProgress } = await import('./utils/jellyfinDownloadManager')
        const result = await syncPendingProgress()
        if (result.synced > 0) {
          console.log(`[Reconnect] Synced ${result.synced} pending Jellyfin progress updates`)
          toastRef.current.success(`Back online — synced ${result.synced} resume position${result.synced === 1 ? '' : 's'}`)
        }
      } catch (e) {
        console.error('[Reconnect] Failed to sync Jellyfin progress:', e)
      }
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  // Flush Jellyfin offline play/progress queue when Jellyfin server comes back
  const prevJellyfinOffline = React.useRef(jellyfinIsOffline)
  useEffect(() => {
    const wasOffline = prevJellyfinOffline.current === true
    prevJellyfinOffline.current = jellyfinIsOffline

    if (wasOffline && !jellyfinIsOffline) {
      // Flush BOTH offline stores: the played-items op queue AND the pending
      // resume positions. The window 'online' event alone is not enough — it
      // never fires when the network stayed up and only the server was away.
      Promise.all([
        import('./utils/jellyfinOfflineQueue').then(({ processJellyfinQueue }) => processJellyfinQueue()),
        import('./utils/jellyfinDownloadManager').then(({ syncPendingProgress }) => syncPendingProgress()),
      ])
        .then(([opsFlushed, progress]) => {
          const total = opsFlushed + progress.synced
          if (total > 0) {
            console.log(`[Reconnect] Jellyfin sync: ${opsFlushed} queue ops, ${progress.synced} resume positions`)
            toastRef.current.success(`Back online — synced ${total} playback update${total === 1 ? '' : 's'}`)
          }
          if (progress.failed > 0) {
            console.warn(`[Reconnect] ${progress.failed} resume positions failed to sync (will retry)`)
          }
        })
        .catch(e => console.error('[Reconnect] Jellyfin sync failed:', e))

      // Back online: re-check every auto-syncing downloaded playlist and pull
      // down whatever tracks were added to it while we were away.
      import('./utils/musicDownloadManager')
        .then(({ syncDownloadedPlaylists }) => syncDownloadedPlaylists())
        .then(reportPlaylistSync)
        .catch(e => console.error('[Reconnect] Playlist sync failed:', e))
    }
  }, [jellyfinIsOffline, reportPlaylistSync])

  // Global search keyboard shortcut (Ctrl+K / Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Global back navigation: Escape and mouse back button route through the
  // navigationBus back-handler stack (each view container registers its own
  // handler). Esc stays silent while an Esc-handling overlay is open (video
  // player, readers, search, shortcut overlay — they register blockers);
  // mouse back always dispatches so it can e.g. close the video player.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isGlobalEscBlocked()) return
      if (isEditableTarget(e.target)) return
      dispatchBack('esc')
    }
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        // Mouse back button
        e.preventDefault()
        dispatchBack('mouse')
      } else if (e.button === 4) {
        // Mouse forward button — no natural forward stack exists in the app,
        // so this is intentionally a no-op (consumed to avoid webview quirks)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // Readers (EPUB/PDF/Manga) own the keyboard while open — suppress Esc-as-back
  useEffect(() => {
    if (isReading) return blockGlobalEsc()
  }, [isReading])

  // Keep the scroll position of the book views when drilling into details
  // and coming back (the data itself survives in the library store)
  const mainScrollRef = React.useRef<HTMLDivElement>(null)
  const dashboardScrollAnchor = useScrollRestore('calibre:dashboard', view === 'dashboard')
  const categoryScrollAnchor = useScrollRestore(
    `calibre:category:${currentFeedUrl}`,
    view === 'category' && remoteBooks.length > 0
  )

  // All Books holds the complete sorted list in memory; the sentinel only
  // grows how many cards are rendered — no network requests while scrolling
  const { sentinelRef: allBooksSentinelRef } = useInfiniteScroll({
    hasMore: view === 'category' && currentFeedUrl === 'virtual:all-books' && allBooksVisible < remoteBooks.length,
    isLoading: allBooksLoading,
    onLoadMore: () => setAllBooksVisible(v => v + 60),
  })

  // ==================== HANDLERS ====================
  // Cache for full book list — populated by All Books and Series views
  const allBooksCache = React.useRef<any[]>([])

  // Populate the session book-list cache on demand. Uses the ETag-backed
  // persistent cache (booksListCache), so a fresh session revalidates instead of
  // re-downloading the whole list, and an in-session refresh gets an empty-body 304.
  const ensureAllBooks = useCallback(async (): Promise<any[]> => {
    if (allBooksCache.current.length > 0) return allBooksCache.current
    const baseUrl = apiUrl.replace(/\/$/, '')
    const list = await fetchBooksList(baseUrl, getAuthHeader())
    if (list.length > 0) allBooksCache.current = list
    return allBooksCache.current
  }, [apiUrl, getAuthHeader])

  const openSettings = useCallback(() => {
    // Save current view so we can return to it from settings
    if (view !== 'settings' && view !== 'details') {
      setPreviousView(view as any)
    }
    setView('settings')
  }, [view])

  const openDetails = useCallback(async (book: any) => {
    setDetailBook(book)
    setSeriesBooks([])
    setPreviousView(view === 'details' ? 'dashboard' : view as 'dashboard' | 'category')
    setView('details')

    // Compute series siblings
    if (apiUrl && syncToken) {
      const baseUrl = apiUrl.replace(/\/$/, '')
      // Fetch full list if cache is empty (ETag-revalidated, persisted)
      await ensureAllBooks()

      // Books opened from local progress data (Continue Reading) often carry no
      // series metadata — resolve it from the server book list by calibreId
      // (fallback: title match) before looking for siblings.
      let seriesName = book.series
      let calibreId = book.calibreId
      if (!seriesName || !calibreId) {
        const entry = allBooksCache.current.find((b: any) =>
          calibreId ? String(b.id) === String(calibreId) : b.title === book.title
        )
        if (entry) {
          seriesName = seriesName || entry.series
          calibreId = calibreId || String(entry.id)
        }
      }

      const siblings: Book[] = !seriesName ? [] : allBooksCache.current
        .filter(b => b.series === seriesName && String(b.id) !== String(calibreId))
        .sort((a: any, b: any) => (a.series_index || 0) - (b.series_index || 0))
        .map((b: any) => ({
          id: `urn:calibre:${b.id}`,
          calibreId: String(b.id),
          title: b.title,
          author: (b.authors || []).join(', '),
          cover: `${baseUrl}${b.cover_url}`,
          formats: b.formats,
          series: b.series || undefined,
          series_index: b.series_index ?? undefined,
          type: 'remote' as const,
        }))
      setSeriesBooks(siblings)

      // Backfill resolved metadata so the details view shows the series name
      // (guard against the user having opened another book meanwhile)
      if (seriesName && (seriesName !== book.series || calibreId !== book.calibreId)) {
        setDetailBook((prev: any) =>
          prev && prev.id === book.id
            ? { ...prev, series: seriesName, calibreId: prev.calibreId || calibreId }
            : prev
        )
      }
    }

    // Update cache if exists (use IndexedDB — same store as the rest of the app)
    const key = `progress_${book.id}`
    getItem(key).then((existing) => {
      if (!existing) return
      try {
        const val = JSON.parse(existing)
        const newVal = {
          ...val,
          title: book.title,
          cover: book.cover,
          author: book.author,
          localPath: book.localPath || val.localPath,
        }
        setItem(key, JSON.stringify(newVal))
      } catch { /* ignore malformed cache entry */ }
    })
  }, [view, ensureAllBooks])

  const handleBack = useCallback(() => {
    if (view === 'details') {
      setView(previousView)
      setDetailBook(null)
    } else {
      setView('dashboard')
    }
  }, [view, previousView])

  const mapServerBook = useCallback((b: any, baseUrl: string): Book => ({
    id: `urn:calibre:${b.id}`,
    calibreId: String(b.id),
    title: b.title,
    author: (b.authors || []).join(', '),
    cover: `${baseUrl}${b.cover_url}`,
    formats: b.formats,
    series: b.series || undefined,
    series_index: b.series_index ?? undefined,
    type: 'remote' as const,
  }), [])

  // 'added' keeps the server's list order (date added); the others sort locally
  const sortAllBooks = useCallback((books: Book[], sort: 'title' | 'author' | 'added'): Book[] => {
    if (sort === 'added') return books
    const byTitle = (a: Book, b: Book) =>
      (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base', numeric: true })
    const arr = [...books]
    if (sort === 'title') arr.sort(byTitle)
    else arr.sort((a, b) =>
      (a.author || '').localeCompare(b.author || '', undefined, { sensitivity: 'base' }) || byTitle(a, b)
    )
    return arr
  }, [])

  const showSeriesList = useCallback((baseUrl: string) => {
    const seriesMap = new Map<string, { count: number; cover: string }>()
    for (const b of allBooksCache.current) {
      if (!b.series) continue
      const existing = seriesMap.get(b.series)
      seriesMap.set(b.series, {
        count: (existing?.count || 0) + 1,
        cover: existing?.cover || `${baseUrl}${b.cover_url}`,
      })
    }
    const seriesList = [...seriesMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, { count, cover }]) => ({
        id: `series:${name}`,
        title: name,
        author: `${count} volume${count !== 1 ? 's' : ''}`,
        cover,
        isFolder: true,
        folderHref: `virtual:series-books:${name}`,
        type: 'remote' as const,
      }))
    setRemoteBooks(seriesList as Book[])
  }, [setRemoteBooks])

  const showSeriesBooks = useCallback((seriesName: string, baseUrl: string) => {
    const filtered = allBooksCache.current
      .filter(b => b.series === seriesName)
      .sort((a, b) => (a.series_index || 0) - (b.series_index || 0))
      .map(b => ({
        id: `urn:calibre:${b.id}`,
        calibreId: String(b.id),
        title: b.title,
        author: (b.authors || []).join(', '),
        cover: `${baseUrl}${b.cover_url}`,
        formats: b.formats,
        series: b.series || undefined,
        series_index: b.series_index ?? undefined,
        type: 'remote' as const,
      }))
    setRemoteBooks(filtered as Book[])
  }, [setRemoteBooks])

  const handleLibraryBack = useCallback(async () => {
    const prev = popHistory()
    if (!prev) { setView('dashboard'); return }
    setCurrentFeedUrl(prev)
    const baseUrl = apiUrl.replace(/\/$/, '')
    if (prev === 'virtual:series') { showSeriesList(baseUrl); return }
    if (prev.startsWith('virtual:series-books:')) {
      showSeriesBooks(prev.replace('virtual:series-books:', ''), baseUrl); return
    }
    if (prev === 'virtual:all-books') {
      // Rebuild the sorted list from the client-side cache (no refetch)
      if (allBooksCache.current.length === 0) { setView('dashboard'); return }
      const books = allBooksCache.current.map((b) => mapServerBook(b, baseUrl))
      setRemoteBooks(sortAllBooks(books, allBooksSort))
      return
    }
    // Session feed cache: going back restores instantly without refetching
    const cachedFeed = loadGridState<Book[]>(`opds:${prev}`)
    if (cachedFeed) {
      setRemoteBooks(cachedFeed.data)
      return
    }
    const items = await fetchFeed(prev, getAuthHeader())
    if (!prev.includes('readbooks')) saveGridState(`opds:${prev}`, 'opds', items)
    setRemoteBooks(items)
  }, [popHistory, setCurrentFeedUrl, fetchFeed, setRemoteBooks, getAuthHeader, apiUrl, showSeriesList, showSeriesBooks, mapServerBook, sortAllBooks, allBooksSort])

  const navigateToCategory = useCallback(async (path: string) => {
    if (path === 'virtual:downloads') {
      setView('category')
      setCurrentFeedUrl('')
      const mapped = localBooks.map(book => ({
        ...book,
        id: book.metadata?.id || book.path,
        title: book.name || book.metadata?.title,
        author: book.author || book.metadata?.author || "Unknown Author",
        cover: book.cover || book.metadata?.cover,
        localPath: book.path,
        type: 'local' as const,
        formats: [book.path.split('.').pop() || ''],
        downloadUrl: book.metadata?.downloadUrl
      }))
      setRemoteBooks(mapped as any)
      return
    }

    const baseUrl = apiUrl.replace(/\/$/, '')
    const fullUrl = `${baseUrl}${path}`

    if (currentFeedUrl) {
      pushHistory(currentFeedUrl)
    }

    setCurrentFeedUrl(fullUrl)
    setView('category')
    // Session feed cache — read-status feeds change as books get marked
    // read, so those are always fetched fresh
    const cacheable = !path.includes('readbooks')
    const cachedFeed = cacheable ? loadGridState<Book[]>(`opds:${fullUrl}`) : undefined
    const items = cachedFeed ? cachedFeed.data : await fetchFeed(fullUrl, getAuthHeader())
    if (cacheable && !cachedFeed) saveGridState(`opds:${fullUrl}`, 'opds', items)

    let displayedBooks = items
    if (path.includes('readbooks')) {
      const localRead = localBooks.filter(b => {
        const id = b.metadata?.id || b.path
        return getIsRead({ ...b, id } as any)
      })
      const remoteIds = new Set(items.map(b => b.id))
      const uniqueLocal = localRead.filter(b => {
        const id = b.metadata?.id || b.path
        return !remoteIds.has(id)
      }).map(b => ({
        ...b,
        id: b.metadata?.id || b.path,
        calibreId: b.metadata?.calibreId,
        isFolder: false,
        formats: [b.path.split('.').pop() || ''],
        type: 'local' as const
      }))
      displayedBooks = [...items, ...uniqueLocal] as Book[]
    }

    setRemoteBooks(displayedBooks)
  }, [apiUrl, currentFeedUrl, localBooks, pushHistory, setCurrentFeedUrl, fetchFeed, setRemoteBooks, getAuthHeader, getIsRead])

  const PAGE_SIZE = 60

  const navigateToAllBooks = useCallback(async () => {
    const baseUrl = apiUrl.replace(/\/$/, '')
    if (currentFeedUrl) pushHistory(currentFeedUrl)
    setCurrentFeedUrl('virtual:all-books')
    setView('category')
    setAllBooksVisible(PAGE_SIZE)
    // Fresh entry renders only the first chunk again — an old deep scroll
    // position can't be restored into that, so start at the top
    setScrollPos('calibre:category:virtual:all-books', 0)
    // One request for the complete list: the server assembles the same full
    // (5-min cached) list even for paged requests, so paging only added round
    // trips. The full list also enables instant client-side sorting and warms
    // the cache used by the series and details views.
    if (allBooksCache.current.length === 0) {
      setRemoteBooks([])
      setAllBooksLoading(true)
      await ensureAllBooks()
      setAllBooksLoading(false)
    }
    const books = allBooksCache.current.map((b) => mapServerBook(b, baseUrl))
    setRemoteBooks(sortAllBooks(books, allBooksSort))
  }, [apiUrl, currentFeedUrl, pushHistory, setCurrentFeedUrl, setRemoteBooks, ensureAllBooks, allBooksSort, mapServerBook, sortAllBooks])

  const handleAllBooksSortChange = useCallback((sort: 'title' | 'author' | 'added') => {
    setAllBooksSort(sort)
    setAllBooksVisible(PAGE_SIZE)
    const baseUrl = apiUrl.replace(/\/$/, '')
    const books = allBooksCache.current.map((b) => mapServerBook(b, baseUrl))
    setRemoteBooks(sortAllBooks(books, sort))
    mainScrollRef.current?.scrollTo({ top: 0 })
  }, [apiUrl, mapServerBook, sortAllBooks, setRemoteBooks])

  const navigateToSeriesView = useCallback(async () => {
    const baseUrl = apiUrl.replace(/\/$/, '')
    if (currentFeedUrl) pushHistory(currentFeedUrl)
    setCurrentFeedUrl('virtual:series')
    setView('category')
    setRemoteBooks([])
    setAllBooksLoading(true)
    try {
      // Use cached data if available, otherwise fetch (ETag-revalidated)
      await ensureAllBooks()
      showSeriesList(baseUrl)
    } catch (e) {
      console.error('[Series] fetch failed', e)
    }
    setAllBooksLoading(false)
  }, [apiUrl, currentFeedUrl, pushHistory, setCurrentFeedUrl, setRemoteBooks, ensureAllBooks, showSeriesList])

  // Refresh the current Calibre screen in place: drop session caches, then
  // re-fetch whatever is on screen (dashboard sections or the open feed)
  const handleCalibreRefresh = useCallback(async () => {
    clearGridStates('opds:')
    allBooksCache.current = []
    if (downloadPath) loadLocalBooks(downloadPath)

    const baseUrl = apiUrl.replace(/\/$/, '')

    if (view === 'category') {
      if (!currentFeedUrl) {
        // Downloads virtual view — local books were just reloaded above
        navigateToCategory('virtual:downloads')
        return
      }
      if (currentFeedUrl === 'virtual:all-books' || currentFeedUrl === 'virtual:series' || currentFeedUrl.startsWith('virtual:series-books:')) {
        // These views render from the full-list cache — refetch it first.
        // ETag revalidation makes an unchanged library a cheap 304.
        setRemoteBooks([])
        setAllBooksLoading(true)
        await ensureAllBooks()
        setAllBooksLoading(false)
        if (currentFeedUrl === 'virtual:series') {
          showSeriesList(baseUrl)
        } else if (currentFeedUrl.startsWith('virtual:series-books:')) {
          showSeriesBooks(currentFeedUrl.replace('virtual:series-books:', ''), baseUrl)
        } else {
          const books = allBooksCache.current.map((b) => mapServerBook(b, baseUrl))
          setRemoteBooks(sortAllBooks(books, allBooksSort))
        }
        return
      }
      // Regular OPDS feed — fetch fresh, re-prime the session cache
      const items = await fetchFeed(currentFeedUrl, getAuthHeader())
      if (!currentFeedUrl.includes('readbooks')) saveGridState(`opds:${currentFeedUrl}`, 'opds', items)
      setRemoteBooks(items)
      return
    }

    // Dashboard (also the fallback for details view: refresh dashboard data)
    if (isAuthenticated) {
      loadDashboard(apiUrl, syncToken, getAuthHeader())
      loadStartedBooks(apiUrl, syncToken, downloadPath, getAuthHeader())
    }
  }, [view, currentFeedUrl, apiUrl, syncToken, downloadPath, isAuthenticated, loadLocalBooks, navigateToCategory, getAuthHeader, fetchFeed, setRemoteBooks, showSeriesList, showSeriesBooks, mapServerBook, sortAllBooks, allBooksSort, loadDashboard, loadStartedBooks, ensureAllBooks])

  const handleRead = useCallback(async (book: any) => {
    await handleReadAction(book, apiUrl, syncToken)
  }, [handleReadAction, apiUrl, syncToken])

  const handleDownload = useCallback(async (book: any) => {
    if (!downloadPath) {
      toast.error("Set download path in Settings")
      openSettings()
      return
    }
    // Track in the unified download center (panel + top-bar badge)
    beginCalibreDownload(book)
    const success = await handleDownloadAction(book, downloadPath, apiUrl, getAuthHeader())
    const outcome = finishCalibreDownload(book.id, success)
    if (success) {
      toast.success(`Downloaded: ${book.title}`)
    } else if (outcome !== 'cancelled') {
      toast.error("Download failed")
    }
  }, [handleDownloadAction, downloadPath, apiUrl, getAuthHeader])

  const handleDelete = useCallback(async (book: any) => {
    if (!confirm(`Delete "${book.title}" from device?`)) return
    const success = await handleDeleteAction(book, downloadPath)
    if (success) {
      toast.success("Book deleted")
      if (detailBook?.id === book.id) {
        setDetailBook({ ...detailBook, localPath: undefined, type: 'remote' })
      }
    } else {
      toast.error("Failed to delete book")
    }
  }, [handleDeleteAction, downloadPath, detailBook])

  const handleMarkRead = useCallback(async (book: any) => {
    const currentlyRead = getIsRead(book)

    if (book.calibreId && apiUrl && syncToken) {
      await toggleReadStatus(book.calibreId, apiUrl, syncToken, isOnline)
    }

    if (currentlyRead) {
      await updateProgress(book.id, "0", 0, apiUrl, syncToken, downloadPath)
      toast.info("Marked as Unread")
    } else {
      await updateProgress(book.id, "100", 1.0, apiUrl, syncToken, downloadPath)
      toast.info("Marked as Read")
    }
  }, [getIsRead, toggleReadStatus, updateProgress, apiUrl, syncToken, isOnline, downloadPath])

  const handleToggleRead = useCallback(async (book: any) => {
    const currentlyRead = getIsRead(book)

    if (book.calibreId && apiUrl && syncToken) {
      await toggleReadStatus(book.calibreId, apiUrl, syncToken, isOnline)
    }

    if (currentlyRead) {
      await updateProgress(book.id, "0", 0, apiUrl, syncToken, downloadPath)
    } else {
      await updateProgress(book.id, "100", 1.0, apiUrl, syncToken, downloadPath)
    }
  }, [getIsRead, toggleReadStatus, updateProgress, apiUrl, syncToken, isOnline, downloadPath])

  const handleProgressUpdate = useCallback((progress: number | string, percentage?: number) => {
    if (selectedBook) {
      updateProgress(selectedBook.id, progress, percentage ?? 0, apiUrl, syncToken, downloadPath)
    }
  }, [selectedBook, updateProgress, apiUrl, syncToken, downloadPath])

  // ==================== SHELL NAVIGATION (navigationBus) ====================

  // Back handler for the App-owned views (Calibre dashboard/category/details
  // and the standalone settings view). The other tabs' view containers
  // register their own handlers while mounted.
  useEffect(() => {
    if (view !== 'dashboard' && view !== 'category' && view !== 'details' && view !== 'settings') return
    return registerBackHandler((source) => {
      if (isReading) {
        // Esc is blocked while reading (readers own the keyboard); the mouse
        // back button and phone edge-swipe close the reader like a back
        // gesture would.
        if (source !== 'esc') setIsReading(false)
        return true
      }
      if (view === 'settings') { setView(previousView as any); return true }
      if (view === 'details') { handleBack(); return true }
      if (view === 'category') { handleLibraryBack(); return true }
      return false // dashboard root — nothing to go back to
    })
  }, [view, isReading, previousView, handleBack, handleLibraryBack, setIsReading])

  // Smart re-tap on the Calibre tab: scroll the current list to top, or
  // (already at top / in a sub-view) return to the dashboard
  useEffect(() => {
    if (view !== 'dashboard' && view !== 'category' && view !== 'details') return
    return registerTabReset('calibre', () => {
      smartTabReset(mainScrollRef.current, view === 'dashboard', () => {
        setView('dashboard')
        setDetailBook(null)
      })
    })
  }, [view])

  // Pull-to-refresh (phone) on the Calibre dashboard — same reload as the
  // toolbar refresh button
  const calibrePullState = usePullToRefresh(mainScrollRef, handleCalibreRefresh, view === 'dashboard' && !isReading)

  // In settings, the tab bar highlights the tab settings was opened from —
  // re-tapping it leaves settings and returns to that tab's view
  useEffect(() => {
    if (view !== 'settings') return
    const tab: AppTab = previousView === 'dashboard' || previousView === 'category' ? 'calibre' : previousView
    return registerTabReset(tab, () => navigateTab(tab))
  }, [view, previousView, navigateTab])

  // ==================== RENDER ====================

  // Global search modal — one shared element included in EVERY view branch
  // below, so Ctrl+K (and the top-bar search buttons) work in all tabs, not
  // just Calibre/Settings.
  const openGlobalSearch = () => setIsSearchOpen(true)
  const globalSearchModal = (
    <GlobalSearch
      isOpen={isSearchOpen}
      onClose={() => setIsSearchOpen(false)}
      onSelectBook={(book) => {
        openDetails(book)
      }}
      onSelectJellyfin={(item) => {
        // Series (and anything not directly playable) → its details page
        setInitialOpenVideoItem(item)
        setView('jellyfin')
      }}
      onSelectMusic={(item) => {
        // Albums/Artists → their details page
        setInitialOpenMusicItem(item)
        setView('jellymusic')
      }}
      onPlayVideo={(item) => {
        // Deep link: Play video immediately
        setInitialPlayVideoItem(item)
        setView('jellyfin')
      }}
      onPlayTrack={(item) => {
        // Deep link: Play track immediately
        setInitialPlayMusicTrack(item)
        setView('jellymusic')
      }}
      onSelectAudiobook={(item) => {
        // Deep link: audiobooks start playing, podcasts open the episode list
        setInitialPlayAbsItemId(item.id)
        setView('audiobookshelf')
      }}
    />
  )

  // JELLYFIN MODE
  if (view === 'jellyfin') {
    return (
      <AppShell tab="jellyfin" onNavigate={navigateTab}>
      <div className="h-screen phone:h-full flex flex-col overflow-hidden">
        {!isPhone && currentMusicTrack && <MusicMiniPlayer onSwitchToMusic={() => setView('jellymusic')} />}
        {!isPhone && currentAudiobookItem && <AudiobookMiniPlayer onSwitchToAudiobooks={() => setView('audiobookshelf')} />}
        <div className="flex-1 min-h-0">
          <Suspense fallback={<div className="h-full bg-gray-900 flex items-center justify-center"><div className="w-12 h-12 border-4 border-theme-500 border-t-transparent rounded-full animate-spin" /></div>}>
            <JellyfinView
              onBackToReader={() => setView('dashboard')}
              onOpenSettings={openSettings}
              onSwitchToJellyMusic={() => setView('jellymusic')}
              onSwitchToRequester={() => setView('requester')}
              onSwitchToLiveTV={() => setView('livetv')}
              onSwitchToAudiobooks={() => setView('audiobookshelf')}
              initialPlayItem={initialPlayVideoItem}
              onInitialPlayHandled={() => setInitialPlayVideoItem(null)}
              initialOpenItem={initialOpenVideoItem}
              onInitialOpenHandled={() => setInitialOpenVideoItem(null)}
              onOpenSearch={openGlobalSearch}
              isOffline={jellyfinIsOffline}
            />
          </Suspense>
        </div>
        {globalSearchModal}
      </div>
      </AppShell>
    )
  }

  // JELLYMUSIC MODE
  if (view === 'jellymusic') {
    return (
      <AppShell tab="jellymusic" onNavigate={navigateTab}>
      <Suspense fallback={<div className="h-screen phone:h-full bg-gray-900 flex items-center justify-center"><div className="w-12 h-12 border-4 border-theme-500 border-t-transparent rounded-full animate-spin" /></div>}>
        <JellyMusicView
          onBackToReader={() => setView('dashboard')}
          onSwitchToJellyfin={() => setView('jellyfin')}
          onOpenSettings={openSettings}
          onSwitchToRequester={() => setView('requester')}
          onSwitchToLiveTV={() => setView('livetv')}
          onSwitchToAudiobooks={() => setView('audiobookshelf')}
          initialPlayTrack={initialPlayMusicTrack}
          onInitialPlayHandled={() => setInitialPlayMusicTrack(null)}
          initialOpenItem={initialOpenMusicItem}
          onInitialOpenHandled={() => setInitialOpenMusicItem(null)}
          onOpenSearch={openGlobalSearch}
          isOffline={jellyfinIsOffline}
        />
      </Suspense>
      {globalSearchModal}
      </AppShell>
    )
  }

  // AUDIOBOOKSHELF MODE
  if (view === 'audiobookshelf') {
    return (
      <AppShell tab="audiobookshelf" onNavigate={navigateTab}>
      <div className="h-screen phone:h-full flex flex-col overflow-hidden">
        {!isPhone && currentMusicTrack && <MusicMiniPlayer onSwitchToMusic={() => setView('jellymusic')} />}
        <div className="flex-1 min-h-0">
          <Suspense fallback={<div className="h-full bg-gray-900 flex items-center justify-center"><div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>}>
            <AudiobookshelfView
              onBackToReader={() => setView('dashboard')}
              onSwitchToJellyfin={() => setView('jellyfin')}
              onSwitchToJellyMusic={() => setView('jellymusic')}
              onOpenSettings={openSettings}
              onSwitchToRequester={() => setView('requester')}
              onSwitchToLiveTV={() => setView('livetv')}
              initialPlayItemId={initialPlayAbsItemId}
              onInitialPlayHandled={() => setInitialPlayAbsItemId(null)}
              onOpenSearch={openGlobalSearch}
            />
          </Suspense>
        </div>
        {globalSearchModal}
      </div>
      </AppShell>
    )
  }

  // REQUESTER MODE
  if (view === 'requester') {
    return (
      <AppShell tab="requester" onNavigate={navigateTab}>
      <div className="h-screen phone:h-full flex flex-col overflow-hidden">
        {!isPhone && currentMusicTrack && <MusicMiniPlayer onSwitchToMusic={() => setView('jellymusic')} />}
        {!isPhone && currentAudiobookItem && <AudiobookMiniPlayer onSwitchToAudiobooks={() => setView('audiobookshelf')} />}
        <div className="flex-1 min-h-0">
          <RequesterView
            onBackToReader={() => setView('dashboard')}
            onSwitchToJellyfin={() => setView('jellyfin')}
            onSwitchToJellyMusic={() => setView('jellymusic')}
            onOpenSettings={openSettings}
            onSwitchToLiveTV={() => setView('livetv')}
            onSwitchToAudiobooks={() => setView('audiobookshelf')}
            onOpenSearch={openGlobalSearch}
          />
        </div>
        {globalSearchModal}
      </div>
      </AppShell>
    )
  }

  // LIVE TV MODE
  if (view === 'livetv') {
    return (
      <AppShell tab="livetv" onNavigate={navigateTab}>
      <div className="h-screen phone:h-full flex flex-col overflow-hidden">
        {!isPhone && currentMusicTrack && <MusicMiniPlayer onSwitchToMusic={() => setView('jellymusic')} />}
        {!isPhone && currentAudiobookItem && <AudiobookMiniPlayer onSwitchToAudiobooks={() => setView('audiobookshelf')} />}
        <div className="flex-1 min-h-0">
          <Suspense fallback={<div className="h-full bg-gray-900 flex items-center justify-center"><div className="w-12 h-12 border-4 border-theme-500 border-t-transparent rounded-full animate-spin" /></div>}>
            <LiveTVView
              onBackToReader={() => setView('dashboard')}
              onSwitchToJellyfin={() => setView('jellyfin')}
              onSwitchToJellyMusic={() => setView('jellymusic')}
              onSwitchToRequester={() => setView('requester')}
              onOpenSettings={openSettings}
              onSwitchToAudiobooks={() => setView('audiobookshelf')}
              onOpenSearch={openGlobalSearch}
            />
          </Suspense>
        </div>
        {globalSearchModal}
      </div>
      </AppShell>
    )
  }

  // SETTINGS MODE (top-level, separate from Calibre)
  if (view === 'settings') {
    const handleSettingsBack = () => {
      setView(previousView as any)
    }
    // Bottom tab bar highlights the tab settings was opened from
    const settingsTab: AppTab =
      previousView === 'dashboard' || previousView === 'category' ? 'calibre' : previousView
    // Home returns to the tab settings was opened from (same target as Back).
    const handleSettingsHome = () => {
      setView(previousView as any)
    }

    return (
      <AppShell tab={settingsTab} onNavigate={navigateTab}>
      <div className="bg-gray-900 text-white h-screen phone:h-full overflow-hidden flex flex-col font-sans select-none">
        {!isPhone && currentMusicTrack && <MusicMiniPlayer onSwitchToMusic={() => setView('jellymusic')} />}
        {!isPhone && currentAudiobookItem && <AudiobookMiniPlayer onSwitchToAudiobooks={() => setView('audiobookshelf')} />}
        {/* Settings Navigation Bar */}
        <div className="flex-shrink-0 h-14 phone:h-auto phone:min-h-14 phone:pt-safe px-4 flex items-center justify-between bg-black/30 backdrop-blur-md border-b border-white/5">
          <div className="flex items-center gap-3">
            <button
              onClick={handleSettingsBack}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white"
              title="Back"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-2">
              <SettingsIcon size={16} className="text-theme-400" />
              <span className="text-sm font-medium">Settings</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <SearchButton onClick={() => setIsSearchOpen(true)} />
            <div className="h-5 w-px bg-white/10" />
            <button
              onClick={handleSettingsHome}
              className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/60"
              title="Go to start page"
            >
              <Home size={20} />
            </button>
          </div>
        </div>

        {/* Settings Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <SettingsContent onNavigate={(v) => setView(v as any)} />
        </div>

        {/* Global Search Modal */}
        {globalSearchModal}
      </div>
      </AppShell>
    )
  }

  // READER MODE
  return (
    <AppShell tab="calibre" onNavigate={navigateTab}>
    <div className="bg-gray-900 text-white h-screen phone:h-full overflow-hidden flex flex-col font-sans select-none">
      {!isPhone && currentMusicTrack && <MusicMiniPlayer onSwitchToMusic={() => setView('jellymusic')} />}
      {!isPhone && currentAudiobookItem && <AudiobookMiniPlayer onSwitchToAudiobooks={() => setView('audiobookshelf')} />}

      {/* Top Navigation Bar */}
      <div className="flex-shrink-0 h-14 phone:h-auto phone:min-h-14 phone:pt-safe px-4 flex items-center justify-between bg-black/30 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3">
          <AppTabs
            active="calibre"
            onNavigate={(tab: AppTab) => setView(tab === 'calibre' ? 'dashboard' : tab)}
          />

          <div className="h-5 w-px bg-white/10 phone:hidden" />

          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-theme-400" />
            <span className="text-sm text-white/60">Calibre Library</span>
            {calibreIsOffline && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-medium">
                <WifiOff size={10} />
                OFFLINE
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Global Search */}
          <SearchButton onClick={() => setIsSearchOpen(true)} />

          <div className="h-5 w-px bg-white/10" />

          {/* Unified downloads */}
          <DownloadCenter />

          <button
            onClick={handleCalibreRefresh}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/60"
            title="Refresh"
          >
            <RefreshCw size={20} />
          </button>

          <button
            onClick={() => setView('dashboard')}
            className={`p-2 rounded-full hover:bg-white/10 transition-colors ${view === 'dashboard' ? 'text-theme-400' : 'text-white/60'}`}
            title="Home"
          >
            <Home size={20} />
          </button>

          <button
            onClick={() => navigateToCategory('/opds/readbooks')}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/60 hover:text-theme-400"
            title="Read Books"
          >
            <BookMarked size={20} />
          </button>

          <button
            onClick={openSettings}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/60"
            title="Settings"
          >
            <SettingsIcon size={20} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="relative flex-1 overflow-y-auto custom-scrollbar" ref={mainScrollRef}>
        {/* Pull-to-refresh puck (phone, dashboard only). The scroller is
            already `relative`; the gesture only runs at scrollTop 0, so the
            absolutely-positioned indicator stays pinned under the top bar. */}
        <PullToRefreshIndicator {...calibrePullState} />

        {/* DASHBOARD VIEW */}
        {view === 'dashboard' && (isAuthenticated || showOfflineDashboard) && (
          <div className="pb-20 space-y-8" ref={dashboardScrollAnchor}>
            {/* Offline banner */}
            {calibreIsOffline && (
              <div className="mx-8 phone:mx-4 mt-6 flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm">
                <WifiOff size={16} className="shrink-0" />
                <span>Server unreachable — showing downloaded content only.</span>
              </div>
            )}

            {/* Hero carousel — online only */}
            {isAuthenticated && <HeroCarousel books={heroBooks} onRead={handleRead} onDetails={openDetails} authHeaders={authHeaders} />}

            <SectionRow title="Libraries" icon={<Library size={20} className="text-theme-400" />}>
              <CategoryCard title="Downloads" icon={<Download size={18} />} onClick={() => navigateToCategory('virtual:downloads')} />
              {isAuthenticated && <>
                <CategoryCard title="All Books" icon={<Library size={18} />} onClick={navigateToAllBooks} />
                <CategoryCard title="Series" icon={<Layers size={18} />} onClick={navigateToSeriesView} />
                <CategoryCard title="Authors" icon={<User size={18} />} onClick={() => navigateToCategory('/opds/author')} />
                <CategoryCard title="Latest" icon={<Clock size={18} />} onClick={() => navigateToCategory('/opds/new')} />
                <CategoryCard title="Random" icon={<RefreshCw size={18} />} onClick={() => navigateToCategory('/opds/discover')} />
                <CategoryCard title="Unread" icon={<BookOpen size={18} />} onClick={() => navigateToCategory('/opds/unreadbooks')} />
              </>}
            </SectionRow>

            {startedBooks.length > 0 && (() => {
              // When offline: only show books that have a local file to read
              const visibleStarted = calibreIsOffline
                ? startedBooks.filter(b => b.localPath)
                : startedBooks
              return visibleStarted.length > 0 ? (
                <SectionRow title="Continue Reading" icon={<Clock size={20} className="text-theme-400" />}>
                  {visibleStarted.map(book => (
                    <BookCard
                      key={`started-${book.id}`}
                      book={book}
                      onClick={() => openDetails(book)}
                      onPlay={handleRead}
                      onToggleRead={handleToggleRead}
                      isRead={false}
                      authHeaders={authHeaders}
                    />
                  ))}
                </SectionRow>
              ) : null
            })()}

            {/* Recently Added — online only */}
            {isAuthenticated && (
              <SectionRow title="Recently Added" icon={<Cloud size={20} className="text-theme-400" />}>
                {recentBooks.map(book => (
                  <BookCard
                    key={book.id}
                    book={book}
                    onClick={() => openDetails(book)}
                    onPlay={handleRead}
                    onDownload={(e) => { e.stopPropagation(); handleDownload(book); }}
                    onToggleRead={handleToggleRead}
                    isRead={getIsRead(book)}
                    authHeaders={authHeaders}
                  />
                ))}
              </SectionRow>
            )}
          </div>
        )}

        {/* CATEGORY VIEW */}
        {view === 'category' && (
          <div className="min-h-full" ref={categoryScrollAnchor}>
            <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-md border-b border-white/5">
              <div className="px-8 phone:px-4 py-4 flex items-center gap-4">
                <button
                  onClick={handleLibraryBack}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <ArrowLeft size={24} />
                </button>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Library size={20} className="text-theme-400" />
                  {currentFeedUrl === 'virtual:all-books' && 'All Books'}
                  {currentFeedUrl === 'virtual:series' && 'Series'}
                  {currentFeedUrl?.startsWith('virtual:series-books:') && currentFeedUrl.replace('virtual:series-books:', '')}
                  {!currentFeedUrl?.startsWith('virtual:') && 'Library'}
                  {currentFeedUrl === 'virtual:all-books' && remoteBooks.length > 0 && (
                    <span className="text-sm font-normal text-white/40 ml-1">{remoteBooks.length.toLocaleString()} books</span>
                  )}
                </h2>
                {currentFeedUrl === 'virtual:all-books' && (
                  <select
                    value={allBooksSort}
                    onChange={(e) => handleAllBooksSortChange(e.target.value as 'title' | 'author' | 'added')}
                    className="ml-auto px-3 py-2 bg-white/10 border border-white/10 rounded-lg text-white text-sm
                      focus:outline-none focus:border-theme-500/50 cursor-pointer"
                  >
                    <option value="title">Title (A–Z)</option>
                    <option value="author">Author</option>
                    <option value="added">Date added</option>
                  </select>
                )}
              </div>
            </div>

            <div className="px-8 phone:px-4 py-6">
              {isLoading || (currentFeedUrl === 'virtual:all-books' && remoteBooks.length === 0 && allBooksLoading) ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-12 h-12 border-4 border-theme-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  <div ref={categoryGridRef} className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] phone:grid-cols-[repeat(auto-fill,minmax(105px,1fr))] gap-x-4 gap-y-6 phone:gap-x-3 [&>*]:scroll-mt-24">
                    {(currentFeedUrl === 'virtual:all-books' ? remoteBooks.slice(0, allBooksVisible) : remoteBooks).map(book => (
                      <BookCard
                        key={book.id}
                        book={book}
                        fluid
                        onClick={() => {
                          if (book.isFolder) {
                            const href = book.folderHref || ''
                            if (href.startsWith('virtual:series-books:')) {
                              const seriesName = href.replace('virtual:series-books:', '')
                              pushHistory(currentFeedUrl)
                              setCurrentFeedUrl(href)
                              showSeriesBooks(seriesName, apiUrl.replace(/\/$/, ''))
                            } else {
                              navigateToCategory(href.replace(apiUrl.replace(/\/$/, ''), '') || '')
                            }
                          } else {
                            openDetails(book)
                          }
                        }}
                        onPlay={handleRead}
                        onDownload={(e) => { e.stopPropagation(); handleDownload(book); }}
                        onToggleRead={handleToggleRead}
                        isRead={getIsRead(book)}
                        authHeaders={authHeaders}
                      />
                    ))}
                  </div>
                  {/* Infinite scroll sentinel — reveals more of the already
                      loaded list as the user scrolls */}
                  {currentFeedUrl === 'virtual:all-books' && allBooksVisible < remoteBooks.length && (
                    <div ref={allBooksSentinelRef} className="flex justify-center py-8">
                      <div className="w-8 h-8 border-4 border-theme-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}

                  {/* A–Z fast-scroll rail (phone; spans the full sorted list) */}
                  {currentFeedUrl === 'virtual:all-books' && allBooksSort !== 'added' && (
                    <AlphabetScrollRail
                      labels={remoteBooks.map(b => (allBooksSort === 'author' ? b.author : b.title) || '')}
                      onJump={jumpToBookIndex}
                      enabled={remoteBooks.length > 30}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* DETAILS VIEW */}
        {view === 'details' && detailBook && (
          <BookDetails
            key={detailBook.id}
            book={detailBook}
            onBack={handleBack}
            onRead={handleRead}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onMarkRead={handleMarkRead}
            isRead={getIsRead(detailBook)}
            isDownloaded={!!(downloadPath && localBooks.some(lb => lb.metadata?.id === detailBook.id || (detailBook.calibreId && lb.metadata?.calibreId === detailBook.calibreId)))}
            authHeaders={authHeaders}
            seriesBooks={seriesBooks}
            onOpenBook={openDetails}
          />
        )}


        {/* LOGIN / OFFLINE FALLBACK — only shown in dashboard view when no local content to display */}
        {!isAuthenticated && view === 'dashboard' && !showOfflineDashboard && (
          <div className="flex items-center justify-center h-full bg-gradient-to-br from-gray-900 via-theme-900/20 to-gray-900">
            <div className="text-center space-y-8 max-w-md px-8">
              {calibreIsOffline ? (
                /* Offline / server unreachable with no downloads */
                <>
                  <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                    <WifiOff size={28} className="text-amber-400" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-3xl font-bold text-white">You're Offline</h2>
                    <p className="text-white/60">No downloaded books available. Connect to the internet and download books to read them offline.</p>
                  </div>
                  <button
                    onClick={openSettings}
                    className="w-full px-6 py-3 bg-white/10 text-white rounded-lg font-semibold hover:bg-white/20 transition-colors"
                  >
                    Open Settings
                  </button>
                </>
              ) : (
                /* Online but not configured / not logged in */
                <>
                  <div className="space-y-2">
                    <h2 className="text-3xl font-bold text-white">Welcome to Reader</h2>
                    <p className="text-white/60">Please configure your server in settings to get started.</p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => openSettings()}
                      className="w-full px-6 py-3 bg-white text-gray-900 rounded-lg font-semibold hover:bg-white/90 transition-colors"
                    >
                      Open Settings
                    </button>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setView('jellyfin')}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white/20 backdrop-blur-sm text-white rounded-lg font-semibold hover:bg-white/30 transition-colors"
                      >
                        <Tv size={18} />
                        <span>Jellyfin</span>
                      </button>
                      <button
                        onClick={() => setView('jellymusic')}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white/20 backdrop-blur-sm text-white rounded-lg font-semibold hover:bg-white/30 transition-colors"
                      >
                        <Music size={18} />
                        <span>JellyMusic</span>
                      </button>
                    </div>
                    <button
                      onClick={() => setView('requester')}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/20 backdrop-blur-sm text-white rounded-lg font-semibold hover:bg-white/30 transition-colors"
                    >
                      <Send size={18} />
                      <span>Requester</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Reader Overlay (Lazy Loaded) */}
      {isReading && selectedBook && (
        <ReaderErrorBoundary onClose={() => setIsReading(false)}>
          <Suspense fallback={
            <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-theme-500 border-t-transparent rounded-full animate-spin" />
            </div>
          }>
            <Reader
              book={selectedBook}
              onClose={() => setIsReading(false)}
              onProgress={handleProgressUpdate}
              headers={getAuthHeader()}
              basicAuthHeaders={settings.credentials.username && password ? {
                Authorization: `Basic ${btoa(`${settings.credentials.username}:${password}`)}`
              } : undefined}
            />
          </Suspense>
        </ReaderErrorBoundary>
      )}

      {/* Global Search Modal */}
      {globalSearchModal}
    </div>
    </AppShell>
  )
}

function AppWithProviders() {
  return (
    <ToastProvider>
      {/* PersistentMusicPlayer must live here — outside App's view returns —
          so it never unmounts when the active view changes. The <audio> element
          must be stable across all view switches to keep music playing. */}
      <PersistentMusicPlayer />
      <PersistentAudiobookPlayer />
      {/* Keyboard shortcut overlay ("?") — lives outside App's view returns so
          it is available in every view without per-branch mounting */}
      <ShortcutOverlay />
      {/* In-app updater notice — mounted at root so it auto-checks on launch
          and shows above every view. */}
      <UpdateNotice />
      <App />
    </ToastProvider>
  )
}

export default AppWithProviders
