// Shared helpers for queueing, favorites and playlists in JellyMusic

import { api as appApi } from '../../../utils/api'
import { getItemsApi, getPlaylistsApi, type BaseItemDto } from '../JellyfinContext'
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
    discNumber: item.ParentIndexNumber ?? null,
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
  const isPlaylist = container.Type === 'Playlist'
  if (isPlaylist) {
    // Only this route returns the live entries in playlist order (CLAUDE.md)
    const res = await getPlaylistsApi(api).getPlaylistItems({ playlistId: container.Id!, userId })
    return (res.data.Items || [])
      .filter(i => i.Id && i.Type === 'Audio')
      .map(i => dtoToTrack(i, serverUrl))
  }
  const itemsApi = getItemsApi(api)
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
    url: `${serverUrl}/UserFavoriteItems/${itemId}`,
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

// ── Playlist editing ─────────────────────────────────────────────────────────

/** Fired after a playlist was created or edited — views listing playlists refetch. */
export const PLAYLISTS_CHANGED_EVENT = 'jellymusic:playlists-changed'
export function notifyPlaylistsChanged(playlistId?: string) {
  window.dispatchEvent(new CustomEvent(PLAYLISTS_CHANGED_EVENT, { detail: { playlistId } }))
}

const authHeaders = (accessToken: string) => ({ 'Authorization': `MediaBrowser Token="${accessToken}"` })

/** The user's audio playlists, sorted by name. */
export async function listAudioPlaylists(api: Api, userId: string): Promise<BaseItemDto[]> {
  const res = await getItemsApi(api).getItems({
    userId,
    includeItemTypes: ['Playlist'],
    recursive: true,
    sortBy: ['SortName'],
    sortOrder: ['Ascending'],
  })
  return (res.data.Items || []).filter(p => p.MediaType === 'Audio' || !p.MediaType)
}

/** Create a playlist and return its id (null on failure). */
export async function createPlaylistWithId(
  serverUrl: string,
  accessToken: string,
  userId: string,
  name: string,
  itemIds: string[],
): Promise<string | null> {
  const res = await appApi.request({
    method: 'POST',
    url: `${serverUrl}/Playlists`,
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    data: { Name: name, Ids: itemIds, UserId: userId, MediaType: 'Audio' },
  })
  if (!res.success) return null
  notifyPlaylistsChanged()
  return (res.data as any)?.Id ?? null
}

/** Append items to a playlist (POST /Playlists/{id}/Items). */
export async function addItemsToPlaylist(
  serverUrl: string,
  accessToken: string,
  userId: string,
  playlistId: string,
  itemIds: string[],
): Promise<boolean> {
  if (itemIds.length === 0) return true
  const params = new URLSearchParams({ ids: itemIds.join(','), userId })
  const res = await appApi.request({
    method: 'POST',
    url: `${serverUrl}/Playlists/${playlistId}/Items?${params}`,
    headers: authHeaders(accessToken),
  })
  if (res.success) notifyPlaylistsChanged(playlistId)
  return res.success
}

/** Remove entries (by PlaylistItemId, not item id) from a playlist. */
export async function removeFromPlaylist(
  serverUrl: string,
  accessToken: string,
  playlistId: string,
  entryIds: string[],
): Promise<boolean> {
  const params = new URLSearchParams({ entryIds: entryIds.join(',') })
  const res = await appApi.request({
    method: 'DELETE',
    url: `${serverUrl}/Playlists/${playlistId}/Items?${params}`,
    headers: authHeaders(accessToken),
  })
  if (res.success) notifyPlaylistsChanged(playlistId)
  return res.success
}

/** Move one entry (by PlaylistItemId) to a new 0-based position. */
export async function movePlaylistItem(
  serverUrl: string,
  accessToken: string,
  playlistId: string,
  entryId: string,
  newIndex: number,
): Promise<boolean> {
  const res = await appApi.request({
    method: 'POST',
    url: `${serverUrl}/Playlists/${playlistId}/Items/${entryId}/Move/${newIndex}`,
    headers: authHeaders(accessToken),
  })
  return res.success
}
