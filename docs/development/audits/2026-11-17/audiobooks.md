# Audit: Audiobooks & Podcasts (Audiobookshelf)

Scope: `src/components/audiobookshelf/*`, `PersistentAudiobookPlayer.tsx`, `AudiobookMiniPlayer.tsx`, `reader/AudiobookControlsMenu.tsx`, `stores/audiobookPlayerStore.ts`, `stores/sleepTimerStore.ts`, `utils/abs*.ts`, `mediaSessionOwner.ts`. Read-only audit, 2026-11-17.
Abbreviations: **PAP** = `src/components/PersistentAudiobookPlayer.tsx`, **Store** = `src/stores/audiobookPlayerStore.ts`.

---

## A) Bugs / likely defects (ranked)

| # | Severity | Location | Defect & concrete failure scenario |
|---|---|---|---|
| A1 | High | `AbsItemDetails.tsx:91-106` + Store `:168,225-232` + PAP `:247-265,210-218` | **Clicking a chapter on a book that is not playing starts at the resume position (or 0), not at the chapter.** `startItemPlayback()` → `startPlayback` sets `pendingTrackSeek = resumeOffset`, then `seek(chapter.start)` runs right away. For a single-file m4b (same track), `seek` sets `audioRef.currentTime = offset` directly, but the src effect only runs after the render, assigns `audio.src` + `load()` (resets currentTime to 0), and then `loadedmetadata` applies the old `pendingTrackSeek`. Result: the chapter tap is lost. If the resume position is < 0.5 s, `pendingTrackSeek` is null and playback starts at 0. |
| A2 | High | Store `seek` `:225-232`, PAP `:214-216,222-224` | **A stale `pendingTrackSeek` jumps into the middle of the next file.** The same-track branch of `seek` never clears `pendingTrackSeek`. Case (a): pressing Play/Resume on the book that is already loaded (series row, home card ▶, details button). `startPlayback` sets a new `pendingTrackSeek` and `currentTime` (the server position, up to 15 s behind), but the src effect deps (`currentItem?.id, currentEpisodeId, trackIndex, isOfflinePlayback`) don't change. No reload happens, so `loadedmetadata` never consumes the value. When the file later ends, `handleEnded` → `trackIndex+1` → the new file's `loadedmetadata` applies the stale offset, and playback starts minutes into file N+1. Case (b): two quick +30 s taps across a file boundary. The second `seek` lands in the "same track" branch while the first load is still pending, so it writes `currentTime` on an element with no metadata, and then `loadedmetadata` restores the first offset. The second skip is lost. |
| A3 | High | PAP `:220-231` + `:293-297` + `:97-119`, `absOfflineQueue.ts:44-49` | **The end of a downloaded book is un-marked "finished" right away.** `handleEnded` calls `reportProgress(true)`. That sets `isPlaying:false`, and the pause effect then calls `reportProgress()` (isFinished=false). With `sessionId === null` (offline/downloaded playback), both calls `patchProgress(queueEntry)`, and the second PATCH sends `isFinished:false`, which overwrites the first. If the server is unreachable, the second `addToAbsQueue` replaces the queued `isFinished:true` entry (the queue keeps the newest entry per key), so the book is never marked finished. |
| A4 | High | `absOfflineQueue.ts:52-78` | **The offline queue overwrites newer server progress (last write wins, no timestamp check).** `processAbsQueue` blindly PATCHes `currentTime`/`isFinished:false`. Scenario: you listen offline on the phone to 2:10:00, then continue on desktop to 3:00:00 or finish the book. When the phone reconnects, it pushes 2:10:00 and `isFinished:false`, so the desktop progress and the "finished" flag are lost. There is no `GET /api/me/progress` + `lastUpdate` comparison against `entry.ts`. |
| A5 | High | PAP `:234-236`, `absApi.ts:224-227` | **The `<audio>` element has no `error`/`stalled` listener.** The project memory says audio elements MUST have one. Track URLs embed `?token=<accessToken>` once, at src time. With ABS ≥2.26 refreshable (short-lived) tokens, a long single-file m4b that keeps streaming past token expiry gets 401 on later range requests (buffering or seeking). The element errors silently, `isPlaying` stays true, the UI shows "playing" with no sound, and there is no retry with a refreshed URL. The same happens with a deleted download file or a server restart. |
| A6 | Med-High | PAP `:292-302`, Store `seek` | **Seeks are never synced while paused.** A report fires only on the 15 s interval while playing and once on the pause transition. Scenario: paused → tap a chapter / scrub to 4:00:00 → close the app or switch device. The server and the local resume map still hold the pre-seek position. `saveLocalAbsProgress` is also only called from `reportProgress`. |
| A7 | Med-High | PAP `:157-172` | **No reliable final sync on app close/background.** Only `beforeunload` fires an async `closeSession` (a Tauri IPC request that is not awaited, likely killed with the process on desktop). On iOS/Android, `beforeunload` never fires on background/kill, and there is no `visibilitychange`/`pagehide` handler. Up to 15 s of progress (server and local resume map) is lost each time the OS kills the app while it is playing. |
| A8 | Med | PAP `:131-154` | **Switching away from sessionless (downloaded) playback drops the last ≤15 s.** On item change, only a previous *server session* is closed. When the previous playback was offline (`sessionId:null`), nothing is reported and `saveLocalAbsProgress` isn't called. `stop()` (mini-player ✕) has the same gap, because the pause effect returns early when `currentItem` is null (`:294`). |
| A9 | Med | `AudiobookshelfContext.tsx:76,109`, `AbsHome.tsx:57-60`, `AbsLibrary.tsx:91-94`, `AbsSeriesDetails.tsx:73-74`, `AbsPodcastDetails.tsx:96-100` | **Progress bars and finished markers are frozen at login.** All lists read `user.mediaProgress`, which is fetched only by `getMe()` at session restore or login and never refreshed. After you listen for an hour, mark a book finished, or finish an episode, the home cards, library cards, series rows and episode "% listened"/played state are stale until the app restarts. The pull-to-refresh/refresh button remounts the views but does not refetch `/api/me`. |
| A10 | Med | `AbsHome.tsx:38` | **Podcast home shelves are dropped.** The filter keeps only `book`/`podcast`/`series` shelves, but ABS returns podcast "Continue Listening" and "Newest Episodes" as `type: 'episode'`. Podcast libraries therefore lose their two most useful rows. `authors` shelves are dropped too. |
| A11 | Med | `AbsDownloads.tsx:31,53` | **Downloaded playback ignores server progress even when online.** It resumes only from `abs_local_progress`. If you listened further on another device, the download resumes from the old local position, and the next sync (A4) then rolls the server back. |
| A12 | Med | Store `:266-270` vs `:258-264`, PAP `:280-284` | **Mute is stuck after using the volume slider.** `toggleMute` sets `audio.muted=true`, but `setVolume` clears `isMuted` in state without resetting `audio.muted`. The slider then shows unmuted while the audio stays silent. The next click on the speaker icon *mutes* again (state false → true), so a second click is needed. There are also two mute mechanisms (`muted` and `volume=0` in `loadedmetadata`). |
| A13 | Med | `AbsPlayerBar.tsx:125-129`, PAP `:196-207` | **The "End of chapter" timer is pinned to a fixed media time.** If you seek forward past that chapter after setting it, the player pauses immediately. If you seek backward, it plays for more than one chapter. The timer also has no fade, no remaining-time display, and no "active option" check in the menu. Expiry calls `reportProgress()` and `pause()` → the pause effect reports again, which is a redundant double sync. |
| A14 | Med (PLAUSIBLE) | PAP `:112-125` | **A dead server session is never re-opened.** After an ABS restart (sessions are in memory), `POST /api/session/{id}/sync` returns 404 on every tick. Each failure is queued as a PATCH, but `processAbsQueue` runs only after a *successful* sync or a view remount. Progress then lands only via the queue, and listening stats/timeListened for the rest of the session are lost. A 404 should trigger a new `play` session or fall back to direct PATCH plus a flush. |
| A15 | Low-Med | Store `play` `:196-204` | **Play after the book has ended restarts the last file, not the book.** After `ended` on the last track, `play()` calls `audio.play()`, which restarts *that file* from 0. The absolute time jumps to the last track's `startOffset`. A 30-file book replays file 30. |
| A16 | Low-Med | `mediaSessionOwner.ts:55`; PAP `:319-327` | **MediaSession gaps.** Release hands the lock screen to music *first* even if the audiobook was the last active player. `previoustrack`/`nexttrack` are not registered, so headset double-tap, AirPods and car buttons don't move between chapters. `seekbackward`/`seekforward` ignore `details.seekOffset`. Artwork for offline playback is a `book-file://` URL, which the OS lock screen probably can't load (PLAUSIBLE). Chapter titles never reach the metadata (`album`). |
| A17 | Low-Med | `AbsPlayerBar.tsx:110-120,193-223` | **Convention violation:** the speed/sleep popovers (also used on phone) don't call `blockGlobalEsc`/`registerBackHandler`. Esc, mouse-back or edge-swipe while a menu is open navigates the ABS view history behind it. Phone should use `BottomSheet`/`BottomSheetSelect` like the music and video sleep menus. |
| A18 | Low | `AudiobookMiniPlayer.tsx:16-40` | Subscribes to `currentTime` through `useShallow` for the whole bar. That re-renders the full mini player 4×/s and violates the store's own rule (`Store:14-15`, only isolated scrubber components may subscribe). Extract the progress bar and time labels like `AbsScrubber`. |
| A19 | Low | `AbsItemCard.tsx:43-52` | The ▶ quick-play button is `opacity-0 group-hover:opacity-100`, so phone/touch users can't see or use it. There is no long-press sheet either (Wave 2 item 2 says it is "still to extend to books/audiobook items"). |
| A20 | Low | `absDownloadManager.ts:279`, `:167-171`, `:129` | `verifyAbsDownloads` checks only `files[0]`, so a partially deleted book still lists as playable and then fails silently (see A5). The cover is requested as `format=webp` but saved as `cover.jpg`. Downloads use all `media.audioFiles`, including ones marked `exclude` server-side (PLAUSIBLE). Then `startOffset`s and chapters drift from the server's track list. Downloads can't be cancelled. |
| A21 | Low | `AbsSeriesGrid.tsx:131`, `AbsHome.tsx:105` | The series card cover is `books[0]`, which is not sorted by sequence, so it often shows book 3's cover. |
| A22 | Low | `AbsPodcastDetails.tsx:152` | The episode list is not virtualized or paged. Podcasts with more than 1,000 episodes render every row (with a `useDownloadFraction` hook per row). |

