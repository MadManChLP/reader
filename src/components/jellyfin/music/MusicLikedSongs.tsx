import React, { useEffect, useState } from 'react'
import { Play, Shuffle, Heart, Clock, Loader2, ListPlus, ListEnd } from 'lucide-react'
import { ItemFilter } from '@jellyfin/sdk/lib/generated-client'
import { useJellyfin, getItemsApi, type BaseItemDto } from '../JellyfinContext'
import { MusicTrackRow } from './MusicTrackRow'
import { useMusicPlayer, ticksToSeconds, type Track } from '../../../stores/musicPlayerStore'
import { dtoToTrack } from './musicQueueHelpers'
import type { MusicViewType } from './JellyMusicView'

interface MusicLikedSongsProps {
  onNavigate: (view: MusicViewType) => void
}

export function MusicLikedSongs({ onNavigate }: MusicLikedSongsProps) {
  const { api, user, serverUrl } = useJellyfin()
  const setQueue = useMusicPlayer(s => s.setQueue)
  const addToQueue = useMusicPlayer(s => s.addToQueue)

  const [tracks, setTracks] = useState<BaseItemDto[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchLiked = async () => {
      if (!api || !user?.Id) return
      setIsLoading(true)
      try {
        const itemsApi = getItemsApi(api)
        const response = await itemsApi.getItems({
          userId: user.Id,
          filters: [ItemFilter.IsFavorite],
          includeItemTypes: ['Audio'],
          recursive: true,
          sortBy: ['SortName'],
          sortOrder: ['Ascending'],
        })
        setTracks(response.data.Items || [])
      } catch (e) {
        console.error('Failed to fetch liked songs:', e)
      }
      setIsLoading(false)
    }

    fetchLiked()
  }, [api, user?.Id])

  const toPlayerTracks = (): Track[] => tracks.map(t => dtoToTrack(t, serverUrl))

  const handlePlayAll = () => {
    const queueTracks = toPlayerTracks()
    if (queueTracks.length > 0) setQueue(queueTracks, 0, 'Liked Songs')
  }

  const handleShuffle = () => {
    const queueTracks = toPlayerTracks()
    if (queueTracks.length > 0) {
      const shuffled = [...queueTracks].sort(() => Math.random() - 0.5)
      setQueue(shuffled, 0, 'Liked Songs')
    }
  }

  const handlePlayTrack = (index: number) => {
    const queueTracks = toPlayerTracks()
    if (queueTracks.length > 0) setQueue(queueTracks, index, 'Liked Songs')
  }

  const handleQueueAll = (position: 'next' | 'end') => {
    const queueTracks = toPlayerTracks()
    if (queueTracks.length > 0) addToQueue(queueTracks, position)
  }

  const totalDuration = tracks.reduce((acc, track) => acc + (track.RunTimeTicks || 0), 0)
  const totalDurationMinutes = Math.round(ticksToSeconds(totalDuration) / 60)

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-b from-theme-900/40 via-theme-900/20 to-gray-900" />

        <div className="relative px-8 pt-8 pb-6">
          <div className="flex gap-6">
            <div className="w-48 h-48 rounded-lg overflow-hidden shadow-2xl flex-shrink-0 bg-gradient-to-br from-theme-600 to-pink-500 flex items-center justify-center">
              <Heart size={64} className="text-white" fill="currentColor" />
            </div>

            <div className="flex flex-col justify-end">
              <span className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
                Playlist
              </span>
              <h1 className="text-4xl font-bold text-white mb-2">Liked Songs</h1>
              <div className="flex items-center gap-2 text-white/70">
                <span>{tracks.length} songs</span>
                {tracks.length > 0 && (
                  <>
                    <span className="text-white/40">•</span>
                    <span>{totalDurationMinutes} min</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-8 py-4 flex items-center gap-4">
        <button
          onClick={handlePlayAll}
          disabled={tracks.length === 0}
          className="flex items-center gap-2 px-6 py-3 bg-theme-500 hover:bg-theme-400
            rounded-full text-white font-semibold transition-colors disabled:opacity-50"
        >
          <Play size={20} fill="currentColor" />
          Play
        </button>

        <button
          onClick={handleShuffle}
          disabled={tracks.length === 0}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
          title="Shuffle"
        >
          <Shuffle size={20} />
        </button>

        <button
          onClick={() => handleQueueAll('next')}
          disabled={tracks.length === 0}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
          title="Play next"
        >
          <ListPlus size={20} />
        </button>

        <button
          onClick={() => handleQueueAll('end')}
          disabled={tracks.length === 0}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
          title="Add to queue"
        >
          <ListEnd size={20} />
        </button>
      </div>

      {/* Track list */}
      <div className="px-4 pb-8">
        <div className="flex items-center gap-4 px-4 py-2 text-xs font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 mb-2">
          <div className="w-8 text-center">#</div>
          <div className="flex-1">Title</div>
          <div className="hidden md:block w-48">Album</div>
          <div className="w-12 text-right">
            <Clock size={14} />
          </div>
          <div className="w-8" />
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={32} className="animate-spin text-theme-500" />
          </div>
        )}

        {!isLoading && tracks.map((track, index) => (
          <MusicTrackRow
            key={track.Id}
            track={track}
            index={index + 1}
            showArtist={true}
            showAlbum={true}
            onPlay={() => handlePlayTrack(index)}
            onNavigateToAlbum={() => {
              if (track.AlbumId) {
                onNavigate({
                  type: 'album-details',
                  album: {
                    Id: track.AlbumId,
                    Name: track.Album,
                    AlbumArtist: track.AlbumArtist
                  } as BaseItemDto
                })
              }
            }}
            onNavigateToArtist={() => {
              if (track.ArtistItems?.[0]?.Id) {
                onNavigate({
                  type: 'artist-details',
                  artist: {
                    Id: track.ArtistItems[0].Id,
                    Name: track.ArtistItems[0].Name
                  } as BaseItemDto
                })
              }
            }}
          />
        ))}

        {!isLoading && tracks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Heart size={48} className="text-white/20 mb-4" />
            <p className="text-white/60">No liked songs yet</p>
            <p className="text-sm text-white/40 mt-1">
              Tap the heart on any song to add it here
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
