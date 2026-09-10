import { create } from 'zustand'
import { useShallow } from 'zustand/shallow'
import api from '../utils/api'
import { checkJellyfinServer } from '../utils/connectivityManager'
import {
  loadSettings as loadSettingsFromStorage,
  saveSettings as saveSettingsToStorage,
  updateJellyfinServer as updateJellyfinServerHelper,
  removeJellyfinServer as removeJellyfinServerHelper,
  generateServerId,
  type AppSettings,
  type JellyfinServer,
  type DefaultStartPage,
  type SeekDuration,
  type AudioOutputTarget,
  type AudiobookshelfConfig,
  type ThemeTab,
  type UpdateChannel,
  type SubtitleStyle,
} from '../types/settings'

// Key for the shared LDAP/AD password in the OS credential store.
// The password is NEVER written to localStorage (saveSettings strips it).
const LDAP_PASSWORD_SECRET_KEY = 'ldap-password'

interface SettingsState extends AppSettings {
  // Sync token (session state, stored separately)
  syncToken: string

  // UI state for settings panel
  isAddingServer: boolean
  newJellyfinUrl: string
  jellyfinServerStatus: Record<string, boolean>

  // Actions
  updateSettings: (updates: Partial<AppSettings>) => void
  updateCredentials: (username: string, password: string) => void
  updateCalibreWeb: (url: string) => void
  updateAudiobookshelf: (updates: Partial<AudiobookshelfConfig>) => void
  updateDownloadPath: (path: string) => void
  setDefaultStartPage: (page: DefaultStartPage) => void
  setJellyfinSeekBackSeconds: (seconds: SeekDuration) => void
  setJellyfinSeekForwardSeconds: (seconds: SeekDuration) => void
  setAudioOutputDevice: (target: AudioOutputTarget, deviceId: string | null) => void
  setJellyfinHomeCardSize: (size: number) => void
  setJellyfinLibraryCardSize: (size: number) => void
  hideJellyfinLibrary: (id: string, name: string) => void
  unhideJellyfinLibrary: (id: string) => void
  // Theme accent overrides: hex color per tab, null = reset to default
  setThemeColor: (tab: ThemeTab, hex: string | null) => void
  resetThemeColors: () => void
  // Jellyfin subtitle appearance (merges a partial into the current style)
  setSubtitleStyle: (updates: Partial<SubtitleStyle>) => void
  // In-app updater preferences
  setUpdateChannel: (channel: UpdateChannel) => void
  setAutoCheckUpdates: (value: boolean) => void

  // Jellyfin server management
  addJellyfinServer: (url: string) => Promise<boolean>
  deleteJellyfinServer: (serverId: string) => void
  setActiveJellyfinServer: (serverId: string | null) => void
  updateJellyfinServerAuth: (serverId: string, userId: string, accessToken: string) => void
  setJellyfinServerStatus: (serverId: string, status: boolean) => void
  checkAllServersStatus: (options?: { timeout?: number; retries?: number; retryDelay?: number }) => Promise<void>

  // UI actions
  setIsAddingServer: (value: boolean) => void
  setNewJellyfinUrl: (value: string) => void

  // Sync token management
  setSyncToken: (token: string) => void
  clearSyncToken: () => void

  // Load password from the OS credential store (and migrate legacy plaintext)
  initSecureCredentials: () => Promise<void>

  // Derived getters
  getActiveJellyfinServer: () => JellyfinServer | null
  getAuthHeader: () => Record<string, string>
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  // Load initial settings from localStorage
  const initialSettings = loadSettingsFromStorage()
  const initialSyncToken = localStorage.getItem('syncToken') || ''

