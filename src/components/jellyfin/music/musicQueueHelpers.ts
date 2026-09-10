// Shared helpers for queueing, favorites and playlists in JellyMusic

import { api as appApi } from '../../../utils/api'
import { getItemsApi, type BaseItemDto } from '../JellyfinContext'
import type { Api } from '@jellyfin/sdk/lib/api'
import type { Track } from '../../../stores/musicPlayerStore'

/** Convert a Jellyfin BaseItemDto (Audio item) to the player's Track shape */
export function dtoToTrack(item: BaseItemDto, serverUrl: string | null): Track {
  return {
    id: item.Id!,
    name: item.Name || 'Unknown Track',
    artists: item.Artists?.length ? item.Artists : [item.AlbumArtist || 'Unknown Artist'],
    artistIds: item.ArtistItems?.map(a => a.Id!).filter(Boolean) || [],
    albumId: item.AlbumId || '',
    albumName: item.Album || '',
    duration: item.RunTimeTicks || 0,
    indexNumber: item.IndexNumber,
    imageUrl: serverUrl && item.AlbumId
      ? `${serverUrl}/Items/${item.AlbumId}/Images/Primary?maxWidth=300&quality=90`
      : undefined,
  }
}

/**
 * Fetch all audio tracks of a container item (album or playlist) in play order.
 * Used by "Play Next" / "Add to Queue" on albums and playlists.
 */
export async function fetchContainerTracks(
  api: Api,
  userId: string,
  container: BaseItemDto,
  serverUrl: string | null,
): Promise<Track[]> {
  const itemsApi = getItemsApi(api)
  const isPlaylist = container.Type === 'Playlist'
  const response = await itemsApi.getItems({
    userId,
    parentId: container.Id!,
    includeItemTypes: ['Audio'],
    // Playlists keep their own order; albums sort by disc/track number
    sortBy: isPlaylist ? undefined : ['ParentIndexNumber', 'IndexNumber'],
    recursive: !isPlaylist,
  })
  return (response.data.Items || [])
    .filter(i => i.Id)
    .map(i => dtoToTrack(i, serverUrl))
}

/** Toggle the Jellyfin favorite state of an item. Returns the new state. */
export async function setFavorite(
  serverUrl: string,
  accessToken: string,
  userId: string,
  itemId: string,
  favorite: boolean,
): Promise<boolean> {
  const res = await appApi.request({
    method: favorite ? 'POST' : 'DELETE',
    url: `${serverUrl}/Users/${userId}/FavoriteItems/${itemId}`,
    headers: { 'Authorization': `MediaBrowser Token="${accessToken}"` },
  })
  if (!res.success) throw new Error(`Favorite update failed (${res.status})`)
  return favorite
}

/** Create a new Jellyfin audio playlist from a list of item ids. */
export async function createPlaylist(
  serverUrl: string,
  accessToken: string,
  userId: string,
  name: string,
  itemIds: string[],
): Promise<boolean> {
  const res = await appApi.request({
    method: 'POST',
    url: `${serverUrl}/Playlists`,
    headers: {
      'Authorization': `MediaBrowser Token="${accessToken}"`,
      'Content-Type': 'application/json',
    },
    data: {
      Name: name,
      Ids: itemIds,
      UserId: userId,
      MediaType: 'Audio',
    },
  })
  return res.success
}