Verified OK (no defect): resume offset → `(track, offset)` mapping in `startPlayback`. Playback rate is persisted and applied on every `loadedmetadata` (global, not per book). MediaSession is released when `currentItem` becomes null and on unmount. Music, video, LiveTV and CBZ reader pause the audiobook. Switching between streaming items closes the old session with the final position.

---

## B) Missing features vs. reference apps (ranked by value ÷ effort)

| # | Feature | Reference | Platform | Effort | Fit / notes |
|---|---|---|---|---|---|
| B1 | **Fullscreen "Now Playing" for audiobooks** (big cover, chapter title, chapter-relative scrubber, speed/sleep/bookmark/chapter-list buttons) | ABS app, Audible, Apple Books, BookPlayer | 📱 (🌐) | M | Music already has `MusicNowPlaying` (drag-dismiss). Clone it for ABS and open it from the phone bar tap. This is the biggest phone UX gap; the phone bar is currently a cramped single row. |
| B2 | **Chapter list in the player** (sheet with current chapter highlighted, per-chapter progress, remaining time) | All | 🌐 | S | `chapters` and `getCurrentChapterIndex` exist. Chapters show only on the details page (no current marker). |
| B3 | **Bookmarks with notes** | ABS app, Audible, BookPlayer | 🌐 | M | ABS API: `POST/PATCH/DELETE /api/me/item/{id}/bookmark`; bookmarks come back in `/api/me`. Not in `absApi.ts`. |
| B4 | **Smart rewind on resume** (rewind 2–30 s depending on pause length) | Audible, BookPlayer, Pocket Casts | 🌐 | S | Store the pause timestamp in `pause()` and apply it in `play()`. Trivial and much loved. |
| B5 | **Sleep timer upgrade**: custom minutes, live countdown, fade-out, shake-to-extend / "+5 min", end-of-chapter that follows seeks | Audible, BookPlayer, ABS app | 🌐 / 📱 shake | S–M | Migrate onto the shared `sleepTimerStore` (add target `'audiobook'`, register pause/fade handlers in PAP). Shake needs DeviceMotion (iOS permission) or a native shim. |
| B6 | **Per-book playback speed** (remember the speed per item, global default) | BookPlayer, Pocket Casts (per podcast), ABS app | 🌐 | S | `abs_playback_rate` is global. Add a `Record<itemId, rate>` map and apply it in `startPlayback`. |
| B7 | **Reset progress / "Listen again" / remove from Continue Listening** | ABS web/app, Audible | 🌐 | S | `toggleFinished` only flips the flag. Add `DELETE /api/me/progress/{id}` and `GET /api/me/progress/{id}/remove-from-continue-listening`. |
| B8 | **Podcast queue / auto-play next episode / "Up Next"** | Overcast, Pocket Casts, Apple Podcasts | 🌐 | M | The store holds one item. Add `queue: {itemId, episodeId}[]` and advance in `handleEnded`. ABS has playlists (`/api/playlists`) to sync it. |
| B9 | **New-episode badges + "N new" + auto-download newest N / auto-delete played** | Podcatchers | 🌐 | M | ABS `GET /api/libraries/{id}/recent-episodes`. Pairs with A10. Already on the roadmap. |
| B10 | **Skip silence / volume boost** | Overcast, Pocket Casts, ABS app (Android) | 🌐 | L | Web Audio `AnalyserNode` + rate bumps. Desktop WebView2 is fine; iOS WKWebView needs a `MediaElementSource` CORS-clean stream (token URL OK, same origin? no). Risky. |
| B11 | **Authors / narrators / collections / genres browsing**, library sort + filter (added, duration, progress, "not started") | ABS app, Plappa, Audible | 🌐 | M | ABS: `/api/libraries/{id}/authors`, `/narrators`, `/collections`, `filter=progress.<b64>`. `AbsLibrary` hard-codes `sort: media.metadata.title`. |
| B12 | **Listening stats** (today, week, streak, per book) | ABS app, Audible, BookPlayer | 🌐 | S–M | ABS `GET /api/me/listening-stats` already exists server-side. A read-only page is cheap. |
| B13 | **Playback history / sessions list** | ABS web | 🌐 | S | `GET /api/me/listening-sessions`. |
| B14 | **Series progress** ("3 of 7 finished", "Continue series → next unfinished book" button) | Audible, Plappa | 🌐 | S | `AbsSeriesDetails` already computes `finishedCount`. Add a "next up" CTA. |
| B15 | **ABS ebooks** (EPUB/PDF attached to ABS items) opened in the existing Reader, ideally read-along with the audio | ABS app | 🌐 | M | `media.ebookFile` → `/api/items/{id}/ebook`. The Reader already supports EPUB/PDF and has `AudiobookControlsMenu`. |
| B16 | **CarPlay / Android Auto** | Audible, ABS app | 📱 | L | CarPlay needs an Apple entitlement (not available with Sideloadly free provisioning). Android Auto needs a `MediaBrowserService` (native). The roadmap §12 notes the caveat. Fallback: "car mode" giant-button view. |
| B17 | **Queue of multiple books / "play next in series" at book end** | BookPlayer, Plappa | 🌐 | M | Same foundation as B8. |
| B18 | **Download whole series / "next 3 episodes"**, Wi-Fi-only | ABS app, podcatchers | 🌐 | S–M | `downloadAbsItem` in a loop; roadmap §8 row. |
| B19 | **System tray / global hotkeys controlling audiobooks** | Desktop players | 🖥️ | M | Roadmap §3 rows mention audiobooks. |

