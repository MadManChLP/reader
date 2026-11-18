import React, { memo, useLayoutEffect, useRef, useState } from 'react'
import { useThemeColors } from '../stores/settingsStore'
import { getTabAccent, hexToRgb, lightenHex } from '../utils/theme'
import { useIsPhone } from '../hooks/useIsPhone'
import { APP_TABS, type AppTab } from './appTabsConfig'
import { triggerTabReset } from '../utils/navigationBus'

// Re-export so existing `import { type AppTab } from './AppTabs'` sites keep working
export type { AppTab }

interface AppTabsProps {
  active: AppTab
  onNavigate: (tab: AppTab) => void
}

type TabDef = (typeof APP_TABS)[number]

// Browser-style app tabs for the top-left of every view.
// Tab definitions live in appTabsConfig.ts (shared with the phone BottomTabBar).
// The active tab is highlighted in its app color (custom theme colors from
// settings apply here too — computed from the tab's accent hex at render time).
//
// On smaller desktop windows the labelled pills would push the right-hand top-bar
// controls (e.g. Settings) off-screen. To keep everything reachable, the strip
// measures whether the labelled tabs fit in the top-bar row and, when they don't,
// collapses to icon-only pills (the name stays available via the hover tooltip).
export const AppTabs = memo(function AppTabs({ active, onNavigate }: AppTabsProps) {
  const themeColors = useThemeColors()
  const isPhone = useIsPhone()
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  // Decide labels-vs-icons by measuring real widths, so it adapts to how busy
  // each individual top bar is rather than guessing from a viewport breakpoint.
  useLayoutEffect(() => {
    if (isPhone) return
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) return

    // The top-bar row is the space-between flex container holding both the tabs
    // and the right-hand controls. Walk up a few levels to find it; if there
    // isn't one (e.g. the setup-screen overlay usage), we simply never collapse.
    let row: HTMLElement | null = container.parentElement
    for (let i = 0; i < 5 && row; i++) {
      if (getComputedStyle(row).justifyContent === 'space-between') break
      row = row.parentElement
    }

    const recompute = () => {
      if (!row) { setCollapsed(false); return }
      // measureRef always renders the labelled pills (hidden), so its width is
      // the space the tabs need with labels regardless of the current state.
      const labeledWidth = measure.offsetWidth
      // Width of everything else in the row (dividers, titles, right controls),
      // derived by removing the currently-visible tab strip from the total.
      const otherWidth = row.scrollWidth - container.offsetWidth
      // Collapse when showing the labels would overflow the row's usable width.
      // Basing the test on labeledWidth (which never changes with state) keeps
      // this stable — expanding again can't immediately re-trigger a collapse.
      setCollapsed(otherWidth + labeledWidth > row.clientWidth)
    }

    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(measure)
    if (row) ro.observe(row)
    window.addEventListener('resize', recompute)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', recompute)
    }
  }, [isPhone, themeColors, active])

  // On phones the app switcher is the BottomTabBar (AppShell in App.tsx) —
  // the pill row would overflow the slim top bars.
  if (isPhone) return null

  const renderTab = (tab: TabDef, showLabel: boolean, interactive: boolean) => {
    const isActive = tab.id === active
    // Active pill: accent at 12% bg / 30% border, text lightened toward *-300
    let activeStyle: React.CSSProperties | undefined
    if (isActive) {
      const hex = getTabAccent(tab.id, themeColors)
      const { r, g, b } = hexToRgb(hex)
      activeStyle = {
        backgroundColor: `rgba(${r}, ${g}, ${b}, 0.14)`,
        borderColor: `rgba(${r}, ${g}, ${b}, 0.35)`,
        color: lightenHex(hex, 0.2),
      }
    }
    // The Live TV dot follows a custom accent too (defaults to red)
    const liveDotStyle = tab.id === 'livetv'
      ? { backgroundColor: getTabAccent('livetv', themeColors) }
      : undefined

    return (
      <button
        key={tab.id}
        // Smart re-tap: tapping the active tab scrolls its list to top,
        // or (when already at top / in a sub-view) returns to its home view
        onClick={interactive ? () => { isActive ? triggerTabReset(tab.id) : onNavigate(tab.id) } : undefined}
        // The hidden measuring copy is inert (not focusable, ignored by AT).
        tabIndex={interactive ? undefined : -1}
        aria-hidden={interactive ? undefined : true}
        style={activeStyle}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
          isActive
            ? ''
            : 'bg-white/10 hover:bg-white/20 border-transparent text-white/70 hover:text-white'
        }`}
        title={isActive ? 'Back to top' : `Switch to ${tab.label}`}
      >
        {tab.Icon ? (
          <tab.Icon size={16} />
        ) : (
          <span className="w-2 h-2 rounded-full animate-pulse" style={liveDotStyle} />
        )}
        {showLabel && <span>{tab.label}</span>}
      </button>
    )
  }

  return (
    <div className="relative">
      {/* Visible strip: icons only when the labels wouldn't fit the top bar. */}
      <div ref={containerRef} className="flex items-center gap-2">
        {APP_TABS.map((tab) => renderTab(tab, !collapsed, true))}
      </div>
      {/* Hidden labelled copy, out of layout and the a11y/focus tree, used only
          to measure the full labelled width for the fit calculation above. */}
      <div
        ref={measureRef}
        aria-hidden
        className="flex items-center gap-2 absolute top-0 left-0 invisible pointer-events-none"
      >
        {APP_TABS.map((tab) => renderTab(tab, true, false))}
      </div>
    </div>
  )
})
