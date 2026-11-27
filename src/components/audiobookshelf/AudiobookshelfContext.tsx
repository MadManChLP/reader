import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { AbsApi, AbsApiError } from '../../utils/absApi'
import { startOidcLogin, clearAbsSession, normalizeAbsUrl } from '../../utils/absAuth'
import { cancelAllAbsDownloads } from '../../utils/absDownloadManager'
import { useAudiobookPlayer } from '../../stores/audiobookPlayerStore'
import type { AbsUser } from '../../types/audiobookshelf'

// Auth/session context for the Audiobookshelf client, mirroring JellyfinContext.
// Login is OIDC-only (see absAuth.ts) — there is no username/password login.

interface AudiobookshelfContextType {
  /** A usable session exists (token present; may still be offline) */
  isAuthenticated: boolean
  isLoading: boolean
  /** Session restore failed with a network error — cached session kept */
  isOffline: boolean
  /** Token invalid and not refreshable — user must sign in again */
  sessionExpired: boolean
  error: string | null
  user: AbsUser | null
  serverUrl: string
  defaultLibraryId: string | null
  api: AbsApi | null
  /** Run the OIDC login window flow. Resolves true on success, false on cancel. */
  login: (serverUrl: string) => Promise<boolean>
  logout: () => Promise<void>
  /**
   * Re-read /api/me so user.mediaProgress (progress bars, finished markers,
   * "% listened") is current. Throttled unless force is set.
   */
  refreshUser: (force?: boolean) => Promise<void>
}

const AudiobookshelfContext = createContext<AudiobookshelfContextType | null>(null)

export function useAudiobookshelf(): AudiobookshelfContextType {
  const ctx = useContext(AudiobookshelfContext)
  if (!ctx) throw new Error('useAudiobookshelf must be used inside AudiobookshelfProvider')
  return ctx
}

export function AudiobookshelfProvider({ children }: { children: React.ReactNode }) {
  const [api, setApi] = useState<AbsApi | null>(null)
  const [user, setUser] = useState<AbsUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isOffline, setIsOffline] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const config = useSettingsStore((state) => state.audiobookshelf)
  const serverUrl = normalizeAbsUrl(config.url || '')

  const handleUnauthorized = useCallback(() => {
    console.warn('[Abs] Session expired — re-login required')
    setSessionExpired(true)
    setUser(null)
    setApi(null)
    clearAbsSession()
  }, [])

  const createApi = useCallback(
    (url: string, token: string) => new AbsApi(url, token, { onUnauthorized: handleUnauthorized }),
    [handleUnauthorized],
  )

  // Restore the stored session once on mount
  const restoreAttemptedRef = useRef(false)
  useEffect(() => {
    if (restoreAttemptedRef.current) return
    restoreAttemptedRef.current = true

    const stored = useSettingsStore.getState().audiobookshelf
    if (!stored.url || !stored.accessToken) {
      setIsLoading(false)
      return
    }

    const restoredApi = createApi(stored.url, stored.accessToken)
    restoredApi
      .getMe()
      .then((me) => {
        setUser(me)
        setApi(restoredApi)
        setIsOffline(false)
      })
      .catch((e) => {
        if (e instanceof AbsApiError && e.isNetworkError) {
          // Server unreachable — keep the cached session for offline use
          console.warn('[Abs] Server unreachable, continuing offline')
          setIsOffline(true)
          setApi(restoredApi)
          setUser(stored.userId ? ({ id: stored.userId, username: stored.username || '' } as AbsUser) : null)
        } else if (!(e instanceof AbsApiError && e.status === 401)) {
          // 401 is already handled by onUnauthorized (incl. refresh attempt)
          console.error('[Abs] Session restore failed:', e)
          setError(e?.message || 'Failed to connect')
        }
      })
      .finally(() => setIsLoading(false))
  }, [createApi])

  const login = useCallback(
    async (url: string): Promise<boolean> => {
      setError(null)
      setIsLoading(true)
      try {
        const result = await startOidcLogin(url)
        if (result.cancelled) return false

        // startOidcLogin persisted the session — read the stored token back
        const stored = useSettingsStore.getState().audiobookshelf
        if (!stored.accessToken) throw new Error('Login did not produce a token')

        setApi(createApi(stored.url, stored.accessToken))
        setUser(result.user ?? null)
        setSessionExpired(false)
        setIsOffline(false)
        return true
      } catch (e: any) {
        console.error('[Abs] Login failed:', e)
        setError(e?.message || 'Login failed')
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [createApi],
  )

  // user.mediaProgress was only read at login/session restore, so every
  // progress bar stayed frozen until the app restarted
  const lastRefreshRef = useRef(0)
  const refreshUser = useCallback(async (force = false) => {
    if (!api || isOffline || sessionExpired) return
    const now = Date.now()
    if (!force && now - lastRefreshRef.current < 15_000) return
    lastRefreshRef.current = now
    try {
      const me = await api.getMe()
      setUser(me)
    } catch (e) {
      if (!(e instanceof AbsApiError && (e.status === 401 || e.isNetworkError))) {
        console.warn('[Abs] Could not refresh progress:', e)
      }
    }
  }, [api, isOffline, sessionExpired])

  // Refresh when playback stops (pause, end, another book), when the app
  // comes back to the foreground, and periodically while something plays
  useEffect(() => {
    if (!api) return
    const unsub = useAudiobookPlayer.subscribe((s, prev) => {
      if (prev.isPlaying && !s.isPlaying) {
        // Give the player's final progress sync a moment to land first
        window.setTimeout(() => { void refreshUser(true) }, 1500)
      }
    })
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshUser() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => {
      if (useAudiobookPlayer.getState().isPlaying) void refreshUser()
    }, 60_000)
    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [api, refreshUser])

  const logout = useCallback(async () => {
    // Download URLs embed the session token — stop them with the session
    cancelAllAbsDownloads()
    await clearAbsSession()
    setUser(null)
    setApi(null)
    setSessionExpired(false)
    setError(null)
  }, [])

  const value: AudiobookshelfContextType = {
    isAuthenticated: !!api && !sessionExpired,
    isLoading,
    isOffline,
    sessionExpired,
    error,
    user,
    serverUrl,
    defaultLibraryId: config.defaultLibraryId ?? null,
    api,
    login,
    logout,
    refreshUser,
  }

  return <AudiobookshelfContext.Provider value={value}>{children}</AudiobookshelfContext.Provider>
}