---

## C) Small UI / gesture / polish (ranked)

| # | Item | Reference | Platform | Effort | Notes |
|---|---|---|---|---|---|
| C1 | **Chapter-relative scrubber** (toggle chapter ↔ book time) | Audible, Apple Books, BookPlayer | 🌐 | S | `AbsScrubber` spans the whole book with `step=1`. On a 30 h book a 300 px phone bar is ~6 min per pixel, which makes precise scrubbing impossible. |
| C2 | **Time left at current speed** ("2h 14m left · 1.5×", chapter time left) | Audible, BookPlayer | 🌐 | S | `(duration-currentTime)/playbackRate`. Isolated subscriber component. |
| C3 | **Configurable skip intervals (10/15/30/45/60) with the number shown in the icon** | Pocket Casts, Overcast, ABS app | 🌐 | S | Hard-coded ±30 in 5 places (`AbsPlayerBar` ×4, mini player, controls menu, MediaSession). Lucide `RotateCcw` shows no number. |
| C4 | **Speed control**: 0.05 stepper + presets (0.8–3.5×) instead of a 9-entry list | BookPlayer, Pocket Casts, Audible | 🌐 | S | Also unify lists: `AudiobookControlsMenu` has 6 speeds and the bar has 9, so 2.5×/3× shows nothing selected in the Reader menu. |
| C5 | **Desktop keyboard shortcuts** (Space play/pause, ←/→ skip, Shift+←/→ chapter, [ ] speed) + entries in `ShortcutOverlay` | Desktop players | 🖥️ | S | None exist for audiobooks (grep: no audiobook entries in `ShortcutOverlay.tsx`). |
| C6 | **Chapter title in the mini player and lock screen** | Audible, ABS app | 🌐 | S | Mini player shows title and author only. Put the chapter in MediaSession `album`/`artist`. |
| C7 | **Phone menus as BottomSheets** (speed, sleep, chapters) with active-check and haptic | Project convention | 📱 | S | Fixes A17. |
| C8 | **Sleep-timer chip with countdown** on the bar and mini player; "Off" row checked | Audible | 🌐 | S | Currently only the icon tint changes. |
| C9 | **Download progress / downloaded badge on `AbsItemCard`** and in series rows | ABS app, Plappa | 🌐 | S | Only the details page shows it. The `subscribeToAbsDownloads` data is available. |
| C10 | **Swipe on the phone mini/player bar** (left/right = skip ±interval, up = open Now Playing) | Spotify-style, ABS app | 📱 | S–M | |
| C11 | **Tap-and-hold skip = fast scan**, long-press ▶ for speed | BookPlayer | 📱 | S | |
| C12 | **Cover-colour gradient background** in details and Now Playing | Apple Books, Audible | 🌐 | S | Sample the dominant colour from the 600 px cover (canvas; cover is same-origin via token URL. CORS may need checking). |
| C13 | **Resume prompt / continue banner** ("Resume at 3:12:40 · Chapter 14?" vs "Start over") | Audible | 🌐 | S | Pairs with B7. |
| C14 | **Current-chapter marker + progress in the details chapter list**, auto-scroll to it | Audible | 🌐 | S | |
| C15 | **Episode row polish**: show notes/description expand, "played" filter, sort toggle (oldest-first for serial podcasts), season/episode numbers | Apple Podcasts, Overcast | 🌐 | S–M | Episode list is newest-first only; `season`/`episode` are typed but unused. |
| C16 | **Haptics** on skip, speed and sleep set (policy: sleep-timer set explicitly listed in `haptics.ts`) | iOS norm | 📱 | S | ABS UI calls no haptics. |
| C17 | **Library: progress/finished overlay + "finished" check on cards**; hide finished toggle | ABS app | 🌐 | S | Cards only show an in-progress bar. |

