// In-app updater state. Holds the currently-available update (if any) and the
// check status. Auto-checks run at app start; manual checks come from the
// Advanced settings "Check for updates" button.
import { create } from 'zustand'
import { checkForUpdate, type UpdateInfo } from '../utils/updater'
import { useSettingsStore } from './settingsStore'

export type CheckResult = 'idle' | 'available' | 'uptodate' | 'error'

interface UpdaterState {
  info: UpdateInfo | null
  checking: boolean
  lastResult: CheckResult
  /** Display version the user dismissed — auto-checks won't resurface it. */
  dismissedVersion: string | null
  check: (opts?: { manual?: boolean }) => Promise<CheckResult>
  dismiss: () => void
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  info: null,
  checking: false,
  lastResult: 'idle',
  dismissedVersion: null,

  check: async ({ manual = false } = {}) => {
    if (get().checking) return get().lastResult
    // Auto-checks require connectivity; manual checks always try.
    if (!manual && typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 'idle'
    }
    set({ checking: true })
    try {
      const channel = useSettingsStore.getState().updateChannel
      const info = await checkForUpdate(channel)
      if (!info) {
        set({ info: null, checking: false, lastResult: 'uptodate' })
        return 'uptodate'
      }
      // On auto-checks, respect a prior dismissal of this exact build.
      if (!manual && get().dismissedVersion === info.displayVersion) {
        set({ checking: false, lastResult: 'available' })
        return 'available'
      }
      set({ info, checking: false, lastResult: 'available' })
      return 'available'
    } catch {
      set({ checking: false, lastResult: 'error' })
      return 'error'
    }
  },

  dismiss: () => {
    const v = get().info?.displayVersion ?? null
    set({ info: null, dismissedVersion: v })
  },
}))
