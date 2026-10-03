import React, { useEffect, useState } from 'react'
import { ArrowLeft, Play, Shuffle, Heart, User, Loader2 } from 'lucide-react'
import { useJellyfin, getItemsApi, type BaseItemDto } from '../JellyfinContext'
import { ScrollSection } from '../ScrollSection'
import { AlbumCard } from './components/AlbumCard'
import { MusicTrackRow } from './MusicTrackRow'
import { useMusicPlayer, type Track } from '../../../stores/musicPlayerStore'
import { useScrollToTopOnMount } from '../../../hooks/useScrollRestore'
import type { MusicViewType } from './MusicView'

interface MusicArtistDetailsProps {
  artist: BaseItemDto
  onNavigate: (view: MusicViewType) => void
  onBack: () => void
}

export function MusicArtistDetails({ artist, onNavigate, onBack }: MusicArtistDetailsProps) {
  const { api, user, serverUrl } = useJellyfin()
  const scrollTopAnchor = useScrollToTopOnMount()
  const setQueue = useMusicPlayer(s => s.setQueue)

  const [albums, setAlbums] = useState<BaseItemDto[]>([])
  const [topTracks, setTopTracks] = useState<BaseItemDto[]>([])
  const [showAllTopTracks, setShowAllTopTracks] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchArtistData = async () => {
      if (!api || !user?.Id || !artist.Id) return

      setIsLoading(true)

      try {
        const itemsApi = getItemsApi(api)

        // Fetch albums
        const albumsResponse = await itemsApi.getItems({
          userId: user.Id,
          albumArtistIds: [artist.Id],
          includeItemTypes: ['MusicAlbum'],
          sortBy: ['ProductionYear', 'SortName'],
          sortOrder: ['Descending', 'Ascending'],
          recursive: true
        })
        setAlbums(albumsResponse.data.Items || [])

        // Fetch top tracks (most played)
        const tracksResponse = await itemsApi.getItems({
          userId: user.Id,
          artistIds: [artist.Id],
          includeItemTypes: ['Audio'],
          sortBy: ['PlayCount', 'SortName'],
          sortOrder: ['Descending', 'Ascending'],
          limit: 10,
          recursive: true
        })
        setTopTracks(tracksResponse.data.Items || [])

      } catch (e) {
        console.error('Failed to fetch artist data:', e)
      }

      setIsLoading(false)
    }

    fetchArtistData()
  }, [api, user?.Id, artist.Id])

  const createTracksFromItems = (items: BaseItemDto[]): Track[] => {
    return items.map(item => ({
      id: item.Id!,
      name: item.Name || 'Unknown Track',
      artists: item.Artists || [item.AlbumArtist || artist.Name || 'Unknown Artist'],
      artistIds: item.ArtistItems?.map(a => a.Id!) || [],
      albumId: item.AlbumId || '',
      albumName: item.Album || 'Unknown Album',
      duration: item.RunTimeTicks || 0,
      indexNumber: item.IndexNumber,
      imageUrl: item.AlbumId && serverUrl
        ? `${serverUrl}/Items/${item.AlbumId}/Images/Primary?maxWidth=120`
        : undefined
    }))
  }

  const handlePlayAll = async () => {
    if (!api || !user?.Id) return

    try {
      const itemsApi = getItemsApi(api)
      const tracksResponse = await itemsApi.getItems({
        userId: user.Id,
        artistIds: [artist.Id!],
        includeItemTypes: ['Audio'],
        sortBy: ['Album', 'IndexNumber'],
        sortOrder: ['Ascending', 'Ascending'],
        limit: 200,
        recursive: true
      })

      const tracks = createTracksFromItems(tracksResponse.data.Items || [])
      if (tracks.length > 0) {
        setQueue(tracks, 0, artist.Name)
      }
    } catch (e) {
      console.error('Failed to play artist:', e)
    }
  }

  const handleShuffle = async () => {
    if (!api || !user?.Id) return

    try {
      const itemsApi = getItemsApi(api)
      const tracksResponse = await itemsApi.getItems({
        userId: user.Id,
        artistIds: [artist.Id!],
        includeItemTypes: ['Audio'],
        sortBy: ['Random'],
        limit: 200,
        recursive: true
      })

      const tracks = createTracksFromItems(tracksResponse.data.Items || [])
      if (tracks.length > 0) {
        setQueue(tracks, 0, artist.Name)
      }
    } catch (e) {
      console.error('Failed to shuffle artist:', e)
    }
  }

  const handlePlayTrack = (index: number) => {
    const tracks = createTracksFromItems(topTracks)
    if (tracks.length > 0) {
      setQueue(tracks, index, artist.Name)
    }
  }

  const handlePlayAlbum = async (album: BaseItemDto) => {
    if (!api || !user?.Id) return

    try {
      const itemsApi = getItemsApi(api)
      const tracksResponse = await itemsApi.getItems({
        userId: user.Id,
        parentId: album.Id,
        includeItemTypes: ['Audio'],
        sortBy: ['IndexNumber'],
        sortOrder: ['Ascending']
      })

      const tracks: Track[] = (tracksResponse.data.Items || []).map(item => ({
        id: item.Id!,
        name: item.Name || 'Unknown Track',
        artists: item.Artists || [item.AlbumArtist || 'Unknown Artist'],
        artistIds: item.ArtistItems?.map(a => a.Id!) || [],
        albumId: album.Id!,
        albumName: album.Name || 'Unknown Album',
        duration: item.RunTimeTicks || 0,
        indexNumber: item.IndexNumber,
        imageUrl: serverUrl ? `${serverUrl}/Items/${album.Id}/Images/Primary?maxWidth=120` : undefined
      }))

      if (tracks.length > 0) {
        setQueue(tracks, 0, album.Name)
      }
    } catch (e) {
      console.error('Failed to play album:', e)
    }
  }

  const imageUrl = serverUrl && artist.Id
    ? `${serverUrl}/Items/${artist.Id}/Images/Primary?maxWidth=300&quality=90`
    : null

  return (
    <div className="min-h-full" ref={scrollTopAnchor}>
      {/* Header with backdrop */}
      <div className="relative">
        {/* Gradient backdrop */}
        <div className="absolute inset-0 bg-gradient-to-b from-theme-900/40 via-theme-900/20 to-gray-900" />

        <div className="relative px-8 phone:px-4 pt-8 phone:pt-safe pb-6">
          {/* Back button */}
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>Back</span>
          </button>

          {/* Artist info */}
          <div className="flex phone:flex-col phone:items-center phone:text-center gap-6 phone:gap-4 items-end">
            {/* Image - circular */}
            <div className="w-48 h-48 phone:w-40 phone:h-40 rounded-full overflow-hidden shadow-2xl flex-shrink-0">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={artist.Name || 'Artist'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
                  <User size={64} className="text-white/30" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex flex-col justify-end min-w-0 phone:items-center">
              <span className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
                Artist
              </span>
              <h1 className="text-5xl phone:text-2xl font-bold text-white mb-4 phone:mb-2">
                {artist.Name}
              </h1>
              <p className="text-white/60">
                {albums.length} albums
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-8 phone:px-4 py-4 flex flex-wrap items-center gap-4 phone:justify-center">
        <button
          onClick={handlePlayAll}
          disabled={isLoading}
          className="flex items-center justify-center gap-2 px-6 py-3 phone:w-full bg-theme-500 hover:bg-theme-400
            rounded-full text-white font-semibold transition-colors disabled:opacity-50"
        >
          <Play size={20} fill="currentColor" />
          Play
        </button>

        <button
          onClick={handleShuffle}
          disabled={isLoading}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
          title="Shuffle"
        >
          <Shuffle size={20} />
        </button>

        <button
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
          title="Add to favorites"
        >
          <Heart size={20} />
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={32} className="animate-spin text-theme-500" />
        </div>
      ) : (
        <div className="pb-8 space-y-8">
          {/* Top Tracks */}
          {topTracks.length > 0 && (
            <div className="px-8 phone:px-4">
              <h2 className="text-xl font-bold text-white mb-4">Popular</h2>
              <div className="space-y-1">
                {topTracks.slice(0, showAllTopTracks ? 10 : 5).map((track, index) => (
                  <MusicTrackRow
                    key={track.Id}
                    track={track}
                    index={index + 1}
                    showAlbum={true}
                    showArtist={false}
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
                  />
                ))}
              </div>
              {topTracks.length > 5 && (
                <button
                  onClick={() => setShowAllTopTracks(v => !v)}
                  className="mt-3 text-xs font-semibold uppercase tracking-wider text-white/50 hover:text-white transition-colors"
                >
                  {showAllTopTracks ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}

          {/* Albums */}
          {albums.length > 0 && (
            <ScrollSection title="Discography">
              {albums.map((album) => (
                <AlbumCard
                  key={album.Id}
                  album={album}
                  onClick={() => onNavigate({ type: 'album-details', album })}
                  onPlay={() => handlePlayAlbum(album)}
                />
              ))}
            </ScrollSection>
          )}
        </div>
      )}
    </div>
  )
}
