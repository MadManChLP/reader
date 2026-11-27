import React from 'react'
import { ChevronLeft } from 'lucide-react'
import { useRequesterNav } from '../../../stores/requesterNavStore'

/** Back button + title for pages pushed on the Requester stack. */
export function PageHeader({ title, subtitle, right }: { title?: string; subtitle?: string; right?: React.ReactNode }) {
  const pop = useRequesterNav(s => s.pop)
  return (
    <div className="px-8 phone:px-4 pt-6 phone:pt-4 pb-4 flex items-center gap-3">
      <button type="button" onClick={() => pop()} title="Back"
        className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors flex-shrink-0">
        <ChevronLeft size={22} className="text-white/70" />
      </button>
      {title && (
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl phone:text-xl font-bold truncate">{title}</h1>
          {subtitle && <p className="text-xs text-white/40">{subtitle}</p>}
        </div>
      )}
      {right}
    </div>
  )
}
