import React, { useState, useEffect, memo } from 'react'
import { Keyboard, X } from 'lucide-react'
import { useIsPhone } from '../hooks/useIsPhone'
import { blockGlobalEsc, isEditableTarget } from '../utils/navigationBus'

// Keyboard shortcut reference overlay (desktop only).
// Self-contained: mounts once at app root, opens on `?` (Shift+/ or any layout
// that produces "?"), closes on Esc or click outside. While open it registers
// an Esc blocker so the global Esc-as-back dispatcher stays quiet, and its own
// Escape listener runs in the CAPTURE phase with stopPropagation so underlying
// Esc listeners (video player, search modal) don't also fire.

interface Shortcut {
  keys: string[]
  description: string
}

interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

// The app's real shortcuts, surveyed from the code:
// - App.tsx: Ctrl+K global search; navigationBus: Esc = back, mouse buttons
// - jellyfin/player/JellyfinPlayer.tsx: Space/K, arrows, M, F, I, Escape
// - livetv/LiveTVPlayer.tsx: M, F, ArrowUp/Down (channel), G (guide), Escape
// - reader/EpubReader + MangaReader: ArrowLeft/Right page turn
// - reader/PdfReader: arrows + PageUp/Down, Home/End, Ctrl+Z / Ctrl+Shift+Z
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Global search (books, movies, music, audiobooks)' },
      { keys: ['Esc'], description: 'Go back (details, categories, settings)' },
      { keys: ['Mouse 4 / 5'], description: 'Back / forward navigation buttons' },
      { keys: ['?'], description: 'Show this shortcut overlay' },
    ],
  },
  {
    title: 'Video Player',
    shortcuts: [
      { keys: ['Space', 'K'], description: 'Play / pause' },
      { keys: ['←', '→'], description: 'Seek backward / forward' },
      { keys: ['↑', '↓'], description: 'Volume up / down' },
      { keys: ['M'], description: 'Mute / unmute' },
      { keys: ['F'], description: 'Toggle fullscreen' },
      { keys: ['I'], description: 'Stats for nerds' },
      { keys: ['Esc'], description: 'Exit fullscreen / close player' },
      { keys: ['Scroll'], description: 'Volume (mouse wheel over video)' },
    ],
  },
  {
    title: 'Live TV',
    shortcuts: [
      { keys: ['↑', '↓'], description: 'Channel up / down' },
      { keys: ['G'], description: 'Toggle guide (picture-in-picture)' },
      { keys: ['M'], description: 'Mute / unmute' },
      { keys: ['F'], description: 'Toggle fullscreen' },
      { keys: ['Esc'], description: 'Stop playback' },
    ],
  },
  {
    title: 'Reader (EPUB / PDF / Manga)',
    shortcuts: [
      { keys: ['←', '→'], description: 'Previous / next page' },
      { keys: ['PgUp', 'PgDn'], description: 'Previous / next page (PDF)' },
      { keys: ['Home', 'End'], description: 'First / last page (PDF)' },
      { keys: ['Ctrl', 'Z'], description: 'Undo annotation (PDF)' },
      { keys: ['Ctrl', 'Shift', 'Z'], description: 'Redo annotation (PDF)' },
    ],
  },
]

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="px-1.5 py-0.5 min-w-[1.6rem] text-center text-xs font-medium bg-white/10 border border-white/10 rounded text-white/70">
    {children}
  </kbd>
)

export const ShortcutOverlay = memo(function ShortcutOverlay() {
  const [isOpen, setIsOpen] = useState(false)
  const isPhone = useIsPhone()

  // Open on '?' — checked via e.key so it works on any keyboard layout
  // (Shift+/ on US, Shift+ß on German, ...). Ignored inside text inputs.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      setIsOpen(open => !open)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // While open: close on Escape (capture + stopPropagation so the player /
  // search modal / reader Esc listeners underneath don't also react), and
  // suppress the global Esc-as-back dispatcher.
  useEffect(() => {
    if (!isOpen) return
    const release = blockGlobalEsc()
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      setIsOpen(false)
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      release()
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [isOpen])

  if (isPhone || !isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-8 bg-black/60 backdrop-blur-sm"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-gray-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center gap-3 px-6 py-4 border-b border-white/10">
          <div className="w-9 h-9 rounded-lg bg-theme-500/15 border border-theme-500/30 flex items-center justify-center">
            <Keyboard size={18} className="text-theme-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
            <p className="text-xs text-white/40">Press <span className="text-white/60">?</span> anytime to open this overlay</p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title="Close"
          >
            <X size={20} className="text-white/60" />
          </button>
        </div>

        {/* Groups */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 grid grid-cols-2 gap-x-8 gap-y-6">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <h3 className="text-sm font-semibold text-theme-400 mb-3">{group.title}</h3>
              {group.shortcuts.map((shortcut) => (
                <div key={`${group.title}-${shortcut.description}`} className="flex items-center justify-between gap-4 py-1">
                  <span className="text-sm text-white/70">{shortcut.description}</span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    {shortcut.keys.map((key, i) => (
                      <React.Fragment key={key}>
                        {i > 0 && <span className="text-white/30 text-xs">+</span>}
                        <Kbd>{key}</Kbd>
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-3 border-t border-white/5 text-center">
          <p className="text-xs text-white/30">
            Press <Kbd>Esc</Kbd> or click outside to close
          </p>
        </div>
      </div>
    </div>
  )
})

export default ShortcutOverlay
