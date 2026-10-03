// navigationBus — tiny app-wide registries for shell navigation:
//
// 1. Tab reset: each top-level view container registers a handler for its tab
//    id. AppTabs / BottomTabBar call triggerTabReset(tabId) when the user taps
//    the ALREADY ACTIVE tab. The handler implements the smart behavior itself
//    (scroll current list to top; if already at top or in a sub-view, navigate
//    back to that tab's home view) because only the view knows its scroll
//    container and navigation stack.
//
// 2. Back handlers: a stack of "go back one step" handlers, dispatched by the
//    global Escape / mouse-back listeners in App.tsx and the phone edge-swipe
//    gesture (SwipeBackOverlay). Views push a handler on mount; overlays
//    (GlobalSearch, ShortcutOverlay) push theirs on top while open so they
//    consume back before the underlying view. A handler returns true when it
//    handled the gesture, false to let the next one try.
//
// 3. Esc blockers: overlays that implement their OWN Escape handling (video
//    player, readers, search modal, shortcut overlay) register a blocker while
//    open so the global Esc-as-back dispatcher stays silent and doesn't
//    double-fire alongside their listeners. Mouse back and edge-swipe are NOT
//    blocked — they still go through the back-handler stack (they close
//    readers/players/search before touching view history).
//
// Plain module state (no React) — exactly one view container per tab is
// mounted at a time, so a Map slot per tab and a simple stack are sufficient.

import type { AppTab } from '../components/appTabsConfig'

export type BackSource = 'esc' | 'mouse' | 'swipe'
export type BackHandler = (source: BackSource) => boolean
type TabResetHandler = () => void

const tabResetHandlers = new Map<AppTab, TabResetHandler>()
const backHandlers: BackHandler[] = []
const escBlockers = new Set<symbol>()

// ── Tab reset ────────────────────────────────────────────────────────────────

export function registerTabReset(tab: AppTab, handler: TabResetHandler): () => void {
  tabResetHandlers.set(tab, handler)
  return () => {
    // Only clear if we're still the registered handler (a newer registration
    // for the same tab must not be wiped by our stale cleanup)
    if (tabResetHandlers.get(tab) === handler) tabResetHandlers.delete(tab)
  }
}

export function triggerTabReset(tab: AppTab): void {
  tabResetHandlers.get(tab)?.()
}

// ── Back handlers (Esc / mouse back button) ──────────────────────────────────

export function registerBackHandler(handler: BackHandler): () => void {
  backHandlers.push(handler)
  return () => {
    const i = backHandlers.lastIndexOf(handler)
    if (i !== -1) backHandlers.splice(i, 1)
  }
}

/** Walk the stack newest-first until a handler consumes the gesture. */
export function dispatchBack(source: BackSource): boolean {
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    if (backHandlers[i](source)) return true
  }
  return false
}

// ── Global-Esc suppression ───────────────────────────────────────────────────

/** Suppress Esc-as-back while an Esc-handling overlay is open. Returns release fn. */
export function blockGlobalEsc(): () => void {
  const token = Symbol('esc-blocker')
  escBlockers.add(token)
  return () => {
    escBlockers.delete(token)
  }
}

export function isGlobalEscBlocked(): boolean {
  return escBlockers.size > 0
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** True when the event target is a text-entry element (Esc there should not navigate). */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * Shared smart re-tap helper: scroll the given container to top if it is
 * scrolled; otherwise run goHome (when provided and not already home).
 * Returns nothing — purely an ergonomic wrapper for tab-reset handlers.
 */
export function smartTabReset(
  scroller: HTMLElement | null,
  isAtHome: boolean,
  goHome: () => void,
): void {
  if (scroller && scroller.scrollTop > 8) {
    scroller.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  if (!isAtHome) goHome()
}
