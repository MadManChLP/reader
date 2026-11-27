import React from 'react'
import {
  CheckCircle2, XCircle, Clock, Download, AlertCircle, X, RotateCcw, CalendarClock, SearchX, CircleSlash,
  Clapperboard, Tv2, Film, Youtube, Music, BookOpen, Headphones, BookImage,
} from 'lucide-react'
import type { DownloadStatus } from '../../../types/requester'

export const STATUS_CONFIG: Record<DownloadStatus, { label: string; color: string; chip: string; icon: React.ReactNode }> = {
  pending:     { label: 'Pending',      color: 'text-yellow-400',  chip: 'bg-yellow-500/15 text-yellow-300', icon: <Clock size={14} /> },
  approved:    { label: 'Approved',     color: 'text-blue-400',    chip: 'bg-blue-500/15 text-blue-300',     icon: <CheckCircle2 size={14} /> },
  queued:      { label: 'Queued',       color: 'text-blue-400',    chip: 'bg-blue-500/15 text-blue-300',     icon: <Clock size={14} /> },
  downloading: { label: 'Downloading',  color: 'text-theme-400',   chip: 'bg-theme-500/15 text-theme-300',   icon: <Download size={14} /> },
  retrying:    { label: 'Retrying',     color: 'text-amber-400',   chip: 'bg-amber-500/15 text-amber-300',   icon: <RotateCcw size={14} /> },
  complete:    { label: 'Complete',     color: 'text-emerald-400', chip: 'bg-emerald-500/15 text-emerald-300', icon: <CheckCircle2 size={14} /> },
  partial:     { label: 'Partly done',  color: 'text-amber-400',   chip: 'bg-amber-500/15 text-amber-300',   icon: <CircleSlash size={14} /> },
  error:       { label: 'Error',        color: 'text-red-400',     chip: 'bg-red-500/15 text-red-300',       icon: <AlertCircle size={14} /> },
  rejected:    { label: 'Rejected',     color: 'text-red-400',     chip: 'bg-red-500/15 text-red-300',       icon: <XCircle size={14} /> },
  cancelled:   { label: 'Cancelled',    color: 'text-white/40',    chip: 'bg-white/10 text-white/50',        icon: <X size={14} /> },
  upcoming:    { label: 'Waiting for release', color: 'text-sky-400', chip: 'bg-sky-500/15 text-sky-300',   icon: <CalendarClock size={14} /> },
  not_found:   { label: 'Not found',    color: 'text-red-400',     chip: 'bg-red-500/15 text-red-300',       icon: <SearchX size={14} /> },
}

export function statusConfig(s: DownloadStatus | string) {
  return STATUS_CONFIG[s as DownloadStatus] ?? STATUS_CONFIG.pending
}

export const TYPE_ICON: Record<string, React.ReactNode> = {
  anime:   <Clapperboard size={14} />,
  serie:   <Tv2 size={14} />,
  movie:   <Film size={14} />,
  youtube: <Youtube size={14} />,
  music:   <Music size={14} />,
  book:      <BookOpen size={14} />,
  audiobook: <Headphones size={14} />,
  manga:     <BookImage size={14} />,
}

export const TYPE_LABEL: Record<string, string> = {
  anime: 'Anime', serie: 'Series', movie: 'Movie', youtube: 'YouTube', music: 'Music',
  book: 'eBook', audiobook: 'Audiobook', manga: 'Manga',
}

export const IN_FLIGHT: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>(['approved', 'queued', 'downloading', 'retrying'])

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return d.toLocaleDateString()
}
