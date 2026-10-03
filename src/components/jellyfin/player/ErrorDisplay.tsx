import React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface ErrorDisplayProps {
  error: string | null
  onRetry: () => void
  onClose: () => void
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, onRetry, onClose }) => {
  if (!error) return null

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-[100] gap-4">
      <AlertTriangle size={48} className="text-red-400" />
      <h3 className="text-white text-xl font-semibold">Playback Error</h3>
      <p className="text-white/70 text-sm max-w-md text-center">{error}</p>
      <div className="flex gap-3 mt-2">
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-5 py-2.5 bg-theme-500 text-white rounded-lg font-semibold hover:bg-theme-600 transition-all duration-200"
        >
          <RotateCcw size={16} />
          Retry
        </button>
        <button
          onClick={onClose}
          className="px-5 py-2.5 rounded-lg font-semibold text-white/80 transition-all duration-200 hover:bg-white/10"
          style={{ border: '1px solid rgba(255,255,255,0.2)' }}
        >
          Exit
        </button>
      </div>
    </div>
  )
}

export default React.memo(ErrorDisplay)
