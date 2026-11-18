# Mediamaster — Quality-of-Life Feature Roadmap

A collection of features typical for media apps (Netflix, Spotify, Plex, YouTube, Apple Books, Tachiyomi, …)
that are currently missing, organized by area. Platform column: 🖥️ desktop, 📱 phone, 🌐 both.
Effort: **S** (hours), **M** (a day or two), **L** (multi-day / touches native code or CI).

Legend for status: ☐ open · ◐ partially exists (the note says what is still missing). Finished features are removed; see git history and the audit reports for what already exists.

**Audit 2026-11-17:** every section was compared against dedicated apps (Apple Books/KOReader/Mihon,
Netflix/Plex/Infuse, TiviMate/Channels DVR, Spotify/Finamp, Audible/ABS app, Netflix/Spotify offline,
Jellyseerr). Statuses below were re-checked against the code; rows marked *(audit)* came from it. The full
reports with file:line evidence live in [`audits/2026-11-17/`](audits/2026-11-17/). Bugs found by the audit
are collected in **§14 Bug backlog** — they are not features, but most should be fixed before new work.

---

## 1. Navigation & App Shell

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Keyboard navigation in grids** (arrow keys move focus, Enter opens) | 🖥️ | M | Focus rings + roving tabindex in library grids. Also an accessibility win. |

## 2. Phone-Specific Polish

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Keep screen awake while reading / listening with the screen on** *(audit)* | 📱 | S | `navigator.wakeLock.request('screen')` in the reader (and optional for the radio/Now Playing screens); re-acquire on `visibilitychange`. No wake lock exists anywhere today. Kindle/KOReader/Moon+ all do this. |
| ☐ | **Tablet layout class** (iPad: sidebar + grid instead of phone stack) | 📱 | L | `useIsPhone()` is binary; an `isTablet` middle class would let iPad use the desktop-ish layouts with touch targets. |
| ☐ | **Landscape phone handling** (players fullscreen, grids more columns) | 📱 | M | Currently portrait-first; rotating should at least not break layouts. |
| ☐ | **Home-screen quick actions** (long-press app icon → Continue Reading / Search) | 📱 | M | iOS `UIApplicationShortcutItem` via Tauri; needs a tiny native hook + deep-link routing. |
| ☐ | **Wi-Fi-only downloads toggle** | 📱 | M | Guard downloads behind a connectivity check (iOS `NWPathMonitor` via small Rust/Swift shim, or JS `navigator.connection` fallback). |

## 3. Desktop-Specific Polish

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **System tray**: minimize to tray, tray menu with play/pause/next for music & audiobooks | 🖥️ | M | Tauri tray API. Music keeps playing when window closes — the Spotify pattern. |
| ☐ | **Global media hotkeys** (play/pause/next while app is unfocused) | 🖥️ | S–M | Tauri global-shortcut plugin; MediaSession only works while focused in WebView2. |
| ☐ | **Always-on-top floating mini player** (music/video in a small separate window) | 🖥️ | L | Tauri multi-window; the "watch while you work" pattern. Video PiP exists — this is the richer version with controls. |
| ☐ | **In-app video mini player** (shrink playing video to a corner while browsing the library) | 🌐 | M–L | Audiobook & music mini players exist; video is the missing one. YouTube-style corner player. The player is `fixed inset-0` and must survive navigation. |
| ☐ | **Drag & drop**: drag tracks/albums onto playlists or the queue | 🖥️ | M | Queue reorder-by-drag exists; dragging *into* the queue/playlists doesn't. |
| ☐ | **Multi-select in grids** (Ctrl/Shift-click → mark watched, download, delete) | 🖥️ | M | Batch operations are a big QoL win for library management. Also wanted in music track lists (Spotify desktop). |

