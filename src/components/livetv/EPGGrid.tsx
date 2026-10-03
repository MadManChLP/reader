import React, { useEffect, useRef, useMemo, memo } from 'react'
import { Tv2, Radio } from 'lucide-react'
import { IS_PHONE } from '../../utils/api'

// ─── Constants ────────────────────────────────────────────────────────────────
// Phone gets a denser grid (narrower channel column, fewer px per minute);
// desktop values are unchanged. IS_PHONE is static, so module-level is fine.
const CHANNEL_COL_WIDTH = IS_PHONE ? 110 : 190   // px – sticky left column
const PIXELS_PER_MINUTE = IS_PHONE ? 2.5 : 4     // px per minute  (1h = 240px desktop)
const ROW_HEIGHT = IS_PHONE ? 52 : 60            // px per channel row
const TIME_HEADER_HEIGHT = 36   // px
const TIME_SPAN_MINUTES = 6 * 60  // 6-hour window

// ─── Types ────────────────────────────────────────────────────────────────────
export interface LiveTVChannel {
  id: string
  name: string
  number: string
  channelType: 'TV' | 'Radio'
  imageUrl: string | null
}

export interface EPGProgram {
  id: string
  channelId: string
  name: string
  startDate: Date
  endDate: Date
  overview?: string
}