---

## D) Roadmap reconciliation (`docs/development/feature-roadmap.md`)

### Section 7 rows: status check
| Row | Listed status | Actual per code | Verdict |
|---|---|---|---|
| "**Bookmarks** ("save this position" with note)" ☐ | ☐ | No bookmark code in ABS files/`absApi.ts` | Correct (= B3) |
| "**Skip silence**" ☐ | ☐ | Absent | Correct (= B10) |
| "**Sleep timer: shake-to-extend / end-of-chapter option**" ☐ | ☐ | **End-of-chapter already exists** (`AbsPlayerBar.tsx:20,125-129`, PAP `:201`). Shake-to-extend is absent | **Wrong status → ◐**; also note the seek bug A13 and the missing fade/countdown (B5, C8) |
| "**New-episode notifications for podcasts**" ☐ | ☐ | Absent; home even drops episode shelves (A10) | Correct (= B9) |
| "**Auto-download newest N podcast episodes + auto-delete finished**" ☐ | ☐ | Absent | Correct (= B9/B18) |

### Wave 1 item 5 / related rows
- Wave 1 item 5: "☑ Sleep timer for video & music … shared `sleepTimerStore`". Accurate, but the audiobook timer was deliberately left separate (`sleepTimerStore.ts:2-3`) and is now the *weakest* of the three: no fade, custom minutes or countdown. This is not listed anywhere → B5/C8.
- §4 row "Sleep timer for video … Audiobooks already have one — extract/reuse" ☐ and §5 row "Sleep timer for music" ☐ are **stale** (both done in Wave 1) → should be ☑.
- §8 row "Unified download manager screen" ☐ is **stale**. Wave 1 item 10 is ☑, and `DownloadPanel.tsx` includes an "Audiobooks" source → ☑.
- §2 row "Long-press context menus" ☑ notes "Books/videos still to extend". Audiobook cards are also missing it (A19), which is not called out.

