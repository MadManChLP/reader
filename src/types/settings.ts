// Unified Settings Types

export interface ServerCredentials {
  username: string
  password: string
}

export interface CalibreWebConfig {
  url: string
}

export interface JellyfinServer {
  id: string
  name: string
  url: string
  userId?: string
  accessToken?: string
  isConnected?: boolean
}

// Audiobookshelf server. Login is OIDC-only (Authentik) — the access token is
// obtained via the OIDC login window, never via username/password.
// The refresh token (if the server issues one) lives in the OS credential
// store under 'abs-refresh-token', never here.
export interface AudiobookshelfConfig {
  url: string
  username?: string
  userId?: string
  accessToken?: string
  // 'refreshable' = new ABS (>=2.26): short-lived token + refresh token.
  // 'legacy' = older ABS: accessToken is a long-lived JWT, no refresh.
  tokenType?: 'legacy' | 'refreshable'
  defaultLibraryId?: string
}

export type DefaultStartPage = 'calibre' | 'jellyfin' | 'jellymusic' | 'requester' | 'livetv' | 'audiobookshelf'

// Available seek duration options (in seconds)
export const SEEK_DURATION_OPTIONS = [10, 15, 30] as const
export type SeekDuration = typeof SEEK_DURATION_OPTIONS[number]

// Per-tab audio output routing (e.g. music → virtual cable 1, video → cable 2).
// null = default system output.
export type AudioOutputTarget = 'music' | 'video' | 'livetv' | 'audiobook'
export type AudioOutputDevices = Record<AudioOutputTarget, string | null>

export const DEFAULT_AUDIO_OUTPUT_DEVICES: AudioOutputDevices = {
  music: null,
  video: null,
  livetv: null,
  audiobook: null,
}

// Per-tab theme accent overrides. Key = tab, value = hex base color ("#a855f7").
// A missing key means the tab uses its built-in default accent.
export type ThemeTab = 'calibre' | 'jellyfin' | 'jellymusic' | 'requester' | 'livetv' | 'audiobookshelf'
export type ThemeColors = Partial<Record<ThemeTab, string>>

// ---- Subtitle appearance (Jellyfin video player) ----------------------------
// Applies to TEXT subtitles (SRT/VTT — rendered through libass with a style we
// build from these fields). ASS/SSA subtitles carry their own authored styling
// and are rendered as-is, so most of these only affect them via size scaling.
export type SubtitleEdgeStyle = 'none' | 'thin' | 'medium' | 'heavy' | 'shadow'
export type SubtitlePosition = 'bottom' | 'middle' | 'top'

export interface SubtitleStyle {
  // libass Fontname. The sentinel 'Default' uses the bundled fallback font
  // (Liberation Sans). Any other name is looked up by libass and falls back to
  // the bundled font if the system doesn't provide it.
  fontFamily: string
  fontScale: number          // 50..200 (%), 100 = default size
  color: string              // primary text color, hex "#ffffff"
  edgeStyle: SubtitleEdgeStyle
  outlineColor: string       // outline / shadow color, hex "#000000"
  backgroundOpacity: number  // 0..100, opaque box behind text (0 = no box)
  position: SubtitlePosition
  bold: boolean
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: 'Default',
  fontScale: 100,
  color: '#ffffff',
  edgeStyle: 'heavy',
  outlineColor: '#000000',
  backgroundOpacity: 0,
  position: 'bottom',
  bold: true,
}

export interface AppSettings {
  credentials: ServerCredentials  // Shared LDAP/AD credentials
  calibreWeb: CalibreWebConfig
  audiobookshelf: AudiobookshelfConfig
  jellyfinServers: JellyfinServer[]
  activeJellyfinServerId: string | null
  downloadPath: string
  defaultStartPage: DefaultStartPage
  // Jellyfin player seek durations
  jellyfinSeekBackSeconds: SeekDuration
  jellyfinSeekForwardSeconds: SeekDuration
  // Audio output devices, one per media tab (music/video/livetv)
  audioOutputDevices: AudioOutputDevices
  // Jellyfin card size settings (pixel width)
  jellyfinHomeCardSize: number   // Home page card width, default 160
  jellyfinLibraryCardSize: number // Library grid card width, default 150
  // Jellyfin libraries hidden from the home view (e.g. recording folders).
  // Name is stored alongside the id so settings can list them without a server round-trip.
  hiddenJellyfinLibraries: { id: string; name: string }[]
  // Per-tab accent color overrides (hex). Missing key = built-in default.
  themeColors: ThemeColors
  // In-app updater: which channel desktop pulls updates from ('stable'|'dev').
  // Desktop-driven; on mobile each app auto-detects its own channel.
  updateChannel: UpdateChannel
  // Automatically check for updates at app start (when online).
  autoCheckUpdates: boolean
  // Jellyfin video subtitle appearance (text subs; ASS carries its own style).
  subtitleStyle: SubtitleStyle
}

export type UpdateChannel = 'stable' | 'dev'

const DEFAULT_SETTINGS: AppSettings = {
  credentials: {
    username: '',
    password: '',
  },
  calibreWeb: {
    url: '',
  },
  audiobookshelf: {
    url: '',
  },
  jellyfinServers: [],
  activeJellyfinServerId: null,
  downloadPath: '',
  defaultStartPage: 'calibre',
  jellyfinSeekBackSeconds: 10,
  jellyfinSeekForwardSeconds: 30,
  audioOutputDevices: { ...DEFAULT_AUDIO_OUTPUT_DEVICES },
  jellyfinHomeCardSize: 160,
  jellyfinLibraryCardSize: 150,
  hiddenJellyfinLibraries: [],
  themeColors: {},
  updateChannel: 'stable',
  autoCheckUpdates: true,
  subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE },
}

