import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'

// Jellyfin creates "virtual" placeholder entries for episodes/seasons it knows
// about from metadata providers but that have no media file on the server
// (missing or unaired episodes, phantom "Specials"). The official web UI hides
// them by passing IsMissing=false on every episode query; plain getItems calls
// return them, which made ghost episodes appear in season lists and Up Next.
// Server-side we pass `isMissing: false`, this is the client-side backstop for
// endpoints without that parameter (e.g. /Shows/NextUp).
export function isRealItem(item: BaseItemDto): boolean {
  return item.LocationType !== 'Virtual'
}

// Specials live in "season 0" and therefore sort BEFORE season 1 when ordering
// by ParentIndexNumber — without this check they hijack "first episode" /
// "next episode" resolution at season boundaries.
export function isSpecial(item: BaseItemDto): boolean {
  return (item.ParentIndexNumber ?? 1) === 0
}
