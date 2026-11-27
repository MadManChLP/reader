import React, { useRef, useEffect } from 'react'
import type { Chapter } from './types'
import { formatTime } from './types'

interface ChapterListProps {
  visible: boolean
  chapters: Chapter[]
  currentChapterIndex: number
  onSelect: (chapter: Chapter) => void
  onClose: () => void
}

const ChapterList: React.FC<ChapterListProps> = ({
  visible,
  chapters,
  currentChapterIndex,
  onSelect,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [visible, onClose])

  if (!visible || chapters.length === 0) return null

  return (
    <div
      ref={ref}
      className="absolute bottom-12 right-0 w-72 bg-gray-900/95 backdrop-blur-md rounded-xl border border-white/10 shadow-2xl overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-white/10">
        <h3 className="text-white font-semibold text-sm">Chapters</h3>
      </div>
      <div className="max-h-64 overflow-y-auto custom-scrollbar p-2">
        {chapters.map((chapter, idx) => {
          const chapterTime = chapter.StartPositionTicks / 10000000
          const isCurrent = currentChapterIndex === idx
          return (
            <button
              key={idx}
              onClick={() => onSelect(chapter)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 ${
                isCurrent
                  ? 'bg-theme-500/20 text-theme-300'
                  : 'text-white/80 hover:bg-white/10'
              }`}
            >
              <span className="text-xs font-medium tabular-nums text-white/50 w-12">
                {formatTime(chapterTime)}
              </span>
              <span className="flex-1 text-sm font-medium truncate">
                {chapter.Name || `Chapter ${idx + 1}`}
              </span>
              {isCurrent && (
                <div className="w-2 h-2 bg-theme-500 rounded-full animate-pulse" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default React.memo(ChapterList)
