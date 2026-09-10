# Project: Calibre-Web Offline Reader (Desktop App)

## Overview
A modern desktop frontend application for Calibre-Web, Jellyfin (video), and JellyMusic (audio). It focuses on seamless reading/viewing/listening, offline capability, and robust synchronization with either a custom JWT-based Sync Server or Calibre-Web-Automated (CWA) via the KoReader protocol.

**Three Main Clients:**
1. **Calibre** - eBook reader with OPDS integration
2. **Jellyfin** - Video streaming client (movies, TV shows)
3. **JellyMusic** - Music streaming client (Spotify/Feishin-style interface)

## Tech Stack

### Frontend (Desktop App)
- **Runtime:** Tauri v2 (Rust) + Vite + React + TypeScript. (Electron still supported for legacy)
- **Styling:** Tailwind CSS + Lucide React (Icons).
- **State Management:** Zustand (for music player state).
- **Layout:** Custom single-page **Dashboard** with app switching.
- **Reader Engines:** `epub.js` (EPUB), Custom Manga View (Images), `react-pdf` (PDF).
- **Music Player:** HTML5 Audio with Zustand store for queue/playback state.
- **Network:** Unified API abstraction (`src/utils/api.ts`) supporting both Tauri and Electron backends.
- **Security:** SSL verification disabled for self-signed certificates (Rust: `danger_accept_invalid_certs`, Electron: `NODE_TLS_REJECT_UNAUTHORIZED`).

### Backend (Sync & Library)
- **Primary Source:** Calibre-Web (via OPDS feed, proxied through Sync API).
- **Media Source:** Jellyfin (via official SDK `@jellyfin/sdk`).
- **Sync API:** Unified Calibre-Web Sync API (FastAPI microservice, port 8787) — single URL + JWT auth for everything:
    - Proxies OPDS feeds from Calibre-Web (client never talks to Calibre-Web directly)
    - Reading progress sync (per-book per-format) via PostgreSQL
    - Read status sync (per-book)
    - Started books listing
    - Auth: `POST /api/login` → JWT token, then `Bearer {token}` on all requests
    - Server code in `calibre-web_API/` with its own `CLAUDE.md`
- **User Management:** Integrated with LDAP/Active Directory - **Unified credentials** for Calibre-Web, Jellyfin, and JellyMusic.

## `reverence/` — Reference Material (all agents)

`reverence/` is a gitignored scratch area for **read-only** reference material. Any agent working on
this project may use it at any time to:
- Clone upstream repos to check APIs against real source (e.g. `reverence/jellyfin-12.0/`,
  Audiobookshelf, Feishin, Blink)
- Park HTML pages, API dumps, release notes, or anything else useful to have on hand temporarily

**Never** import from, build, or edit anything under `reverence/` — it is lookup material only, and
it is not part of the app. Prefer checking a claim against the source in `reverence/` over guessing.

## Jellyfin API: Authentication (12.0+) — DO NOT REGRESS

Jellyfin 12.0 ships `EnableLegacyAuthorization = false` (a migration force-disables it on upgrade,
and it defaults to `false` on fresh installs). The legacy auth mechanisms are **dead**:

| ❌ Never use (legacy, ignored by 12.0) | ✅ Use instead |
|---|---|
| `X-Emby-Authorization` header | `Authorization` header |
| `X-Emby-Token`, `X-MediaBrowser-Token` headers | `Authorization` header |
| `Emby ...` auth scheme | `MediaBrowser ...` scheme |
| `?api_key=<token>` query param | `?ApiKey=<token>` query param |
| `/emby/*`, `/mediabrowser/*` route prefixes | unprefixed routes |

```typescript
// Header auth (hand-rolled fetch / appApi.request)
headers: { 'Authorization': `MediaBrowser Token="${accessToken}"` }

// URL auth (stream/image/subtitle/trickplay URLs the <video>/<img> element loads itself)
`${serverUrl}/Videos/${id}/master.m3u8?ApiKey=${accessToken}`
```

Both forms are also accepted by Jellyfin 10.x, so this is backward compatible — there is never a
reason to reach for the legacy spellings. `@jellyfin/sdk` already emits the correct `Authorization`
header, so SDK-based calls are fine; only hand-rolled requests need care.