  return {
    // Initial state from localStorage
    ...initialSettings,
    syncToken: initialSyncToken,

    // UI state
    isAddingServer: false,
    newJellyfinUrl: '',
    jellyfinServerStatus: {},

    // Core settings update
    updateSettings: (updates) => {
      set((state) => {
        const newSettings: AppSettings = {
          credentials: updates.credentials ?? state.credentials,
          calibreWeb: updates.calibreWeb ?? state.calibreWeb,
          audiobookshelf: updates.audiobookshelf ?? state.audiobookshelf,
          jellyfinServers: updates.jellyfinServers ?? state.jellyfinServers,
          activeJellyfinServerId: updates.activeJellyfinServerId !== undefined
            ? updates.activeJellyfinServerId
            : state.activeJellyfinServerId,
          downloadPath: updates.downloadPath ?? state.downloadPath,
          defaultStartPage: updates.defaultStartPage ?? state.defaultStartPage,
          jellyfinSeekBackSeconds: updates.jellyfinSeekBackSeconds ?? state.jellyfinSeekBackSeconds,
          jellyfinSeekForwardSeconds: updates.jellyfinSeekForwardSeconds ?? state.jellyfinSeekForwardSeconds,
          audioOutputDevices: updates.audioOutputDevices ?? state.audioOutputDevices,
          jellyfinHomeCardSize: updates.jellyfinHomeCardSize ?? state.jellyfinHomeCardSize,
          jellyfinLibraryCardSize: updates.jellyfinLibraryCardSize ?? state.jellyfinLibraryCardSize,
          hiddenJellyfinLibraries: updates.hiddenJellyfinLibraries ?? state.hiddenJellyfinLibraries,
          themeColors: updates.themeColors ?? state.themeColors,
          updateChannel: updates.updateChannel ?? state.updateChannel,
          autoCheckUpdates: updates.autoCheckUpdates ?? state.autoCheckUpdates,
          subtitleStyle: updates.subtitleStyle ?? state.subtitleStyle,
        }
        saveSettingsToStorage(newSettings)
        return newSettings
      })
    },

    setUpdateChannel: (channel) => {
      const state = get()
      saveSettingsToStorage({ ...state, updateChannel: channel })
      set({ updateChannel: channel })
    },

    setAutoCheckUpdates: (value) => {
      const state = get()
      saveSettingsToStorage({ ...state, autoCheckUpdates: value })
      set({ autoCheckUpdates: value })
    },

    updateCredentials: (username, password) => {
      const state = get()
      const newSettings: AppSettings = {
        ...state,
        credentials: { username, password },
      }
      // Password is stripped from localStorage by saveSettings; persist it in
      // the OS credential store instead (kept in memory in the Zustand store).
      saveSettingsToStorage(newSettings)
      set({ credentials: { username, password } })

      if (password) {
        api.secretSet(LDAP_PASSWORD_SECRET_KEY, password).then((ok) => {
          if (!ok) console.warn('[Settings] Could not save password to OS credential store — it will not persist across restarts')
        })
      } else {
        api.secretDelete(LDAP_PASSWORD_SECRET_KEY)
      }
    },

    updateCalibreWeb: (url) => {
      const state = get()
      const newSettings: AppSettings = {
        ...state,
        calibreWeb: { url },
      }
      saveSettingsToStorage(newSettings)
      set({ calibreWeb: { url } })
    },

    updateAudiobookshelf: (updates) => {
      const state = get()
      const audiobookshelf: AudiobookshelfConfig = { ...state.audiobookshelf, ...updates }
      const newSettings: AppSettings = {
        ...state,
        audiobookshelf,
      }
      saveSettingsToStorage(newSettings)
      set({ audiobookshelf })
    },

    updateDownloadPath: (path) => {
      const state = get()
      const newSettings: AppSettings = {
        ...state,
        downloadPath: path,
      }
      saveSettingsToStorage(newSettings)
      set({ downloadPath: path })
    },

    setDefaultStartPage: (page) => {
      const state = get()
      const newSettings: AppSettings = {
        ...state,
        defaultStartPage: page,
      }
      saveSettingsToStorage(newSettings)
      set({ defaultStartPage: page })
    },

    setJellyfinSeekBackSeconds: (seconds) => {
      const state = get()
      const newSettings: AppSettings = {
        ...state,
        jellyfinSeekBackSeconds: seconds,
      }
      saveSettingsToStorage(newSettings)
      set({ jellyfinSeekBackSeconds: seconds })
    },

    setJellyfinSeekForwardSeconds: (seconds) => {
      const state = get()
      const newSettings: AppSettings = {
        ...state,
        jellyfinSeekForwardSeconds: seconds,
      }
      saveSettingsToStorage(newSettings)
      set({ jellyfinSeekForwardSeconds: seconds })
    },

    setAudioOutputDevice: (target, deviceId) => {
      const state = get()
      const audioOutputDevices = { ...state.audioOutputDevices, [target]: deviceId }
      const newSettings: AppSettings = {
        ...state,
        audioOutputDevices,
      }
      saveSettingsToStorage(newSettings)
      set({ audioOutputDevices })
    },

    setJellyfinHomeCardSize: (size) => {
      const state = get()
      const newSettings: AppSettings = {
        ...state,
        jellyfinHomeCardSize: size,
      }
      saveSettingsToStorage(newSettings)
      set({ jellyfinHomeCardSize: size })
    },

    setJellyfinLibraryCardSize: (size) => {
      const state = get()
      const newSettings: AppSettings = {
        ...state,
        jellyfinLibraryCardSize: size,
      }
      saveSettingsToStorage(newSettings)
      set({ jellyfinLibraryCardSize: size })
    },

    hideJellyfinLibrary: (id, name) => {
      const state = get()
      if (state.hiddenJellyfinLibraries.some(lib => lib.id === id)) return
      const hiddenJellyfinLibraries = [...state.hiddenJellyfinLibraries, { id, name }]
      const newSettings: AppSettings = { ...state, hiddenJellyfinLibraries }
      saveSettingsToStorage(newSettings)
      set({ hiddenJellyfinLibraries })
    },

    unhideJellyfinLibrary: (id) => {
      const state = get()
      const hiddenJellyfinLibraries = state.hiddenJellyfinLibraries.filter(lib => lib.id !== id)
      const newSettings: AppSettings = { ...state, hiddenJellyfinLibraries }
      saveSettingsToStorage(newSettings)
      set({ hiddenJellyfinLibraries })
    },

    setThemeColor: (tab, hex) => {
      const state = get()
      const themeColors = { ...state.themeColors }
      if (hex) {
        themeColors[tab] = hex
      } else {
        delete themeColors[tab]
      }
      const newSettings: AppSettings = { ...state, themeColors }
      saveSettingsToStorage(newSettings)
      set({ themeColors })
    },

    setSubtitleStyle: (updates) => {
      const state = get()
      const subtitleStyle = { ...state.subtitleStyle, ...updates }
      const newSettings: AppSettings = { ...state, subtitleStyle }
      saveSettingsToStorage(newSettings)
      set({ subtitleStyle })
    },

    resetThemeColors: () => {
      const state = get()
      const newSettings: AppSettings = { ...state, themeColors: {} }
      saveSettingsToStorage(newSettings)
      set({ themeColors: {} })
    },

    // Jellyfin server management
    addJellyfinServer: async (url) => {
      let normalizedUrl = url.trim()
      if (!normalizedUrl.startsWith('http')) {
        normalizedUrl = 'https://' + normalizedUrl
      }
      normalizedUrl = normalizedUrl.replace(/\/$/, '')

      try {
        const res = await api.request({
          method: 'GET',
          url: `${normalizedUrl}/System/Info/Public`
        })
        if (res.success) {
          const data = res.data
          const newServer: JellyfinServer = {
            id: generateServerId(),
            name: data.ServerName || 'Jellyfin Server',
            url: normalizedUrl,
          }

          const currentSettings = loadSettingsFromStorage()
          let newSettings = updateJellyfinServerHelper(currentSettings, newServer)

          // Auto-select as active if first server
          if (!newSettings.activeJellyfinServerId) {
            newSettings.activeJellyfinServerId = newServer.id
          }

          saveSettingsToStorage(newSettings)
          set({
            jellyfinServers: newSettings.jellyfinServers,
            activeJellyfinServerId: newSettings.activeJellyfinServerId,
            newJellyfinUrl: '',
            isAddingServer: false,
          })
          return true
        }
      } catch (e) {
        console.error('Failed to connect to Jellyfin server:', e)
      }
      return false
    },

    deleteJellyfinServer: (serverId) => {
      const state = get()
      const newSettings = removeJellyfinServerHelper(state, serverId)
      saveSettingsToStorage(newSettings)
      set({
        jellyfinServers: newSettings.jellyfinServers,
        activeJellyfinServerId: newSettings.activeJellyfinServerId,
      })
    },

    setActiveJellyfinServer: (serverId) => {
      const state = get()
      const newSettings: AppSettings = {
        ...state,
        activeJellyfinServerId: serverId,
      }
      saveSettingsToStorage(newSettings)
      set({ activeJellyfinServerId: serverId })
    },

    updateJellyfinServerAuth: (serverId, userId, accessToken) => {
      const state = get()
      const serverIndex = state.jellyfinServers.findIndex((s) => s.id === serverId)
      if (serverIndex === -1) return

      const updatedServers = [...state.jellyfinServers]
      updatedServers[serverIndex] = {
        ...updatedServers[serverIndex],
        userId,
        accessToken,
        isConnected: true,
      }

      const newSettings: AppSettings = {
        ...state,
        jellyfinServers: updatedServers,
      }
      saveSettingsToStorage(newSettings)
      set({ jellyfinServers: updatedServers })
    },

    setJellyfinServerStatus: (serverId, status) => {
      set((state) => ({
        jellyfinServerStatus: {
          ...state.jellyfinServerStatus,
          [serverId]: status,
        },
      }))
    },

    checkAllServersStatus: async (options = {}) => {
      const state = get()
      const statuses: Record<string, boolean> = {}

      await Promise.all(
        state.jellyfinServers.map(async (server) => {
          statuses[server.id] = await checkJellyfinServer(server.url, options)
        })
      )

      set({ jellyfinServerStatus: statuses })
    },

    // UI actions
    setIsAddingServer: (value) => set({ isAddingServer: value }),
    setNewJellyfinUrl: (value) => set({ newJellyfinUrl: value }),

    // Sync token management
    setSyncToken: (token) => {
      localStorage.setItem('syncToken', token)
      set({ syncToken: token })
    },

    clearSyncToken: () => {
      localStorage.removeItem('syncToken')
      set({ syncToken: '' })
    },

    initSecureCredentials: async () => {
      const state = get()
      const plaintext = state.credentials.password

      if (plaintext) {
        // Migration: settings loaded from an old install still contain a
        // plaintext password. Move it to the OS credential store and re-save
        // the settings (saveSettings strips the password from localStorage).
        const ok = await api.secretSet(LDAP_PASSWORD_SECRET_KEY, plaintext)
        if (ok) {
          saveSettingsToStorage({ ...get() })
          console.log('[Settings] Migrated password from localStorage to OS credential store')
        }
        return
      }

      const stored = await api.secretGet(LDAP_PASSWORD_SECRET_KEY)
      if (stored) {
        set({ credentials: { ...get().credentials, password: stored } })
      }
    },

    // Derived getters
    getActiveJellyfinServer: () => {
      const state = get()
      return (
        state.jellyfinServers.find((s) => s.id === state.activeJellyfinServerId) ||
        null
      )
    },

    getAuthHeader: (): Record<string, string> => {
      const state = get()
      if (state.syncToken) {
        return { Authorization: `Bearer ${state.syncToken}` }
      }
      return {}
    },
  }
})

