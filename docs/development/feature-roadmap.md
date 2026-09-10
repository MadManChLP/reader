# Mediamaster — Quality-of-Life Feature Roadmap

A collection of features typical for media apps (Netflix, Spotify, Plex, YouTube, Apple Books, Tachiyomi, …)
that are currently missing, organized by area. Platform column: 🖥️ desktop, 📱 phone, 🌐 both.
Effort: **S** (hours), **M** (a day or two), **L** (multi-day / touches native code or CI).

Legend for status: ☐ open · ◐ partially exists · ☑ done

---

## 1. Navigation & App Shell

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Tap active tab → go home** (reset that app's view to its home screen) | 🌐 | S | Both `AppTabs` and `BottomTabBar` currently ignore taps on the active tab. iOS convention: first tap = pop to root. |
| ☐ | **Tap active tab again (already home) → scroll to top** | 📱 | S | Second half of the iOS convention. Needs a scroll-container ref per view. |
| ☑ | **Edge-swipe back gesture** (swipe from left edge = back) | 📱 | M | *Done 2026-07-20 (Wave 2, `db6ad39a0`):* `SwipeBackOverlay` in AppShell — left-edge chevron puck, arms at 70px with haptic, drives `dispatchBack('swipe')` through the existing back-handler stack. |
| ☐ | **Mouse back/forward buttons (Mouse4/Mouse5) navigate back/forward** | 🖥️ | S | Desktop browser convention; single `mouseup` listener mapping to the active view's back handler. |
| ☐ | **Esc = back** everywhere (not just in players/modals) | 🖥️ | S | Consistent keyboard back navigation. |
| ☐ | **Keyboard navigation in grids** (arrow keys move focus, Enter opens) | 🖥️ | M | Focus rings + roving tabindex in library grids. Also an accessibility win. |
| ☑ | **"Start where I left off"**: reopen the app in the last-used tab & view | 🌐 | S | *Done 2026-07-28:* `src/utils/lastTab.ts` persists the top-level tab to localStorage on every view change; App.tsx restores it on launch. Replaced the manual "Default Start Page" setting (kept as one-time migration fallback). Settings Home button now returns to `previousView`. |
| ☑ | **Pull-to-refresh** on phone lists/grids | 📱 | M | *Done 2026-07-20 (Wave 2, `db6ad39a0`):* `usePullToRefresh` + `PullToRefreshIndicator`, reusing each tab's existing refresh. Wired on the six homes + library grids; EPG grid skipped (two-axis pan). |
| ☑ | **A–Z fast-scroll index** on long alphabetical lists (artists, authors, library) | 📱 | M | *Done 2026-07-20:* `AlphabetScrollRail` on music artists/albums, Jellyfin library, ABS library, Calibre All-Books. Indexes loaded items (paginated lists span what's loaded; Calibre spans the full list). |

## 2. Phone-Specific Polish

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☑ | **Long-press context menus** (touch equivalent of right-click) | 📱 | M | *Done 2026-07-20 (Wave 2):* `MusicContextMenu` now opens as a `BottomSheet` on phone; `useContextMenu` returns a 500ms long-press detector, wired on `AlbumCard` (hover-only ⋯ had no touch path). Books/videos still to extend. |
| ☑ | **Bottom sheets instead of dropdowns/modals** | 📱 | M | *Done 2026-07-20 (Wave 2):* shared `BottomSheet`/`BottomSheetSelect`; converted music context menu, player audio/subtitle/sleep/stats menu, and sort/filter selects (album/artist/Jellyfin grids). Desktop dropdowns untouched. |
| ☑ | **Haptic feedback** (light tap on toggle/download-complete/long-press) | 📱 | S–M | *Done 2026-07-20 (Wave 2):* `tauri-plugin-haptics` (mobile-gated) + `src/utils/haptics.ts` wrapper (no-op off-phone). Subtle policy: tab switch, sheet open, long-press, gesture arm thresholds. |
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
| ☐ | **In-app video mini player** (shrink playing video to a corner while browsing the library) | 🌐 | M–L | Audiobook & music mini players exist; video is the missing one. YouTube-style corner player. |
| ☐ | **Drag & drop**: drag tracks/albums onto playlists or the queue | 🖥️ | M | Queue reorder-by-drag exists; dragging *into* the queue/playlists doesn't. |
| ☐ | **Multi-select in grids** (Ctrl/Shift-click → mark watched, download, delete) | 🖥️ | M | Batch operations are a big QoL win for library management. |
| ☐ | **Keyboard shortcut cheat-sheet overlay** (press `?`) | 🖥️ | S | Many shortcuts exist (player, Ctrl+K) but are undiscoverable. |
| ☐ | **Window state memory** (size/position/maximized restored on launch) | 🖥️ | S | Tauri window-state plugin — nearly free. |
| ☐ | **Auto-update / update check** for the desktop app | 🖥️ | M | Tauri updater, or a simple "new version available" toast checking a release feed. (iOS sideload can't self-update — show a notice instead.) |

## 4. Video Player (Jellyfin / Live TV)

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Double-tap left/right screen zones = ±10s** | 📱 | S | The YouTube/Netflix mobile gesture; the player currently only has buttons + keyboard. |
| ◐ | **Vertical swipe zones: left = brightness, right = volume** | 📱 | M | *Done 2026-07-20:* right = volume (real), left = in-app dim overlay. Real system brightness still needs an iOS entitlement shim (deferred). Jellyfin player only. |
| ☐ | **Lock button** (disable all touch input while watching) | 📱 | S | Prevents accidental seeks when holding the phone. |
| ☐ | **Pinch to zoom / fill-vs-fit aspect toggle** | 📱 | S–M | For 21:9 content on a 19.5:9 phone screen. |
| ☐ | **Sleep timer for video** ("stop after this episode" / after N minutes) | 🌐 | S | Audiobooks already have one — extract/reuse. |
| ☐ | **Skip credits / auto-play next with countdown ring** | 🌐 | S–M | Up-next flyout exists; MediaSegments "Outro" segments could trigger it like Skip Intro does. |
| ☑ | **Subtitle appearance settings** (size, background, position) | 🌐 | M | *Done 2026-07-28:* replaced native `<track>`/`::cue` with **libass (JASSUB)** rendering in JellyfinPlayer. ASS/SSA now render with authored fonts/positions/colors/karaoke (fetched as `.ass`, not flattened to VTT); SRT/VTT are converted to ASS built from a full **SubtitleStyle** (font, size, color, edge style, outline color, background box, position, bold) edited in Settings → Jellyfin with a live preview. Text-sub changes apply live (no reload). See [[jellyfin-subtitles-libass]]. |
| ☐ | **Remember per-series audio/subtitle language choice** | 🌐 | M | Pick German audio once → all following episodes use it. Persist per series in settings. |
| ☐ | **Chromecast / AirPlay casting** | 🌐 | L | Big one. AirPlay on iOS is partly free via `webkitShowPlaybackTargetPicker`; Chromecast needs the sender SDK. Alternative below ↓ |
| ☐ | **"Play on…" remote control** (control another Jellyfin client/session) | 🌐 | M–L | Jellyfin Sessions API can command other devices — poor-man's casting without any cast SDK. |

## 5. Music (JellyMusic)

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Lyrics view** (synced lyrics, tap to seek) | 🌐 | M | Jellyfin 10.9+ has a Lyrics API (`/Audio/{id}/Lyrics`). Spotify-style fullscreen lyrics page. |
| ☐ | **Fullscreen "Now Playing" view** (big artwork, blurred background, queue peek) | 🌐 | M | Tap the player bar → immersive view. On phone this is *the* expected music UX. |
| ☐ | **Crossfade / gapless playback** | 🌐 | M–L | Two overlapping audio elements or Web Audio API. Gapless matters for live albums. |
| ☐ | **Volume normalization (ReplayGain)** | 🌐 | M | Jellyfin exposes `NormalizationGain`; apply via Web Audio gain node. |
| ☐ | **Equalizer** | 🌐 | M | Web Audio `BiquadFilter` chain + presets. Pairs with the existing per-tab audio-device routing. |
| ☐ | **Sleep timer for music** | 🌐 | S | Reuse the audiobook one. |
| ☐ | **Playlist editing** (create playlist, add/remove/reorder tracks from the app) | 🌐 | M | Jellyfin playlist API; currently playlists are read-only. |
| ☐ | **"Song radio" / start radio from any track** | 🌐 | S | InstantMix is already used for autoplay — expose it as an explicit context-menu action. |
| ☐ | **Recently played history view** (individual tracks, not albums) | 🌐 | S–M | |

## 6. Reading (Calibre: EPUB / PDF / Manga)

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **EPUB appearance settings**: font family/size, line height, margins, themes (dark/sepia/light/black) | 🌐 | M | The single biggest e-reader QoL gap; epub.js supports all of it via themes. |
| ☐ | **In-book text search** (EPUB) | 🌐 | M | epub.js `book.search`-style spine walk. |
| ☐ | **Bookmarks & highlights with notes** (EPUB) | 🌐 | L | Store CFI ranges locally, optionally sync via the Sync API later. |
| ☐ | **Tap word → dictionary lookup / translation** | 🌐 | M–L | Great for reading in a second language. |
| ☐ | **Manga: right-to-left reading direction toggle** | 🌐 | S | Essential for manga; flips page-turn direction + tap zones. Persist per book. |
| ☐ | **Manga: double-page spread in landscape/desktop** | 🌐 | M | Show pages 2-up like a physical book, with cover-page offset toggle. |
| ☐ | **Manga: long-strip / webtoon vertical scroll mode** | 🌐 | M | The other half of comic reading; continuous vertical mode. |
| ☐ | **Page slider / scrubber with thumbnails** (manga & PDF) | 🌐 | M | Jump to page N without spamming next-page. |
| ☐ | **Reader brightness / background dimming slider** | 📱 | S | In-app overlay dim (no native brightness needed) for night reading. |
| ☐ | **Preload next pages** (manga) while reading | 🌐 | S | The Rust per-page CBZ extraction makes this cheap; hides page-turn latency. |
| ☐ | **Reading stats** (time read today/this week, pages turned, streaks) | 🌐 | M | Fun + motivating; local-only counter is enough to start. |
| ☐ | **"Continue" floating button on book details** showing % and page | 🌐 | S | One-tap resume with context, like Apple Books. |

## 7. Audiobooks (Audiobookshelf)

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Bookmarks** ("save this position" with note) | 🌐 | M | ABS has a bookmarks API — sync them. |
| ☐ | **Skip silence** | 🌐 | L | Web Audio analysis; a beloved Audiobookshelf-app feature but non-trivial. |
| ☐ | **Sleep timer: shake-to-extend / end-of-chapter option** | 📱 | S–M | Timer exists; "to end of chapter" is the most requested variant. |
| ☐ | **New-episode notifications for podcasts** (badge on tab, "N new" row) | 🌐 | M | Poll on app start; local notification later. |
| ☐ | **Auto-download newest N podcast episodes + auto-delete finished** | 🌐 | M | The podcatcher pattern; pairs with the download manager below. |

## 8. Downloads & Offline

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Unified download manager screen** (all apps: queued/active/done, pause/cancel/retry) | 🌐 | M–L | Progress rings now exist everywhere; a single overview screen is the natural next step. `downloadProgressStore` is the foundation. |
| ☐ | **Download queue with concurrency limit** (queue N, download 2 at a time) | 🌐 | M | Prevents saturating the connection when grabbing a season. |
| ☐ | **Storage overview in settings** (usage per app, largest items, clear-all buttons) | 🌐 | M | "Downloads use 4.2 GB: Books 1.1 · Video 2.8 · Music 0.3". |
| ☐ | **Auto-delete watched/finished downloads** (opt-in) | 🌐 | M | Keeps sideloaded iPhones from filling up. |
| ☐ | **Global offline banner + graceful offline mode** | 🌐 | M | Per-view checks exist; a single "You're offline — showing downloads" banner with auto-recovery would unify it. |
| ☐ | **"Download next 3 episodes" smart action** on series/podcasts | 🌐 | S–M | One tap instead of hunting individual episodes. |

## 9. Search & Discovery

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Recent searches + search history** in Ctrl+K | 🌐 | S | Show last queries on open, before typing. |
| ☐ | **Search filters** (type/library chips: Books · Movies · Music · Audiobooks) | 🌐 | S–M | Results are grouped already; filtering narrows long result lists. |
| ☐ | **Genre / decade / random discovery pages for video** | 🌐 | M | Music has genres + "Explore"; video has nothing equivalent. "Surprise me" button. |
| ☐ | **"More like this" row on item details** | 🌐 | S | Jellyfin `/Items/{id}/Similar` — nearly free. |

## 10. Feedback, Notifications & System Integration

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Download-complete notification** (toast in-app; system notification when unfocused) | 🌐 | S–M | Tauri notification plugin; rings show progress but completion goes unnoticed. |
| ☐ | **Deep links** (`mediamaster://item/...`) + **share action** on items | 🌐 | M | Share a book/movie to another device running the app; foundation for quick actions & widgets. |
| ☐ | **Discord Rich Presence** ("Watching X · 42:10") | 🖥️ | M | Fun flex feature; small Rust IPC to Discord. |
| ☐ | **Trakt / AniList / Last.fm scrobbling** | 🌐 | L | Usually better done server-side via Jellyfin plugins — consider documenting that instead of building it. |
| ☐ | **In-app log/debug viewer** (recent errors, copy button) in settings | 🌐 | S–M | Would have made the iOS black-screen debugging much faster. |

## 11. Settings & Personalization

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Settings sync/roaming across devices** (via the Sync API) | 🌐 | M–L | Set up once on desktop, phone follows. Needs a server endpoint + conflict rule (last-write-wins is fine). |
| ☐ | **Hide/reorder tabs** (e.g. hide Live TV if unused) | 🌐 | S–M | `appTabsConfig` is already central; add a per-user enabled/order list. |
| ☐ | **Per-section home customization** (hide/reorder home rows per app) | 🌐 | M | "I never use Genres" — let users tailor the home screens. |
| ☐ | **Localization (German first)** | 🌐 | L | i18n pass over all strings; big but mechanical. |
| ☐ | **Reduced-motion & larger-text accessibility support** | 🌐 | M | Respect `prefers-reduced-motion`, audit contrast/labels. |

## 12. Wild Ideas (big bets, someday/maybe)

- **Couch mode / 10-foot UI**: gamepad & TV-remote navigation, giant tiles — turns the desktop app into an HTPC frontend.
- **QR-code device login**: desktop shows a QR, phone scans it and inherits server config + credentials — kills the worst part of mobile onboarding.
- **CarPlay support** for audiobooks/music (preferred over an in-app car mode). Caveat: requires the `com.apple.developer.carplay-audio` entitlement, which must be requested from Apple and needs a paid developer account — not obtainable with Sideloadly free provisioning. Until then, a simple in-app car mode (giant buttons) is the sideload-compatible fallback.
- **Cross-device handoff**: "Continue on iPhone" — start a movie on desktop, tap a prompt on the phone to resume at the same second (Sync API + Jellyfin sessions make this feasible).
- **Reading/listening year-in-review** ("Your 2026 Wrapped").
- **Per-profile kids mode** with a locked-down library selection.
- **Smart offline sync**: "always keep the next 5 unread chapters / unwatched episodes downloaded, delete consumed ones" — the killer feature for commuters.

---

## Wave 0 — Prework (before the first wave)

Foundation so every later feature ships to all platforms in one push, not just iOS.

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ◐ | **Multi-platform build pipeline** — extend CI so a single tagged build produces artifacts for **iOS + Windows + Linux + macOS + Android**, not iOS alone. *Status 2026-07-19: implemented (two-stage GitLab pipeline: one `mirror` job → five dispatch jobs; new windows/linux/macos/android GitHub workflows; keystore-secret Android signing with debug fallback; Inno Setup for Windows). Awaiting first real pipeline run for verification.* | 🌐 | L | Today only `.github/workflows/ios-build.yml` exists (macOS runner, GitLab-triggered, unsigned `.ipa` for Sideloadly). Turn it into a matrix / sibling jobs: **Windows** `.exe`+installer (`windows-latest`, MSVC toolchain, existing Inno Setup script `installer/reader-setup.iss`); **Linux** AppImage+`.deb` (`ubuntu-latest`, install webkit2gtk deps); **macOS** `.dmg`/`.app` (`macos-15`, unsigned/ad-hoc like the iOS flow); **Android** `.apk` (`npx tauri android init` + `android build`, needs Android SDK/NDK + a debug keystore). Reuse the GitLab→GitHub dispatch pattern already proven for iOS. Watch: `gen/apple` and `gen/android` are still generated on the fly (not committed) — same on-the-fly-init approach applies to Android. Deliverable: one pipeline run → five downloadable artifacts. |

Sub-steps (each independently shippable, do in this order — cheapest/most-used first):
1. **Windows** (S–M) — the primary desktop target; `tauri build` already works locally via `build-tauri.ps1`, mostly a matter of wiring the runner + toolchain + Inno Setup.
2. **Linux** (M) — `ubuntu-latest` + webkit2gtk/appindicator deps; AppImage is the portable artifact.
3. **macOS** (M) — reuses the iOS runner class; ad-hoc/unsigned `.app` + `.dmg` (Gatekeeper caveat: users right-click-open, same spirit as Sideloadly).
4. **Android** (M–L) — `tauri android init`, Android SDK/NDK in CI, Rust `aarch64-linux-android` target, debug-signed `.apk`. Unlocks the phone-native work (Wave 2) on a second platform beyond iOS.

## Suggested first wave (high impact ÷ low effort)

*Status 2026-07-19: all ten implemented (☑), awaiting hands-on testing.*

1. ☑ Tap active tab → home / scroll-to-top (🌐, S) — smart re-tap via `src/utils/navigationBus.ts`, wired for all six tabs.
2. ☑ Mouse back/forward buttons + Esc = back (🖥️, S) — back-handler stack with Esc suppression for overlays/players; forward is a deliberate no-op.
3. ☑ Manga RTL reading direction + page preload (🌐, S) — RTL already existed; preload made forward-biased (+5/−2) with instant first-page publish and pre-decoding of the next 3 pages.
4. ☑ Double-tap seek zones + lock button in the video player (📱, S) — YouTube-style ripple with tap accumulation, two-tap unlock overlay.
5. ☑ Sleep timer for video & music (🌐, S) — shared `sleepTimerStore` (one active timer), presets + custom + end-of-item, 5s volume fade; UI in player settings menu, music bar, and phone Now Playing sheet.
6. ☑ Window state memory + `?` shortcut overlay (🖥️, S) — `tauri-plugin-window-state` (desktop-gated) + `ShortcutOverlay.tsx`.
7. ☑ Recent searches in Ctrl+K (🌐, S) — last 10, recorded on result click, per-item remove + clear all.
8. ☑ "More like this" row on video details (🌐, S) — Jellyfin similar-items on movie/series details, independent load.
9. ☑ **EPUB appearance settings** (🌐, M) — font family/size, line height, margins, Light/Sepia/Dark/Black themes, live re-flow with CFI position preservation (`src/components/reader/epubStyles.ts`).
10. ☑ Unified download manager screen (🌐, M) — global top-bar button with progress ring + slide-over panel (`src/components/downloads/`), all four sources, cancel/retry/delete where the managers support it.

## Second wave — "make the phone feel native" (priority after the first wave)

A focused pass so the mobile variant reads as a real native app, not the desktop layout
shrunk down. Ordered so each step compounds: shared gesture/sheet primitives first, then
apply them everywhere.

*Status 2026-07-20: the core gesture/sheet/haptics pass (items 1–5) is implemented in commit
`db6ad39a0`, awaiting hands-on iPhone testing (verified so far only via tsc + vite build). Items
6–7 were largely delivered by earlier work (Wave 1 + the phone-layout pass); 8–9 remain open.*

1. ☑ **Edge-swipe back gesture** (📱, M) — `SwipeBackOverlay` mounted in `AppShell`; window-level
   capture-phase touch tracking (preempts the manga reader's own swipe), chevron puck arms at 70px
   with a haptic, drives the existing back-handler stack via `dispatchBack('swipe')`. Known gap:
   EPUB page content lives in epub.js's iframe, so the swipe only fires from reader chrome there.
2. ☑ **Long-press → bottom-sheet context menu** (📱, M) — `MusicContextMenu` renders as a
   `BottomSheet` on phone; `useContextMenu` exposes a 500ms long-press detector (wired on `AlbumCard`).
   Established the shared **BottomSheet** component. *Still to extend to books/audiobook items.*
3. ☑ **Bottom sheets replace desktop dropdowns/modals on phone** (📱, M) — `BottomSheet` +
   `BottomSheetSelect` now back the music context menu, the player audio/subtitle/sleep/stats menu,
   and sort/filter selects in the album/artist/Jellyfin grids. Desktop popovers untouched.
4. ☑ **Haptic feedback** (📱, S–M) — `tauri-plugin-haptics` (mobile-gated) + `src/utils/haptics.ts`
   wrapper (safe no-op off-phone). Subtle policy: tab switch, sheet open, long-press, gesture arm.
5. ☑ **Pull-to-refresh** on phone lists/grids (📱, M) — `usePullToRefresh` + `PullToRefreshIndicator`,
   reusing each tab's refresh handler on the six homes + library grids (EPG grid skipped — two-axis pan).
6. ☑ **Fullscreen "Now Playing" music view** (🌐→📱, M) — delivered by the phone-layout pass:
   `MusicNowPlaying.tsx` (tap the compact bar → immersive artwork + queue/lyrics). Now also drag-dismissible.
7. ☑ **Video player touch gestures** (📱, S–M) — double-tap side-zone seek + lock button shipped in
   Wave 1; *done 2026-07-20:* right-zone vertical swipe = volume, left-zone vertical swipe = an in-app
   dim overlay (`BrightnessOverlay`; real HW brightness deferred — needs an iOS entitlement Sideloadly
   can't grant). Jellyfin player only.
8. ☑ **Safe-area & one-handed polish** (📱, S–M) — *done 2026-07-20:* audited `pt-safe`/`pb-safe` across
   every top bar + the bottom tab bar (all covered); bumped dense music-track-row height and the ⋯
   touch target to ~44px on phone. (Fullscreen players/readers/sheets already carried insets.)
9. ☑ **A–Z fast-scroll rail** on long alphabetical lists (📱, M) — *done 2026-07-20:* shared
   `AlphabetScrollRail` (right-edge letters, drag to jump, haptic tick, absent letters dimmed) wired
   into music artists/albums, Jellyfin library, ABS library, and Calibre All-Books (title/author sort).

Deliberately deferred to later (native shims / entitlements / heavier work): tablet layout class,
landscape handling, home-screen quick actions, Wi-Fi-only downloads, real system brightness swipe.

**Wave 2 status 2026-07-20: COMPLETE** — all nine items shipped (1–6 in `db6ad39a0`; the final
polish trio 7–9 in the follow-up commit). Only sub-scoped extensions remain as future nice-to-haves:
long-press sheets on book/video cards (item 2 covered music), and real system-brightness (item 7).
