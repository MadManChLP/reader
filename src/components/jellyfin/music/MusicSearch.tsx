import React, { useState, useEffect, useCallback } from 'react'
import { Search as SearchIcon, Disc3, User, Music2, Loader2, X } from 'lucide-react'
import { useJellyfin, getItemsApi, type BaseItemDto } from '../JellyfinContext'
import { getArtistsApi } from '@jellyfin/sdk/lib/utils/api'
import { ScrollSection } from '../ScrollSection'
import { AlbumCard } from './components/AlbumCard'
import { ArtistCard } from './components/ArtistCard'
import { MusicTrackRow } from './MusicTrackRow'
import { useMusicPlayer, type Track } from '../../../stores/musicPlayerStore'
import type { MusicViewType } from './MusicView'

interface MusicSearchProps {
  onNavigate: (view: MusicViewType) => void
  musicLibraries: BaseItemDto[]
}

export function MusicSearch({ onNavigate, musicLibraries }: MusicSearchProps) {
  const { api, user, serverUrl } = useJellyfin()
  const setQueue = useMusicPlayer(s => s.setQueue)

  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [albums, setAlbums] = useState<BaseItemDto[]>([])
  const [artists, setArtists] = useState<BaseItemDto[]>([])
  const [tracks, setTracks] = useState<BaseItemDto[]>([])

  const search = useCallback(async () => {
    if (!api || !user?.Id || !query.trim() || musicLibraries.length === 0) {
      setAlbums([])
      setArtists([])
      setTracks([])
      return
    }

    setIsSearching(true)

    try {
      const itemsApi = getItemsApi(api)
      const artistsApi = getArtistsApi(api)
      const libraryId = musicLibraries[0].Id

      // Search in parallel
      const [albumsRes, artistsRes, tracksRes] = await Promise.all([
        // Albums
        itemsApi.getItems({
          userId: user.Id,
          parentId: libraryId,
          includeItemTypes: ['MusicAlbum'],
          searchTerm: query,
          limit: 10,
          recursive: true
        }),
        // Artists
        artistsApi.getArtists({
          userId: user.Id,
          parentId: libraryId,
          searchTerm: query,
          limit: 10
        }),
        // Tracks
        itemsApi.getItems({
          userId: user.Id,
          parentId: libraryId,
          includeItemTypes: ['Audio'],
          searchTerm: query,
          limit: 20,
          recursive: true
        })
      ])

      setAlbums(albumsRes.data.Items || [])
      setArtists(artistsRes.data.Items || [])
      setTracks(tracksRes.data.Items || [])

    } catch (e) {
      console.error('Search failed:', e)
    }

    setIsSearching(false)
  }, [api, user?.Id, query, musicLibraries])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      search()
    }, 300)

    return () => clearTimeout(timer)
  }, [search])

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

      const queueTracks: Track[] = (tracksResponse.data.Items || []).map(item => ({
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

      if (queueTracks.length > 0) {
        setQueue(queueTracks, 0, album.Name)
      }
    } catch (e) {
      console.error('Failed to play album:', e)
    }
  }

  const handlePlayArtist = async (artist: BaseItemDto) => {
    if (!api || !user?.Id) return

    try {
      const itemsApi = getItemsApi(api)
      const tracksResponse = await itemsApi.getItems({
        userId: user.Id,
        artistIds: [artist.Id!],
        includeItemTypes: ['Audio'],
        sortBy: ['Random'],
        limit: 50,
        recursive: true
      })

      const queueTracks: Track[] = (tracksResponse.data.Items || []).map(item => ({
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

      if (queueTracks.length > 0) {
        setQueue(queueTracks, 0, artist.Name)
      }
    } catch (e) {
      console.error('Failed to play artist:', e)
    }
  }

  const handlePlayTrack = (trackIndex: number) => {
    const queueTracks: Track[] = tracks.map(item => ({
      id: item.Id!,
      name: item.Name || 'Unknown Track',
      artists: item.Artists || [item.AlbumArtist || 'Unknown Artist'],
      artistIds: item.ArtistItems?.map(a => a.Id!) || [],
      albumId: item.AlbumId || '',
      albumName: item.Album || 'Unknown Album',
      duration: item.RunTimeTicks || 0,
      indexNumber: item.IndexNumber,
      imageUrl: item.AlbumId && serverUrl
        ? `${serverUrl}/Items/${item.AlbumId}/Images/Primary?maxWidth=120`
        : undefined
    }))

    if (queueTracks.length > 0) {
      setQueue(queueTracks, trackIndex, 'Search results')
    }
  }

  const hasResults = albums.length > 0 || artists.length > 0 || tracks.length > 0

  return (
    <div className="p-8">
      {/* Search input */}
      <div className="max-w-xl mb-8">
        <div className="relative">
          <SearchIcon size={24} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What do you want to listen to?"
            autoFocus
            className="w-full pl-14 pr-12 py-4 bg-white/10 border border-white/10 rounded-full
              text-lg text-white placeholder-white/40 focus:outline-none focus:border-theme-500/50
              focus:bg-white/15 transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 text-white/40 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {isSearching && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={32} className="animate-spin text-theme-500" />
        </div>
      )}

      {/* Results */}
      {!isSearching && query && (
        <>
          {/* No results */}
          {!hasResults && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <SearchIcon size={64} className="text-white/20 mb-4" />
              <h2 className="text-xl font-semibold text-white mb-2">No results found</h2>
              <p className="text-white/60">Try different keywords or check your spelling</p>
            </div>
          )}

          {/* Artists */}
          {artists.length > 0 && (
            <ScrollSection
              title="Artists"
              icon={<User size={20} className="text-theme-400" />}
              className="mb-8"
            >
              {artists.map((artist) => (
                <ArtistCard
                  key={artist.Id}
                  artist={artist}
                  onClick={() => onNavigate({ type: 'artist-details', artist })}
                  onPlay={() => handlePlayArtist(artist)}
                />
              ))}
            </ScrollSection>
          )}

          {/* Albums */}
          {albums.length > 0 && (
            <ScrollSection
              title="Albums"
              icon={<Disc3 size={20} className="text-theme-400" />}
              className="mb-8"
            >
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

          {/* Tracks */}
          {tracks.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold flex items-center gap-2 mb-4 px-8">
                <Music2 size={20} className="text-theme-400" />
                Songs
              </h2>
              <div className="px-4">
                {tracks.map((track, index) => (
                  <MusicTrackRow
                    key={track.Id}
                    track={track}
                    index={index + 1}
                    showAlbum={true}
                    showArtist={true}
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
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state - show before search */}
      {!query && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <SearchIcon size={64} className="text-white/20 mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Search your music</h2>
          <p className="text-white/60">Find artists, albums, and songs</p>
        </div>
      )}
    </div>
  )
}
