import React, { useCallback, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { X, GripVertical, Trash2, ListMusic, Sparkles, Save, Loader2, Check } from 'lucide-react'
import { useJellyfin } from '../JellyfinContext'
import { useMusicPlayer, formatTime, ticksToSeconds, type Track } from '../../../stores/musicPlayerStore'
import { createPlaylist } from './musicQueueHelpers'

type Lane = 'manual' | 'context'

interface MusicQueueProps {
  // Spotify-style navigation from queue rows: title → album, artist → artist page.
  // The drawer closes itself before navigating.
  onNavigateToAlbum?: (albumId: string, albumName?: string) => void
  onNavigateToArtist?: (artistId: string, artistName?: string) => void
}

export function MusicQueue({ onNavigateToAlbum, onNavigateToArtist }: MusicQueueProps) {
  const { serverUrl, accessToken, user, getImageUrl } = useJellyfin()
  // useShallow without currentTime — the queue panel must not re-render on timeupdates
  const {
    queue,
    queueIndex,
    manualQueue,
    queueContextName,
    currentTrack,
    isPlaying,
    isQueueOpen,
    autoplayEnabled,
    isFetchingAutoplay,
    setQueueOpen,
    playTrackAtIndex,
    playManualTrackAt,
    removeFromQueue,
    removeFromManualQueue,
    reorderQueue,
    reorderManualQueue,
    toggleAutoplay,
    getQueueSnapshot,
    clearQueue
  } = useMusicPlayer(useShallow(s => ({
    queue: s.queue,
    queueIndex: s.queueIndex,
    manualQueue: s.manualQueue,
    queueContextName: s.queueContextName,
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    isQueueOpen: s.isQueueOpen,
    autoplayEnabled: s.autoplayEnabled,
    isFetchingAutoplay: s.isFetchingAutoplay,
    setQueueOpen: s.setQueueOpen,
    playTrackAtIndex: s.playTrackAtIndex,
    playManualTrackAt: s.playManualTrackAt,
    removeFromQueue: s.removeFromQueue,
    removeFromManualQueue: s.removeFromManualQueue,
    reorderQueue: s.reorderQueue,
    reorderManualQueue: s.reorderManualQueue,
    toggleAutoplay: s.toggleAutoplay,
    getQueueSnapshot: s.getQueueSnapshot,
    clearQueue: s.clearQueue,
  })))

  // Save-as-playlist UI state
  const [isSaving, setIsSaving] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [playlistName, setPlaylistName] = useState('')
  const [saveResult, setSaveResult] = useState<'ok' | 'error' | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, lane: Lane, index: number) => {
    e.dataTransfer.setData('text/plain', `${lane}:${index}`)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, lane: Lane, dropIndex: number) => {
    e.preventDefault()
    const [dragLane, dragIndexStr] = e.dataTransfer.getData('text/plain').split(':')
    const dragIndex = parseInt(dragIndexStr)
    if (isNaN(dragIndex) || dragLane !== lane) return  // Reorder within the same lane only
    if (dragIndex === dropIndex) return
    if (lane === 'manual') {
      reorderManualQueue(dragIndex, dropIndex)
    } else {
      reorderQueue(dragIndex, dropIndex)
    }
  }, [reorderQueue, reorderManualQueue])

  const handleSavePlaylist = async () => {
    if (!serverUrl || !accessToken || !user?.Id || !playlistName.trim()) return
    setIsSaving(true)
    setSaveResult(null)
    try {
      const snapshot = getQueueSnapshot()
      // De-duplicate while keeping listening order (Jellyfin rejects some dupes)
      const seen = new Set<string>()
      const ids = snapshot.map(t => t.id).filter(id => {
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
      const ok = await createPlaylist(serverUrl, accessToken, user.Id, playlistName.trim(), ids)
      setSaveResult(ok ? 'ok' : 'error')
      if (ok) {
        setTimeout(() => {
          setSaveOpen(false)
          setPlaylistName('')
          setSaveResult(null)
        }, 1500)
      }
    } catch (e) {
      console.error('Failed to save queue as playlist:', e)
      setSaveResult('error')
    }
    setIsSaving(false)
  }

  const handleNavigateToAlbum = onNavigateToAlbum
    ? (albumId: string, albumName?: string) => {
        setQueueOpen(false)
        onNavigateToAlbum(albumId, albumName)
      }
    : undefined
  const handleNavigateToArtist = onNavigateToArtist
    ? (artistId: string, artistName?: string) => {
        setQueueOpen(false)
        onNavigateToArtist(artistId, artistName)
      }
    : undefined

  if (!isQueueOpen) {
    return null
  }

  const upcoming = queue.slice(queueIndex + 1)
  const hasAnything = !!currentTrack || manualQueue.length > 0 || upcoming.length > 0
  const snapshotLength = getQueueSnapshot().length

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={() => setQueueOpen(false)}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-[72px] w-[340px] phone:left-0 phone:bottom-0 phone:w-full phone:z-[60] phone:pt-safe phone:pb-safe bg-gray-900 border-l border-white/10 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <ListMusic size={20} className="text-theme-400" />
            <h2 className="font-semibold text-white">Queue</h2>
            <span className="text-sm text-white/50">({snapshotLength})</span>
          </div>

          <div className="flex items-center gap-1">
            {hasAnything && (
              <button
                onClick={() => { setSaveOpen(!saveOpen); setSaveResult(null) }}
                className={`p-2 transition-colors ${saveOpen ? 'text-theme-400' : 'text-white/50 hover:text-white'}`}
                title="Save queue as playlist"
              >
                <Save size={18} />
              </button>
            )}
            {hasAnything && (
              <button
                onClick={clearQueue}
                className="p-2 text-white/50 hover:text-red-400 transition-colors"
                title="Clear queue"
              >
                <Trash2 size={18} />
              </button>
            )}
            <button
              onClick={() => setQueueOpen(false)}
              className="p-2 text-white/50 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Save as playlist */}
        {saveOpen && (
          <div className="px-4 py-3 border-b border-white/10 bg-white/5">
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
              Save queue as playlist
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSavePlaylist() }}
                placeholder="Playlist name"
                autoFocus
                className="flex-1 px-3 py-2 bg-white/10 border border-white/10 rounded-lg text-sm text-white
                  placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50"
                disabled={isSaving}
              />
              <button
                onClick={handleSavePlaylist}
                disabled={isSaving || !playlistName.trim()}
                className="px-3 py-2 bg-theme-500 hover:bg-theme-400 disabled:opacity-50 rounded-lg
                  text-sm text-white font-medium transition-colors flex items-center gap-1.5"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : saveResult === 'ok' ? <Check size={16} /> : <Save size={16} />}
                {saveResult === 'ok' ? 'Saved' : 'Save'}
              </button>
            </div>
            <p className="text-xs text-white/40 mt-2">
              Includes played and upcoming songs ({snapshotLength} tracks)
            </p>
            {saveResult === 'error' && (
              <p className="text-xs text-red-400 mt-1">Could not create the playlist</p>
            )}
          </div>
        )}

        {/* Autoplay toggle */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
          <div className="flex items-center gap-2 text-sm text-white/70">
            <Sparkles size={16} className={autoplayEnabled ? 'text-theme-400' : 'text-white/40'} />
            <span>Autoplay similar music</span>
            {isFetchingAutoplay && <Loader2 size={14} className="animate-spin text-theme-400" />}
          </div>
          <button
            onClick={toggleAutoplay}
            role="switch"
            aria-checked={autoplayEnabled}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              autoplayEnabled ? 'bg-theme-500' : 'bg-white/20'
            }`}
            title={autoplayEnabled ? 'Autoplay on — similar songs continue when the queue ends' : 'Autoplay off'}
          >
            {/* left-0 anchors the knob — without it the span keeps its static
                (centered) position inside the button and the whole travel is
                shifted right */}
            <span
              className={`absolute left-0 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                autoplayEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* Queue content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* Now Playing */}
          {currentTrack && (
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
                Now Playing
              </p>
              <QueueTrackItem
                track={currentTrack}
                isCurrentTrack={true}
                isPlaying={isPlaying}
                getImageUrl={getImageUrl}
                onPlay={() => {}}
                onNavigateToAlbum={handleNavigateToAlbum}
                onNavigateToArtist={handleNavigateToArtist}
              />
            </div>
          )}

          {/* Next in Queue (manually added) */}
          {manualQueue.length > 0 && (
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
                Next in Queue
              </p>
              <div className="space-y-0.5">
                {manualQueue.map((track, i) => (
                  <QueueTrackItem
                    key={`manual-${track.id}-${i}`}
                    track={track}
                    isCurrentTrack={false}
                    isPlaying={false}
                    getImageUrl={getImageUrl}
                    onPlay={() => playManualTrackAt(i)}
                    onRemove={() => removeFromManualQueue(i)}
                    onNavigateToAlbum={handleNavigateToAlbum}
                    onNavigateToArtist={handleNavigateToArtist}
                    draggable
                    onDragStart={(e) => handleDragStart(e, 'manual', i)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, 'manual', i)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Next from context */}
          {upcoming.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
                {queueContextName ? `Next from: ${queueContextName}` : 'Up Next'}
              </p>
              <div className="space-y-0.5">
                {upcoming.map((track, i) => {
                  const actualIndex = queueIndex + 1 + i
                  return (
                    <QueueTrackItem
                      key={`ctx-${track.id}-${actualIndex}`}
                      track={track}
                      isCurrentTrack={false}
                      isPlaying={false}
                      getImageUrl={getImageUrl}
                      onPlay={() => playTrackAtIndex(actualIndex)}
                      onRemove={() => removeFromQueue(actualIndex)}
                      onNavigateToAlbum={handleNavigateToAlbum}
                      onNavigateToArtist={handleNavigateToArtist}
                      draggable
                      onDragStart={(e) => handleDragStart(e, 'context', actualIndex)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, 'context', actualIndex)}
                    />
                  )
                })}
              </div>
            </div>
          )}

          {/* Autoplay hint when nothing else is queued */}
          {currentTrack && manualQueue.length === 0 && upcoming.length === 0 && autoplayEnabled && (
            <div className="px-4 py-3 flex items-center gap-2 text-sm text-white/40">
              <Sparkles size={16} />
              <span>Similar music will play when this song ends</span>
            </div>
          )}

          {/* Empty state */}
          {!hasAnything && (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <ListMusic size={48} className="text-white/20 mb-4" />
              <p className="text-white/60">Queue is empty</p>
              <p className="text-sm text-white/40 mt-1">
                Play an album or use "Add to queue" on any song
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

interface QueueTrackItemProps {
  track: Track
  isCurrentTrack: boolean
  isPlaying: boolean
  getImageUrl: (itemId: string, type?: 'Primary' | 'Backdrop' | 'Thumb', maxWidth?: number) => string | null
  onPlay: () => void
  onRemove?: () => void
  onNavigateToAlbum?: (albumId: string, albumName?: string) => void
  onNavigateToArtist?: (artistId: string, artistName?: string) => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}

function QueueTrackItem({
  track,
  isCurrentTrack,
  isPlaying,
  getImageUrl,
  onPlay,
  onRemove,
  onNavigateToAlbum,
  onNavigateToArtist,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop
}: QueueTrackItemProps) {
  const imageUrl = track.albumId
    ? getImageUrl(track.albumId, 'Primary', 80)
    : track.imageUrl

  const durationSeconds = ticksToSeconds(track.duration)

  return (
    <div
      className={`group flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors
        ${isCurrentTrack ? 'bg-theme-500/20' : 'hover:bg-white/5 active:bg-white/10'}
      `}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onPlay}
    >
      {/* Drag handle — always visible so it works on touch */}
      {draggable && (
        <div className="cursor-grab active:cursor-grabbing p-0.5 -m-0.5 touch-none">
          <GripVertical size={16} className="text-white/30" />
        </div>
      )}

      {/* Album art */}
      <div className="w-10 h-10 rounded overflow-hidden bg-white/5 flex-shrink-0">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={track.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-theme-900/50 to-pink-900/50" />
        )}
      </div>

      {/* Track info */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${
          isCurrentTrack ? 'text-theme-400 font-medium' : 'text-white'
        }`}>
          {onNavigateToAlbum && track.albumId ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onNavigateToAlbum(track.albumId, track.albumName)
              }}
              className="hover:underline text-left"
              title={`Go to album: ${track.albumName}`}
            >
              {track.name}
            </button>
          ) : (
            track.name
          )}
        </p>
        <p className="text-xs text-white/50 truncate">
          {track.artists.map((artistName, i) => (
            <React.Fragment key={`${artistName}-${i}`}>
              {i > 0 && ', '}
              {onNavigateToArtist && track.artistIds[i] ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onNavigateToArtist(track.artistIds[i], artistName)
                  }}
                  className="hover:underline hover:text-white/80 transition-colors"
                  title={`Go to artist: ${artistName}`}
                >
                  {artistName}
                </button>
              ) : (
                artistName
              )}
            </React.Fragment>
          ))}
        </p>
      </div>

      {/* Playing indicator / Duration */}
      <div className="flex items-center gap-2">
        {isCurrentTrack && isPlaying ? (
          <div className="flex items-end gap-0.5 h-4">
            <div className="w-1 bg-theme-400 animate-pulse" style={{ height: '12px' }} />
            <div className="w-1 bg-theme-400 animate-pulse" style={{ height: '16px', animationDelay: '0.2s' }} />
            <div className="w-1 bg-theme-400 animate-pulse" style={{ height: '8px', animationDelay: '0.4s' }} />
          </div>
        ) : (
          <span className="text-xs text-white/40 tabular-nums">
            {formatTime(durationSeconds)}
          </span>
        )}
      </div>

      {/* Remove button — always visible for touch */}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
          title="Remove from queue"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
