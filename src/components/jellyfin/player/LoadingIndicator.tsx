import React from 'react'
import { Loader2 } from 'lucide-react'

interface LoadingIndicatorProps {
  visible: boolean
}

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({ visible }) => {
  if (!visible) return null

  return (
    <div className="absolute inset-0 flex items-center justify-center z-[2] pointer-events-none">
      <Loader2 size={72} className="animate-spin text-white/80" strokeWidth={1.4} />
    </div>
  )
}

export default React.memo(LoadingIndicator)
