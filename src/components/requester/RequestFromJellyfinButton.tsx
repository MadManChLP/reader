import React from 'react'
import { Send } from 'lucide-react'
import { useRequesterStore } from '../../stores/requesterStore'
import { openRequesterPage } from '../../stores/requesterNavStore'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client'

/**
 * "Request more seasons" on a Jellyfin series: opens the Requester's search
 * pre-filled with the title (Jellyfin has no aniworld/s.to slug, so the user
 * confirms the match). Anime is guessed from the genres; the search tab can
 * be switched with the query kept. Hidden without a requester session.
 */
export function RequestFromJellyfinButton({ item, className }: { item: BaseItemDto; className?: string }) {
  const connected = useRequesterStore(s => s.isAuthenticated)
  if (!connected || !item.Name) return null
  const isAnime = (item.Genres ?? []).some(g => /anime/i.test(g))
  return (
    <button type="button"
      onClick={() => openRequesterPage({ type: 'search', mediaType: isAnime ? 'anime' : 'serie', query: item.Name! })}
      title="Request missing seasons in the Requester"
      className={className ?? 'flex items-center gap-2 px-6 py-3 bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm rounded-lg font-semibold transition-colors'}>
      <Send size={18} />
      Request seasons
    </button>
  )
}
