import { memo } from 'react'
import { Home, Library, Mic, Download } from 'lucide-react'
import { PhoneChipNav } from '../PhoneChipNav'
import { useIsPhone } from '../../hooks/useIsPhone'
import type { AbsLibrary } from '../../types/audiobookshelf'
import type { AbsViewType } from './AudiobookshelfView'

interface AbsPhoneNavProps {
  currentView: AbsViewType
  libraries: AbsLibrary[]
  onNavigate: (view: AbsViewType) => void
}

// Phone replacement for AbsSidebar: scrollable chip row under the top bar.
// Self-gating (renders nothing on desktop) so callers can mount it unconditionally.
// Series grids stay reachable from within each library view.
export const AbsPhoneNav = memo(function AbsPhoneNav({ currentView, libraries, onNavigate }: AbsPhoneNavProps) {
  const isPhone = useIsPhone()
  if (!isPhone) return null

  return (
    <PhoneChipNav
      items={[
        {
          id: 'home',
          label: 'Home',
          icon: <Home size={15} />,
          active: currentView.type === 'home',
          onClick: () => onNavigate({ type: 'home' }),
        },
        ...libraries.map((lib) => ({
          id: lib.id,
          label: lib.name,
          icon: lib.mediaType === 'podcast' ? <Mic size={15} /> : <Library size={15} />,
          active:
            (currentView.type === 'library' || currentView.type === 'series') &&
            currentView.library.id === lib.id,
          onClick: () => onNavigate({ type: 'library', library: lib }),
        })),
        {
          id: 'downloads',
          label: 'Downloads',
          icon: <Download size={15} />,
          active: currentView.type === 'downloads',
          onClick: () => onNavigate({ type: 'downloads' }),
        },
      ]}
    />
  )
})
