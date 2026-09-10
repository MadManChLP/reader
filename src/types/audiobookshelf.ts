// Audiobookshelf REST API types (subset used by the app)
// Reference: https://api.audiobookshelf.org/

export interface AbsLibrary {
  id: string
  name: string
  mediaType: 'book' | 'podcast'
  icon?: string
}

export interface AbsChapter {
  id: number
  start: number // seconds
  end: number   // seconds
  title: string
}

export interface AbsAudioFile {
  ino: string
  index: number
  duration: number
  mimeType?: string
  metadata: {
    filename: string
    ext: string
    size: number
  }
}

export interface AbsAuthorRef {
  id: string
  name: string
}

export interface AbsSeriesRef {
  id: string
  name: string
  sequence?: string | null
}

// From GET /api/libraries/{id}/series (and series-type personalized shelves)
export interface AbsSeries {
  id: string
  name: string
  nameIgnorePrefix?: string
  description?: string | null
  addedAt?: number
  totalDuration?: number
  books?: AbsLibraryItem[]
}

export interface AbsBookMetadata {
  title: string | null
  subtitle?: string | null
  // Expanded items have authorName/seriesName; minified ones have authors[]/series[]
  authorName?: string
  narratorName?: string
  seriesName?: string
  authors?: AbsAuthorRef[]
  // Array on expanded items; a single object on items filtered by series
  series?: AbsSeriesRef[] | AbsSeriesRef
  description?: string | null
  publishedYear?: string | null
  genres?: string[]
  language?: string | null
  explicit?: boolean
}

export interface AbsPodcastEpisode {
  id: string
  libraryItemId: string
  index?: number
  season?: string
  episode?: string
  title: string
  subtitle?: string
  description?: string
  publishedAt?: number  // ms epoch
  audioFile?: AbsAudioFile
  duration?: number
  size?: number
}

export interface AbsMedia {
  id?: string
  metadata: AbsBookMetadata
  coverPath?: string | null
  duration?: number
  numTracks?: number
  numAudioFiles?: number
  chapters?: AbsChapter[]
  audioFiles?: AbsAudioFile[]
  // Podcast-only
  episodes?: AbsPodcastEpisode[]
  numEpisodes?: number
  autoDownloadEpisodes?: boolean
}

export interface AbsLibraryItem {
  id: string
  libraryId: string
  folderId?: string
  path?: string
  mediaType: 'book' | 'podcast'
  media: AbsMedia
  addedAt: number
  updatedAt: number
}

export interface AbsAudioTrack {
  index: number
  startOffset: number // seconds from the start of the whole book
  duration: number
  contentUrl: string  // server-relative, needs ?token=
  mimeType: string
  title?: string
}

export interface AbsPlaybackSession {
  id: string
  userId: string
  libraryItemId: string
  episodeId?: string | null
  mediaType: string
  displayTitle?: string
  displayAuthor?: string
  coverPath?: string | null
  duration: number
  currentTime: number
  playMethod: number  // 0 = direct play, 1 = direct stream, 2 = transcode
  audioTracks: AbsAudioTrack[]
  chapters?: AbsChapter[]
  libraryItem?: AbsLibraryItem
}

export interface AbsMediaProgress {
  id: string
  libraryItemId: string
  episodeId?: string | null
  duration: number
  progress: number      // 0..1
  currentTime: number   // seconds
  isFinished: boolean
  lastUpdate: number    // ms epoch
}

export interface AbsUser {
  id: string
  username: string
  type?: string
  // Legacy ABS: long-lived JWT. New ABS (>=2.26): short-lived accessToken + refreshToken
  token?: string
  accessToken?: string
  refreshToken?: string
  mediaProgress?: AbsMediaProgress[]
}

// One shelf from GET /api/libraries/{id}/personalized
// entities are AbsLibraryItem[] for book/podcast shelves, AbsSeries[] for series shelves
export interface AbsShelf {
  id: string
  label: string
  type: 'book' | 'podcast' | 'episode' | 'series' | 'authors' | string
  entities: (AbsLibraryItem | AbsSeries)[]
}

export interface AbsSearchResult {
  book?: { libraryItem: AbsLibraryItem }[]
  podcast?: { libraryItem: AbsLibraryItem }[]
}
