import { useEffect, useRef } from 'react'
import { useToast } from '../Toast'
import { useDownloadCenter, wireDownloadCenter } from './downloadCenterStore'

/**
 * Mounted once at the app root (inside ToastProvider): turns finished
 * downloads into an in-app toast (the OS notification is sent by the store
 * when the app isn't in front). Renders nothing.
 */
export function DownloadNotifyBridge() {
  const toast = useToast()
  const last = useDownloadCenter(s => s.lastCompletion)
  const shown = useRef<number | null>(null)

  // Completion detection needs the manager listeners even before any
  // download panel was opened
  useEffect(() => { wireDownloadCenter() }, [])

  useEffect(() => {
    if (!last || shown.current === last.id) return
    shown.current = last.id
    if (last.onlyCalibre) return // Calibre shows its own toast
    toast.success(last.body ? `${last.title}: ${last.body}` : last.title)
  }, [last, toast])

  return null
}
