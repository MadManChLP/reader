import React, { memo } from 'react'
import { Home, Library, Mic, Download, Layers } from 'lucide-react'
import type { AbsLibrary } from '../../types/audiobookshelf'
import type { AbsViewType } from './AudiobookshelfView'
import { useIsPhone } from '../../hooks/useIsPhone'

interface AbsSidebarProps {
  currentView: AbsViewType
  libraries: AbsLibrary[]
  onNavigate: (view: AbsViewType) => void
}

export const AbsSidebar = memo(function AbsSidebar({ currentView, libraries, onNavigate }: AbsSidebarProps) {
  // On phones navigation lives in AbsPhoneNav (chip row)
  const isPhone = useIsPhone()
  const bookLibraries = libraries.filter((l) => l.mediaType === 'book')
  const podcastLibraries = libraries.filter((l) => l.mediaType === 'podcast')

  const itemClass = (active: boolean) =>
    `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      active ? 'bg-white/10 text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/5'
    }`

  if (isPhone) return null

  return (
    <aside className="w-56 flex-shrink-0 bg-black/40 border-r border-white/5 p-3 space-y-1 overflow-y-auto custom-scrollbar">
      <button onClick={() => onNavigate({ type: 'home' })} className={itemClass(currentView.type === 'home')}>
        <Home size={18} />
        Home
      </button>

      {bookLibraries.length > 0 && (
        <>
          <div className="pt-4 pb-1 px-3 text-xs font-semibold text-white/40 uppercase tracking-wider">Libraries</div>
          {bookLibraries.map((lib) => (
            <React.Fragment key={lib.id}>
              <button
                onClick={() => onNavigate({ type: 'library', library: lib })}
                className={itemClass(currentView.type === 'library' && currentView.library.id === lib.id)}
              >
                <Library size={18} />
                <span className="truncate">{lib.name}</span>
              </button>
              <button
                onClick={() => onNavigate({ type: 'series', library: lib })}
                className={`${itemClass(currentView.type === 'series' && currentView.library.id === lib.id)} pl-9`}
              >
                <Layers size={16} />
                <span className="truncate">Series</span>
              </button>
            </React.Fragment>
          ))}
        </>
      )}

      {podcastLibraries.length > 0 && (
        <>
          <div className="pt-4 pb-1 px-3 text-xs font-semibold text-white/40 uppercase tracking-wider">Podcasts</div>
          {podcastLibraries.map((lib) => (
            <button
              key={lib.id}
              onClick={() => onNavigate({ type: 'library', library: lib })}
              className={itemClass(currentView.type === 'library' && currentView.library.id === lib.id)}
            >
              <Mic size={18} />
              <span className="truncate">{lib.name}</span>
            </button>
          ))}
        </>
      )}

      <div className="pt-4">
        <button onClick={() => onNavigate({ type: 'downloads' })} className={itemClass(currentView.type === 'downloads')}>
          <Download size={18} />
          Downloads
        </button>
      </div>
    </aside>
  )
})
