import React from 'react'
import { PictureInPicture2, PictureInPictureIcon } from 'lucide-react'

interface PictureInPictureButtonProps {
  isActive: boolean
  onToggle: () => void
}

const PictureInPictureButton: React.FC<PictureInPictureButtonProps> = ({ isActive, onToggle }) => {
  if (!document.pictureInPictureEnabled) return null

  return (
    <button
      onClick={onToggle}
      className={`p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 ${isActive ? 'bg-white/20' : ''}`}
      title={isActive ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}
    >
      {isActive ? (
        <PictureInPictureIcon size={22} className="text-white" />
      ) : (
        <PictureInPicture2 size={22} className="text-white" />
      )}
    </button>
  )
}

export default React.memo(PictureInPictureButton)
