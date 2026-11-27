// System notifications (OS toast / Android & iOS notification centre).
//
// Tauri: @tauri-apps/plugin-notification. Electron / browser: the Web
// Notification API. Permission is asked once, lazily, the first time
// something wants to notify — never at startup. Everything here is best
// effort: a missing plugin or a denied permission just means no OS alert
// (the in-app toast still shows).

import { IS_TAURI } from './api'
const isTauri = () => IS_TAURI || (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window)

type Permission = 'granted' | 'denied' | 'default'

let permission: Permission | null = null
let asking: Promise<Permission> | null = null

async function ensurePermission(): Promise<Permission> {
  if (permission === 'granted' || permission === 'denied') return permission
  if (asking) return asking
  asking = (async (): Promise<Permission> => {
    try {
      if (isTauri()) {
        const n = await import('@tauri-apps/plugin-notification')
        if (await n.isPermissionGranted()) return 'granted'
        return (await n.requestPermission()) as Permission
      }
      if (typeof Notification === 'undefined') return 'denied'
      if (Notification.permission !== 'default') return Notification.permission as Permission
      return (await Notification.requestPermission()) as Permission
    } catch {
      return 'denied'
    }
  })()
  permission = await asking
  asking = null
  return permission
}

/** Show an OS notification. Resolves false when it couldn't be shown. */
export async function systemNotify(title: string, body?: string): Promise<boolean> {
  try {
    if ((await ensurePermission()) !== 'granted') return false
    if (isTauri()) {
      const n = await import('@tauri-apps/plugin-notification')
      n.sendNotification({ title, body })
      return true
    }
    if (typeof Notification === 'undefined') return false
    new Notification(title, { body })
    return true
  } catch {
    return false
  }
}

/** Current permission without prompting (for the settings toggle). */
export async function notificationPermission(): Promise<Permission> {
  try {
    if (isTauri()) {
      const n = await import('@tauri-apps/plugin-notification')
      return (await n.isPermissionGranted()) ? 'granted' : 'default'
    }
    if (typeof Notification === 'undefined') return 'denied'
    return Notification.permission as Permission
  } catch {
    return 'denied'
  }
}

/** Ask now (from a user gesture, e.g. enabling the setting). */
export async function requestNotificationPermission(): Promise<Permission> {
  permission = null
  return ensurePermission()
}
