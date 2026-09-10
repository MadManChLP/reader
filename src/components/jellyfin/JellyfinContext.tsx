import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { Jellyfin } from '@jellyfin/sdk'
import { Api } from '@jellyfin/sdk/lib/api'
import {
  getSystemApi,
  getUserApi,
  getItemsApi,
  getImageApi,
  getMediaInfoApi,
  getTvShowsApi,
  getUserViewsApi
} from '@jellyfin/sdk/lib/utils/api'
import type { BaseItemDto, UserDto } from '@jellyfin/sdk/lib/generated-client'
import { loadSettings, saveSettings, updateJellyfinServer, type AppSettings, type JellyfinServer } from '../../types/settings'
import { useCredentials } from '../../stores/settingsStore'
import { syncPendingProgress, getPendingProgress } from '../../utils/jellyfinDownloadManager'

// Storage keys (kept for backward compatibility)
const STORAGE_KEYS = {
  SERVER_URL: 'jellyfin_server_url',
  SERVER_NAME: 'jellyfin_server_name',
  SERVER_ID: 'jellyfin_server_id',
  USER_ID: 'jellyfin_user_id',
  USER_NAME: 'jellyfin_user_name',
  ACCESS_TOKEN: 'jellyfin_access_token',
}

interface JellyfinContextType {
  // Connection state
  isConnected: boolean
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  // Server info
  serverUrl: string | null
  serverName: string | null
  serverId: string | null
  accessToken: string | null

  // User info
  user: UserDto | null

  // API instance
  api: Api | null
  jellyfin: Jellyfin | null

  // Shared credentials from unified settings
  sharedCredentials: { username: string; password: string } | null

  // Actions
  connectToServer: (url: string) => Promise<boolean>
  login: (username: string, password: string) => Promise<boolean>
  loginWithSharedCredentials: () => Promise<boolean>
  logout: () => void
  disconnect: () => void

  // Helper APIs
  getImageUrl: (itemId: string, type?: 'Primary' | 'Backdrop' | 'Thumb', maxWidth?: number) => string | null
}

const JellyfinContext = createContext<JellyfinContextType | null>(null)

// Initialize Jellyfin SDK
const createJellyfinClient = () => {
  return new Jellyfin({
    clientInfo: {
      name: 'Reader Jellyfin Client',
      version: '1.0.0'
    },
    deviceInfo: {
      name: 'Desktop',
      id: localStorage.getItem('jellyfin_device_id') || generateDeviceId()
    }
  })
}

function generateDeviceId(): string {
  const id = crypto.randomUUID()
  localStorage.setItem('jellyfin_device_id', id)
  return id
}

