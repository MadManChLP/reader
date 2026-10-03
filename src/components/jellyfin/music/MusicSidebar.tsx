import React, { memo } from 'react'
import {
  Home, Search, Library, Disc3, User, ListMusic,
  Download, Music, Heart
} from 'lucide-react'
import type { BaseItemDto } from '../JellyfinContext'
import type { MusicViewType } from './JellyMusicView'
import { useIsPhone } from '../../../hooks/useIsPhone'
import { PlaylistCover } from './PlaylistCover'

interface MusicSidebarProps {
  currentView: MusicViewType
  onNavigate: (view: MusicViewType) => void
  onBack: () => void
  playlists?: BaseItemDto[]
}

interface NavItemProps {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}

const NavItem = memo(function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
        active
          ? 'bg-white/10 text-white'
          : 'text-white/70 hover:text-white hover:bg-white/5'
      }`}
    >
      {icon}
      <span className="text-sm font-medium truncate">{label}</span>
    </button>
  )
})

interface PlaylistItemProps {
  playlist: BaseItemDto
  active: boolean
  onClick: () => void
  serverUrl?: string | null
}

const PlaylistItem = memo(function PlaylistItem({ playlist, active, onClick, serverUrl }: PlaylistItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
        active
          ? 'bg-white/10 text-white'
          : 'text-white/70 hover:text-white hover:bg-white/5'
      }`}
    >
      <PlaylistCover
        playlist={playlist}
        serverUrl={serverUrl}
        maxWidth={80}
        className="w-8 h-8 rounded flex-shrink-0"
        iconSize={14}
      />
      <span className="text-sm truncate">{playlist.Name}</span>
    </button>
  )
})

export const MusicSidebar = memo(function MusicSidebar({
  currentView,
  onNavigate,
  onBack,
  playlists = []
}: MusicSidebarProps) {
  // On phones navigation lives in MusicPhoneNav (chip row) — the fixed 224px
  // rail would eat most of the screen width.
  const isPhone = useIsPhone()

  const isActive = (type: MusicViewType['type']) => currentView.type === type
  const isPlaylistActive = (playlistId: string) =>
    currentView.type === 'playlist-details' && currentView.playlist.Id === playlistId

  // We need serverUrl for playlist images - get it from window or pass it down
  // For now, we'll use a simple check
  const serverUrl = typeof window !== 'undefined'
    ? localStorage.getItem('jellyfin_server_url')
    : null

  if (isPhone) return null

  return (
    <aside className="w-56 flex-shrink-0 bg-black/40 border-r border-white/5 flex flex-col">
      {/* Logo/Brand */}
      <div className="p-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-theme-500 to-pink-500 flex items-center justify-center">
            <Music size={18} className="text-white" />
          </div>
          <span className="font-semibold text-white">JellyMusic</span>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="p-2 space-y-1">
        <NavItem
          icon={<Home size={20} />}
          label="Home"
          active={isActive('home')}
          onClick={() => onNavigate({ type: 'home' })}
        />
        <NavItem
          icon={<Search size={20} />}
          label="Search"
          active={isActive('search')}
          onClick={() => onNavigate({ type: 'search' })}
        />
      </nav>

      {/* Library Section */}
      <div className="px-2 pt-3">
        <div className="flex items-center gap-2 px-3 mb-2">
          <Library size={16} className="text-white/40" />
          <span className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
            Your Library
          </span>
        </div>

        <nav className="space-y-0.5">
          <NavItem
            icon={<Disc3 size={18} />}
            label="Albums"
            active={isActive('albums') || isActive('album-details')}
            onClick={() => onNavigate({ type: 'albums' })}
          />
          <NavItem
            icon={<User size={18} />}
            label="Artists"
            active={isActive('artists') || isActive('artist-details')}
            onClick={() => onNavigate({ type: 'artists' })}
          />
          <NavItem
            icon={<Heart size={18} />}
            label="Liked Songs"
            active={isActive('liked-songs')}
            onClick={() => onNavigate({ type: 'liked-songs' })}
          />
          <NavItem
            icon={<Download size={18} />}
            label="Downloads"
            active={isActive('downloads')}
            onClick={() => onNavigate({ type: 'downloads' })}
          />
        </nav>
      </div>

      {/* Playlists Section */}
      <div className="flex-1 flex flex-col min-h-0 px-2 pt-4">
        <div className="flex items-center gap-2 px-3 mb-2">
          <ListMusic size={16} className="text-white/40" />
          <span className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
            Playlists
          </span>
        </div>

        {playlists.length > 0 ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5">
            {playlists.map((playlist) => (
              <PlaylistItem
                key={playlist.Id}
                playlist={playlist}
                active={isPlaylistActive(playlist.Id!)}
                onClick={() => onNavigate({ type: 'playlist-details', playlist })}
                serverUrl={serverUrl}
              />
            ))}
          </div>
        ) : (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-white/30">No playlists yet</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-white/5">
        <p className="text-[10px] text-white/20 text-center">
          Powered by Jellyfin
        </p>
      </div>
    </aside>
  )
})
