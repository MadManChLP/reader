import React from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'

interface ChapterButtonsProps {
  hasChapters: boolean
  currentChapterIndex: number
  totalChapters: number
  onPrevChapter: () => void
  onNextChapter: () => void
}

const ChapterButtons: React.FC<ChapterButtonsProps> = ({
  hasChapters,
  currentChapterIndex,
  totalChapters,
  onPrevChapter,
  onNextChapter,
}) => {
  if (!hasChapters) return null

  return (
    <>
      <button
        onClick={onPrevChapter}
        className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
        title="Previous Chapter"
        disabled={currentChapterIndex <= 0}
      >
        <ChevronsLeft size={22} className={currentChapterIndex <= 0 ? 'text-white/30' : 'text-white'} />
      </button>
      <button
        onClick={onNextChapter}
        className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
        title="Next Chapter"
        disabled={currentChapterIndex >= totalChapters - 1}
      >
        <ChevronsRight size={22} className={currentChapterIndex >= totalChapters - 1 ? 'text-white/30' : 'text-white'} />
      </button>
    </>
  )
}

export default React.memo(ChapterButtons)