## 4. Video Player (Jellyfin)

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Pinch to zoom / fill-vs-fit aspect toggle** | 📱 | S–M | For 21:9 content on a 19.5:9 phone screen. `object-contain` is hard-coded. Live TV needs it too (4:3 SD channels). |
| ☐ | **Skip credits / auto-play next with countdown ring** | 🌐 | S–M | MediaSegments are already fetched but only `Intro` is used, and Up Next shows at a fixed 120 s before the end with no countdown. Drive Up Next from the `Outro` segment, add a countdown ring, and Skip Recap/Preview buttons (generalise `SkipIntroButton`). |
| ☐ | **Remember per-series audio/subtitle language choice + honour server subtitle mode** | 🌐 | M | Pick German audio once → all following episodes use it. *(audit)* Wider than first thought: no subtitle is ever auto-selected (forced subs and the server's SubtitleMode/language are ignored), and the preferred audio track is UI-only on first play (the stream isn't re-requested). Persist per series in settings. |
| ☐ | **Playback speed** (0.5–2×, remembered) *(audit)* | 🌐 | S | No `playbackRate` anywhere in the player. Row in SettingsMenu + `<`/`>` keys. YouTube, Plex, VLC. |
| ☐ | **Streaming quality / max bitrate selector** *(audit)* | 🌐 | S–M | `MaxStreamingBitrate` is hard-coded to 120 Mbps. Settings default + in-player menu that re-requests PlaybackInfo. Matters on phone/remote. |
| ☐ | **Image-based subtitles (PGS/VobSub) via burn-in** *(audit)* | 🌐 | S–M | Listed in the menu but never render. Re-request PlaybackInfo with an `Encode` subtitle profile when one is selected. |
| ☐ | **Multiple versions picker** (4K vs 1080p, Director's Cut) *(audit)* | 🌐 | S | Player always uses `MediaSources[0]`. |
| ☐ | **"Play from beginning" next to Resume** *(audit)* | 🌐 | S | Netflix "Start over". Needs a start-position override because the player re-fetches the resume point. |
| ☐ | **Offline auto-next / offline episode queue** *(audit)* | 🌐 | S | Offline playback passes no episode queue, so offline binge stops after every episode. Build it from downloaded episodes of the same series. |
| ☐ | **"Are you still watching?"** after N auto-advanced episodes *(audit)* | 🌐 | S | Netflix/YouTube; pairs with the countdown ring. |
| ☐ | **Long-press = 2× speed while held; horizontal swipe = scrub with trickplay preview** *(audit)* | 📱 | S–M | YouTube/MX Player gestures. The touch effect already detects the axis and ignores horizontal. Needs the playback-speed plumbing. |
| ☐ | **Player keyboard power keys** (0–9 = jump to %, J/L, `,`/`.` frame step, Shift+N next episode, C subtitles) + remember volume *(audit)* | 🖥️ | S | YouTube/mpv. Add to `ShortcutOverlay`. Volume resets to 100 % on every open today. |
| ☐ | **Seek-bar polish**: seek buttons show their seconds, remaining-time toggle, chapter names in the hover preview, intro/credits segments tinted *(audit)* | 🌐 | S | Depends on the chapters bug in §14 (chapters are effectively never loaded). |
| ☐ | **Subtitle offset (delay) adjustment** *(audit)* | 🌐 | S–M | VLC/mpv/Infuse. JASSUB supports a time offset. |
| ☐ | **Chromecast / AirPlay casting** | 🌐 | L | Big one. AirPlay on iOS is partly free via `webkitShowPlaybackTargetPicker`; Chromecast needs the sender SDK. Alternative below ↓ |
| ☐ | **"Play on…" remote control** (control another Jellyfin client/session) | 🌐 | M–L | Jellyfin Sessions API can command other devices — poor-man's casting without any cast SDK. Applies to music too. |

### 4a. Video browsing (Jellyfin) *(audit)*

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Long-press sheet on video cards** (mark watched, favourite, download, go to series, remove from Continue Watching) | 📱 | S–M | Home/library card actions are hover-only, so unreachable on touch. Reuse `useContextMenu` + `BottomSheet`. |
| ☐ | **"Remove from Continue Watching"** | 🌐 | S | Netflix, Plex, Jellyfin-web. |
| ☐ | **Episode list inline on the series page + season switcher** | 🌐 | M | Series view only shows season cards; no way to jump to another season except going back. Netflix/Disney+ layout. |
| ☐ | **Cast & crew → person pages** (filmography), directors/writers/studios | 🌐 | M | `CastCard` isn't clickable and shows 6 actors max. |
| ☐ | **Trailers** (local + remote) | 🌐 | S–M | `LocalTrailerCount` → `/Items/{id}/LocalTrailers`; `RemoteTrailers` → open externally. |
| ☐ | **Collections (BoxSets)** with an ordered details page | 🌐 | M | No BoxSet handling today. |
| ☐ | **Library sort/filter depth + sort memory** (date played, runtime, release date, year, 4K/HDR; remembered per library) | 🌐 | S | Sort state only lives in the session grid cache. The genre filter only lists genres found in the first loaded page. |
| ☐ | **Card badges**: "S2·E5 · 23 min left" on Continue Watching, remaining-episode count on every series card | 🌐 | S | |
| ☐ | **Phone details on `MobileDetailHero`/`DetailActionBar`** | 📱 | M | Jellyfin details don't use the shared phone primitives (only ABS does), contrary to the earlier "phone-native redesign of all detail views" note. Also replace hard-coded pink accents with `theme-*`. |
| ☐ | **Desktop hover preview on cards** (overview, year, rating after ~600 ms) | 🖥️ | M | Netflix/Disney+. |

## 4b. Live TV & DVR *(audit)*

Live TV had no rows before the audit. Its player lacks most of what JellyfinPlayer already has. The stream
lifecycle, error handling and guide-refresh bugs were fixed on 2026-11-17.

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Program details sheet** (title, episode, overview, times, Watch now / Record / Record series) | 🌐 | S–M | Program bars have no onClick today; phone gets nothing. |
| ☐ | **Record / series record** + red dot on scheduled programs | 🌐 | M | SDK `createTimer`/`createSeriesTimer`/`getTimers`. |
| ☐ | **Recordings library** (by series, Scheduled, Series rules, delete; plays in JellyfinPlayer) | 🌐 | M | Also fixes the manual hiding of recording folders in JellyfinHome. |
| ☐ | **Favourites & channel groups** (chips: All / Favourites / TV / Radio / tags) | 🌐 | S–M | `UserData.IsFavorite` is already fetched and unused. |
| ☐ | **Last-channel toggle + resume last channel on open** | 🌐 | S | Every STB remote's Recall button; TiviMate, waipu.tv. |
| ☐ | **Numeric channel entry** ("12_" OSD, tune after ~1.5 s) | 🖥️ (+📱 keypad) | S | `channel.number` is already mapped. |
| ☐ | **Zapping OSD banner** (number, logo, now/next, progress, auto-hide) | 🌐 | S | Keyboard zapping shows nothing today. |
| ☐ | **In-player mini-guide** (now/next of neighbouring channels without leaving fullscreen) | 🌐 | M | TiviMate OK-button list. Today "Guide" collapses the player into the corner box. |
| ☐ | **EPG navigation**: Now button, day picker, lazy horizontal loading past 6 h | 🌐 | M | |
| ☐ | **Now/next + progress in the channel column; phone list-mode guide** | 🌐 / 📱 | S / M | A list mode also unlocks pull-to-refresh on phone (the grid's two-axis pan blocked it). |
| ☐ | **EPG virtualization** | 🌐 | M | 1000 channels × ~12 bars render at once. `react-virtuoso` is already a dependency. |
| ☐ | **Player parity with JellyfinPlayer**: OS-level PiP, stats, sleep timer, lock, swipe volume/brightness, aspect toggle, audio/subtitle track picker, cursor auto-hide, haptics, persisted volume | 🌐 | M | Each piece already exists in `player/`; mostly reuse. Also make channel up/down consistent (fullscreen buttons are inverted vs keys and PiP). |
| ☐ | **Timeshift / pause live** (scrubbable buffer + "Back to live") | 🌐 | M–L | Verify against a real server's live HLS window. |
| ☐ | **Background playback across tab switches** (hoisted player store, MediaSession ownership) | 🌐 | M | Leaving the tab kills the stream; radio especially should keep playing like music. |
| ☐ | **Program reminders** (local, toast/system notification, tune prompt) | 🌐 | S–M | No server support needed. |
| ☐ | **EPG search** (`/LiveTv/Programs?searchTerm=`) and Live TV in Ctrl+K | 🌐 | S–M | See §9. |

## 5. Music (JellyMusic)

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Crossfade / gapless playback** | 🌐 | M–L | Two overlapping audio elements or Web Audio API. Gapless matters for live albums. Start with a preloaded second `<audio>`; keep `setSinkId` routing on both. |
| ☐ | **Volume normalization (ReplayGain)** | 🌐 | M | Jellyfin exposes `NormalizationGain`; apply via Web Audio gain node (or as a volume multiplier for an S version). |
| ☐ | **Equalizer** | 🌐 | M | Web Audio `BiquadFilter` chain + presets. Pairs with the existing per-tab audio-device routing. |
| ☐ | **"Song radio" / start radio from any track** | 🌐 | S | InstantMix is already used for autoplay — expose it as an explicit context-menu action (track, album, artist). |
| ☐ | **Recently played history view** (individual tracks, not albums) | 🌐 | S–M | `sortBy DatePlayed`, `includeItemTypes Audio`. |
| ☐ | **Like the current track from the player bar / Now Playing** *(audit)* | 🌐 | S | Liking is only possible in track rows today. |
| ☐ | **Artist & album page depth** (bio, "Appears on", similar artists, "More by", disc headers, total duration as "1 hr 12 min") *(audit)* | 🌐 | M | "Popular" uses the user's own play counts, so it is empty for new users. |
| ☐ | **Saved albums / followed artists in "Your Library"** + sort/filter in every list *(audit)* | 🌐 | S–M | Liked Songs exists; favourite albums/artists only appear as a home strip. Liked Songs, playlist and genre pages have no sort or in-list search. |
| ☐ | **Use every music library** (or a library switcher) *(audit)* | 🌐 | S–M | Home/albums/artists only read the first music library; a second one ("Hörspiele", "Classical") is invisible outside search. |
| ☐ | **Remember queue, position, shuffle, repeat and volume across restarts** *(audit)* | 🌐 | S–M | Only autoplay is persisted. Spotify/Finamp resume where you left off. |
| ☐ | **Phone gestures**: swipe the mini bar to skip / up to open Now Playing, swipe track rows (queue / like), long-press sheets on artists and playlists *(audit)* | 📱 | S–M | |
| ☐ | **Touch-capable queue reorder** (pointer-based) + "Clear upcoming" vs "Clear all" + undo toast *(audit)* | 📱 / 🌐 | M | HTML5 drag & drop doesn't work in mobile WebViews, so the grip is decorative on phones. "Clear queue" also stops the current song. |
| ☐ | **Offline-mode toggle / "downloaded only" filter**, download a whole artist, auto-sync Liked Songs *(audit)* | 🌐 | S–M | Offline is only auto-detected today. |
| ☐ | **Track info sheet** (credits, codec, bitrate, play count) + lossless/explicit badges *(audit)* | 🌐 | S | |
| ☐ | **Smart mixes on Home** ("Daily mix", "On repeat") *(audit)* | 🌐 | M | InstantMix seeded from top-played tracks. |

## 6. Reading (Calibre: EPUB / PDF / Manga)

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **In-book text search** (EPUB) | 🌐 | M | epub.js spine walk (`item.find(q)`); reuse the PDF search-bar UI and highlight via `rendition.annotations`. |
| ☐ | **Sync bookmarks & highlights** across devices (Sync API) | 🌐 | M | Highlights + notes, the notes list with Markdown export and PDF/manga page bookmarks are done locally (2026-11-18, `readerAnnotations.ts`). Needs annotation endpoints on the Sync API server (not in this repo), then push/pull like reading progress. |
| ☐ | **Tap word → dictionary lookup / translation** | 🌐 | M–L | Great for reading in a second language. Hook `rendition.on('selected')` and PDF select mode. |
| ☐ | **Manga: long-strip / webtoon vertical scroll mode** | 🌐 | M | The other half of comic reading; continuous vertical mode (`react-virtuoso` is a dependency). |
| ☐ | **Reader brightness / background dimming slider** | 📱 | S | In-app overlay dim for night reading; copy the Jellyfin `BrightnessOverlay` (+ warm amber option). |
| ☐ | **Reading stats** (time read today/this week, pages turned, streaks) | 🌐 | M | Fun + motivating; local-only counter is enough to start. |
| ☐ | **"Continue" floating button on book details** showing % and page | 🌐 | S | One-tap resume with context, like Apple Books. Needs the EPUB percentage fix (§14). |
| ☐ | **EPUB tap zones + center-tap chrome toggle; swipe page turns over the text** *(audit)* | 📱 | S | Phone-critical: touches inside epub.js's iframe never reach the wrapper, so swipe/tap turns only work in the margins. Wire through `rendition.on('touchstart'/'click')`. Also stop the toolbar re-appearing on every page-turn tap. |
| ☐ | **EPUB progress footer** (% · page x of y · chapter · time left) + scrolled (continuous) flow option *(audit)* | 🌐 | S–M | Needs `book.locations.generate()` (see §14). Kindle/Apple Books. |
| ☐ | **Format picker for multi-format books** ("Read as EPUB / PDF") + CBT/CB7 support *(audit)* | 🌐 | S | Reader always opens `formats[0]`. |
| ☐ | **PDF internal links** (TOC pages, footnotes, cross-references) *(audit)* | 🌐 | S–M | `renderAnnotationLayer` is off on every page, so links inside PDFs are dead. |
| ☐ | **PDF scroll modes: virtualization + scroll-to-page** *(audit)* | 🌐 | M | Every page renders at once (memory risk on phones), and nothing scrolls to the current page (see §14). |
| ☐ | **Reader panels as BottomSheets with back handlers** (appearance, PDF settings, TOC, bookmarks, audiobook menu) *(audit)* | 📱 | S–M | Also makes Esc/back close the panel instead of the whole reader. |
| ☐ | **"Back to page N" pill after a jump** (TOC, search, slider, thumbnails) + current chapter highlighted in the TOC *(audit)* | 🌐 | S | Kindle/Acrobat. |
| ☐ | **Text-to-speech read-aloud** *(audit)* | 🌐 | M | `speechSynthesis` over the epub.js range / the PDF text index. Apple Books, Moon+. |
| ☐ | **EPUB footnote popups** *(audit)* | 🌐 | M | Intercept `noteref` links and show the note in a popover/sheet. |
| ☐ | **Volume-key page turn** *(audit)* | 📱 | M | The in-repo system-volume plugin already watches the hardware buttons. Moon+/KOReader. |
| ☐ | **Double-tap to zoom at the tap point**, page-turn animation, remember zoom per PDF (Fit Width on phone portrait) *(audit)* | 🌐 | S | Today a double-tap in a click zone turns two pages. |
| ☐ | **End-of-book screen** (mark read, next in series, rate) *(audit)* | 🌐 | S–M | Replaces the silent auto-mark-read at 99 %. |
| ☐ | **Per-book/per-series manga settings + reader filters** (auto-crop borders, grayscale) *(audit)* | 🌐 | S–M | Mihon/Perfect Viewer. |

## 7. Audiobooks (Audiobookshelf)

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Bookmarks** ("save this position" with note) | 🌐 | M | ABS has a bookmarks API (`/api/me/item/{id}/bookmark`) — sync them. |
| ☐ | **Skip silence** | 🌐 | L | Web Audio analysis; a beloved Audiobookshelf-app feature but non-trivial. |
| ☐ | **New-episode notifications for podcasts** (badge on tab, "N new" row) | 🌐 | M | Poll on app start; local notification later. The home screen currently drops the podcast "Continue Listening" / "Newest Episodes" shelves entirely (§14). |
| ☐ | **Auto-download newest N podcast episodes + auto-delete finished** | 🌐 | M | The podcatcher pattern; pairs with the download manager below. |
| ☐ | **Fullscreen "Now Playing" for audiobooks** (big cover, chapter title, chapter-relative scrubber, speed/sleep/bookmark/chapter buttons) *(audit)* | 📱 (🌐) | M | Biggest phone gap; clone `MusicNowPlaying`. Audible, BookPlayer, ABS app. |
| ☐ | **Chapter list in the player** (current chapter, per-chapter progress) + chapter title in mini player and lock screen *(audit)* | 🌐 | S | Chapters only show on the details page today. |
| ☐ | **Chapter-relative scrubber + "time left at current speed"** *(audit)* | 🌐 | S | On a 30 h book a phone scrubber moves ~6 min per pixel. |
| ☐ | **Smart rewind on resume** (2–30 s depending on pause length) *(audit)* | 🌐 | S | Audible, BookPlayer, Pocket Casts. |
| ☐ | **Per-book playback speed + 0.05 stepper; configurable skip intervals shown in the icon** *(audit)* | 🌐 | S | Speed is global; ±30 s is hard-coded in five places. The reader's audiobook menu and the bar offer different speed lists. |
| ☐ | **Reset progress / "Listen again" / remove from Continue Listening** *(audit)* | 🌐 | S | ABS `DELETE /api/me/progress/{id}` and remove-from-continue-listening. |
| ☐ | **Podcast queue / auto-play next episode; "next in series" at book end** *(audit)* | 🌐 | M | The store holds a single item. |
| ☐ | **Browse authors / narrators / collections / genres + library sort & filter** *(audit)* | 🌐 | M | `AbsLibrary` hard-codes title sort. |
| ☐ | **Listening stats + playback history** *(audit)* | 🌐 | S–M | ABS already serves `/api/me/listening-stats` and `/api/me/listening-sessions`. |
| ☐ | **Series progress + "continue series" button** *(audit)* | 🌐 | S | `finishedCount` is already computed. |
| ☐ | **Open ABS ebooks in the Reader** (read-along) *(audit)* | 🌐 | M | `media.ebookFile` → `/api/items/{id}/ebook`. |
| ☐ | **Audiobook mini-bar swipe** (phone: swipe the mini bar to skip ±30 s / chapter) *(audit)* | 📱 | S | Keyboard shortcuts are done (2026-11-18); the phone swipe is not. |
| ☐ | **Card polish**: downloaded/finished badges, touch-visible quick play, episode list sort (oldest first), show notes *(audit)* | 🌐 | S–M | |

## 8. Downloads & Offline

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Download queue with concurrency limit** (queue N, download 2 at a time) | 🌐 | M–L | *(audit)* Jellyfin video and music are already strictly serial; the unbounded case is **Audiobookshelf** (no queue, no cancel, every click starts a parallel download). Route all four sources through one scheduler. |
| ☐ | **Download quality selector** (video Original/1080p/720p transcode; audio Original/320/128 kbps) + download subtitles *(audit)* | 🌐 (📱 critical) | M | Video is saved as `video.mp4` whatever the container, so MKV/HEVC downloads fail on iOS. Offline video has no subtitles and no audio switching. Netflix, Plex, Findroid. |
| ☐ | **Storage overview in settings** (usage per app, largest items, clear-all buttons) | 🌐 | M | "Downloads use 4.2 GB: Books 1.1 · Video 2.8 · Music 0.3". Needs a Rust free-space command. |
| ☐ | **Auto-delete watched/finished downloads** (opt-in) | 🌐 | M | Keeps sideloaded iPhones from filling up. |
| ☐ | **Global offline banner + graceful offline mode** | 🌐 | M | Per-view checks exist; a single "You're offline — showing downloads" banner with auto-recovery would unify it. |
| ☐ | **Move the download folder with migration** *(audit)* | 🖥️ / Android | M | Changing the path today orphans every Jellyfin/music/ABS download. Cheap once index paths are relative (§14). |
| ☐ | **Background downloads on mobile** *(audit)* | 📱 | L | iOS suspends the WebView/reqwest when backgrounded; needs a native `URLSession` background config / Android foreground service. |
| ☐ | **Offline lists**: sort/filter/search, swipe or long-press to delete, in-app confirm instead of `confirm()`, consistent "downloaded" badge on every card type, size shown before downloading *(audit)* | 🌐 | S–M | |
| ☐ | **Export/share a downloaded file** ("Save to Files" / open in another e-reader) *(audit)* | 📱 | S | |

## 9. Search & Discovery

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Search filters** (type/library chips: Books · Movies · Music · Audiobooks) | 🌐 | S–M | Results are grouped already; filtering narrows long result lists. Add a "Requests" chip once Requester results exist. |
| ☐ | **Live TV channels + programs in Ctrl+K** *(audit)* | 🌐 | S–M | `/LiveTv/Programs?searchTerm=`. GlobalSearch has no Live TV group. |
| ☐ | **"Request it" in Ctrl+K** when the libraries have no match *(audit)* | 🌐 | M | See §13. |

## 10. Feedback, Notifications & System Integration

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Download-complete notification** (toast in-app; system notification when unfocused) | 🌐 | S–M | Tauri notification plugin; rings show progress but completion goes unnoticed. *(audit)* Completion detection already exists in `downloadCenterStore`; only Calibre toasts today. Wire `hapticSuccess()` here too. |
| ☐ | **Deep links** (`mediamaster://item/...`) + **share action** on items | 🌐 | M | Share a book/movie to another device running the app; foundation for quick actions & widgets. A `mediamaster://request/{id}` target would let Discord/notification clicks open a request. |
| ☐ | **Discord Rich Presence** ("Watching X · 42:10") | 🖥️ | M | Fun flex feature; small Rust IPC to Discord. |
| ☐ | **Trakt / AniList / Last.fm scrobbling** | 🌐 | L | Usually better done server-side via Jellyfin plugins — consider documenting that instead of building it. *(audit)* Server plugins only see correct data once music session reporting is fixed (§14). |
| ☐ | **In-app log/debug viewer** (recent errors, copy button) in settings | 🌐 | S–M | Would have made the iOS black-screen debugging much faster. *(audit)* Live TV logs stream URLs including the access token — redact before this ships. |
| ☐ | **Program reminders** (Live TV) *(audit)* | 🌐 | S–M | See §4b. |
| ☐ | **Request status notifications** (approved / rejected / complete / error) *(audit)* | 🌐 | M | See §13. |

## 11. Settings & Personalization

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Settings sync/roaming across devices** (via the Sync API) | 🌐 | M–L | Set up once on desktop, phone follows. Needs a server endpoint + conflict rule (last-write-wins is fine). |
| ☐ | **Hide/reorder tabs** (e.g. hide Live TV if unused) | 🌐 | S–M | `appTabsConfig` is already central; add a per-user enabled/order list. Hide the Requester automatically when no Requester server is configured. |
| ☐ | **Per-section home customization** (hide/reorder home rows per app) | 🌐 | M | "I never use Genres" — let users tailor the home screens. |
| ☐ | **Localization (German first)** | 🌐 | L | i18n pass over all strings; big but mechanical. |
| ☐ | **Reduced-motion & larger-text accessibility support** | 🌐 | M | Respect `prefers-reduced-motion`, audit contrast/labels. *(audit)* Several reader buttons have no `aria-label`; the Requester multilang toggle isn't keyboard accessible. |
| ☐ | **Tab badges** (Requester pending count, new podcast episodes) *(audit)* | 🌐 | S–M | Neither `AppTabs` nor `BottomTabBar` supports badges yet. |

## 12. Wild Ideas (big bets, someday/maybe)

- **Couch mode / 10-foot UI**: gamepad & TV-remote navigation, giant tiles — turns the desktop app into an HTPC frontend.
- **QR-code device login**: desktop shows a QR, phone scans it and inherits server config + credentials — kills the worst part of mobile onboarding.
- **CarPlay support** for audiobooks/music (preferred over an in-app car mode). Caveat: requires the `com.apple.developer.carplay-audio` entitlement, which must be requested from Apple and needs a paid developer account — not obtainable with Sideloadly free provisioning. Until then, a simple in-app car mode (giant buttons) is the sideload-compatible fallback. Android Auto would need a native `MediaBrowserService`.
- **Cross-device handoff**: "Continue on iPhone" — start a movie on desktop, tap a prompt on the phone to resume at the same second (Sync API + Jellyfin sessions make this feasible).
- **Reading/listening year-in-review** ("Your 2026 Wrapped").
- **Per-profile kids mode** with a locked-down library selection.
- **Smart offline sync**: "always keep the next 5 unread chapters / unwatched episodes downloaded, delete consumed ones" — the killer feature for commuters.
- **Live TV multi-view** (2–4 channels at once; costs a tuner + transcode each) *(audit)*.
- **Live TV catch-up / restart program** via provider catch-up URLs (Jellyfin has no native catch-up) *(audit)*.

## 13. Requests (Requester) *(audit)*

The Requester is a download-request client for the custom mediamaster server (scrapers, OMDb, YouTube,
Spotify), not an Overseerr clone — so TMDB discover and 4K/HD requests don't apply. The admin approval
queue was added on 2026-11-17 (Admin Panel).

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Cancel active downloads** (whole request or single episode) | 🌐 | S | `POST /api/download/{id}/cancel[?episode=S01E03]`; history rows only offer Delete on finished rows. |
| ☐ | **Request detail / status timeline** (approved by/when, per-season/episode progress, error message) | 🌐 | M | All fields are already in `DownloadRequest` + WS `episode_update`/`season_update`; BottomSheet on phone. |
| ☐ | **Requests list: filter chips + pagination + requester name** (Mine/Pending/Active/Done/Failed, Load more) | 🌐 | S–M | `offset` supported; admin `GET /api/admin/history` unused; `user_id` never shown. |
| ☐ | **Duplicate-request guard** ("already requested · Downloading") | 🌐 | S | A double-click currently files two requests (see §14). |
| ☐ | **Show server error details** instead of "No results" / "Request failed" | 🌐 | S | A server without an OMDb key looks like "this movie doesn't exist". |
| ☐ | **Phone-native request flow** (results → detail page with back handler, sticky submit, swipe actions) | 📱 | M | The anime/series detail is a fixed two-column row that leaves ~70 px on a phone. |
| ☐ | **Status-change notifications + tab badge** | 🌐 | M | Move the `/ws/downloads` socket into `requesterStore` (app-level, with reconnect). |
| ☐ | **Per-episode language check before submit** | 🌐 | S–M | `GET /api/info/episode-langs` is unused; also fixes a stale language key after changing seasons. |
| ☐ | **"Request this" from Ctrl+K and from Jellyfin details** (missing seasons, movie not in library) | 🌐 | M | Movies map exactly via the IMDb provider id; series need a title→slug confirm step. |
| ☐ | **"In library / requested" badges on request search results** | 🌐 | M | History match (S) + Jellyfin lookup by IMDb id / name (M). |
| ☐ | **Admin: edit schedule entries + "add to schedule" from detail** | 🌐 | S | `PUT /api/admin/schedule/{id}` wrapper exists, no UI. |
| ☐ | **Admin: local user management** | 🌐 | M | `/api/admin/users*`; show only when `auth_mode === 'local'`. |
| ☐ | **Polish**: distinct status badge colours, poster thumbnails in history, confirm dialogs, search-as-you-type, remember last tab + language, `theme-*` instead of hard-coded teal/amber/pink | 🌐 | S | |
| ☐ | **Discover rows** (airing this week, trending anime/series) | 🌐 | L | Needs a server discover endpoint (TMDB/AniList); "this week" from the schedule is a cheap first row. |

## 14. Bug backlog (audit 2026-11-17)

Open defects found by reading the code; not yet reproduced in the running app. Each links to the report with
file:line evidence and the failure scenario. All high-severity bugs were fixed on 2026-11-17.

### Medium (selection)

| ☐ | Area | Bug | Report |
|---|------|-----|--------|
| ☐ | Reader | PDF scroll modes render every page eagerly (memory risk on phones); manga leaks page blobs on close. | [reader A7, A9](audits/2026-11-17/reader.md) |
| ☐ | Reader | Toolbar auto-hide hides the open PDF settings/bookmark dialog and flashes on every page-turn tap. | [reader A10](audits/2026-11-17/reader.md) |
| ☐ | Live TV | Channel up/down inverted in the fullscreen controls; player key handler steals Esc/arrows from overlays; Live TV never claims MediaSession. | [livetv A9, A11, A12](audits/2026-11-17/livetv.md) |
| ☐ | Audiobooks | Progress bars/finished markers frozen until restart; podcast home shelves dropped. | [audiobooks A9, A10](audits/2026-11-17/audiobooks.md) |
| ☐ | Downloads | Cancel before the transfer starts downloads the whole file first; stalled transfers hang the queue (logout/server removal now stop downloads). | [downloads A12, A13, A15](audits/2026-11-17/downloads.md) |

Low-severity findings and polish items are only in the reports.

---

## Suggested next wave

All 22 high-severity bugs from the audit were fixed on 2026-11-17, every partially implemented feature
was finished on 2026-11-18, and the 2026-11-18 bug wave fixed music data/queue state, Requester submit
and errors, video chapters/audio/watched state/keyboard/phone controls, EPUB touch page turns, multi-disc
download names, the serial ABS queue and stopping downloads on logout (all type-checked and built, not
yet tested in the running app). Next, in order of damage ÷ effort:

1. ☐ **Reader:** toolbar auto-hide hides the open PDF settings/bookmark dialog and flashes on every page-turn tap (S).
2. ☐ **Reader memory:** PDF scroll modes render every page eagerly; manga leaks page blobs on close (M).
3. ☐ **Live TV:** inverted channel up/down, key handler steals Esc/arrows from overlays, MediaSession (S).
4. ☐ **Downloads:** cancel before the transfer starts, per-chunk idle timeout in Rust so a stalled transfer can't hang the queue (M, touches Rust).
5. ☐ **Audiobooks:** progress bars/finished markers frozen until restart; podcast home shelves (S–M).