// Load the password from the OS credential store as soon as the store exists
// (also migrates any legacy plaintext password out of localStorage).
// Components react to the credential update — e.g. App.tsx auto-login re-runs
// when credentials.password changes.
useSettingsStore.getState().initSecureCredentials().catch((e) => {
  console.error('[Settings] Failed to initialize secure credentials:', e)
})

// Selector hooks for optimized re-renders
export const useCredentials = () =>
  useSettingsStore(useShallow((state) => state.credentials))

export const useCalibreWeb = () =>
  useSettingsStore(useShallow((state) => state.calibreWeb))

export const useAudiobookshelfConfig = () =>
  useSettingsStore(useShallow((state) => state.audiobookshelf))

export const useJellyfinServers = () =>
  useSettingsStore(useShallow((state) => state.jellyfinServers))

export const useActiveJellyfinServer = () =>
  useSettingsStore((state) => state.getActiveJellyfinServer())

export const useSyncToken = () =>
  useSettingsStore((state) => state.syncToken)

export const useDownloadPath = () =>
  useSettingsStore((state) => state.downloadPath)

export const useDefaultStartPage = () =>
  useSettingsStore((state) => state.defaultStartPage)

export const useThemeColors = () =>
  useSettingsStore(useShallow((state) => state.themeColors))

export const useJellyfinSeekDurations = () =>
  useSettingsStore(useShallow((state) => ({
    seekBackSeconds: state.jellyfinSeekBackSeconds,
    seekForwardSeconds: state.jellyfinSeekForwardSeconds,
  })))

export const useSubtitleStyle = () =>
  useSettingsStore(useShallow((state) => state.subtitleStyle))
