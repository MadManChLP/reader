import React, { memo } from 'react'
import { ImageOff, CheckCircle2, Clock, Download, AlertCircle, XCircle, CalendarClock, Library } from 'lucide-react'
import AuthenticatedImage from '../../AuthenticatedImage'
import type { TitleStatus } from '../../../types/requesterDiscover'

export const TITLE_STATUS: Record<NonNullable<TitleStatus>, { label: string; className: string; Icon: React.ComponentType<{ size?: number }> }> = {
  available:  { label: 'In library',  className: 'bg-emerald-500/90 text-white', Icon: Library },
  downloaded: { label: 'Downloaded',  className: 'bg-emerald-600/90 text-white', Icon: CheckCircle2 },
  processing: { label: 'Downloading', className: 'bg-theme-500/90 text-white',   Icon: Download },
  pending:    { label: 'Requested',   className: 'bg-amber-500/90 text-black',   Icon: Clock },
  upcoming:   { label: 'Upcoming',    className: 'bg-sky-500/90 text-white',     Icon: CalendarClock },
  failed:     { label: 'Failed',      className: 'bg-red-500/90 text-white',     Icon: AlertCircle },
  rejected:   { label: 'Rejected',    className: 'bg-red-700/90 text-white',     Icon: XCircle },
}

export function StatusBadge({ status, className = '' }: { status: TitleStatus | undefined; className?: string }) {
  if (!status) return null
  const cfg = TITLE_STATUS[status]
  if (!cfg) return null
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold shadow ${cfg.className} ${className}`}>
      <cfg.Icon size={10} />
      {cfg.label}
    </span>
  )
}

interface PosterCardProps {
  title: string
  subtitle?: string | null
  posterUrl?: string | null
  /** Server-proxied images need the Bearer header */
  authHeaders?: Record<string, string>
  status?: TitleStatus
  onClick?: () => void
  /** Fixed width inside horizontal rows; grids pass className="w-full" */
  className?: string
}

export const PosterCard = memo(function PosterCard({
  title, subtitle, posterUrl, authHeaders, status, onClick, className = 'w-36 phone:w-28 flex-shrink-0',
}: PosterCardProps) {
  return (
    <button type="button" onClick={onClick} data-press=""
      className={`group text-left snap-start ${className}`}>
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 shadow-lg ring-1 ring-white/5 group-hover:ring-theme-500/40 transition-all">
        {posterUrl ? (
          authHeaders ? (
            <AuthenticatedImage src={posterUrl} authHeaders={authHeaders} alt={title}
              className="w-full h-full object-cover" />
          ) : (
            <img src={posterUrl} alt={title} loading="lazy" decoding="async"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageOff size={22} className="text-white/20" />
          </div>
        )}
        <StatusBadge status={status} className="absolute top-1.5 left-1.5" />
      </div>
      <p className="mt-2 text-sm font-medium text-white/90 line-clamp-2 leading-snug">{title}</p>
      {subtitle && <p className="text-xs text-white/40 truncate">{subtitle}</p>}
    </button>
  )
})
