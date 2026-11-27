import React from 'react'
import { ArrowLeft } from 'lucide-react'

type CoverShape = 'poster' | 'square' | 'circle'

interface MobileDetailHeroProps {
  /** Cover aspect/shape: poster = 2:3 (books/movies), square = albums/audiobooks, circle = artists */
  coverShape: CoverShape
  /** Caller supplies the <img>/fallback node; this component owns the frame box */
  cover: React.ReactNode
  onBack: () => void
  /** Small uppercase label above the title (e.g. "Album", badges) */
  eyebrow?: React.ReactNode
  title: React.ReactNode
  /** Author / narrator / counts / series link — rendered centered under the title */
  meta?: React.ReactNode
  /** Action bar, progress, description — stacked under the meta */
  children?: React.ReactNode
}

// Frame classes per shape. Only mounts on phone (callers gate with useIsPhone),
// so plain classes are fine — no `phone:` prefixes needed inside.
const coverFrame: Record<CoverShape, string> = {
  poster: 'w-40 aspect-[2/3] rounded-xl',
  square: 'w-44 aspect-square rounded-xl',
  circle: 'w-40 aspect-square rounded-full',
}

// Native phone hero: back row in normal flow (root pt-safe clears the notch),
// centered cover, then stacked/centered title, meta and content slots.
export const MobileDetailHero: React.FC<MobileDetailHeroProps> = ({
  coverShape,
  cover,
  onBack,
  eyebrow,
  title,
  meta,
  children,
}) => {
  return (
    <div className="px-4 pt-safe pb-4 space-y-4">
      <button
        onClick={onBack}
        aria-label="Back"
        className="p-2 -ml-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      >
        <ArrowLeft size={22} />
      </button>

      <div className="flex flex-col items-center text-center space-y-3">
        <div className={`${coverFrame[coverShape]} overflow-hidden shadow-2xl bg-white/5 flex-shrink-0`}>
          {cover}
        </div>

        <div className="w-full space-y-1 min-w-0">
          {eyebrow && (
            <div className="text-xs font-semibold text-white/50 uppercase tracking-wider">{eyebrow}</div>
          )}
          <h1 className="text-2xl font-bold text-white leading-tight break-words">{title}</h1>
          {meta && <div className="text-sm text-white/60">{meta}</div>}
        </div>
      </div>

      {children && <div className="space-y-4">{children}</div>}
    </div>
  )
}

export default MobileDetailHero