**Routes that take the user from the token** (use these; do not build `/Users/<id>/...` URLs when
you don't have a real user GUID — `current` is not a valid userId):
- `POST|DELETE /UserPlayedItems/{itemId}` (not `/Users/{userId}/PlayedItems/{itemId}`)
- `POST /LiveStreams/Open` (there is no `/LiveTv/LiveStreamings/Open`)

**Playlists:** read a playlist's contents with `GET /Playlists/{playlistId}/Items`
(`getPlaylistsApi(api).getPlaylistItems(...)`), never `getItems({ parentId: playlistId })`. Only that
route returns the playlist's live linked children **in playlist order** (and fills `PlaylistItemId`);
the generic item query needs a `sortBy` and therefore loses the order.

**Playlist covers: not every playlist has one.** The cover is a collage `PlaylistImageProvider`
builds during a metadata refresh; a playlist created/rewritten through the API (a generator plugin)
may never get one, and none is built if no track has its own artwork. `GET
/Items/{id}/Images/Primary` then answers `404 "<name> does not have an image of type Primary"` —
a broken `<img>`. `ImageTags.Primary` is the server's signal: **request a playlist image only when
that tag is present**, and render a placeholder (or a related item's art) otherwise. Use
`music/PlaylistCover.tsx`, which encodes this rule; don't hand-build playlist image URLs.
`&tag=${ImageTags.Primary}` is a *caching hint only* (`ImageController` uses it solely to set a
365-day `Cache-Control`; it never selects or validates the image), so it busts the cache when the
collage is regenerated but can never fix — or cause — a 404.

**Trickplay:** there is no `GET /Videos/{id}/Trickplay` endpoint. The manifest is on the item DTO as
`Trickplay: { [mediaSourceId]: { [width]: TrickplayInfoDto } }`, returned by `GET /Items/{itemId}`.
Tiles are served from `GET /Videos/{itemId}/Trickplay/{width}/{index}.jpg`.

## Key Technical Implementations

### 1. App Switching (Three Clients)
- **View States:** `'dashboard' | 'category' | 'settings' | 'details' | 'jellyfin' | 'jellymusic'`
- **Navigation Bar:** Two buttons in Calibre view to switch to Jellyfin or JellyMusic
- **Each client is independent** with its own provider and state management

### 2. Dashboard Layout (Calibre)
- **AppBar (Top Left):** Navigation controls (Home, Read Books, Settings) + Jellyfin/JellyMusic switch buttons.
- **Hero Carousel:** Displays random books with blurred backdrop.
- **Section Rows:** Horizontal scrolling lists for Continue Reading, Libraries, Recently Added.
- **Book Cards:** Unified card with lazy loading, hover actions, status overlays.

### 3. Jellyfin Client (Video)
- **Home View:** Hero slideshow with sections in order:
    1. Libraries (with actual library images, music filtered out)
    2. Continue Watching (resume partially watched)
    3. Up Next (next unwatched episodes from started series)
    4. Latest Movies (unwatched only)
    5. Latest Episodes per library (unwatched only)
- **Navigation:** History stack for proper back navigation (library → item → back returns to library).
- **Item Details:** Detailed views for Movies, Series, Seasons, and Episodes.
- **Libraries:** Compact cards (w-28 h-16) with actual Jellyfin library images.
- **Music Button:** Quick switch to JellyMusic from the top bar.

#### JellyfinPlayer Features (Blink-style UX)
- **Playback Session Lifecycle:** Proper Jellyfin sync with:
  - `reportPlaybackStart` on first play (includes PlaySessionId, MediaSourceId, PlayMethod)
  - `reportPlaybackProgress` every 10 seconds with full session data
  - `reportPlaybackStopped` on unmount (not just progress report)
- **Controls:**
  - Single click = pause/play (200ms delay), Double click = fullscreen
  - Skip ±10s buttons, volume slider, fullscreen toggle
  - Mouse wheel = volume control (±5%)
- **Keyboard Shortcuts:** Space/K (play/pause), Arrow Left/Right (seek ±10s), Arrow Up/Down (volume), M (mute), F (fullscreen), Escape (exit), I (stats)
- **Episode Queue:** Queue panel for TV shows, "Up Next" dialog 2min before end
- **Audio Track Switching:** Forces HLS transcoding to switch embedded audio tracks
- **Subtitle Support:** External VTT/SRT via `<track>` element, styled with text-shadow
- **Trickplay:** Preview thumbnails on progress bar hover (if server provides)
- **MediaSession API:** Hardware media button support (play/pause/seek)
- **Stats for Nerds:** Press 'i' or click Info button - shows resolution, codecs, play method, buffer, frames
- **PlayMethod Types:** `DirectPlay` | `DirectStream` | `Transcode` (color-coded in stats)

### 4. JellyMusic Client (Audio) - Spotify/Feishin Style

#### Layout Architecture
```
┌─────────────────────────────────────────────────────────────────────┐
│                     Top Bar (h-14)                                   │
│  [Calibre] [Jellyfin]  |  JellyMusic - ServerName     [User] [⚙] [↪]│
├──────────────┬────────────────────────────────────────┬─────────────┤
│              │                                        │             │
│  MusicSidebar│         Main Content Area              │  MusicQueue │
│  (w-56)      │         (scrollable)                   │  (drawer)   │
│              │                                        │             │
│  • Home      │  ┌──────────────────────────────────┐  │  Now Playing│
│  • Search    │  │  MusicHome / AlbumGrid /         │  │  Queue List │
│  ────────────│  │  AlbumDetails / ArtistView /     │  │             │
│  Your Library│  │  PlaylistView / Search /         │  │             │
│    Albums    │  │  GenreDetails                    │  │             │
│    Artists   │  └──────────────────────────────────┘  │             │
│    Downloads │                                        │             │
│  ────────────│                                        │             │
│  Playlists   │                                        │             │
│    [List...] │                                        │             │
│              │                                        │             │
├──────────────┴────────────────────────────────────────┴─────────────┤
│                     MusicPlayerBar (h-[72px])                        │
│  [Cover] Title - Artist    ◀◀ ▶ ▶▶   ━━━●━━━━━━  3:42/5:30   🔀 🔁 🔊│
└─────────────────────────────────────────────────────────────────────┘
```

#### Music View Types
```typescript
type MusicViewType =
  | { type: 'home' }
  | { type: 'search' }
  | { type: 'albums' }
  | { type: 'artists' }
  | { type: 'playlists' }
  | { type: 'downloads' }
  | { type: 'album-details'; album: BaseItemDto }
  | { type: 'artist-details'; artist: BaseItemDto }
  | { type: 'playlist-details'; playlist: BaseItemDto }
  | { type: 'genre-details'; genre: BaseItemDto }
```

#### MusicHome Sections (in order)
1. **Genres** - Color-coded genre cards (navigates to genre details)
2. **Recently Played** - Albums sorted by DatePlayed
3. **Most Played** - Albums sorted by PlayCount
4. **Favorite Albums** - Albums with IsFavorite filter
5. **Newly Added** - Albums sorted by DateCreated
6. **Recently Released** - Albums from last 2 years (ProductionYear)
7. **Explore Your Library** - Random albums for discovery

#### Music Player State (Zustand Store)
```typescript
// src/stores/musicPlayerStore.ts
interface Track {
  id: string
  name: string
  artists: string[]
  artistIds: string[]
  albumId: string
  albumName: string
  duration: number      // ticks (100ns units)
  indexNumber?: number | null
  imageUrl?: string
}

interface MusicPlayerState {
  // Playback
  currentTrack: Track | null
  isPlaying: boolean
  currentTime: number   // seconds
  duration: number      // seconds
  volume: number        // 0-1
  isMuted: boolean

  // Queue
  queue: Track[]
  queueIndex: number
  originalQueue: Track[]  // For unshuffle

  // Modes
  shuffleMode: boolean
  repeatMode: 'off' | 'all' | 'one'

  // UI state
  isQueueOpen: boolean
  audioRef: HTMLAudioElement | null

  // Actions
  play, pause, toggle, next, previous, seek
  setVolume, toggleMute, toggleShuffle, cycleRepeat
  setQueue, addToQueue, removeFromQueue, reorderQueue, clearQueue
  playTrackAtIndex, toggleQueueOpen
}
```

#### Jellyfin Music API Endpoints
```typescript
// Get music libraries
getUserViews({ userId }).filter(v => v.CollectionType === 'music')

// Get albums
getItems({
  userId, parentId: musicLibraryId,
  includeItemTypes: ['MusicAlbum'],
  sortBy: ['SortName' | 'DatePlayed' | 'PlayCount' | 'DateCreated' | 'ProductionYear' | 'Random'],
  recursive: true
})

// Get album tracks
getItems({
  userId, parentId: albumId,
  includeItemTypes: ['Audio'],
  sortBy: ['IndexNumber']
})

// Get artists
getArtists({ userId, parentId: musicLibraryId })

// Get artist albums
getItems({
  userId, albumArtistIds: [artistId],
  includeItemTypes: ['MusicAlbum']
})

// Get playlists
getItems({
  userId, includeItemTypes: ['Playlist'],
  recursive: true
}).filter(p => p.MediaType === 'Audio')

// Get genres
getItems({
  userId, parentId: libraryId,
  includeItemTypes: ['MusicGenre'],
  recursive: true
})

// Audio stream URL
`${serverUrl}/Audio/${itemId}/universal?api_key=${token}&container=mp3,flac,aac,opus,webm`
```

#### Jellyfin Video Playback API
```typescript
// Get playback info (returns PlaySessionId, MediaSources, TranscodingUrl)
POST /Items/{itemId}/PlaybackInfo?userId={userId}
Body: { DeviceProfile, EnableDirectPlay, EnableTranscoding, ... }

// Playback session reporting (1 tick = 100ns, 1 second = 10,000,000 ticks)
POST /Sessions/Playing              // reportPlaybackStart
POST /Sessions/Playing/Progress     // reportPlaybackProgress (every 10s)
POST /Sessions/Playing/Stopped      // reportPlaybackStopped

// Report body
{
  ItemId, MediaSourceId, PlaySessionId, PositionTicks,
  VolumeLevel, IsMuted, IsPaused, PlayMethod, RepeatMode
}

// Video stream URLs
Direct: `${serverUrl}/Videos/{itemId}/stream.{container}?Static=true&mediaSourceId={id}&api_key={token}`
HLS:    `${serverUrl}/Videos/{itemId}/master.m3u8?AudioStreamIndex={idx}&api_key={token}`
Transcode: Use TranscodingUrl from PlaybackInfo response
```

### 5. Unified Settings (Standalone View)
- **Separate Top-Level View:** Settings is its own view (`view === 'settings'`), not embedded in Calibre.
- **Own Nav Bar:** Back arrow (returns to `previousView`), "Settings" label, Search button, Home button (goes to `defaultStartPage`).
- **`SettingsContent` Component:** Standalone component using stores directly, renders all sections.
- **`openSettings()` Callback:** Saves current view to `previousView` before switching to settings.
- **Single Settings View:** Combined configuration for Calibre, Jellyfin, and JellyMusic.
- **Credentials Section:** Shared LDAP/AD credentials used for all services.
- **Multi-Server Support:** Connect to multiple Jellyfin servers and switch between them.
- **Quick Launch Buttons:** Open Jellyfin or JellyMusic directly from settings.

### 6. API Abstraction (Tauri Migration)
- **Unified Interface:** `src/utils/api.ts` provides consistent API for both Tauri and Electron.
- **Tauri Backend:** Rust commands in `src-tauri/src/commands/` for filesystem, HTTP, dialogs.
- **Image Optimization:**
    - `LazyImage` component with Intersection Observer (200px rootMargin, click-to-retry on error)
    - Request queue limiting concurrent fetches to 6
    - Deduplication of identical requests + automatic retry with 500ms delay
    - Proper MIME type detection from base64 magic bytes for blob URLs
    - Ref-counted blob URLs via `releaseImage()` (not `URL.revokeObjectURL` directly)
    - **Auth headers stored in `useRef`** to prevent effect re-runs on parent re-renders
    - Lower quality images (80%) for grid views
- **Custom Protocol:** `book-file://` for serving local files to WebView.

### 7. Reading Progress & Sync
- **Idle Detection:** Controls fade after 3s inactivity.
- **Sync Logic:** Push on page turn, pull on book open, merge by timestamp.
- **Offline Support:** Rich metadata cached to localStorage, downloaded books playable offline.

### 8. Performance Optimizations
- **React.memo** on heavy components: `AlbumCard`, `ArtistCard`, `MusicPlayerBar`, `MusicSidebar`, `MusicHome`, `MusicTrackRow`
- **Parallel Section Loading:** Each MusicHome section loads independently with skeleton loaders
- **Image Lazy Loading:** `loading="lazy"` and `decoding="async"` on all images
- **Lower Quality Images:** 80% quality, smaller maxWidth for grid views
- **Zustand Store:** Efficient state updates without unnecessary re-renders

## Important Files

### Core Application
- `src/App.tsx`: Main application, dashboard, sync handlers, app switching (dashboard/jellyfin/jellymusic).
- `src/types/settings.ts`: Unified settings types and helpers.
- `src/utils/api.ts`: Unified API abstraction (Tauri/Electron).
- `src/utils/tauriApi.ts`: Tauri-specific implementation.
- `src/utils/electronApi.ts`: Electron-specific implementation.
- `src/utils/coverCache.ts`: Cover image caching logic.
- `src/utils/requestQueue.ts`: Concurrent request limiting.

### State Management (Zustand Stores)
- `src/stores/index.ts`: Exports all stores.
- `src/stores/settingsStore.ts`: App settings, credentials, Jellyfin servers, sync token.
- `src/stores/libraryStore.ts`: Library state, books, OPDS parsing, sync logic.
- `src/stores/musicPlayerStore.ts`: Music playback, queue, shuffle/repeat modes.
- `src/stores/playbackStore.ts`: Video playback state (adapted from Blink) — media source, play session, subtitle/audio tracks, segments, volume indicator, player ref actions.

### Components (Calibre)
- `src/components/LazyImage.tsx`: Lazy loading image with queue + framer-motion fade-in.
- `src/components/BookCard.tsx`, `HeroCarousel.tsx`, `SectionRow.tsx`: Dashboard UI.
- `src/components/Reader.tsx`: EPUB/PDF/Manga reader (lazy loaded).
- `src/components/BookDetails.tsx`: Book details view.
- `src/components/GlobalSearch.tsx`: Unified search modal (Ctrl+K) for books, movies, music.

### Jellyfin Components (Video)
- `src/components/jellyfin/JellyfinView.tsx`: Main container with navigation history stack.
- `src/components/jellyfin/JellyfinHome.tsx`: Home view with hero, libraries, up next, latest content.
- `src/components/jellyfin/JellyfinLibrary.tsx`: Library grid view.
- `src/components/jellyfin/JellyfinContext.tsx`: Auth, API context, shared credentials support.
- `src/components/jellyfin/JellyfinSetup.tsx`: Server connection with shared credentials option.
- `src/components/jellyfin/JellyfinItemDetails.tsx`: Movie/Series/Season/Episode details views.
- `src/components/jellyfin/JellyfinOfflineLibrary.tsx`: Offline downloads management.
- `src/components/jellyfin/ScrollSection.tsx`: Reusable horizontal scroll section.
- `src/components/jellyfin/index.ts`: Exports for Jellyfin components.

### Jellyfin Player (Decomposed - `src/components/jellyfin/player/`)
- `player/JellyfinPlayer.tsx`: Main player — all logic (playback info, session lifecycle, media segments, intro detection, keyboard shortcuts, auto-hide, MediaSession API). Composes sub-components for UI.
- `player/PlayerControls.tsx`: Controls overlay — assembles buttons, progress bar, volume, chapters, settings menu.
- `player/ProgressSlider.tsx`: Smooth progress bar with pointer capture dragging, trickplay thumbnails, chapter markers, buffer indicator.
- `player/VolumeControl.tsx`: Animated expand-on-hover volume slider.
- `player/VolumeOverlay.tsx`: Glassmorphic center-screen volume indicator (mouse wheel).
- `player/EndsAtDisplay.tsx`: "Ends at HH:MM" wall-clock display.
- `player/SettingsMenu.tsx`: Audio/subtitle track selection + stats toggle.
- `player/StatsForNerds.tsx`: Video stats panel (resolution, codecs, play method, buffer, frames).
- `player/SkipIntroButton.tsx`: Spring-animated skip intro button (from MediaSegments API).
- `player/UpNextFlyout.tsx`: Glassmorphic up-next episode card.
- `player/ChapterList.tsx`: Chapter list dropdown.
- `player/QueuePanel.tsx`: Episode queue side panel.
- `player/ErrorDisplay.tsx`: Error overlay with retry.
- `player/LoadingIndicator.tsx`: Loading spinner.
- `player/types.ts`: Shared types (MediaStream, Chapter, MediaSource, PlayMethod, TrickplayInfo), helpers (formatTime, getTrackDisplayName, detectCodecCapabilities).
- `player/buttons/`: PlayPauseButton, SeekButtons, ChapterButtons, SkipEpisodeButtons, FullscreenButton, CaptionsButton, PictureInPictureButton.
- `player/index.ts`: Barrel exports.

### JellyMusic Components (Audio)
- `src/components/jellyfin/music/JellyMusicView.tsx`: **Standalone music client** with JellyfinProvider.
- `src/components/jellyfin/music/MusicView.tsx`: Music view embedded in JellyfinView (legacy).
- `src/components/jellyfin/music/MusicSidebar.tsx`: Left navigation with playlists.
- `src/components/jellyfin/music/MusicPlayerBar.tsx`: Bottom persistent player bar.
- `src/components/jellyfin/music/MusicHome.tsx`: Home with genre/recent/favorites/discovery sections.
- `src/components/jellyfin/music/MusicAlbumGrid.tsx`: Album library grid with search/sort.
- `src/components/jellyfin/music/MusicAlbumDetails.tsx`: Album detail with track list.
- `src/components/jellyfin/music/MusicArtistGrid.tsx`: Artist library grid.
- `src/components/jellyfin/music/MusicArtistDetails.tsx`: Artist page with discography.
- `src/components/jellyfin/music/MusicPlaylistDetails.tsx`: Playlist track list view.
- `src/components/jellyfin/music/MusicGenreDetails.tsx`: Genre albums view.
- `src/components/jellyfin/music/MusicSearch.tsx`: Search across artists/albums/tracks.
- `src/components/jellyfin/music/MusicQueue.tsx`: Slide-out queue drawer with drag reorder.
- `src/components/jellyfin/music/MusicTrackRow.tsx`: Reusable track row component.
- `src/components/jellyfin/music/components/AlbumCard.tsx`: Album card with play overlay.
- `src/components/jellyfin/music/components/ArtistCard.tsx`: Artist circular card.
- `src/components/jellyfin/music/index.ts`: Exports for music components.

### Tauri Backend
- `src-tauri/src/main.rs`: Entry point, book-file:// protocol handler.
- `src-tauri/src/commands/filesystem.rs`: File operations.
- `src-tauri/src/commands/http.rs`: HTTP client with cookies and SSL bypass.
- `src-tauri/src/commands/dialog.rs`: Native dialogs.
- `src-tauri/src/commands/window.rs`: Window controls.
- `src-tauri/Cargo.toml`: Rust dependencies.
- `src-tauri/tauri.conf.json`: Tauri configuration.

### Electron Backend (Legacy)
- `electron/main.ts`: Main process, IPC handlers.
- `electron/preload.ts`: Context bridge API.

## Build Commands

```bash
# Development
npm run dev              # Electron dev
npm run tauri:dev        # Tauri dev

# Production
npm run electron:build   # Electron build
npm run tauri:build      # Tauri build

# Build Scripts (recommended)
./build-windows.bat      # Windows CMD (checks toolchain)
./build-windows.ps1      # Windows PowerShell (with MSVC guidance)
./build-linux.sh         # Linux/macOS

# Type checking
npx tsc --noEmit
```

### Windows Build Requirements
- Node.js, Rust with **MSVC toolchain** (not GNU)
- Visual Studio Build Tools with "Desktop development with C++"
- Switch toolchain: `rustup default stable-x86_64-pc-windows-msvc`

## Dependencies

### Key NPM Packages
- `@jellyfin/sdk`: Official Jellyfin API SDK
- `zustand`: Lightweight state management (settings, library, music player)
- `zustand/shallow`: **Required** for object selectors (prevents infinite re-render loops)
- `epub.js`: EPUB reader
- `react-pdf`: PDF viewer
- `lucide-react`: Icon library
- `tailwindcss`: Utility-first CSS
- `framer-motion`: Animations (image fade-in)
- `react-virtuoso`: Virtualized lists/grids (JellyfinLibrary)

## Current Session Status (2026-02-27) — UI Improvements, Player Decomposition & Cover Fix

### Completed This Session
1. **Removed UpNextSection from Calibre dashboard** — Calibre tab focuses on reading only
2. **Fixed cover image loading** — Multiple fixes:
    - Increased concurrency (4→6), auto-retry, MIME detection, ref-counted blobs, click-to-retry
    - **Cover URL fix:** Changed from `/api/books/{id}/cover` to `/opds/cover/{id}` — the OPDS proxy route that serves JPEG covers from Calibre-Web
    - **Auth header stability:** `getAuthHeader()` created new objects every render, causing `LazyImage`/`HeroCarousel` effects to re-run and revoke blob URLs mid-load. Fixed with `useRef` for auth headers in components + `useMemo` in App.tsx
    - **Stale cached URLs:** Local progress data in localStorage had old `/api/books/{id}/cover` URLs. Now always reconstructs correct OPDS cover URL from calibreId
    - Added `[ImageQueue]` console warnings for failed cover fetches (debugging)
3. **Separated settings from Calibre tab** — Own top-level view with dedicated nav bar, `previousView` tracking
4. **Decomposed JellyfinPlayer** — From 2921-line monolith to 23 files in `src/components/jellyfin/player/`
5. **Created playbackStore** — `src/stores/playbackStore.ts` (Zustand, adapted from Blink)

### Previous Session (2026-02-26) — Calibre-Web Sync API Migration (COMPLETE)

**Completed:**
1. `src/types/settings.ts` — Removed `syncUrl`, single `url` field for API server
2. `src/stores/settingsStore.ts` — `getAuthHeader()` returns Bearer JWT token
3. `src/utils/syncServerApi.ts` — Rewritten for new API endpoints
4. `src/stores/libraryStore.ts` — Updated all sync calls, login, health checks, OPDS URLs
5. `src/App.tsx` — Removed syncUrl, single apiUrl, updated all handler signatures
6. Settings UI — Removed "Sync Server URL" input, single "API Server URL" field

**Pending / needs testing:**
- Verify duplicate fix works (calibreId-based merge in `loadStartedBooks`)
- Verify "Unknown Book" titles are resolved (enrichment via `/api/books/{id}` + local metadata preservation)
- Debug logging is still active in libraryStore.ts, syncServerApi.ts, Reader.tsx — remove after issues confirmed fixed
- Old cached progress values for PDF may be percentages (e.g. `"0.204..."`) instead of page numbers — fresh page turns send correct page numbers

### Key API Mappings (Calibre-Web Sync API)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/login` | POST | Auth (username + password) → `{token}` |
| `/api/books` | GET | List books (OPDS proxy) |
| `/api/books/started` | GET | In-progress books → `{book_id, format, position, updated_at}` |
| `/api/books/{id}` | GET | Book details (title, authors, formats) |
| `/opds/cover/{id}` | GET | Cover image (JPEG, proxied from Calibre-Web OPDS) |
| `/api/books/{id}/progress` | GET | Reading position (`?format=PDF`) |
| `/api/books/{id}/progress` | PUT | Set position (`{position, format}`) |
| `/api/books/{id}/read-status` | GET | Read/unread status |
| `/api/books/{id}/read-status` | PUT | Set status (`{read: bool}`) |
| `/opds/{path}` | GET | Raw OPDS XML passthrough |
| `/opds/download/{id}/{fmt}/` | GET | Book file download |

**Progress format:** PDF/comics = page number string (`"42"`), EPUB = CFI string (`"epubcfi(...)"`)
**PDF is DB-only:** Not synced with Calibre-Web bookmarks (unlike comics CBZ/CBR/CBT which sync bidirectionally)

### Two ID Systems (Important!)
- **OPDS ID** (`urn:uuid:5e512111-...`): Used as local book `id` in localStorage/IndexedDB
- **Calibre ID** (`"1826"`): Numeric ID used by server API, stored as `calibreId` on Book objects
- `calibreId` is extracted from OPDS `<link>` download URLs (pattern `/download/(\d+)/`)
- Merge logic in `loadStartedBooks` must cross-reference both ID systems

### OPDS URL Rewriting
- Calibre-Web returns absolute URLs in OPDS XML pointing to its own host
- `parseOpds()` in libraryStore.ts rewrites all acquisition/cover URLs to go through the API server
- Pattern: replace hostname with API server hostname, keep path intact
- Cover images use OPDS cover URL (`/opds/cover/{id}`), NOT `/api/books/{id}/cover`
- `loadStartedBooks` constructs cover URLs as `${baseUrl}/opds/cover/${calibreId}` for server-fetched books
- Old cached data may have stale URLs — `handleRead` and `loadStartedBooks` fix these at runtime

---

## Previous Session Status (2026-02-12)

### Architecture: Zustand State Management

The app uses **Zustand** for global state management. Three stores exist:

#### 1. `src/stores/settingsStore.ts`
- All app settings (credentials, calibreWeb, jellyfinServers, downloadPath, defaultStartPage)
- Sync token management
- Jellyfin server CRUD operations
- `getAuthHeader()` returns `{ Authorization: 'Bearer ${syncToken}' }` (JWT from Sync API login)

#### 2. `src/stores/libraryStore.ts`
- Book lists (localBooks, heroBooks, recentBooks, startedBooks, remoteBooks)
- Online/offline status, authentication state
- OPDS feed parsing, sync logic
- Progress tracking with `startedBooksIndex` for O(1) lookups

#### 3. `src/stores/musicPlayerStore.ts`
- Music playback state, queue management
- Shuffle/repeat modes

**CRITICAL: useShallow for Object Selectors**
```typescript
// WRONG - causes infinite re-render loop!
const settings = useSettingsStore((state) => ({
  credentials: state.credentials,
  calibreWeb: state.calibreWeb,
}))

// CORRECT - use useShallow for object selectors
import { useShallow } from 'zustand/shallow'
const settings = useSettingsStore(useShallow((state) => ({
  credentials: state.credentials,
  calibreWeb: state.calibreWeb,
})))
```
Zustand uses reference equality. Object literals `{...}` create new objects on every render, causing infinite loops. `useShallow` performs shallow comparison instead.

### JellyfinPlayer Critical Architecture

The video player is decomposed into sub-components in `src/components/jellyfin/player/`. The main logic lives in `player/JellyfinPlayer.tsx`. **DO NOT MODIFY** without understanding these patterns:

#### Two-Effect Pattern (Prevents Race Conditions)
```typescript
// EFFECT 1: Video Source Management - ONLY depends on [videoUrl]
useEffect(() => {
  if (!video || !videoUrl) return
  if (video.src === videoUrl) return  // Guard: prevent reset loop

  hasResumedRef.current = false  // Reset for new video
  video.src = videoUrl
  video.load()
}, [videoUrl])

// EFFECT 2: Event Listeners - depends on [videoUrl] to re-attach when ready
useEffect(() => {
  if (!video) return

  // Attach all event listeners
  video.addEventListener('loadedmetadata', handleLoadedMetadata)
  // ... other listeners

  return () => {
    // Cleanup
    video.removeEventListener('loadedmetadata', handleLoadedMetadata)
  }
}, [videoUrl])  // Re-attach when video becomes available
```

#### Essential Refs (Avoid Stale Closures)
```typescript
// Track resume position for event handlers
const effectiveResumePositionRef = useRef<number>(0)
effectiveResumePositionRef.current = effectiveResumePosition  // Keep in sync

// Track if resume has been applied
const hasResumedRef = useRef(false)

// Prevent double initialization
const lastInitializedItemIdRef = useRef<string | null>(null)

// For next episode handling in event callbacks
const nextEpisodeRef = useRef(nextEpisode)
const onPlayNextRef = useRef(onPlayNext)
```

#### Video Element Must Always Render
```typescript
// WRONG - causes event listeners to never attach
if (!videoUrl) {
  return <div>Loading...</div>  // No video element!
}

// CORRECT - always render video, show loading overlay
const isVideoReady = !!videoUrl
return (
  <div>
    <video ref={videoRef} ... />
    {(isLoading || !isVideoReady) && <LoadingSpinner />}
  </div>
)
```

#### Controls Auto-Hide Pattern
```typescript
useEffect(() => {
  const startHideTimer = () => {
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false)
    }, 3000)
  }

  container.addEventListener('mousemove', handleMouseMove)  // Show + restart timer
  container.addEventListener('mouseleave', handleMouseLeave)  // Hide immediately
  container.addEventListener('mouseenter', handleMouseEnter)  // Show + start timer

  if (isPlaying) startHideTimer()  // Start on mount if playing
}, [isPlaying])
```

### Performance Optimizations (2026-02-06)

1. **Lazy Loading Reader** (`src/App.tsx`):
   ```typescript
   const Reader = lazy(() => import('./components/Reader'))
   // Wrapped in <Suspense> with loading spinner
   ```

2. **LazyImage Fade-In** (`src/components/LazyImage.tsx`):
   ```typescript
   import { motion } from 'framer-motion'
   <motion.img
     initial={{ opacity: 0 }}
     animate={{ opacity: 1 }}
     transition={{ duration: 0.3 }}
   />
   ```

3. **Virtualized Library** (`src/components/jellyfin/JellyfinLibrary.tsx`):
   ```typescript
   import { VirtuosoGrid } from 'react-virtuoso'
   <VirtuosoGrid
     totalCount={items.length}
     overscan={200}
     components={{
       List: forwardRef((props, ref) => (
         <div ref={ref} className="grid grid-cols-3 sm:grid-cols-4 ..." {...props} />
       ))
     }}
     itemContent={(index) => <LibraryItemCard item={items[index]} />}
   />
   ```

### New Features (2026-02-06)

#### Global Search (`src/components/GlobalSearch.tsx`)
- **Trigger:** `Ctrl+K` / `Cmd+K` or click search button in nav
- **Searches:** Local books, Jellyfin movies/series, Jellyfin music
- **API:** Uses Jellyfin `/Search/Hints` endpoint
- **Debounced:** 350ms delay before querying
- **Results:** Grouped by type (Books, Movies/TV, Music)

### Bug Fixes Reference

#### sendBeacon → fetch with keepalive
**Problem:** `navigator.sendBeacon` cannot send custom headers (401 error with Jellyfin)
**Solution:** Use `fetch()` with `{ keepalive: true }` option
```typescript
// In cleanup/unmount
fetch(`${serverUrl}/Sessions/Playing/Stopped`, {
  method: 'POST',
  headers: { 'X-Emby-Authorization': `MediaBrowser Token="${token}"` },
  body: JSON.stringify(data),
  keepalive: true,  // Ensures request completes after unmount
})
```

#### Trickplay 404 Silence
**Problem:** Console flooded with 404 errors for media without trickplay thumbnails
**Solution:** Silently catch errors, no console output
```typescript
try {
  const response = await fetch(trickplayUrl)
  if (!response.ok) return  // Silent return on 404
  // ... process trickplay
} catch {
  // Silent - trickplay not available
}
```

#### Streaming Downloads (Rust)
**Problem:** Large file downloads caused OOM (loading entire file into RAM)
**Solution:** Stream directly to disk using `bytes_stream()`
```rust
// src-tauri/src/commands/filesystem.rs
let mut stream = response.bytes_stream();
while let Some(chunk) = stream.next().await {
  file.write_all(&chunk).await?;
}
```

### Completed Features
- **JellyfinPlayer Enhancements (Blink-style UX):**
    1. Proper playback session lifecycle (reportPlaybackStart/Progress/Stopped)
    2. PlaySessionId and MediaSourceId tracking for Jellyfin sync
    3. Double-click fullscreen, single-click pause (200ms delay pattern)
    4. Keyboard shortcuts (Space, Arrows, M, F, I, Escape)
    5. Mouse wheel volume control
    6. Skip forward/backward buttons (±10s)
    7. Episode queue panel and "Up Next" dialog
    8. Audio track switching via HLS transcoding
    9. Stats for Nerds overlay (press 'i')
    10. MediaSession API integration
    11. Resume position fetched from server before playback
    12. Progress reporting every 10 seconds with full session data
    13. **Controls auto-hide** (3s timeout, mouse leave hides immediately)

- **JellyMusic Client:** Full Spotify/Feishin-style music interface
    1. Three-panel layout (sidebar, content, player bar)
    2. Separate app mode (switch from Calibre like Jellyfin)
    3. Zustand store for playback state and queue
    4. Album/Artist/Playlist/Genre browsing
    5. Search across all music content
    6. Queue management with drag-to-reorder
    7. Shuffle and repeat modes (off/all/one)
    8. Volume control with mute toggle
    9. Playlists displayed in sidebar (Feishin-style)
    10. MusicHome sections: Genres, Recently Played, Most Played, Favorites, Newly Added, Recently Released, Explore
    11. Performance: React.memo, parallel loading, skeleton loaders, lazy images

- **2026-02-12 Session Fixes:**
    1. Removed microphone permission request (was from getUserMedia for audio output enumeration)
    2. Removed "Reading Progress Sync" notice from settings (kept URL input only)
    3. Default offline download path changed to `./dl` relative to executable (auto-created)
    4. MusicHome: "Recently Played" and "Most Played" converted from track lists to album card sliders
    5. MusicHome: "Most Played" now fetches up to 80 albums for extensive browsing
    6. Jellyfin Library: Added server-side pagination (100 items/page) with page controls
    7. Jellyfin Library: Removed client-side filtering in favor of API-based pagination
    8. Tauri: Fixed dialog/fs plugin configuration for v2 (capabilities-based permissions)
    9. Tauri: Fixed CSP to allow book-file:// protocol in connect-src, frame-src, worker-src
    10. Installer: Created Inno Setup script (installer/reader-setup.iss) and build script
    11. Sync Server: Updated Dockerfile (multi-stage, non-root), docker-compose.yml (external DB), README

- **Calibre-Web Sync API Migration (2026-02-26, in progress):**
    1. Replaced old sync server + direct Calibre-Web with unified API (port 8787)
    2. Single URL + JWT auth for OPDS proxy, progress sync, read status
    3. Settings simplified: removed syncUrl, single API server URL
    4. Fixed stale cached data: calibreId extraction, URL rewriting
    5. Fixed duplicate books in Continue Reading via calibreId-based merge
    6. Server code: `calibre-web_API/` (FastAPI, Docker, PostgreSQL)

- **Blink Player Decomposition (2026-02-27, complete):**
    - Decomposed 2921-line monolithic JellyfinPlayer into 23 files in `src/components/jellyfin/player/`
    - Main player retains all logic; UI composed from sub-components (PlayerControls, ProgressSlider, VolumeControl, etc.)
    - Created `src/stores/playbackStore.ts` (Zustand, adapted from Blink's store)
    - All sub-components use `React.memo` for performance
    - Blink-style controls: gradient overlay, animated volume slider, smooth progress bar (pointer capture + rAF), trickplay sprite sheets, skip intro (MediaSegments API), glassmorphic up-next flyout, chapter markers/navigation, "Ends At" display

- **UI Improvements (2026-02-27, complete):**
    - Removed UpNextSection from Calibre dashboard (Calibre tab focuses on reading only)
    - Separated settings from Calibre tab — own top-level view with dedicated nav bar
    - Fixed cover image loading: concurrency 6, auto-retry, MIME detection, ref-counted blob URLs, click-to-retry
    - Cover URL fix: use `/opds/cover/{id}` (OPDS proxy) instead of broken `/api/books/{id}/cover`
    - Auth header stability: `useRef` in LazyImage/HeroCarousel + `useMemo` in App.tsx prevents blob URL revocation race
    - Stale cached cover URL rewriting in `loadStartedBooks` for locally stored progress data

- **Build Scripts:** `build-windows.bat`, `build-windows.ps1`, `build-linux.sh`, `build-tauri.ps1` for Tauri builds

- **State Management Refactoring:**
    1. `settingsStore.ts` - All app settings
    2. `libraryStore.ts` - Library state and sync logic
    3. App.tsx reduced from ~1800 to ~700 lines (lightweight router)

### Navigation Flow
```
App.tsx
├── view === 'settings' → SettingsContent (own nav bar, back returns to previousView)
├── view === 'dashboard' → Calibre Reader
├── view === 'jellyfin' → JellyfinView (video)
└── view === 'jellymusic' → JellyMusicView (audio)
      └── MusicView
            ├── MusicSidebar
            │     ├── Home → MusicHome
            │     ├── Search → MusicSearch
            │     └── Library
            │           ├── Albums → MusicAlbumGrid → MusicAlbumDetails
            │           ├── Artists → MusicArtistGrid → MusicArtistDetails
            │           └── Playlists (sidebar list) → MusicPlaylistDetails
            │
            ├── Main Content (based on musicView state)
            ├── MusicQueue (slide-out drawer)
            └── MusicPlayerBar (always visible when track loaded)
```

## Styling Guidelines

- **Theme**: Gray-900 dark background, purple-500 accents (consistent across all clients)
- **Cards**: Rounded-xl style with hover scale effects
- **Player bar**: Fixed bottom, backdrop-blur, border-white/5
- **Sidebar**: bg-black/40, w-56, with playlist images
- **Scrollbars**: Use `custom-scrollbar` class from Tailwind config
- **Skeleton loaders**: bg-white/10 with animate-pulse

## Testing Checklist

### JellyfinPlayer (Critical - Test After Any Changes)
1. Play a movie with existing watch progress - should resume from correct position
2. Console shows: "JellyfinPlayer: Attaching event listeners" then "Setting initial position: X seconds"
3. Time counter updates (not stuck at 00:00)
4. Controls auto-hide after 3s of no mouse movement
5. Move mouse - controls reappear
6. Mouse leaves window - controls hide immediately (if playing)
7. Pause video - controls stay visible
8. Play next episode in queue - resumes at correct position
9. Exit player - progress reported to server (check Jellyfin "Continue Watching")

### JellyMusic
1. Navigate to JellyMusic from Calibre
2. Browse albums, click to see details and track list
3. Play a track, verify audio plays
4. Add tracks to queue, verify queue management
5. Test shuffle and repeat modes
6. Search for music content
7. Browse artists and their albums
8. Click playlists in sidebar
9. Test genre navigation
10. Verify volume control and mute
11. Switch back to Jellyfin/Calibre while music plays

### Global Search
1. Press Ctrl+K (or Cmd+K on Mac) - search modal opens
2. Type query - results appear after ~350ms debounce
3. Results grouped by type (Books, Movies/TV, Music)
4. Click book result - opens book details
5. Click movie/series - switches to Jellyfin view
6. Click music - switches to JellyMusic view
7. Press Escape - modal closes

### Calibre Sync API (Test After Migration Changes)
1. Login: single API URL, gets JWT token, dashboard loads books from OPDS
2. Open PDF book: progress synced (pull from `/api/books/{id}/progress?format=PDF`)
3. Read PDF pages, close: progress saved (push to same endpoint, page number as string)
4. Open EPUB book: progress synced via CFI string
5. "Continue Reading" section: no duplicates, correct titles (not "Unknown Book")
6. Mark as read: reflected in UI, synced via `/api/books/{id}/read-status`
7. Download a book: uses `/opds/download/{id}/{fmt}/` through API proxy
8. Offline: read and save progress → pending changes queue → processed on reconnect
9. Clear app cache → reopen: books still load correctly (calibreId extracted, URLs rewritten)
10. Check console for `[SyncApi]` and `[SyncPush]` debug logs (remove when stable)

### Settings (Standalone View)
1. Open settings from any view (Calibre, Jellyfin, JellyMusic) - settings view opens with own nav bar
2. Back arrow returns to the view you came from (not always Calibre)
3. Home button navigates to the default start page set in settings
4. All settings sections render correctly (Credentials, General, Audio, Calibre-Web, Jellyfin, etc.)
5. Quick-launch buttons (Jellyfin, JellyMusic) switch to the correct view

### Cover Image Loading
1. Dashboard loads - book cover images appear reliably (not mostly broken)
2. Hero carousel shows covers with smooth transitions
3. Failed images show "Retry" - clicking retries the load
4. No blob URL memory leaks (check DevTools Memory tab)
