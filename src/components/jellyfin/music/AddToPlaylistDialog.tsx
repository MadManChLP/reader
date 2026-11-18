import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { ListMusic, Plus, Loader2, X, Check } from 'lucide-react'
import { useJellyfin, type BaseItemDto } from '../JellyfinContext'
import { useIsPhone } from '../../../hooks/useIsPhone'
import { BottomSheet } from '../../BottomSheet'
import { useToast } from '../../Toast'
import { blockGlobalEsc, registerBackHandler } from '../../../utils/navigationBus'
import { hapticSuccess } from '../../../utils/haptics'
import { PlaylistCover } from './PlaylistCover'
import { listAudioPlaylists, addItemsToPlaylist, createPlaylistWithId } from './musicQueueHelpers'

// "Add to playlist…" picker (Spotify-style): any track/album/queue menu calls
// openAddToPlaylist() with the item ids (or a loader for albums whose tracks
// still have to be fetched). One instance is mounted in JellyMusicView.

type IdSource = string[] | (() => Promise<string[]>)

interface AddToPlaylistState {
  source: IdSource | null
  label: string
  open: (source: IdSource, label: string) => void
  close: () => void
}

const useAddToPlaylist = create<AddToPlaylistState>((set) => ({
  source: null,
  label: '',
  open: (source, label) => set({ source, label }),
  close: () => set({ source: null, label: '' }),
}))

export function openAddToPlaylist(source: IdSource, label: string) {
  useAddToPlaylist.getState().open(source, label)
}

export function AddToPlaylistDialog() {
  const source = useAddToPlaylist(s => s.source)
  if (!source) return null
  return <AddToPlaylistPicker />
}

function AddToPlaylistPicker() {
  const { api, user, serverUrl, accessToken } = useJellyfin()
  const { source, label, close } = useAddToPlaylist()
  const isPhone = useIsPhone()
  const toast = useToast()
  const [playlists, setPlaylists] = useState<BaseItemDto[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!api || !user?.Id) return
    let cancelled = false
    listAudioPlaylists(api, user.Id)
      .then(list => { if (!cancelled) setPlaylists(list) })
      .catch(() => { if (!cancelled) setPlaylists([]) })
    return () => { cancelled = true }
  }, [api, user?.Id])

  const resolveIds = async (): Promise<string[]> => {
    if (!source) return []
    return typeof source === 'function' ? await source() : source
  }

  const addTo = async (playlist: BaseItemDto) => {
    if (!serverUrl || !accessToken || !user?.Id || !playlist.Id || busyId) return
    setBusyId(playlist.Id)
    try {
      const ids = await resolveIds()
      const ok = await addItemsToPlaylist(serverUrl, accessToken, user.Id, playlist.Id, ids)
      if (ok) {
        hapticSuccess()
        toast.success(`Added ${label} to "${playlist.Name}"`)
        close()
      } else {
        toast.error('Could not add to the playlist')
      }
    } finally {
      setBusyId(null)
    }
  }

  const createNew = async () => {
    const name = newName.trim()
    if (!name || !serverUrl || !accessToken || !user?.Id || creating) return
    setCreating(true)
    try {
      const ids = await resolveIds()
      const id = await createPlaylistWithId(serverUrl, accessToken, user.Id, name, ids)
      if (id) {
        hapticSuccess()
        toast.success(`Created "${name}"`)
        close()
      } else {
        toast.error('Could not create the playlist')
      }
    } finally {
      setCreating(false)
    }
  }

  const body = (
    <div className="space-y-3">
      {/* New playlist */}
      <form
        onSubmit={(e) => { e.preventDefault(); void createNew() }}
        className="flex items-center gap-2"
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New playlist name"
          className="flex-1 min-w-0 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-theme-500"
        />
        <button
          type="submit"
          disabled={!newName.trim() || creating}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-theme-600 hover:bg-theme-500 text-white text-sm font-medium disabled:opacity-40 transition-colors"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Create
        </button>
      </form>

      {/* Existing playlists */}
      <div className="max-h-[50vh] overflow-y-auto custom-scrollbar -mx-1">
        {playlists === null ? (
          <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-white/50" /></div>
        ) : playlists.length === 0 ? (
          <p className="text-sm text-white/40 text-center py-6">No playlists yet — create one above</p>
        ) : playlists.map(p => (
          <button
            key={p.Id}
            onClick={() => void addTo(p)}
            disabled={!!busyId}
            className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left text-white/85 hover:bg-white/10 active:bg-white/15 transition-colors disabled:opacity-60"
          >
            <PlaylistCover playlist={p} serverUrl={serverUrl} maxWidth={80} className="w-10 h-10 rounded flex-shrink-0" iconSize={16} />
            <span className="flex-1 text-sm truncate">{p.Name}</span>
            {busyId === p.Id ? <Loader2 size={16} className="animate-spin text-white/60" /> : <Check size={16} className="text-transparent" />}
          </button>
        ))}
      </div>
    </div>
  )

  if (isPhone) {
    return (
      <BottomSheet title={<><ListMusic size={16} />Add {label} to playlist</>} onClose={close}>
        <div className="px-3 pb-3">{body}</div>
      </BottomSheet>
    )
  }
  return <DesktopDialog label={label} onClose={close}>{body}</DesktopDialog>
}

function DesktopDialog({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const unblock = blockGlobalEsc()
    const unregister = registerBackHandler(() => { onClose(); return true })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { unblock(); unregister(); window.removeEventListener('keydown', onKey) }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60" onClick={(e) => { e.stopPropagation(); onClose() }} />
      <div className="relative w-full max-w-md bg-gray-900 border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-semibold text-white truncate">
            <ListMusic size={18} className="text-theme-400 flex-shrink-0" />
            <span className="truncate">Add {label} to playlist</span>
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-white/60" title="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
