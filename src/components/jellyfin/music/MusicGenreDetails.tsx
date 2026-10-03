import React, { useEffect, useState, memo } from 'react'
import { ArrowLeft, Play, Shuffle, Tag, Loader2 } from 'lucide-react'
import { useJellyfin, getItemsApi, type BaseItemDto } from '../JellyfinContext'
import { ScrollSection } from '../ScrollSection'
import { AlbumCard } from './components/AlbumCard'
import { useMusicPlayer, type Track } from '../../../stores/musicPlayerStore'
import { useScrollRestore } from '../../../hooks/useScrollRestore'
import { loadGridState, saveGridState } from '../../../utils/viewStateCache'
import type { MusicViewType } from './JellyMusicView'

interface MusicGenreDetailsProps {
  genre: BaseItemDto
  onNavigate: (view: MusicViewType) => void
  onBack: () => void
}

export const MusicGenreDetails = memo(function MusicGenreDetails({
  genre,
  onNavigate,
  onBack
}: MusicGenreDetailsProps) {
  const { api, user, serverUrl } = useJellyfin()
  const setQueue = useMusicPlayer(s => s.setQueue)

  // Restore cached albums so coming back from album details neither
  // refetches nor loses the scroll position (rendered with key={genre.Id},
  // so switching genres remounts with a fresh cache lookup)
  const cacheKey = `music-genre:${genre.Id}`
  const [cached] = useState(() => loadGridState<BaseItemDto[]>(cacheKey))
  const [albums, setAlbums] = useState<BaseItemDto[]>(cached?.data ?? [])
  const [isLoading, setIsLoading] = useState(!cached)

  useEffect(() => {
    if (loadGridState<BaseItemDto[]>(cacheKey)) return

    const fetchAlbums = async () => {
      if (!api || !user?.Id || !genre.Name) return

      setIsLoading(true)

      try {
        const itemsApi = getItemsApi(api)
        const response = await itemsApi.getItems({
          userId: user.Id,
          genreIds: [genre.Id!],
          includeItemTypes: ['MusicAlbum'],
          sortBy: ['SortName'],
          sortOrder: ['Ascending'],
          recursive: true
        })

        const items = response.data.Items || []
        setAlbums(items)
        saveGridState(cacheKey, 'all', items)
      } catch (e) {
        console.error('Failed to fetch genre albums:', e)
      }

      setIsLoading(false)
    }

    fetchAlbums()
  }, [api, user?.Id, genre.Id, genre.Name, cacheKey])

  const scrollAnchorRef = useScrollRestore(cacheKey, !isLoading)

  const handlePlayAll = async () => {
    if (!api || !user?.Id) return

    try {
      const itemsApi = getItemsApi(api)
      const tracksResponse = await itemsApi.getItems({
        userId: user.Id,
        genreIds: [genre.Id!],
        includeItemTypes: ['Audio'],
        sortBy: ['Random'],
        limit: 100,
        recursive: true
      })

      const tracks: Track[] = (tracksResponse.data.Items || []).map(item => ({
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

      if (tracks.length > 0) {
        setQueue(tracks, 0, genre.Name)
      }
    } catch (e) {
      console.error('Failed to play genre:', e)
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

  const imageUrl = serverUrl && genre.Id
    ? `${serverUrl}/Items/${genre.Id}/Images/Primary?maxWidth=300&quality=90`
    : null

  return (
    <div className="min-h-full" ref={scrollAnchorRef}>
      {/* Header */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-b from-green-900/40 via-green-900/20 to-gray-900" />

        <div className="relative px-8 phone:px-4 pt-8 phone:pt-safe pb-6">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>Back</span>
          </button>

          <div className="flex phone:flex-col phone:items-center phone:text-center gap-6 phone:gap-4 items-end">
            <div className="w-48 h-48 phone:w-44 phone:h-44 rounded-lg overflow-hidden shadow-2xl flex-shrink-0 bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={genre.Name || 'Genre'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Tag size={64} className="text-white/80" />
              )}
            </div>

            <div className="flex flex-col justify-end min-w-0 phone:items-center">
              <span className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
                Genre
              </span>
              <h1 className="text-5xl phone:text-2xl font-bold text-white mb-4 phone:mb-2">
                {genre.Name}
              </h1>
              <p className="text-white/60">
                {albums.length} albums
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-8 phone:px-4 py-4 flex items-center gap-4">
        <button
          onClick={handlePlayAll}
          disabled={isLoading || albums.length === 0}
          className="flex items-center justify-center gap-2 px-6 py-3 phone:w-full bg-green-500 hover:bg-green-400
            rounded-full text-white font-semibold transition-colors disabled:opacity-50"
        >
          <Shuffle size={20} />
          Shuffle Play
        </button>
      </div>

      {/* Albums */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={32} className="animate-spin text-theme-500" />
        </div>
      ) : albums.length > 0 ? (
        <div className="px-8 phone:px-4 pb-8">
          <h2 className="text-xl font-bold text-white mb-4">Albums</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-6">
            {albums.map((album) => (
              <AlbumCard
                key={album.Id}
                album={album}
                size="fluid"
                onClick={() => onNavigate({ type: 'album-details', album })}
                onPlay={() => handlePlayAlbum(album)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20">
          <Tag size={48} className="text-white/20 mb-4" />
          <p className="text-white/60">No albums found in this genre</p>
        </div>
      )}
    </div>
  )
})