interface EPGGridProps {
  channels: LiveTVChannel[]
  programMap: Record<string, EPGProgram[]>
  activeChannelId: string | null
  serverUrl: string | null
  onSelectChannel: (channel: LiveTVChannel) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getTimeStart(): Date {
  // Round down to last 30-minute mark, then subtract 30min
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(Math.floor(d.getMinutes() / 30) * 30 - 30)
  return d
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ─── ProgramBar (memoised) ────────────────────────────────────────────────────
const ProgramBar = memo(function ProgramBar({
  program,
  left,
  width,
  isCurrent,
}: {
  program: EPGProgram
  left: number
  width: number
  isCurrent: boolean
}) {
  if (width < 2) return null
  return (
    <div
      className={`absolute inset-y-1 rounded overflow-hidden border border-white/5 px-2 flex flex-col justify-center transition-colors
        ${isCurrent ? 'bg-theme-700/50 border-theme-500/40' : 'bg-white/5 hover:bg-white/10'}`}
      style={{ left: left + 1, width: Math.max(2, width - 2) }}
      title={program.overview ? `${program.name}\n${program.overview}` : program.name}
    >
      {width > 50 && (
        <span className="text-xs text-white/80 truncate leading-tight font-medium">{program.name}</span>
      )}
      {width > 100 && (
        <span className="text-[10px] text-white/40 truncate leading-tight">
          {fmtTime(program.startDate)} – {fmtTime(program.endDate)}
        </span>
      )}
    </div>
  )
})

// ─── ChannelRow (memoised) ────────────────────────────────────────────────────
const ChannelRow = memo(function ChannelRow({
  channel,
  programs,
  timeStart,
  totalWidth,
  nowX,
  isActive,
  onSelect,
  serverUrl,
}: {
  channel: LiveTVChannel
  programs: EPGProgram[]
  timeStart: Date
  totalWidth: number
  nowX: number
  isActive: boolean
  onSelect: (ch: LiveTVChannel) => void
  serverUrl: string | null
}) {
  const now = new Date()

  return (
    <div className="flex border-t border-white/5" style={{ height: ROW_HEIGHT }}>
      {/* Channel info – sticky left */}
      <div
        className={`sticky left-0 z-10 flex-shrink-0 flex items-center gap-2 px-3 cursor-pointer border-r border-white/10 transition-colors
          ${isActive ? 'bg-theme-900/50' : 'bg-gray-900 hover:bg-white/5'}`}
        style={{ width: CHANNEL_COL_WIDTH }}
        onClick={() => onSelect(channel)}
      >
        {channel.imageUrl ? (
          <img
            src={channel.imageUrl}
            className="w-8 h-8 object-contain rounded flex-shrink-0"
            alt=""
            loading="lazy"
          />
        ) : (
          <div className="w-8 h-8 bg-white/10 rounded flex items-center justify-center flex-shrink-0">
            {channel.channelType === 'Radio'
              ? <Radio size={14} className="text-white/50" />
              : <Tv2 size={14} className="text-white/50" />}
          </div>
        )}
        <div className="overflow-hidden min-w-0">
          <div className="text-[10px] text-white/30 leading-none mb-0.5">{channel.number}</div>
          <div className="text-sm text-white/80 truncate leading-tight">{channel.name}</div>
          {channel.channelType === 'Radio' && (
            <div className="text-[10px] text-blue-400/70 leading-none mt-0.5">Radio</div>
          )}
        </div>
      </div>

      {/* Program area */}
      <div className="relative" style={{ width: totalWidth, height: ROW_HEIGHT }}>
        {programs.map((program) => {
          const left = Math.max(0,
            (program.startDate.getTime() - timeStart.getTime()) / 60000 * PIXELS_PER_MINUTE)
          const right = Math.min(totalWidth,
            (program.endDate.getTime() - timeStart.getTime()) / 60000 * PIXELS_PER_MINUTE)
          const isCurrent = program.startDate <= now && program.endDate >= now
          return (
            <ProgramBar
              key={program.id}
              program={program}
              left={left}
              width={right - left}
              isCurrent={isCurrent}
            />
          )
        })}

        {/* Current-time red line */}
        {nowX > 0 && nowX < totalWidth && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500/70 pointer-events-none z-10"
            style={{ left: nowX }}
          />
        )}
      </div>
    </div>
  )
})

// ─── EPGGrid ──────────────────────────────────────────────────────────────────
export function EPGGrid({
  channels,
  programMap,
  activeChannelId,
  serverUrl,
  onSelectChannel,
}: EPGGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Stable time-start reference (recalculated only on mount)
  const timeStart = useMemo(() => getTimeStart(), [])
  const totalWidth = TIME_SPAN_MINUTES * PIXELS_PER_MINUTE

  // Time labels every 30 min
  const timeLabels = useMemo(() => {
    const labels: Date[] = []
    const t = new Date(timeStart)
    // Snap to next 30-min boundary
    t.setMinutes(Math.ceil(t.getMinutes() / 30) * 30, 0, 0)
    while (t.getTime() < timeStart.getTime() + TIME_SPAN_MINUTES * 60000) {
      labels.push(new Date(t))
      t.setMinutes(t.getMinutes() + 30)
    }
    return labels
  }, [timeStart])

  const nowX = (new Date().getTime() - timeStart.getTime()) / 60000 * PIXELS_PER_MINUTE

  // Auto-scroll: put current time ~1/4 from the left on mount
  useEffect(() => {
    if (!containerRef.current) return
    const scrollTo = nowX - CHANNEL_COL_WIDTH - 60  // 60px buffer left of NOW line
    containerRef.current.scrollLeft = Math.max(0, scrollTo)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      className="overflow-auto h-full custom-scrollbar"
      style={{ scrollbarWidth: 'thin' }}
    >
      {/* Inner container – sets the total scroll width */}
      <div style={{ width: CHANNEL_COL_WIDTH + totalWidth, minWidth: '100%' }}>

        {/* Time header – sticky top */}
        <div
          className="sticky top-0 z-20 flex bg-gray-950 border-b border-white/10"
          style={{ height: TIME_HEADER_HEIGHT }}
        >
          {/* Corner cell */}
          <div
            className="sticky left-0 z-30 flex-shrink-0 flex items-center px-3 bg-gray-950 border-r border-white/10"
            style={{ width: CHANNEL_COL_WIDTH }}
          >
            <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Channel</span>
          </div>

          {/* Time axis */}
          <div className="relative" style={{ width: totalWidth, height: TIME_HEADER_HEIGHT }}>
            {timeLabels.map((t) => {
              const x = (t.getTime() - timeStart.getTime()) / 60000 * PIXELS_PER_MINUTE
              return (
                <div
                  key={t.getTime()}
                  className="absolute top-0 bottom-0 flex items-center"
                  style={{ left: x }}
                >
                  <div className="absolute top-0 bottom-0 w-px bg-white/5" />
                  <span className="text-xs text-white/40 pl-1.5 select-none">{fmtTime(t)}</span>
                </div>
              )
            })}

            {/* NOW label in header */}
            {nowX > 0 && nowX < totalWidth && (
              <div
                className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
                style={{ left: nowX }}
              >
                <div className="w-0.5 h-full bg-red-500" />
                <span
                  className="absolute top-0.5 -translate-x-1/2 text-[10px] font-bold text-red-400 bg-gray-950 px-1 rounded"
                >
                  NOW
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Channel rows */}
        {channels.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            programs={programMap[channel.id] || []}
            timeStart={timeStart}
            totalWidth={totalWidth}
            nowX={nowX}
            isActive={channel.id === activeChannelId}
            onSelect={onSelectChannel}
            serverUrl={serverUrl}
          />
        ))}

        {channels.length === 0 && (
          <div className="flex items-center justify-center py-20 text-white/30 text-sm">
            No channels available
          </div>
        )}
      </div>
    </div>
  )
}