### Findings → roadmap mapping
| Finding | Roadmap |
|---|---|
| A1–A22 (all bugs) | **Not listed** (roadmap has no bug section). A3/A4/A11 relate loosely to §8 "Global offline banner + graceful offline mode" ☐ but aren't covered |
| B1 Now Playing (audiobook) | Not listed (only music: Wave 2 item 6 "Fullscreen 'Now Playing' music view" ☑) |
| B2 Chapter list in player | Not listed |
| B3 Bookmarks | Listed §7 ☐ (correct) |
| B4 Smart rewind | Not listed |
| B5 Sleep timer upgrade | Partly: §7 "Sleep timer: shake-to-extend / end-of-chapter option" (status wrong, see above) |
| B6 Per-book speed | Not listed |
| B7 Reset progress / remove from continue | Not listed |
| B8 / B17 Queue / up next | Not listed for audiobooks |
| B9 New episodes / auto-download | Listed §7 (two rows) ☐ |
| B10 Skip silence | Listed §7 ☐ |
| B11 Authors/narrators/collections/sort | Not listed (§1 A–Z rail ☑ only) |
| B12 Stats | Not listed for audio (§6 "Reading stats" ☐ is books only; §12 "year-in-review") |
| B13 History | Not listed for audiobooks (§5 history row is music) |
| B14 Series progress | Not listed |
| B15 ABS ebooks | Not listed |
| B16 CarPlay/Android Auto | Listed §12 "CarPlay support for audiobooks/music" (with sideload caveat). Android Auto not mentioned |
| B18 Download series / next 3 episodes | Listed §8 "'Download next 3 episodes' smart action on series/podcasts" ☐ |
| B19 Tray / global hotkeys | Listed §3 "System tray … music & audiobooks" ☐ and "Global media hotkeys" ☐ |
| C1–C17 | **None listed**, except C5 partly via §3 "Keyboard shortcut cheat-sheet overlay" (done in Wave 1, but it has no audiobook keys) and C7 via Wave 2 item 3 (bottom sheets: "converted … player audio/subtitle/sleep/stats menu", which covers the video player only; the ABS menus were not converted) |
