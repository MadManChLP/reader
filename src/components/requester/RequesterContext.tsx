import React, { createContext, useContext, useEffect, useRef } from 'react'
import { useRequesterStore } from '../../stores/requesterStore'
import type { UserInfo } from '../../types/requester'

interface RequesterContextType {
  serverUrl: string
  token: string | null
  isAuthenticated: boolean
  isLoggingIn: boolean
  loginError: string | null
  userInfo: UserInfo | null
  isAdmin: boolean
  login: (username: string, password: string, serverUrlOverride?: string) => Promise<boolean>
  logout: () => void
  setServerUrl: (url: string) => void
}

const RequesterContext = createContext<RequesterContextType | null>(null)

export function RequesterProvider({ children }: { children: React.ReactNode }) {
  const store = useRequesterStore()

  // The persisted token may have expired since the last visit (server JWTs
  // live ~24h). Validate it once per mount and silently re-login if needed.
  const revalidatedRef = useRef(false)
  useEffect(() => {
    if (revalidatedRef.current) return
    revalidatedRef.current = true
    const { isAuthenticated, revalidateSession } = useRequesterStore.getState()
    if (isAuthenticated) revalidateSession()
  }, [])

  const value: RequesterContextType = {
    serverUrl: store.serverUrl,
    token: store.token,
    isAuthenticated: store.isAuthenticated,
    isLoggingIn: store.isLoggingIn,
    loginError: store.loginError,
    userInfo: store.userInfo,
    isAdmin: store.userInfo?.role === 'admin',
    login: store.login,
    logout: store.logout,
    setServerUrl: store.setServerUrl,
  }

  return (
    <RequesterContext.Provider value={value}>
      {children}
    </RequesterContext.Provider>
  )
}

export function useRequester() {
  const context = useContext(RequesterContext)
  if (!context) throw new Error('useRequester must be used within a RequesterProvider')
  return context
}
