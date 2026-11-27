import React, { useEffect, useState } from 'react'
import { Clapperboard, Tv2, Film, Youtube, Music, BookOpen, BookImage } from 'lucide-react'
import { AnimeSerieForm } from './forms/AnimeSerieForm'
import { MovieForm } from './forms/MovieForm'
import { YouTubeForm } from './forms/YouTubeForm'
import { MusicForm } from './forms/MusicForm'
import { BooksForm } from './forms/BooksForm'
import { useRequesterNav, type SearchMediaType } from '../../stores/requesterNavStore'

type MediaType = SearchMediaType

const TABS: { type: MediaType; label: string; icon: React.ReactNode }[] = [
  { type: 'anime', label: 'Anime', icon: <Clapperboard size={18} /> },
  { type: 'serie', label: 'Series', icon: <Tv2 size={18} /> },
  { type: 'movie', label: 'Movie', icon: <Film size={18} /> },
  { type: 'youtube', label: 'YouTube', icon: <Youtube size={18} /> },
  { type: 'music', label: 'Music', icon: <Music size={18} /> },
  { type: 'book', label: 'Books', icon: <BookOpen size={18} /> },
  { type: 'manga', label: 'Manga', icon: <BookImage size={18} /> },
]

const TAB_KEY = 'requesterSearchTab'

/** Search & request by type (the original request forms). */
export function SearchSection() {
  const [activeTab, setActiveTab] = useState<MediaType>(() => {
    try {
      const t = localStorage.getItem(TAB_KEY) as MediaType | null
      return t && TABS.some(x => x.type === t) ? t : 'anime'
    } catch { return 'anime' }
  })
  const [isWide, setIsWide] = useState(false)
  const prefill = useRequesterNav(s => s.searchPrefill)
  const consume = useRequesterNav(s => s.consumeSearchPrefill)
  // Bumped per prefill so the form remounts with the new query
  const [formKey, setFormKey] = useState(0)
  const [initialQuery, setInitialQuery] = useState<string | undefined>()

  useEffect(() => {
    if (!prefill) return
    setActiveTab(prefill.mediaType)
    setInitialQuery(prefill.query)
    setFormKey(k => k + 1)
    consume()
  }, [prefill, consume])

  const choose = (t: MediaType) => {
    setActiveTab(t)
    setIsWide(false)
    // A pre-filled query survives switching between Anime / Series / Movie
    try { localStorage.setItem(TAB_KEY, t) } catch { /* ignore */ }
  }

  const form = (() => {
    switch (activeTab) {
      case 'anime': return <AnimeSerieForm key={`a${formKey}`} type="anime" onExpand={setIsWide} initialQuery={initialQuery} />
      case 'serie': return <AnimeSerieForm key={`s${formKey}`} type="serie" onExpand={setIsWide} initialQuery={initialQuery} />
      case 'movie': return <MovieForm key={`m${formKey}`} initialQuery={initialQuery} />
      case 'youtube': return <YouTubeForm />
      case 'music': return <MusicForm key={`u${formKey}`} initialQuery={initialQuery} />
      case 'book': return <BooksForm key={`b${formKey}`} kind="book" initialQuery={initialQuery} />
      case 'manga': return <BooksForm key={`g${formKey}`} kind="manga" initialQuery={initialQuery} />
    }
  })()

  return (
    <div className={`mx-auto px-8 phone:px-4 py-6 space-y-6 transition-all duration-300 ${isWide ? 'max-w-5xl' : 'max-w-2xl'}`}>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
        {TABS.map(tab => {
          const isActive = activeTab === tab.type
          return (
            <button key={tab.type} onClick={() => choose(tab.type)}
              className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                isActive ? 'border-theme-500/50 bg-theme-500/10 text-theme-300' : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
              }`}>
              {tab.icon}
              <span className="font-medium">{tab.label}</span>
            </button>
          )
        })}
      </div>
      <div className="bg-white/5 border border-white/10 rounded-xl p-6 phone:p-4">{form}</div>
    </div>
  )
}
