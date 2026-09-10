import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Play, X } from 'lucide-react'
import type { BaseItemDto } from '../JellyfinContext'

interface UpNextFlyoutProps {
  visible: boolean
  nextEpisode: BaseItemDto | null
  thumbnailUrl: string | null
  onPlayNext: () => void
  onDismiss: () => void
}

const UpNextFlyout: React.FC<UpNextFlyoutProps> = ({
  visible,
  nextEpisode,
  thumbnailUrl,
  onPlayNext,
  onDismiss,
}) => (
  <AnimatePresence>
    {visible && nextEpisode && (
      <motion.div
        className="absolute bottom-32 right-6 z-20"
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      >
        <div
          className="overflow-hidden"
          style={{
            background: 'rgba(20, 20, 20, 0.6)',
            backdropFilter: 'blur(16px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
            borderRadius: '24px',
            padding: '16px',
            width: '380px',
            maxWidth: '100%',
          }}
        >
          <div className="flex gap-4">
            {/* Thumbnail */}
            <div
              className="relative rounded-lg overflow-hidden flex-shrink-0"
              style={{ width: '140px', minWidth: '140px', aspectRatio: '16/9', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
            >
              {thumbnailUrl ? (
                <img src={thumbnailUrl} alt="next item thumbnail" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/5">
                  <Play size={24} className="text-white/30" />
                </div>
              )}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)' }}
              />
            </div>

            {/* Info */}
            <div className="flex flex-col flex-1 min-w-0 justify-center">
              <span className="text-theme-400 text-xs font-bold uppercase tracking-wider leading-none mb-1">
                UP NEXT
              </span>
              <h4 className="text-white font-semibold text-base truncate leading-tight mb-0.5">
                {nextEpisode.SeriesName || nextEpisode.Name}
              </h4>
              <p className="text-white/60 text-sm truncate">
                {nextEpisode.SeriesName
                  ? `S${nextEpisode.ParentIndexNumber}:E${nextEpisode.IndexNumber} - ${nextEpisode.Name}`
                  : nextEpisode.Overview || ''}
              </p>

              {/* Buttons */}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={onPlayNext}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-theme-500 text-white rounded-lg font-semibold hover:bg-theme-600 transition-all duration-200"
                  style={{ boxShadow: '0 4px 12px rgb(var(--theme-500) / 0.3)' }}
                >
                  <Play size={16} fill="currentColor" />
                  Play Now
                </button>
                <button
                  onClick={onDismiss}
                  className="p-2 rounded-lg transition-all duration-200 hover:bg-white/10 text-white/60 hover:text-white"
                  style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
)

export default React.memo(UpNextFlyout)
