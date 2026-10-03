import React from 'react'
import type { LucideIcon } from 'lucide-react'

interface PrimaryAction {
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  /** Fill the icon (e.g. Play triangle). Default true. */
  fillIcon?: boolean
}

interface DetailActionBarProps {
  primary: PrimaryAction
  /** Secondary icon buttons (already ~44px). Wrap onto extra rows on narrow screens. */
  secondary?: React.ReactNode
}

// Phone action bar: full-width primary button, secondary icon buttons wrap below.
// Only mounts on phone (callers gate with useIsPhone).
export const DetailActionBar: React.FC<DetailActionBarProps> = ({ primary, secondary }) => {
  const { label, icon: Icon, onClick, disabled, busy, fillIcon = true } = primary
  return (
    <div className="space-y-3">
      <button
        onClick={onClick}
        disabled={disabled || busy}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-theme-500 hover:bg-theme-400 disabled:opacity-50 rounded-full text-white font-semibold transition-colors"
      >
        {busy ? (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <Icon size={18} fill={fillIcon ? 'currentColor' : 'none'} />
        )}
        {label}
      </button>

      {secondary && <div className="flex flex-wrap gap-2 justify-center">{secondary}</div>}
    </div>
  )
}

export default DetailActionBar
