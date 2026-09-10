import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Chapter, TrickplayInfo } from './types'
import { formatTime } from './types'

interface ProgressSliderProps {
  currentTime: number
  duration: number
  bufferedPercent: number
  chapters: Chapter[]
  trickplayInfo: TrickplayInfo | null
  serverUrl: string | null
  accessToken: string | null
  itemId: string | undefined
  videoRef: React.RefObject<HTMLVideoElement | null>
}

const ProgressSlider: React.FC<ProgressSliderProps> = ({
  currentTime,
  duration,
  bufferedPercent,
  chapters,
  trickplayInfo,
  serverUrl,
  accessToken,
  itemId,
  videoRef,
}) => {
  const progressRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)

  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverPosition, setHoverPosition] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [dragPosition, setDragPosition] = useState(0)

  // Refs mirror the drag state so pointer handlers never act on stale React
  // state (a fast click-release could otherwise commit the PREVIOUS position)
  const isDraggingRef = useRef(false)
  const dragPosRef = useRef(0) // 0..1

  // After committing a seek the video takes a moment (longer while
  // transcoding) to actually jump — keep showing the target position instead
  // of snapping back to the old currentTime until playback catches up.
  const [pendingSeek, setPendingSeek] = useState<{ percent: number; time: number } | null>(null)
  useEffect(() => {
    if (pendingSeek && Math.abs(currentTime - pendingSeek.time) < 2) {
      setPendingSeek(null)
    }
  }, [currentTime, pendingSeek])

  // Trickplay sprite calculation
  const getTrickplayData = useCallback((time: number) => {
    if (!serverUrl || !accessToken || !itemId || !trickplayInfo) return null

    const hoverTimeMs = time * 1000
    const currentImageIndex = Math.floor(hoverTimeMs / trickplayInfo.interval)
    const tilesPerSheet = trickplayInfo.tileWidth * trickplayInfo.tileHeight
    const sheetIndex = Math.floor(currentImageIndex / tilesPerSheet)
    const tileIndexOnSheet = currentImageIndex % tilesPerSheet
    const xOffset = -(tileIndexOnSheet % trickplayInfo.tileWidth) * trickplayInfo.width
    const yOffset = -Math.floor(tileIndexOnSheet / trickplayInfo.tileWidth) * trickplayInfo.height
    const url = `${serverUrl}/Videos/${itemId}/Trickplay/${trickplayInfo.width}/${sheetIndex}.jpg?ApiKey=${accessToken}`

    return { url, xOffset, yOffset }
  }, [serverUrl, accessToken, itemId, trickplayInfo])

  const posFromClientX = useCallback((clientX: number): number => {
    const rect = progressRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  // Commit the drag position to the video exactly once per gesture
  const commitSeek = useCallback(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    setIsDragging(false)

    const video = videoRef.current
    if (video && duration > 0) {
      const pos = dragPosRef.current
      const seekTime = pos * duration
      video.currentTime = seekTime
      setPendingSeek({ percent: pos * 100, time: seekTime })
    }
  }, [duration, videoRef])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const progress = progressRef.current
    if (!progress || duration <= 0) return

    progress.setPointerCapture(e.pointerId)
    const pos = posFromClientX(e.clientX)

    isDraggingRef.current = true
    dragPosRef.current = pos
    setIsDragging(true)
    setDragPosition(pos * 100)
    setHoverTime(pos * duration)
    setHoverPosition(pos * 100)
  }, [duration, posFromClientX])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const progress = progressRef.current
    if (!progress || duration <= 0) return

    // Track the position synchronously (the ref is what gets committed);
    // batch only the visual state updates behind rAF
    const pos = posFromClientX(e.clientX)
    if (isDraggingRef.current) dragPosRef.current = pos

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      setHoverTime(pos * duration)
      setHoverPosition(pos * 100)
      if (isDraggingRef.current) setDragPosition(pos * 100)
    })
  }, [duration, posFromClientX])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const progress = progressRef.current
    if (!progress) return
    if (progress.hasPointerCapture(e.pointerId)) {
      progress.releasePointerCapture(e.pointerId)
    }
    commitSeek()
  }, [commitSeek])

  const handlePointerLeave = useCallback(() => {
    if (!isDraggingRef.current) setHoverTime(null)
  }, [])

  // Safety net: capture can be lost without a pointerup (e.g. window blur).
  // commitSeek's ref guard makes a double call after pointerup a no-op.
  const handleLostPointerCapture = useCallback(() => {
    commitSeek()
  }, [commitSeek])

  const handleMouseLeave = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setHoverTime(null)
  }, [])

  const progressPercent = isDragging
    ? dragPosition
    : pendingSeek
    ? pendingSeek.percent
    : (duration > 0 ? (currentTime / duration) * 100 : 0)
  const previewTime = isDragging ? (dragPosition / 100) * duration : hoverTime!

  return (
    <div className="flex flex-col gap-0">
      {/* Progress bar — the wrapper provides a generous (~24px) hit area for
          mouse/touch while the bar itself stays visually thin */}
      <div
        ref={progressRef}
        className="relative py-2.5 -my-2 cursor-pointer group touch-none"
        onMouseLeave={handleMouseLeave}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onLostPointerCapture={handleLostPointerCapture}
      >
      <div
        className="relative bg-white/[0.28] rounded-full"
        style={{
          height: isDragging ? '8px' : '4px',
          transition: isDragging ? 'none' : 'height 0.15s ease-out',
        }}
      >
        {/* Chapter markers */}
        {chapters.map((chapter, idx) => {
          const position = (chapter.StartPositionTicks / 10000000 / duration) * 100
          if (position <= 0 || position >= 100) return null
          return (
            <div
              key={idx}
              className="absolute top-0 w-0.5 h-full bg-white/60 z-10"
              style={{ left: `${position}%` }}
              title={chapter.Name || `Chapter ${idx + 1}`}
            />
          )
        })}

        {/* Buffer progress */}
        <div
          className="absolute top-0 h-full bg-white/[0.18] rounded-full pointer-events-none"
          style={{ width: `${bufferedPercent}%`, transition: 'width 300ms ease-out' }}
        />

        {/* Current progress */}
        <div
          className="absolute top-0 h-full bg-theme-500 rounded-full"
          style={{
            width: `${progressPercent}%`,
            transition: isDragging ? 'none' : 'width 100ms',
          }}
        />

        {/* Hover indicator */}
        {hoverTime !== null && !isDragging && (
          <div
            className="absolute top-0 h-full bg-white/30 rounded-full pointer-events-none"
            style={{ width: `${hoverPosition}%` }}
          />
        )}

        {/* Position dot */}
        <div
          className={`absolute rounded-full shadow-lg ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          style={{
            width: isDragging ? '16px' : '14px',
            height: isDragging ? '16px' : '14px',
            backgroundColor: 'rgb(var(--theme-500))',
            left: `${progressPercent}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            transition: isDragging ? 'none' : 'opacity 0.1s ease-in-out, width 0.1s ease-in-out, height 0.1s ease-in-out',
          }}
        />

        {/* Preview tooltip */}
        {(hoverTime !== null || isDragging) && (
          <div
            className="absolute bottom-6 transform -translate-x-1/2 pointer-events-none z-10"
            style={{
              left: `${isDragging ? dragPosition : hoverPosition}%`,
              transition: isDragging ? 'none' : undefined,
            }}
          >
            <div className="bg-gray-900/95 backdrop-blur-sm rounded-lg overflow-hidden shadow-2xl border border-white/10">
              {/* Trickplay thumbnail */}
              {trickplayInfo && (() => {
                const data = getTrickplayData(previewTime)
                if (!data) return null
                return (
                  <div
                    className="w-40 aspect-video bg-black"
                    style={{
                      backgroundImage: `url(${data.url})`,
                      backgroundPosition: `${data.xOffset}px ${data.yOffset}px`,
                      backgroundSize: `${trickplayInfo.tileWidth * trickplayInfo.width}px ${trickplayInfo.tileHeight * trickplayInfo.height}px`,
                      backgroundRepeat: 'no-repeat',
                    }}
                  />
                )
              })()}
              {/* Timestamp */}
              <div className="px-3 py-1.5 text-center">
                <span className="text-white text-sm font-semibold tabular-nums">
                  {formatTime(previewTime)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Time display row */}
      <div className="flex items-center justify-between mt-2.5">
        <span className="text-white/90 text-base font-medium tabular-nums">
          {formatTime(currentTime)}
        </span>
        <span className="text-white/90 text-base font-medium tabular-nums">
          {formatTime(duration)}
        </span>
      </div>
    </div>
  )
}

export default React.memo(ProgressSlider)
