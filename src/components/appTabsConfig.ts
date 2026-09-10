import { BookOpen, Tv, Music, Send, Headphones, type LucideIcon } from 'lucide-react'

export type AppTab = 'calibre' | 'jellyfin' | 'jellymusic' | 'requester' | 'livetv' | 'audiobookshelf'

// Shared app-switcher tab definitions — single source of truth for both the
// desktop pill row (AppTabs) and the phone bottom tab bar (BottomTabBar).
// Fixed order — tabs never shift around between views.
// Live TV has Icon: null — both bars render its pulsing accent dot inline.
export const APP_TABS: { id: AppTab; label: string; Icon: LucideIcon | null }[] = [
  { id: 'calibre', label: 'Calibre', Icon: BookOpen },
  { id: 'jellyfin', label: 'Jellyfin', Icon: Tv },
  { id: 'jellymusic', label: 'JellyMusic', Icon: Music },
  { id: 'requester', label: 'Requester', Icon: Send },
  { id: 'livetv', label: 'Live TV', Icon: null },
  { id: 'audiobookshelf', label: 'Audiobooks', Icon: Headphones },
]
