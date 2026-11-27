import React, { memo } from 'react'
import { useThemeColors } from '../stores/settingsStore'
import { getTabAccent, hexToRgb, lightenHex } from '../utils/theme'
import { APP_TABS, type AppTab } from './appTabsConfig'
import { triggerTabReset } from '../utils/navigationBus'
import { hapticLight, hapticMedium } from '../utils/haptics'
import { useRequesterLive } from '../stores/requesterLiveStore'

interface BottomTabBarProps {
  active: AppTab
  onNavigate: (tab: AppTab) => void
}

// Phone-only app switcher: an iOS-style bottom tab bar. Rendered by AppShell
// (App.tsx) on phone-class devices; AppTabs (the desktop pill row) returns null
// there so navigation lives in exactly one place per device class.
export const BottomTabBar = memo(function BottomTabBar({ active, onNavigate }: BottomTabBarProps) {
  const themeColors = useThemeColors()
  const requesterUnseen = useRequesterLive(s => s.unseen)

  return (
    <div className="flex-shrink-0 flex border-t border-white/10 bg-black/85 backdrop-blur-md pb-safe">
      {APP_TABS.map((tab) => {
        const isActive = tab.id === active
        const hex = getTabAccent(tab.id, themeColors)
        let activeStyle: React.CSSProperties | undefined
        if (isActive) {
          const { r, g, b } = hexToRgb(hex)
          activeStyle = { color: lightenHex(hex, 0.2), backgroundColor: `rgba(${r}, ${g}, ${b}, 0.1)` }
        }
        return (
          <button
            key={tab.id}
            // Smart re-tap: tapping the active tab scrolls its list to top,
            // or (when already at top / in a sub-view) returns to its home view
            onClick={() => {
              if (isActive) {
                hapticLight()
                triggerTabReset(tab.id)
              } else {
                hapticMedium()
                onNavigate(tab.id)
              }
            }}
            style={activeStyle}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 min-w-0 transition-colors ${
              isActive ? '' : 'text-white/50 active:text-white'
            }`}
          >
            {tab.Icon ? (
              <tab.Icon size={22} />
            ) : (
              <span className="w-[22px] h-[22px] flex items-center justify-center">
                <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ backgroundColor: hex }} />
              </span>
            )}
            <span className="text-[10px] font-medium leading-tight truncate max-w-full px-0.5">{tab.label}</span>
            {tab.id === 'requester' && requesterUnseen > 0 && (
              <span className="absolute top-1 left-1/2 ml-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[10px] leading-4 text-white text-center font-semibold">
                {requesterUnseen > 9 ? '9+' : requesterUnseen}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
})
