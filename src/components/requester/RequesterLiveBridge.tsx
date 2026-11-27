import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/shallow'
import { useRequesterStore } from '../../stores/requesterStore'
import { useRequesterLive } from '../../stores/requesterLiveStore'
import { useToast } from '../Toast'

/**
 * Mounted once at the app root (inside ToastProvider): keeps the requester
 * live connection running whenever a requester session exists — in every
 * tab, not only while the Requester is open — and turns status alerts into
 * toasts. Renders nothing.
 */
export function RequesterLiveBridge() {
  const { serverUrl, token, isAuthenticated, userInfo } = useRequesterStore(useShallow(s => ({
    serverUrl: s.serverUrl,
    token: s.token,
    isAuthenticated: s.isAuthenticated,
    userInfo: s.userInfo,
  })))
  const toast = useToast()

  useEffect(() => {
    const live = useRequesterLive.getState()
    if (isAuthenticated && serverUrl && token) {
      live.start({
        serverUrl,
        token,
        username: userInfo?.username ?? null,
        isAdmin: userInfo?.role === 'admin',
      })
    } else {
      live.stop()
    }
  }, [isAuthenticated, serverUrl, token, userInfo?.username, userInfo?.role])

  useEffect(() => () => useRequesterLive.getState().stop(), [])

  const lastAlert = useRequesterLive(s => s.lastAlert)
  const shownRef = useRef<string | null>(null)
  useEffect(() => {
    if (!lastAlert || shownRef.current === lastAlert.id) return
    shownRef.current = lastAlert.id
    const text = `${lastAlert.title}: ${lastAlert.body}`
    if (lastAlert.tone === 'success') toast.success(text)
    else if (lastAlert.tone === 'error') toast.error(text)
    else toast.info(text)
  }, [lastAlert, toast])

  return null
}
