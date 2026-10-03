// Remembers the top-level tab the user was last in, so reopening the app
// lands back where they left off. Replaces the old manual "default start page"
// setting. Persisted to localStorage on every tab change (survives crashes /
// hard closes — there is no reliable "on close" hook in the WebView).

export type PersistedTab =
  | 'dashboard'
  | 'jellyfin'
  | 'jellymusic'
  | 'requester'
  | 'livetv'
  | 'audiobookshelf'

const STORAGE_KEY = 'mediamaster:lastTab'

const VALID: readonly PersistedTab[] = [
  'dashboard',
  'jellyfin',
  'jellymusic',
  'requester',
  'livetv',
  'audiobookshelf',
]

/** The last real tab the user was in, or null if none has been stored yet. */
export function loadLastTab(): PersistedTab | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && (VALID as readonly string[]).includes(raw)) {
      return raw as PersistedTab
    }
  } catch {
    // localStorage unavailable — fall through to null
  }
  return null
}

/** Persist the current top-level tab. Transient views (settings/details/etc.)
 *  are normalized by the caller; anything not in VALID is ignored. */
export function saveLastTab(tab: PersistedTab): void {
  try {
    if ((VALID as readonly string[]).includes(tab)) {
      localStorage.setItem(STORAGE_KEY, tab)
    }
  } catch {
    // best-effort; ignore quota/availability errors
  }
}
