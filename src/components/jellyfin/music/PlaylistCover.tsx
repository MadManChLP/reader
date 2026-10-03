import React, { useState, useEffect, memo } from 'react'
import { ListMusic } from 'lucide-react'
import type { BaseItemDto } from '../JellyfinContext'

interface PlaylistCoverProps {
  playlist: BaseItemDto
  serverUrl?: string | null
  /** Requested image width in px (roughly the rendered size, not the CSS box) */
  maxWidth: number
  /** Classes for the box — applied to both the <img> and the placeholder */
  className?: string
  iconSize?: number
  /**
   * Item whose Primary image stands in when the playlist has no cover of its own
   * — normally the first track's album. Omitted where no track list is at hand.
   */
  fallbackItemId?: string | null
}

/**
 * A playlist's cover, with the one rule every call site has to follow.
 *
 * Jellyfin does NOT give every playlist a picture. The cover is a collage built
 * by `PlaylistImageProvider` during a metadata refresh, and a playlist that was
 * created or rewritten through the API (a generator plugin) may never have had
 * one generated — nor will one exist if none of its tracks has its own artwork.
 * For those, `GET /Items/{id}/Images/Primary` answers
 * `404 "<name> does not have an image of type Primary"`, which renders as a
 * broken image.
 *
 * `ImageTags.Primary` is the server's own signal for this: it is present only
 * when the item really has a Primary image. So request the image only when the
 * tag is there, fall back to a related item's artwork when one is offered, and
 * show the placeholder otherwise. `onError` covers the remaining case where the
 * tag is stale because the file went away behind our back.
 */
export const PlaylistCover = memo(function PlaylistCover({
  playlist,
  serverUrl,
  maxWidth,
  className = '',
  iconSize = 16,
  fallbackItemId,
}: PlaylistCoverProps) {
  const tag = playlist.ImageTags?.Primary
  const coverItemId = tag ? playlist.Id : fallbackItemId

  const src = serverUrl && coverItemId
    ? `${serverUrl}/Items/${coverItemId}/Images/Primary?maxWidth=${maxWidth}&quality=90` +
      // Only the playlist's own cover carries a tag we can trust here. The tag
      // buys strong caching AND busts it when the collage is regenerated.
      (tag && coverItemId === playlist.Id ? `&tag=${tag}` : '')
    : null

  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])

  if (!src || failed) {
    return (
      <div className={`bg-white/10 flex items-center justify-center ${className}`}>
        <ListMusic size={iconSize} className="text-white/40" />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={playlist.Name || 'Playlist'}
      className={`object-cover ${className}`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
})

export default PlaylistCover