export function JellyfinProvider({ children }: { children: React.ReactNode }) {
  const [jellyfin] = useState(() => createJellyfinClient())
  const [api, setApi] = useState<Api | null>(null)
  const [user, setUser] = useState<UserDto | null>(null)
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [serverName, setServerName] = useState<string | null>(null)
  const [serverId, setServerId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isConnected = !!api
  const isAuthenticated = !!api?.accessToken && !!user
  const accessToken = api?.accessToken || null

  // Get shared credentials from the settings store — NOT from localStorage:
  // the password only lives in memory (loaded from the OS credential store).
  const storeCredentials = useCredentials()
  const getSharedCredentials = useCallback(() => {
    if (storeCredentials.username && storeCredentials.password) {
      return storeCredentials
    }
    return null
  }, [storeCredentials])

  const sharedCredentials = getSharedCredentials()

  // Restore session on mount
  useEffect(() => {
    const restoreSession = async () => {
      // First, try to get active server from unified settings
      const settings = loadSettings()
      const activeServer = settings.jellyfinServers.find(s => s.id === settings.activeJellyfinServerId)

      const storedUrl = activeServer?.url || localStorage.getItem(STORAGE_KEYS.SERVER_URL)
      const storedToken = activeServer?.accessToken || localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN)
      const storedUserId = activeServer?.userId || localStorage.getItem(STORAGE_KEYS.USER_ID)
      const storedServerName = activeServer?.name || localStorage.getItem(STORAGE_KEYS.SERVER_NAME)
      const storedServerId = activeServer?.id || localStorage.getItem(STORAGE_KEYS.SERVER_ID)

      if (storedUrl && storedToken && storedUserId) {
        try {
          const restoredApi = jellyfin.createApi(storedUrl, storedToken)
          setApi(restoredApi)
          setServerUrl(storedUrl)
          setServerName(storedServerName)
          setServerId(storedServerId)

          // Verify token is still valid
          const userApi = getUserApi(restoredApi)
          const userResponse = await userApi.getCurrentUser()
          setUser(userResponse.data)
        } catch (e: any) {
          const status = e?.response?.status
          if (status === 401 || status === 403) {
            // Token actually rejected by the server — clear the session and
            // stay connected without auth so the user can log in again
            console.error('Jellyfin session token rejected, clearing session:', e)
            clearStorage()
            if (storedUrl) {
              try {
                const newApi = jellyfin.createApi(storedUrl)
                setApi(newApi)
                setServerUrl(storedUrl)
                setServerName(storedServerName)
                setServerId(storedServerId)
              } catch {}
            }
          } else {
            // Network error / server unreachable — NOT an auth failure.
            // Keep the token-authenticated session and restore the cached user
            // so offline playback can queue progress with valid credentials.
            console.warn('Jellyfin unreachable — continuing with cached offline session')
            setUser({
              Id: storedUserId,
              Name: localStorage.getItem(STORAGE_KEYS.USER_NAME) || undefined,
            } as UserDto)
          }
        }
      } else if (storedUrl) {
        // Server configured but not authenticated - try to connect
        try {
          const newApi = jellyfin.createApi(storedUrl)
          setApi(newApi)
          setServerUrl(storedUrl)
          setServerName(storedServerName)
          setServerId(storedServerId)
        } catch (e) {
          console.error('Failed to connect to stored server:', e)
        }
      }
      setIsLoading(false)
    }

    restoreSession()
  }, [jellyfin])

  const clearStorage = () => {
    Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key))
  }

  const connectToServer = useCallback(async (url: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      // Normalize URL
      let normalizedUrl = url.trim()
      if (!normalizedUrl.startsWith('http')) {
        normalizedUrl = 'https://' + normalizedUrl
      }
      normalizedUrl = normalizedUrl.replace(/\/$/, '')

      // Create API without token
      const newApi = jellyfin.createApi(normalizedUrl)

      // Test connection by getting public system info
      const systemApi = getSystemApi(newApi)
      const infoResponse = await systemApi.getPublicSystemInfo()

      if (infoResponse.data) {
        setApi(newApi)
        setServerUrl(normalizedUrl)
        setServerName(infoResponse.data.ServerName || 'Jellyfin Server')
        setServerId(infoResponse.data.Id || null)

        localStorage.setItem(STORAGE_KEYS.SERVER_URL, normalizedUrl)
        localStorage.setItem(STORAGE_KEYS.SERVER_NAME, infoResponse.data.ServerName || '')
        localStorage.setItem(STORAGE_KEYS.SERVER_ID, infoResponse.data.Id || '')

        setIsLoading(false)
        return true
      }
    } catch (e: any) {
      console.error('Failed to connect to server:', e)
      setError(e.message || 'Failed to connect to server')
    }

    setIsLoading(false)
    return false
  }, [jellyfin])

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    if (!api) {
      setError('Not connected to server')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      const auth = await api.authenticateUserByName(username, password)

      if (auth.data.AccessToken && auth.data.User) {
        // Update API with token
        const authenticatedApi = jellyfin.createApi(serverUrl!, auth.data.AccessToken)
        setApi(authenticatedApi)
        setUser(auth.data.User)

        // Store credentials to old format (backward compatibility)
        localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, auth.data.AccessToken)
        localStorage.setItem(STORAGE_KEYS.USER_ID, auth.data.User.Id || '')
        localStorage.setItem(STORAGE_KEYS.USER_NAME, auth.data.User.Name || '')

        // Also update unified settings if this server exists there
        const settings = loadSettings()
        const serverIndex = settings.jellyfinServers.findIndex(s => s.url === serverUrl)
        if (serverIndex >= 0) {
          settings.jellyfinServers[serverIndex] = {
            ...settings.jellyfinServers[serverIndex],
            userId: auth.data.User.Id || undefined,
            accessToken: auth.data.AccessToken,
          }
          saveSettings(settings)
        }

        setIsLoading(false)
        return true
      }
    } catch (e: any) {
      console.error('Login failed:', e)
      setError(e.response?.data?.message || e.message || 'Login failed')
    }

    setIsLoading(false)
    return false
  }, [api, jellyfin, serverUrl])

  // Login using shared LDAP/AD credentials from unified settings
  const loginWithSharedCredentials = useCallback(async (): Promise<boolean> => {
    const credentials = getSharedCredentials()
    if (!credentials) {
      setError('No shared credentials configured. Please set credentials in Settings.')
      return false
    }
    return login(credentials.username, credentials.password)
  }, [getSharedCredentials, login])

  const logout = useCallback(() => {
    // Keep server connection but clear user
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN)
    localStorage.removeItem(STORAGE_KEYS.USER_ID)
    localStorage.removeItem(STORAGE_KEYS.USER_NAME)

    if (serverUrl) {
      setApi(jellyfin.createApi(serverUrl))
    }
    setUser(null)
  }, [jellyfin, serverUrl])

  const disconnect = useCallback(() => {
    clearStorage()
    setApi(null)
    setUser(null)
    setServerUrl(null)
    setServerName(null)
    setServerId(null)
    setError(null)
  }, [])

  const getImageUrl = useCallback((itemId: string, type: 'Primary' | 'Backdrop' | 'Thumb' = 'Primary', maxWidth = 400): string | null => {
    if (!api || !serverUrl) return null
    // Include ApiKey for private servers that require authentication on image requests
    const token = api.accessToken || accessToken
    const tokenParam = token ? `&ApiKey=${token}` : ''
    return `${serverUrl}/Items/${itemId}/Images/${type}?maxWidth=${maxWidth}&quality=90${tokenParam}`
  }, [api, serverUrl, accessToken])

  // Sync pending progress when coming online or on initial load
  useEffect(() => {
    const handleOnline = async () => {
      const pending = getPendingProgress()
      if (pending.length > 0) {
        console.log(`Syncing ${pending.length} pending progress updates...`)
        const result = await syncPendingProgress()
        console.log(`Progress sync complete: ${result.synced} synced, ${result.failed} failed`)
      }
    }

    // Sync on mount if online
    if (navigator.onLine && isAuthenticated) {
      handleOnline()
    }

    // Listen for online events
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [isAuthenticated])

  return (
    <JellyfinContext.Provider value={{
      isConnected,
      isAuthenticated,
      isLoading,
      error,
      serverUrl,
      serverName,
      serverId,
      accessToken,
      user,
      api,
      jellyfin,
      sharedCredentials,
      connectToServer,
      login,
      loginWithSharedCredentials,
      logout,
      disconnect,
      getImageUrl
    }}>
      {children}
    </JellyfinContext.Provider>
  )
}

export function useJellyfin() {
  const context = useContext(JellyfinContext)
  if (!context) {
    throw new Error('useJellyfin must be used within a JellyfinProvider')
  }
  return context
}

export { getItemsApi, getUserViewsApi, getTvShowsApi, getMediaInfoApi, getUserApi }
export { getArtistsApi, getUserLibraryApi, getPlaylistsApi } from '@jellyfin/sdk/lib/utils/api'
export type { BaseItemDto, UserDto }