export const loadSettings = (): AppSettings => {
  const stored = localStorage.getItem('appSettings')
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      // Remove deprecated syncMode if present
      if (parsed.calibreWeb && 'syncMode' in parsed.calibreWeb) {
        delete parsed.calibreWeb.syncMode
      }
      // Migrate: if old syncUrl exists, use it as the new unified url
      if (parsed.calibreWeb && parsed.calibreWeb.syncUrl) {
        if (!parsed.calibreWeb.url) {
          parsed.calibreWeb.url = parsed.calibreWeb.syncUrl
        }
        delete parsed.calibreWeb.syncUrl
      }
      // Migrate: single audioDeviceId → per-tab audioOutputDevices
      // (the old device carries over to all three tabs)
      if ('audioDeviceId' in parsed) {
        if (!parsed.audioOutputDevices) {
          parsed.audioOutputDevices = {
            music: parsed.audioDeviceId ?? null,
            video: parsed.audioDeviceId ?? null,
            livetv: parsed.audioDeviceId ?? null,
          }
        }
        delete parsed.audioDeviceId
      }
      // Fill in any missing targets (e.g. settings saved by an older build)
      parsed.audioOutputDevices = {
        ...DEFAULT_AUDIO_OUTPUT_DEVICES,
        ...parsed.audioOutputDevices,
      }
      // Deep-merge subtitle style so a settings blob from an older build (no
      // subtitleStyle, or only some fields) still gets every field populated.
      parsed.subtitleStyle = {
        ...DEFAULT_SUBTITLE_STYLE,
        ...(parsed.subtitleStyle || {}),
      }
      return { ...DEFAULT_SETTINGS, ...parsed }
    } catch {
      // Fall through to migration
    }
  }

  // Migration from old format
  return {
    credentials: {
      username: localStorage.getItem('calibreUsername') || '',
      password: localStorage.getItem('calibrePassword') || '',
    },
    calibreWeb: {
      url: localStorage.getItem('syncUrl') || localStorage.getItem('calibreUrl') || '',
    },
    audiobookshelf: { url: '' },
    jellyfinServers: migrateJellyfinServers(),
    activeJellyfinServerId: localStorage.getItem('jellyfin_server_id') || null,
    downloadPath: localStorage.getItem('downloadPath') || '',
    defaultStartPage: 'calibre',
    jellyfinSeekBackSeconds: 10,
    jellyfinSeekForwardSeconds: 30,
    audioOutputDevices: { ...DEFAULT_AUDIO_OUTPUT_DEVICES },
    jellyfinHomeCardSize: 160,
    jellyfinLibraryCardSize: 150,
    hiddenJellyfinLibraries: [],
    themeColors: {},
    updateChannel: 'stable',
    autoCheckUpdates: true,
    subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE },
  }
}

// Migrate existing Jellyfin settings to server list format
const migrateJellyfinServers = (): JellyfinServer[] => {
  const serverUrl = localStorage.getItem('jellyfin_server_url')
  const serverName = localStorage.getItem('jellyfin_server_name')
  const serverId = localStorage.getItem('jellyfin_server_id')
  const userId = localStorage.getItem('jellyfin_user_id')
  const accessToken = localStorage.getItem('jellyfin_access_token')

  if (serverUrl) {
    return [{
      id: serverId || crypto.randomUUID(),
      name: serverName || 'Jellyfin Server',
      url: serverUrl,
      userId: userId || undefined,
      accessToken: accessToken || undefined,
    }]
  }

  return []
}

export const saveSettings = (settings: AppSettings): void => {
  // SECURITY: the password lives in the OS credential store (see settingsStore),
  // never in localStorage. Strip it before persisting.
  const persistable: AppSettings = {
    ...settings,
    credentials: { ...settings.credentials, password: '' },
  }
  localStorage.setItem('appSettings', JSON.stringify(persistable))

  // Also save to old keys for backward compatibility during transition
  localStorage.setItem('calibreUsername', settings.credentials.username)
  localStorage.setItem('calibreUrl', settings.calibreWeb.url)
  localStorage.setItem('downloadPath', settings.downloadPath)

  // Remove deprecated keys (calibrePassword was plaintext — always purge it)
  localStorage.removeItem('calibrePassword')
  localStorage.removeItem('syncMode')

  // Update active Jellyfin server in old format for JellyfinContext compatibility
  const activeServer = settings.jellyfinServers.find(s => s.id === settings.activeJellyfinServerId)
  if (activeServer) {
    localStorage.setItem('jellyfin_server_url', activeServer.url)
    localStorage.setItem('jellyfin_server_name', activeServer.name)
    localStorage.setItem('jellyfin_server_id', activeServer.id)
    if (activeServer.userId) localStorage.setItem('jellyfin_user_id', activeServer.userId)
    if (activeServer.accessToken) localStorage.setItem('jellyfin_access_token', activeServer.accessToken)
  }
}

export const updateJellyfinServer = (settings: AppSettings, server: JellyfinServer): AppSettings => {
  const existingIndex = settings.jellyfinServers.findIndex(s => s.id === server.id)
  const newServers = [...settings.jellyfinServers]

  if (existingIndex >= 0) {
    newServers[existingIndex] = server
  } else {
    newServers.push(server)
  }

  return {
    ...settings,
    jellyfinServers: newServers,
  }
}

export const removeJellyfinServer = (settings: AppSettings, serverId: string): AppSettings => {
  return {
    ...settings,
    jellyfinServers: settings.jellyfinServers.filter(s => s.id !== serverId),
    activeJellyfinServerId: settings.activeJellyfinServerId === serverId ? null : settings.activeJellyfinServerId,
  }
}

export const generateServerId = (): string => crypto.randomUUID()
