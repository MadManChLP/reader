import React, { useCallback } from 'react'
import { Play, ListPlus, ListEnd, FolderOpen, ListMusic } from 'lucide-react'
import { openAddToPlaylist } from './AddToPlaylistDialog'
import { useJellyfin, type BaseItemDto } from '../JellyfinContext'
import { useMusicPlayer } from '../../../stores/musicPlayerStore'
import { MusicContextMenu, useContextMenu, type ContextMenuItem } from './MusicContextMenu'
import { fetchContainerTracks } from './musicQueueHelpers'

/**
 * Right-click / long-press menu for an album or playlist row: Play, Play next,
 * Add to queue, Open. Spread `bind` onto the row and render `menu`.
 */
export function useContainerMenu(container: BaseItemDto, onOpen: () => void) {
  const { api, user, serverUrl } = useJellyfin()
  const setQueue = useMusicPlayer(s => s.setQueue)
  const addToQueue = useMusicPlayer(s => s.addToQueue)
  const { menuPosition, openAt, close, longPressHandlers } = useContextMenu()

  const load = useCallback(async () => {
    if (!api || !user?.Id || !container.Id) return []
    try {
      return await fetchContainerTracks(api, user.Id, container, serverUrl)
    } catch (e) {
      console.error('Failed to load tracks:', e)
      return []
    }
  }, [api, user?.Id, container, serverUrl])

  const items: ContextMenuItem[] = [
    { label: 'Play', icon: Play, onClick: () => void load().then(t => { if (t.length) setQueue(t, 0, container.Name ?? null) }) },
    { label: 'Play next', icon: ListPlus, onClick: () => void load().then(t => { if (t.length) addToQueue(t, 'next') }), separator: true },
    { label: 'Add to queue', icon: ListEnd, onClick: () => void load().then(t => { if (t.length) addToQueue(t, 'end') }) },
    { label: 'Add to playlist…', icon: ListMusic, onClick: () => openAddToPlaylist(() => load().then(t => t.map(x => x.id)), `"${container.Name ?? 'this'}"`) },
    { label: 'Open', icon: FolderOpen, onClick: onOpen, separator: true },
  ]

  const bind = { onContextMenu: openAt, ...longPressHandlers }
  const menu = menuPosition
    ? <MusicContextMenu items={items} position={menuPosition} onClose={close} />
    : null
  return { bind, menu }
}
