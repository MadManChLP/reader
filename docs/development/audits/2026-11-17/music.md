# JellyMusic audit (read-only) — 2026-11-17

Scope: `src/components/jellyfin/music/*`, `PersistentMusicPlayer`, `MusicMiniPlayer`, `SystemVolumeSlider`, `musicPlayerStore`, `sleepTimerStore`, `musicDownloadManager`, `audioStream`, `mediaSessionOwner`, roadmap §5.
Effort key: S ≤ ½ day, M 1–3 days, L ≥ 1 week. Platform: 🖥 desktop, 📱 phone, 🌐 both.

Checked and found clean (not reported as bugs): audio stream URL uses `ApiKey=` (`audioStream.ts:18`) and every hand-rolled request uses the `Authorization: MediaBrowser Token=` header. There is no `X-Emby-*` and no `api_key` in the music code. (CLAUDE.md's audio example is stale; the code is correct.) `PersistentMusicPlayer` has an `error` listener. Store selectors are granular or `useShallow` everywhere: no bare `useMusicPlayer()`. Playlist details and playlist download use `GET /Playlists/{id}/Items`. `PlaylistCover` respects `ImageTags.Primary`. Offline path resolution goes through `resolveLocalAudioPath()`.

---

## A) Bugs / defects (ranked)

1. **The Next button does nothing while repeat-one is on, and broken tracks loop.** `musicPlayerStore.ts:303-313`. `next()` returns early when `repeatMode==='one'` and restarts the same track. It is the only "advance" action, so it also handles:
   - the Next button in the player bar, Now Playing and the mini player;
   - the MediaSession `nexttrack` action (`PersistentMusicPlayer.tsx:340`);
   - the error path (`PersistentMusicPlayer.tsx:169`).

   Scenario: with repeat-one on, the user can never skip a song from the UI, the lock screen or headphone buttons. A track that fails to load offline is retried 5 times, then playback stops with "Playback failed" instead of skipping to the next downloaded track. Spotify, Apple Music and Finamp all advance on an explicit skip and only repeat on natural `ended`.
   Fix: split this into `next({ user: true })` and an `onEnded()` path, and only honour repeat-one on `ended`. Size S.

2. **Playback reporting is incomplete and lives in a UI component.** `MusicPlayerBar.tsx:139-232`.
   - (a) **Progress is never reported for a normal play.** The progress effect (`:186-215`) reads `isStarted.current` when the effect runs. The start POST in `:161-182` is async, so `isStarted` is still `false` in the same commit. Nothing in the deps (`isPlaying, currentTrack, serverUrl, api`) changes afterwards, so the 15 s interval never starts until the user pauses and resumes.
   - (b) **`/Sessions/Playing/Stopped` is never sent.** The effects at `:218-232` are empty stubs. Jellyfin's dashboard shows a stale "now playing" session, and the play counts and "last played" values that depend on Stopped are not recorded. A partial workaround is the `UserPlayedItems` POST on `ended`.
   - (c) **No playback data is sent while the user is in another tab.** `MusicPlayerBar` only mounts inside JellyMusicView. When the user switches to Calibre or Jellyfin while music plays (the mini player case), nothing is reported at all.
   - (d) `isStarted.current = true` is set even when `appApi.request` resolves with `success:false`, because it does not throw. The report bodies also lack `PlaySessionId`, `PlayMethod`, `CanSeek`, `IsPaused` and `MediaSourceId`.

   Fix: move session reporting into `PersistentMusicPlayer`, which is always mounted, driven by audio element events. Size M.
3. **Album pages opened from the player bar, the queue or global search show stale or wrong data.** `JellyMusicView.tsx:253-259` builds stub DTOs `{Id, Name, Type}`. The comment there says "details views resolve the rest", but `MusicAlbumDetails.tsx` never re-fetches the album item. As a result:
   - The header shows "Unknown Artist" (`:229`), the artist link is dead (`AlbumArtists` is missing), and there is no year.
   - The favourite heart starts unfilled for an album that is already liked (`:35`).
   - "Download album" stores `album.AlbumArtist || 'Unknown Artist'` and an empty year, overview and genres into the offline metadata (`:141-155`). The Downloads view then groups the album under "Unknown Artist".

   `MusicArtistDetails` has the same problem for stubs (no image tag or overview), which matters less. Fix: `getItems({ids:[id]})` or `getItem` on mount when fields are missing. Size S.
4. **Multi-disc albums play out of order.** The album page sorts with `sortBy:['IndexNumber','SortName']` and no `ParentIndexNumber` (`MusicAlbumDetails.tsx:79`). The same happens in:
   - MusicHome album play (`MusicHome.tsx:560-565`, IndexNumber only);
   - artist "Play" (`MusicArtistDetails.tsx:94`, `['Album','IndexNumber']`);
   - artist album play (`:148`), album-grid quick play (`MusicAlbumGrid.tsx:162`), and the artist grid (`MusicArtistGrid.tsx:153`).

   Result: the order becomes D1T1, D2T1, D1T2, D2T2… Only `fetchContainerTracks` (`musicQueueHelpers.ts:42`) sorts correctly, so "Play next" on a card and "Play" on the album page give different orders. There are also no disc headers on the album page. Fix: one shared `fetchAlbumTracks()` with `['ParentIndexNumber','IndexNumber']`. Size S.
5. **"Play next" / "Add to queue" on a playlist would use the forbidden query.** `fetchContainerTracks` (`musicQueueHelpers.ts:35-44`) reads playlists with `getItems({parentId, recursive:false})`. That breaks the CLAUDE.md rule (it loses playlist order and returns no live linked children). It is currently only reached from `AlbumCard`, which is only rendered for albums, so this is **latent**. It will bite as soon as a playlist card or context menu reuses the helper. Fix: branch to `getPlaylistsApi(api).getPlaylistItems`. Size S.
6. **Removing or reordering in the queue is undone when shuffle is toggled.** `removeFromQueue` and `reorderQueue` (`musicPlayerStore.ts:524-583`) never update `originalQueue`. Toggling shuffle off (`:648-659`) restores `[...originalQueue]`: removed tracks come back and manual reorders are lost. Size S.
7. **Turning shuffle on mid-context replays tracks already heard and drops duplicates.** `toggleShuffle` (`:630-647`) shuffles the whole queue, including the tracks before `queueIndex`, so already-played songs come back as "upcoming". `filter(t => t.id !== currentTrack.id)` also drops every duplicate of the current track. If the current track is from the manual lane (`currentIsManual`), the queue is fully shuffled with `queueIndex:0`, so `queue[0]` is treated as already played and is **never played**.
   Turning shuffle off while a manual track plays sets `queueIndex=0` (`:651-653`), so the context restarts at track 2.
   Spotify only shuffles the remaining tracks. Size S.
8. **Autoplay (Instant Mix) can overwrite a queue the user just started.** In `startAutoplay` (`:676-730`), if the user starts a new album during the `await api.request(...)`, the resolved mix still replaces the queue with `currentTrack: tracks[0]`. Nothing checks that `get().currentTrack?.id === seed.id` after the await.
   Two smaller issues in the same function:
   - The duplicate filter only covers the seed and the current `queue`. It does not cover `manualQueue` or the tracks of the previous mix that were replaced, so a second mix can repeat tracks.
   - Replacing `queue` wipes the history, so Previous cannot go back into the album that just ended.

   Size S.
9. **The Now Playing overlay ignores Back and Esc.** `MusicNowPlaying.tsx` (phone, `z-50`) neither calls `registerBackHandler` nor `blockGlobalEsc`, and its open state is local to `MusicPlayerBar` (`:93`). The back handler in `JellyMusicView.tsx:241-249` only knows about lyrics and queue. Android Back or the edge-swipe therefore pops the view history **behind** the open overlay instead of closing it. This breaks the project convention for overlays. Size S.
10. **Mini player shows a broken cover for downloaded tracks.** `MusicMiniPlayer.tsx:54-57` renders `<img src={currentTrack.imageUrl}>` directly. For tracks queued from Downloads, `imageUrl` is `downloaded.localImagePath`, a raw filesystem path (`musicDownloadManager.ts:893`). `getLocalTrackImage()` and `toLocalUrl()` exist for exactly this and are used by the player bar. Size S.
11. **Legacy `MusicView` is a second audio engine.** `MusicView.tsx:345` has its own `<audio>`. It calls `setAudioRef` (overwriting PersistentMusicPlayer's ref) and plays the same `currentTrack` and `isPlaying`. If it is ever mounted, two streams play at once. On unmount it sets `audioRef=null`, so `seek`, repeat-one restart and `previous` stop affecting the real element. It has no MediaSession, sleep timer, scrobble or `ended` reporting, and Back does not close its queue or lyrics.
   It is only reachable through `JellyfinView` `handleOpenMusic` when `onSwitchToJellyMusic` is missing. App passes that prop everywhere (`App.tsx:2310/2365/2392`), so this is **latent dead code**. Delete it and the `type:'music'` route. Size S.
12. **PLAUSIBLE: the download index is re-parsed for every lookup.** `getDownloadedTrack` (`musicDownloadManager.ts:706`) does a `JSON.parse` of the whole downloaded-tracks list on every call. Callers:
    - every `MusicTrackRow` on mount and on **every** download-update event (`MusicTrackRow.tsx:61-80`), which gives rows × downloads parses per progress tick during an album download;
    - `next()`, via `isTrackPlayableOffline` for each queue entry while offline (`findPlayable`);
    - the source effect.

    A large library with 1k+ downloads will jank. Add an in-memory cache invalidated on save. Size S.
13. **Album and playlist "Shuffle" buttons are not real shuffle mode.** `MusicAlbumDetails.tsx:118-124` and `MusicPlaylistDetails.tsx:133-139` pre-shuffle with the biased `sort(() => Math.random()-0.5)` and leave `shuffleMode=false`. The shuffle icon stays off, and toggling shuffle on then off "restores" the random order, because `originalQueue` is the shuffled list. If shuffle mode is already on, the list is shuffled twice. Use `setQueue(tracks, randomStart)` plus `shuffleMode:true`. Size S.
14. **Library views only read the first music library.** Albums, Home and artist grid use `musicLibraries[0].Id` (`MusicAlbumGrid.tsx:71`, `MusicHome.tsx:316`, artist grid likewise). A second music library (for example "Hörspiele" or "Classical") is invisible outside search. Fix: omit `parentId`, or add a library switcher. Size S–M.
15. **Lyrics are always sent to a third party.** `MusicPlayerBar.tsx:236-350` sends every played track's artist, title and album to `lrclib.net`, with no setting and even when the server has no lyrics. The `User-Agent` points at a placeholder GitHub URL (`:282`). Privacy and opt-out concern. Size S.
16. **`previous()` misses edge cases.** At `queueIndex 0` with repeat off, and when wrapping in a single-track repeat-all queue, the track id does not change, so the source effect does not re-run. The store sets `currentTime:0` but never seeks the element (`:445-450`, unlike `next()`'s same-id restart at `:407-410`). Visible only when ≤3 s into the track. Separately, `previous()` while paused does not resume, which is inconsistent with `next()` setting `isPlaying:true`. Size S.
17. **PLAUSIBLE: changing the server or token mid-track restarts the song.** The source effect deps include `jellyfinServerUrl` and `jellyfinAccessToken` (`PersistentMusicPlayer.tsx:280`). A token or server change while a stream plays reloads `src` from 0 (`resumeAtRef` is reset to 0 at `:271`). Size S.
18. **PLAUSIBLE: pauses during a track change are dropped.** `trackTransitionRef` ignores every `pause` event for 500 ms after a source change (`:222-224`). An OS-initiated pause in that window (headphones unplugged, call starting) leaves `isPlaying=true` while the element is paused, so the UI shows "playing" with silence. Size S.
19. **Deleting a downloaded track leaves playlist downloads stale.** `deleteDownloadedTrack` (`musicDownloadManager.ts:773-811`) updates albums but not `DownloadedPlaylist.trackIds`, so the playlist keeps listing a missing track until the next sync. Size S.

---

## B) Missing features (ranked by value / fit)

| # | Feature | Reference apps | Platform | Effort | Fit / notes |
|---|---|---|---|---|---|
| 1 | **Add to playlist / playlist editing.** Track and album context menu entry "Add to playlist…" with a picker plus "New playlist". Remove and reorder inside a playlist (`DELETE /Playlists/{id}/Items?entryIds=`, `POST /Playlists/{id}/Items/{itemId}/Move/{newIndex}`). Today only "Save queue as playlist" exists (`MusicQueue.tsx:91`, `createPlaylist`). | Spotify, Apple Music, Feishin, Finamp, Symfonium | 🌐 | M | `PlaylistItemId` is already filled by `getPlaylistItems`. Picker = `BottomSheet` on phone, menu on desktop. |
| 2 | **Gapless playback / crossfade.** One `<audio>`, no preloading of the next track: every transition reloads, with an audible gap. | Spotify, Apple Music, Plexamp, Finamp, Symfonium | 🌐 | M–L | Start with a 2nd preloaded `<audio>` that starts on `ended` (near-gapless), then Web Audio for real gapless and crossfade. Must keep the `setSinkId` routing on both elements. |
| 3 | **ReplayGain / volume normalisation.** Jellyfin 10.9+ exposes `NormalizationGain` / `LUFS` on Audio items. | Spotify, Plexamp (Loudness), Finamp, Symfonium | 🌐 | M (S if using `element.volume` scaling only) | Store the gain on `Track`; apply it as a multiplier in the volume effect. |
| 4 | **"Start radio" from a track, album or artist.** `InstantMix` is already used for autoplay (`startAutoplay`). | Spotify, YT Music, Plexamp, Feishin | 🌐 | S | Context-menu item calling `/Items/{id}/InstantMix` + `setQueue(..., 'Radio: X')`. |
| 5 | **Like the current track from the player bar and Now Playing.** No heart in `MusicPlayerBar` (no `Heart` import) or in `MusicNowPlaying`. Liking is only possible in track rows. | Spotify, Apple Music, YT Music | 🌐 | S | `setFavorite` exists. Needs `IsFavorite` on `Track` or a lazy fetch. |
| 6 | **Artist page depth.** Missing: bio (`Overview`), "Appears on" (`contributingArtistIds`), similar artists (`/Artists/{id}/Similar` or `/Items/{id}/Similar`), and a follow/favourite toggle. "Popular" uses the user's own `PlayCount`, so it is empty for new users. | Spotify, Apple Music, Plexamp, Feishin | 🌐 | M | `getSimilarItems` is already used in `JellyfinItemDetails.tsx:2030`. |
| 7 | **Album page depth.** Missing: overview/notes, disc grouping, "More by {artist}", "You might also like" (Similar), genre chips, and label or copyright line. | Spotify, Apple Music, Feishin | 🌐 | S–M | Pairs with bug A4 and A3. |
| 8 | **Synced-lyrics tap-to-seek, plus lyrics on the Now Playing artwork.** Lines are not clickable (`MusicLyrics.tsx:155-170`). There is no "Lyrics" card under the artwork on phone and no translation or karaoke word highlight. | Spotify, Apple Music, Feishin, Symfonium | 🌐 | S | `seek(lyricsTicksToSeconds(line.start))`. |
| 9 | **Keyboard shortcuts for music.** None exist. `ShortcutOverlay` only lists Ctrl+K. Missing: Space (play/pause), Ctrl+→/← (next/previous), Shift+→/← (seek), Ctrl+↑/↓ (volume), L (like), Ctrl+S (shuffle), Ctrl+R (repeat). | Spotify desktop, Feishin | 🖥 | S | Global keydown in JellyMusicView, guarded against inputs. Add to ShortcutOverlay. |
| 10 | **Listening history (track level).** Home has "Recently Played" albums and tracks, but no history page. | Spotify, YT Music, Plexamp | 🌐 | S–M | `sortBy DatePlayed, includeItemTypes Audio`. Roadmap row exists. |
| 11 | **Favourite albums and artists in "Your Library".** Liked Songs exists. Followed artists and saved albums appear only on Home (favourite albums strip), with no library filter. | Spotify, Apple Music, Finamp | 🌐 | S | Add `IsFavorite` filter chips to the album and artist grids. |
| 12 | **Sort and filter in every list.** Album grid has name/artist/date/random. Missing: date added, play count, rating, year range, genre filter. The artist grid only has name/random. Liked Songs, playlist and genre pages have no sort or search-in-list. | Spotify, Feishin, Symfonium | 🌐 | S–M | |
| 13 | **Scrobbling (Last.fm / ListenBrainz).** Only possible through a server plugin; there is no client option. | Plexamp, Symfonium, Feishin | 🌐 | S (doc/link) – M (client scrobbler) | Low priority if the server plugin is used. Fixing A2 makes the plugin accurate. |
| 14 | **Equalizer.** | Symfonium, Plexamp, Apple Music (presets) | 🌐 | M | Web Audio chain, shared with item 3. |
| 15 | **Explicit offline-mode toggle and "downloaded only" filter.** Offline is only auto-detected (`isOffline` → downloads view). There is no manual "Offline mode" switch or "show downloaded only" filter in library views. | Spotify, Finamp, Symfonium | 🌐 | S–M | `isTrackPlayableOffline` exists. Grey out undownloaded rows when offline. |
| 16 | **Download an artist or genre.** "Download this playlist" and album downloads exist. There is no "download all by artist" and no smart auto-download (for example liked songs). | Spotify (Liked Songs download), Finamp, Symfonium | 🌐 | S–M | Reuse `downloadPlaylist` semantics with auto-sync for Liked Songs. |
| 17 | **Smart playlists and mixes on Home** ("Daily mix", "On repeat", per-genre radio). | Spotify, Plexamp (DJ modes), YT Music | 🌐 | M | InstantMix seeded from top played tracks. |
| 18 | **Track credits and info sheet** (composer, codec, bitrate, file path, play count). | Spotify (credits), Feishin, Symfonium | 🌐 | S | `MediaSources`, `People`. |
| 19 | **Playback speed and "skip silence"** (podcast-style). | YT Music, Symfonium | 🌐 | S | Low value for music. |
| 20 | **Car mode, Android Auto, CarPlay.** | Spotify, Plexamp, Symfonium | 📱 | M (in-app car mode) / L (CarPlay, entitlement) | The roadmap's "Future" note already prefers CarPlay. A giant-button car mode is the sideload fallback. |
| 21 | **Remote control or casting to other Jellyfin sessions** ("Play on…"). | Spotify Connect, Feishin, Finamp | 🌐 | M–L | Already a roadmap §4 row; it applies to music too. |
| 22 | **Multi-select in track lists** (shift/ctrl-click, then queue, download or add to playlist). | Spotify desktop, Feishin | 🖥 | M | |

Verified as **existing**, so not missing: Play next and Add to queue (two-lane queue, `addToQueue(..,'next'|'end')`); autoplay; sleep timer (music target); synced and plain lyrics (Jellyfin then LRCLIB); liked songs; album and playlist download with playlist auto-sync; save queue as playlist; offline fallback to local files; audio-device routing; MediaSession with artwork and seek; phone Now Playing; A–Z rail on the artist and album grids.

---

## C) Small UI / gesture / polish (ranked)

| # | Detail | Reference | Platform | Effort | Notes |
|---|---|---|---|---|---|
| 1 | **Swipe the Now Playing artwork left/right to skip; swipe down to dismiss.** `MusicNowPlaying` has no gesture handlers at all (only the seek bar's pointer handler). The roadmap claims "Now also drag-dismissible", which is false (see D). | Spotify, Apple Music, YT Music | 📱 | S–M | Reuse the `SwipeBackOverlay` / `BottomSheet` drag code. |
| 2 | **Swipe the mini/compact bar to skip tracks, drag it up to open Now Playing.** `MusicPlayerBar` phone variant is tap-only. | Spotify, YT Music | 📱 | S | |
| 3 | **Long-press sheet on track rows, artists and playlists.** `useContextMenu().longPressHandlers` is only spread on `AlbumCard`. `MusicTrackRow` relies on its always-visible ⋯ (acceptable). `ArtistCard`, sidebar playlists and the phone playlist list have **no** context menu at all (no Play, Shuffle, Radio or Download). | Spotify, Apple Music | 🌐 | S | |
| 4 | **Swipe a track row right to queue it, left to like it.** | Apple Music, Symfonium, Spotify (swipe to queue) | 📱 | S–M | |
| 5 | **Tappable artist and album in Now Playing.** Artist and album text is plain (`MusicNowPlaying.tsx:122-123`). The desktop bar and the queue already navigate. | Spotify, Apple Music | 📱 | S | Needs the `onNavigate*` props passed through. |
| 6 | **Seek scrubber time preview and drag thumb.** The desktop bar seeks live on every pointermove, with no hover time tooltip and no "preview then commit". The mini player is click-only with no drag. Spotify shows the time while dragging and commits on release. | Spotify, Feishin | 🌐 | S | Live seeking on a stream also causes repeated range requests. |
| 7 | **Mouse wheel volume on the player bar**, and the volume level shown on hover. The video player has a wheel; the music bar does not. | Feishin, Spotify | 🖥 | S | |
| 8 | **Colour-extracted backgrounds.** Now Playing is a flat `bg-gray-900`. The album and artist headers use theme gradients, not the art colours. Lyrics uses a blurred image (good). | Spotify, Apple Music, Plexamp | 🌐 | S–M | Canvas average colour, or Vibrant via an offscreen canvas. |
| 9 | **Queue-peek and "Playing from: X" header on Now Playing.** There is no "Playing from album X" line above the artwork and no next-track peek. The context name exists (`queueContextName`). | Spotify, Apple Music | 📱 | S | |
| 10 | **Animated now-playing bars consistency.** `MusicTrackRow` uses `animate-music-bar-*`. The queue drawer uses static `animate-pulse` bars (`MusicQueue.tsx:465-470`). Album, artist, playlist and genre cards do not show that they contain the playing track. | Spotify | 🌐 | S | |
| 11 | **Shuffle-play button on album cards and playlist rows**, and "Play" on artist cards. AlbumCard has hover play, ArtistCard has none, and sidebar playlists have none. | Spotify | 🖥 | S | |
| 12 | **Album header details.** Missing: total duration as "1 hr 12 min" (currently "72 min"), release date, label and disc count. The playlist header shows no duration for long lists. | Spotify, Apple Music | 🌐 | S | |
| 13 | **Explicit badge and lossless/hi-res badge** (from `Tags` or the codec). | Spotify, Apple Music, Symfonium | 🌐 | S | |
| 14 | **Queue: drag a row to the top lane; "Clear upcoming" vs "Clear all"; touch drag.** The HTML5 `draggable` reorder (`MusicQueue.tsx:68-89`) does **not work on touch** (iOS/Android WebViews have no HTML5 DnD), so the always-visible grip is decorative on phones. Cross-lane drag is refused. "Clear queue" also stops the current song. | Spotify, Apple Music | 📱/🌐 | M | Pointer-based sortable list, the same as the gap noted for the audiobook queue. |
| 15 | **Undo snackbar** after removing from queue, unliking, or deleting a download. | Spotify, YT Music | 🌐 | S | Toast exists. |
| 16 | **"Add to queue" confirmation toast.** The track-row and album-card actions are silent. | Spotify | 🌐 | S | |
| 17 | **Lyrics button disabled while loading** (`MusicPlayerBar.tsx:596`), and greyed "No lyrics" with no explanation. Phone Now Playing always shows a Lyrics button even when there are none. | Spotify | 🌐 | S | |
| 18 | **Haptics on phone transport buttons, like and long-press.** `haptics.ts` exists but none of the music files import it. | Apple Music, Spotify | 📱 | S | |
| 19 | **Sleep timer: "end of album/playlist" option and shake-to-extend.** Only minutes and end-of-track exist. | Apple Music (end of album), Symfonium | 🌐 | S | |
| 20 | **Remember shuffle, repeat and volume across restarts.** Only autoplay is persisted (`AUTOPLAY_STORAGE_KEY`). The queue and position are also lost on restart (no "resume where you left off"). | Spotify, Finamp, Symfonium | 🌐 | S–M | Persist a queue snapshot plus position to localStorage. |

---

## D) Roadmap reconciliation (`docs/development/feature-roadmap.md`)

**Section 5 rows with wrong status:**
- `| ☐ | **Lyrics view** (synced lyrics, tap to seek) |` → **mostly done.** `MusicLyrics.tsx` has synced auto-scroll and highlight. Sources are Jellyfin `/Items/{id}/Lyrics` and the LRCLIB fallback. The panel is fullscreen on phone and a modal on desktop. Missing: **tap-to-seek** (B8) and a Spotify-style full page. Mark ◐ / partial.
- `| ☐ | **Fullscreen "Now Playing" view** (big artwork, blurred background, queue peek) |` → **done on phone only, without the blurred background or queue peek.** `MusicNowPlaying.tsx` is phone-only, flat background, no swipe gestures. Wave 2 item 6 already says ☑ ("delivered by the phone-layout pass … Now also drag-dismissible"). The **"drag-dismissible" claim is false**: `MusicNowPlaying.tsx` has no drag or swipe handling, only a chevron close button, and it also ignores Back (A9). Desktop has no fullscreen view. Mark §5 ◐ and correct the Wave 2 note.
- `| ☐ | **Sleep timer for music** | 🌐 | S | Reuse the audiobook one. |` → **done.** `sleepTimerStore` target `'music'` is used in the `MusicPlayerBar` popover and the Now Playing BottomSheet, with fade and end-of-track. The Wave 1 list (line 182) already says ☑. Mark §5 ☑.
- `| ☐ | **Playlist editing** (create playlist, add/remove/reorder tracks from the app) |` → **partial.** Create exists only as "Save queue as playlist" (`MusicQueue.tsx`). Add-to-playlist, remove and reorder are missing (B1). The note "currently playlists are read-only" is outdated.

**Section 5 rows that are correct (still ☐, verified missing):**
- `**Crossfade / gapless playback**` → B2.
- `**Volume normalization (ReplayGain)**` → B3.
- `**Equalizer**` → B14.
- `**"Song radio" / start radio from any track**` → B4.
- `**Recently played history view**` → B10.

**Other sections that touch music:**
- §3 `| ☐ | **Drag & drop**: drag tracks/albums onto playlists or the queue |` → still open; relates to C14 and B1.
- §3 `**System tray** … play/pause/next for music` and `**Always-on-top floating mini player**` → still open. Not audited further.
- §2 (line 29) `**Long-press context menus** … wired on AlbumCard … Books/videos still to extend` → accurate for albums, but it also needs to mention **artists and playlists**, which have no menu at all (C3).
- Future (line 152) `**CarPlay support** … in-app car mode` → B20.

**Findings the roadmap does not list:**
- **All A-group bugs:**
  - A1 repeat-one blocks skip;
  - A2 playback reporting (no progress, no Stopped, nothing reported outside the tab);
  - A3 stub album details;
  - A4 multi-disc order;
  - A5 playlist `getItems` in the helper;
  - A6–A8 queue, shuffle and autoplay state bugs;
  - A9 Now Playing back handling;
  - A10 mini-player local cover;
  - A11 legacy MusicView removal (the memory file mentions a "legacy MusicView audio conflict" as open in the perf audit, but the roadmap does not);
  - A12 download-index parsing;
  - A13 album/playlist shuffle buttons not using shuffle mode;
  - A14 only the first music library is used;
  - A15 LRCLIB privacy opt-out;
  - A16–A19.
- **B items not listed:** B1's add-to-playlist flow (folded into "Playlist editing"), B5, B6, B7, B9, B11, B12, B13, B15, B16, B17, B18, B19, B21 (the §4 row is video-centric), B22.
- **C items not listed:** all of C1–C20, except C14, which partially maps to the §3 drag & drop row.
