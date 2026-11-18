import React, { memo } from 'react'

export interface ChipNavItem {
  id: string
  label: string
  icon?: React.ReactNode
  active: boolean
  onClick: () => void
}

interface PhoneChipNavProps {
  items: ChipNavItem[]
}

// Phone-only navigation primitive: a horizontally scrollable row of pill chips.
// Replaces the fixed desktop sidebars (JellyMusic, Audiobookshelf) on phones.
// Active chip uses the current tab's theme accent classes.
export const PhoneChipNav = memo(function PhoneChipNav({ items }: PhoneChipNavProps) {
  return (
    <div className="flex-shrink-0 flex items-center gap-2 overflow-x-auto scrollbar-hide px-3 py-2 border-b border-white/5">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={item.onClick}
          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
            item.active
              ? 'bg-theme-500/15 border-theme-500/35 text-theme-300'
              : 'bg-white/10 border-transparent text-white/70 active:bg-white/20'
          }`}
        >
          {item.icon}
          <span className="whitespace-nowrap">{item.label}</span>
        </button>
      ))}
    </div>
  )
})
