import { memo } from 'react'
import { Home, Search, Disc3, User, Heart, ListMusic, Download } from 'lucide-react'
import { PhoneChipNav } from '../../PhoneChipNav'
import { useIsPhone } from '../../../hooks/useIsPhone'
import type { MusicViewType } from './JellyMusicView'

interface MusicPhoneNavProps {
  currentView: MusicViewType
  onNavigate: (view: MusicViewType) => void
}

// Phone replacement for MusicSidebar: scrollable chip row under the top bar.
// Self-gating (renders nothing on desktop) so callers can mount it unconditionally.
export const MusicPhoneNav = memo(function MusicPhoneNav({ currentView, onNavigate }: MusicPhoneNavProps) {
  const isPhone = useIsPhone()
  if (!isPhone) return null

  const is = (...types: MusicViewType['type'][]) => types.includes(currentView.type)

  return (
    <PhoneChipNav
      items={[
        { id: 'home', label: 'Home', icon: <Home size={15} />, active: is('home'), onClick: () => onNavigate({ type: 'home' }) },
        { id: 'search', label: 'Search', icon: <Search size={15} />, active: is('search'), onClick: () => onNavigate({ type: 'search' }) },
        { id: 'albums', label: 'Albums', icon: <Disc3 size={15} />, active: is('albums', 'album-details'), onClick: () => onNavigate({ type: 'albums' }) },
        { id: 'artists', label: 'Artists', icon: <User size={15} />, active: is('artists', 'artist-details'), onClick: () => onNavigate({ type: 'artists' }) },
        { id: 'liked', label: 'Liked', icon: <Heart size={15} />, active: is('liked-songs'), onClick: () => onNavigate({ type: 'liked-songs' }) },
        { id: 'playlists', label: 'Playlists', icon: <ListMusic size={15} />, active: is('playlists', 'playlist-details'), onClick: () => onNavigate({ type: 'playlists' }) },
        { id: 'downloads', label: 'Downloads', icon: <Download size={15} />, active: is('downloads'), onClick: () => onNavigate({ type: 'downloads' }) },
      ]}
    />
  )
})
