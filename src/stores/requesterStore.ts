import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { login as apiLogin, getMe, setUnauthorizedHandler } from '../utils/requesterApi'
import { useSettingsStore } from './settingsStore'
import type { UserInfo } from '../types/requester'

interface RequesterState {
  // Connection
  serverUrl: string
  token: string | null
  isAuthenticated: boolean
  isLoggingIn: boolean
  loginError: string | null

  // User info
  userInfo: UserInfo | null

  // Actions
  setServerUrl: (url: string) => void
  login: (username: string, password: string, serverUrlOverride?: string) => Promise<boolean>
  logout: () => void
  revalidateSession: () => Promise<boolean>
}

export const useRequesterStore = create<RequesterState>()(
  persist(
    (set, get) => ({
      serverUrl: '',
      token: null,
      isAuthenticated: false,
      isLoggingIn: false,
      loginError: null,
      userInfo: null,

      setServerUrl: (url) => set({ serverUrl: url }),

      login: async (username, password, serverUrlOverride) => {
        // Use the explicit override first, then fall back to stored URL.
        // The override avoids any Zustand batching delay when setServerUrl was just called.
        const serverUrl = (serverUrlOverride ?? get().serverUrl).trim()
        if (!serverUrl || !username || !password) {
          set({ loginError: 'Server URL and credentials are required' })
          return false
        }

        set({ isLoggingIn: true, loginError: null })
        try {
          const result = await apiLogin(serverUrl, username, password)
          if (!result) {
            set({ isLoggingIn: false, loginError: 'Invalid credentials or server unreachable' })
            return false
          }
          set({
            isLoggingIn: false,
            isAuthenticated: true,
            token: result.token,
            userInfo: result.userInfo,
            loginError: null,
          })
          return true
        } catch (e) {
          set({
            isLoggingIn: false,
            loginError: e instanceof Error ? e.message : 'Connection failed',
          })
          return false
        }
      },

      logout: () => set({
        token: null,
        isAuthenticated: false,
        userInfo: null,
        loginError: null,
      }),

      // The server JWT expires (~24h) but the persisted store keeps
      // isAuthenticated=true forever, leaving the requester "connected" with a
      // dead token. Called when the requester opens and whenever a request
      // comes back 401: validate the token, silently re-login with the shared
      // LDAP credentials if it's dead, and only drop to the setup screen when
      // both fail.
      revalidateSession: async () => {
        const { serverUrl, token } = get()
        if (!serverUrl) {
          set({ isAuthenticated: false, token: null, userInfo: null })
          return false
        }

        set({ isLoggingIn: true })

        // Whatever happens below, never leave the "Connecting..." spinner up
        try {
          if (token) {
            const me = await getMe(serverUrl, token)
            if (me.userInfo) {
              set({ isAuthenticated: true, userInfo: me.userInfo, loginError: null })
              return true
            }
            if (!me.unauthorized) {
              // Server unreachable — probably offline, keep the session as-is
              return true
            }
          }

          // Token rejected or missing — silent re-login with shared credentials
          const creds = useSettingsStore.getState().credentials
          if (creds?.username && creds?.password) {
            try {
              const result = await apiLogin(serverUrl, creds.username, creds.password)
              if (result) {
                set({
                  isAuthenticated: true,
                  token: result.token,
                  userInfo: result.userInfo,
                  loginError: null,
                })
                return true
              }
            } catch { /* fall through to logout */ }
          }

          set({ isAuthenticated: false, token: null, userInfo: null })
          return false
        } finally {
          set({ isLoggingIn: false })
        }
      },
    }),
    {
      name: 'requester-storage-v2',
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        userInfo: state.userInfo,
      }),
    }
  )
)

// Any authenticated requester call that hits a 401 (token expired mid-session)
// triggers one re-login attempt; concurrent 401s share the same attempt.
let reauthInFlight: Promise<boolean> | null = null
setUnauthorizedHandler(() => {
  const state = useRequesterStore.getState()
  if (!state.isAuthenticated || reauthInFlight) return
  reauthInFlight = state.revalidateSession().finally(() => {
    reauthInFlight = null
  })
})
