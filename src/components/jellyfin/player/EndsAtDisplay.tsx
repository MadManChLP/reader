import React from 'react'
import { Clock } from 'lucide-react'

interface EndsAtDisplayProps {
  duration: number
  currentTime: number
}

const EndsAtDisplay: React.FC<EndsAtDisplayProps> = ({ duration, currentTime }) => {
  if (!duration || duration <= 0) return null

  const remainingSeconds = duration - currentTime
  const endDate = new Date(Date.now() + remainingSeconds * 1000)
  const endsAtTime = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex items-center gap-1.5 ml-3 px-3 py-1.5 bg-white/5 rounded-full">
      <Clock size={14} className="text-white/60" />
      <span className="text-white/80 text-xs font-medium">
        Ends at {endsAtTime}
      </span>
    </div>
  )
}

export default React.memo(EndsAtDisplay)
