import { useRequesterNav, OPEN_JELLYFIN_ITEM_EVENT } from '../../../stores/requesterNavStore'
import type { DiscoverItem, UpcomingItem } from '../../../types/requesterDiscover'

/** Open a discover/upcoming item: its detail page, or the Jellyfin tab for library items. */
export function openDiscoverItem(item: DiscoverItem | UpcomingItem) {
  const nav = useRequesterNav.getState()
  if (item.kind === 'jellyfin') {
    const d = item as DiscoverItem
    if (!d.jellyfin_id) return
    window.dispatchEvent(new CustomEvent(OPEN_JELLYFIN_ITEM_EVENT, {
      detail: { Id: d.jellyfin_id, Type: d.media_type || undefined, Name: d.title },
    }))
    return
  }
  if (item.kind === 'movie') {
    if (item.tmdb_id == null) return
    nav.push({ type: 'title', kind: 'movie', tmdbId: item.tmdb_id, title: item.title, poster: item.poster_url })
    return
  }
  if (item.slug) {
    nav.push({ type: 'title', kind: item.kind, slug: item.slug, title: item.title, poster: item.poster_url })
  }
}

/** Upcoming anime without a site slug yet can only be requested, not opened */
export function canOpen(item: DiscoverItem | UpcomingItem): boolean {
  if (item.kind === 'jellyfin') return !!(item as DiscoverItem).jellyfin_id
  if (item.kind === 'movie') return item.tmdb_id != null
  return !!item.slug
}
