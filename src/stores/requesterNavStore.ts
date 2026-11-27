// Requester navigation: sub-tab (section) + a stack of pages opened on top of
// it (title details, genre lists, request details, notification settings).
// A store rather than component state so other tabs (Jellyfin details, the
// Ctrl+K search) can open a Requester page: openRequesterPage() pushes the
// page and asks App to switch to the Requester view.

import { create } from 'zustand'

export type RequesterSection = 'discover' | 'search' | 'upcoming' | 'requests' | 'admin'

export type RequesterPage =
  | { type: 'title'; kind: 'anime' | 'series'; slug: string; title?: string; poster?: string | null }
  | { type: 'title'; kind: 'movie'; tmdbId: number; title?: string; poster?: string | null }
  | { type: 'genre'; id: string; label: string; kind?: 'anime' | 'series' | 'movie' }
  | { type: 'request'; id: number }
  /** Admin: pick the release of a pending book / audiobook / manga request */
  | { type: 'release'; id: number }
  | { type: 'notifications' }
  /** Search tab pre-filled (e.g. "request this" for a title without a known slug) */
  | { type: 'search'; mediaType: SearchMediaType; query: string }

export type SearchMediaType = 'anime' | 'serie' | 'movie' | 'music' | 'youtube' | 'book' | 'manga'

const SECTION_KEY = 'requesterSection'
const SECTIONS: RequesterSection[] = ['discover', 'search', 'upcoming', 'requests', 'admin']

function loadSection(): RequesterSection {
  try {
    const s = localStorage.getItem(SECTION_KEY) as RequesterSection | null
    return s && SECTIONS.includes(s) ? s : 'discover'
  } catch { return 'discover' }
}

/** Fired on window with detail = Jellyfin item stub {Id, Type, Name}: App opens it in the Jellyfin tab */
export const OPEN_JELLYFIN_ITEM_EVENT = 'app:open-jellyfin-item'

/** Fired on window: App switches to the Requester view */
export const REQUESTER_OPEN_EVENT = 'requester:open'

interface NavState {
  section: RequesterSection
  stack: RequesterPage[]
  /** Pre-fill for the Search section (consumed by SearchSection) */
  searchPrefill: { mediaType: SearchMediaType; query: string; nonce: number } | null
  setSection: (s: RequesterSection) => void
  push: (p: RequesterPage) => void
  pop: () => boolean
  reset: () => void
  consumeSearchPrefill: () => void
}

export const useRequesterNav = create<NavState>((set, get) => ({
  section: loadSection(),
  stack: [],
  searchPrefill: null,

  setSection: (section) => {
    try { localStorage.setItem(SECTION_KEY, section) } catch { /* ignore */ }
    set({ section, stack: [] })
  },

  push: (p) => {
    if (p.type === 'search') {
      try { localStorage.setItem(SECTION_KEY, 'search') } catch { /* ignore */ }
      set({ section: 'search', stack: [], searchPrefill: { mediaType: p.mediaType, query: p.query, nonce: Date.now() } })
      return
    }
    set(s => ({ stack: [...s.stack, p] }))
  },

  pop: () => {
    if (get().stack.length === 0) return false
    set(s => ({ stack: s.stack.slice(0, -1) }))
    return true
  },

  reset: () => set({ stack: [] }),
  consumeSearchPrefill: () => set({ searchPrefill: null }),
}))

/** Open a Requester page from anywhere in the app (switches to the Requester tab). */
export function openRequesterPage(page: RequesterPage) {
  const nav = useRequesterNav.getState()
  nav.reset()
  nav.push(page)
  window.dispatchEvent(new Event(REQUESTER_OPEN_EVENT))
}
