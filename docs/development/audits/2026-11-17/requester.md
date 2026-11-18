# Requester tab — audit (2026-11-17)

Scope read in full: `src/components/requester/**` (RequesterView, RequesterHome, RequesterSetup, RequesterContext, forms/AnimeSerieForm, MovieForm, MusicForm, YouTubeForm, admin/AdminPanel, admin/ScheduleManager), `src/stores/requesterStore.ts`, `src/utils/requesterApi.ts`, `src/types/requester.ts`, `docs/development/REQUEST_API.md`, `docs/development/feature-roadmap.md`, Requester bits of `src/App.tsx`, `AppTabs.tsx`, `navigationBus.ts`.

**Framing:** this is not an Overseerr clone. It's a *download-request* client for a custom `mediamaster-server` (aniworld.to / s.to scrapers, OMDb movies, YouTube, Spotify→music). There's no TMDB, no "is it already in Jellyfin" check, and no Readarr/Lidarr. The UI is five form tabs, a 50-row history list and an admin schedule editor.

**Biggest structural gap:** the backend has a full **approval workflow** (`GET /api/admin/requests`, `POST /api/download/{id}/approve|reject|cancel`, `GET /api/admin/history`, `/api/admin/users*`). The client calls **none** of it (grep for `approve|reject|admin/requests|cancel` in `src/` finds nothing requester-related). Regular users' requests sit at `pending` and an admin can't act on them anywhere in the app.

### API coverage matrix

| Endpoint (REQUEST_API.md) | Used by client? |
|---|---|
| `POST /api/auth/login`, `GET /api/auth/me` | yes |
| `POST /api/auth/logout` | **no** (logout is local-only) |
| `GET /api/health` | wrapper `checkHealth` exists, never called |
| `GET /api/search/{anime,series,movie,music}` | yes (`music` without `offset`) |
| `GET /api/search/music/resolve` | **no** |
| `GET /api/search/poster` | yes (wrong `type` value for series, see A6) |
| `GET /api/info/{anime,series}` | yes |
| `GET /api/info/episode-langs` | **no** |
| `POST /api/download/*` (5) | yes |
| `GET /api/download/history` | yes, `limit=50`, never paginated |
| `DELETE /api/download/{id}`, `POST /history/clear` | yes |
| `GET /api/admin/requests` | **no** |
| `POST /api/download/{id}/approve` / `reject` | **no** |
| `POST /api/download/{id}/cancel[?episode=]` | **no** |
| `GET /api/admin/history` (≤500) | **no** |
| `GET/POST/DELETE /api/admin/schedule`, `/enrich` | yes |
| `PUT /api/admin/schedule/{id}` | wrapper `updateScheduleEntry` exists, **no UI** |
| `/api/admin/users*` (local mode) | **no** |
| `WS /ws/downloads` | yes (no reconnect) |

---

## A) Bugs / likely defects (ranked)

1. **A 401 or a tab re-entry tears down the whole Requester UI and loses form state.**
   - `requesterStore.ts:90` `revalidateSession` sets `isLoggingIn: true`, and `RequesterView.tsx:61-70` then returns a full-screen "Connecting..." spinner *instead of* the tree.
   - `RequesterProvider` mounts per view (`App.tsx:2382`), and `RequesterContext.tsx:26-31` revalidates on every mount. So **every** switch to the Requester tab flashes a full-screen spinner until `/api/auth/me` returns. Offline, it waits for the HTTP timeout before falling through (`requesterStore.ts:100-102`).
   - Worse, any mid-session 401 (`requesterApi.ts:33` → `setUnauthorizedHandler` → `revalidateSession`) unmounts `RequesterHome`. A user halfway through picking seasons/languages/excludes loses everything, and the submit that triggered the 401 shows "Request failed" (the call isn't retried after the silent re-login).
   - Fix: use a separate `isRevalidating` flag that doesn't gate rendering, and retry the original request once after a successful re-auth.

2. **"Disconnect" is effectively a no-op.**
   - `RequesterView.tsx:117` calls `logout()`, which clears token and `isAuthenticated` but keeps `serverUrl`. `RequesterSetup` then mounts fresh with a new `autoLoginAttemptedRef` (`RequesterSetup.tsx:29-36`) and immediately logs in again with the shared LDAP credentials.
   - The user can't switch accounts without first clicking "Use different credentials" during the brief auto-login window. `POST /api/auth/logout` is never called either.
   - Fix: a `manualLogout` flag in the store that suppresses auto-login until the user submits the form.

3. **Duplicate requests are easy and never detected.**
   - After a successful submit, every form sets `isSubmitting=false` while keeping `selected` and the enabled submit button for 2 s (`AnimeSerieForm.tsx:229-242`, `MovieForm.tsx:48-60`, `MusicForm.tsx:59-71`, `YouTubeForm.tsx:37-43`). A double-click or impatient re-click files a second request.
   - Nothing checks `history` for an existing non-terminal request with the same `slug` / `imdb_id` / `url`, and the server doesn't seem to either (no 409 in the docs).
   - Fix: keep the button disabled during the success state, and warn "already requested (status X)" from the loaded history before posting.

4. **The success `setTimeout` clobbers newer user input.**
   - The 2 s reset (`AnimeSerieForm.tsx:232-238`, `MovieForm.tsx:50-56`, `MusicForm.tsx:61-67`, `YouTubeForm.tsx:39`) is never cleared. If the user clicks another search result or types a new query within 2 s, the timer wipes `selected`, `query` and `results` under them.
   - The timer also survives unmount (switching media-type tab / refresh remount).
   - Fix: store the timer in a ref, clear it on unmount and on any new selection.

5. **Server error details are swallowed, so failures show the wrong message.**
   - Every wrapper returns `null` or `[]` on `!res.success` (`requesterApi.ts:96,105,114,129,185,205,220,235,250,266`) and discards FastAPI's `detail`. Two consequences:
     - Submit always shows "Request failed. Please try again." even for non-retryable causes: 400 "seasons filter resulted in nothing", 404 slug not found, 422 bad content_type/URL, 503 OMDb not configured.
     - Search failures render as **"No results found."** (`MovieForm.tsx:29`, `AnimeSerieForm.tsx:100`, `MusicForm.tsx:41`), because `request()` doesn't throw and the `catch` blocks never fire. A server without an OMDb key looks like "there's no such movie".
   - History load failure renders "No download history yet" (`RequesterHome.tsx:80-87`, `getHistory` → `[]`).
   - Fix: return `{ ok, data, error }` and show `detail`.

6. **Series poster lookup sends the wrong `type`.**
   - `fetchPosterUrl(..., type: 'anime' | 'serie')` puts `type=serie` in the query (`requesterApi.ts:142`, called with `type` from `AnimeSerieForm.tsx:83`). REQUEST_API.md:277 specifies `"anime"` or `"series"`.
   - `getMediaInfo` maps correctly (`requesterApi.ts:156`), but the poster call doesn't. **PLAUSIBLE** (depends on server leniency): every series result keeps the ImageOff placeholder. `posterCache` caches the `null`, so it never retries for the session.

7. **Language key isn't re-validated when the season selection changes.**
   - `langKey` defaults to season 1's first key (`AnimeSerieForm.tsx:144-147`). `availableLangKeys` is recomputed from the selected seasons (`:159-169`), but nothing resets `langKey` when it falls out of that set.
   - Example: the user picks only S3 (keys `[2,3]`) while `langKey` is still `1`. The language chips show none selected, yet the request posts `lang_key: 1`.
   - The chip list is also a **union** across seasons, so a key available in only some selected seasons is offered silently. The server's `GET /api/info/episode-langs` exists for exactly this check and is unused.
   - Outcome is server-dependent: 400, or a silently partial download (PLAUSIBLE).

8. **Season and language arrays are sorted lexicographically.**
   - `[...selectedSeasons].sort()` (`AnimeSerieForm.tsx:203`) turns `[2,10,1]` into `[1,10,2]`. Same for `availableLangKeys` (`:168`; harmless for keys 1–3).
   - Seasons are downloaded "sequentially" per REQUEST_API.md:437, so long-running anime (10+ seasons) download out of order.
   - Fix: `.sort((a, b) => a - b)`.

9. **The episode-exclude parser silently misreads ranges.**
   - `parseExclude` (`AnimeSerieForm.tsx:182-183`) uses `parseInt` per comma token, so `"1-5"` excludes only episode 1 and `"3 5"` excludes only 3. There's no validation or preview.
   - Excludes typed for a season that's later deselected are still sent (`buildExcludeEpisodes` iterates every key in `excludes`). Harmless server-side, but sloppy.

10. **Admin "Clear all" wipes every user's history, with no confirmation.**
    - `RequesterHome.tsx:101` → `apiClearHistory` → `POST /history/clear`, which for admins "clears all users' history" (REQUEST_API.md:629). One mis-click is irreversible.
    - Schedule delete (`ScheduleManager.tsx:252`) and history row delete (`RequesterHome.tsx:150`) also have no confirm or undo.

11. **Deletes are removed from the list even when the server refused them.**
    - `handleDelete` ignores the boolean result and filters the row out unconditionally (`RequesterHome.tsx:254-255`, `ScheduleManager.tsx:64-65`). On 400/403/404 the row vanishes and then reappears on the next refresh/poll, with no error.
    - `handleClear` likewise ignores failure (`:262`).

12. **WebSocket handling: stale closure, no reconnect, and redundant polling.**
    - `ws.onmessage` reads `history` from the effect's first-render closure, where it's still `[]` (`RequesterHome.tsx:215`; the effect deps are `[serverUrl, token]`). So `!history.some(...)` is always true and **every** `queue_update` triggers a full `loadHistory()`. For admins, who receive all users' events, that's a refetch storm.
    - `onclose` (`:234`) never reconnects. An expired-token close doesn't trigger re-auth.
    - The 15 s poll (`:244-249`) runs whenever any row is non-terminal, regardless of WS health. That includes `pending` rows, which can wait days for approval: the tab polls every 15 s indefinitely while open.
    - The interval is torn down and recreated on every `history` change.
    - `episodeProgress` is never pruned.

13. **Phone layout breaks in the anime/series detail view.**
    - `AnimeSerieForm.tsx:250-252` is a fixed `flex` row with a `w-56` (224 px) result column and no `phone:` variant. On a ~390 px phone, after `RequesterHome`'s `p-8` (`RequesterHome.tsx:278`) and the card's `p-6` (`:299`), the detail/season panel gets ≈60–80 px.
    - No Requester component uses `useIsPhone`. Only the YouTube type grid and ScheduleManager grids have `phone:` classes.

14. **The detail sub-view isn't wired into back navigation.**
    - `AnimeSerieForm`'s detail panel is a sub-state with its own "Back to search" button, but it never calls `registerBackHandler`. Esc, Mouse4 and edge-swipe-back (Wave 2) don't return to the results.
    - Swipe-back on phone does nothing here, or navigates away depending on the stack. The `RequesterView.tsx:37-39` comment ("no sub-navigation … no back handler") is wrong for this form.

15. **Smaller verified defects**
    - **YouTube URL detection:**
      - `watch?v=…&list=RD…` (a normal "share from a mix" URL) is auto-classified as **playlist** (`requesterApi.ts:357`), so a single-video request becomes a whole-mix download.
      - `hostname.includes('youtube.com')` also accepts `notyoutube.com`.
    - **Music form:**
      - Search results with `spotify_url: null` are selectable, but then no submit button renders and nothing explains why (`MusicForm.tsx:74,238`). `/api/search/music/resolve` exists for this.
      - Manual mode rejects `music.youtube.com` URLs that the API accepts (REQUEST_API.md:537 vs `isSpotifyUrl`).
    - **Movie form:** the manual IMDb ID isn't validated (`/^tt\d{7,}$/`, `MovieForm.tsx:43`).
    - **Login form:** the password is `.trim()`med (`RequesterSetup.tsx:50`), which breaks passwords with leading or trailing spaces.
    - **ScheduleManager:**
      - "Add Entry" has no submitting guard, so a double-click inserts duplicates (`:69-94`).
      - Season accepts `0` / empty (`Number('')`).
      - The `addSuccess` banner never clears.
    - **Context performance:** `useRequesterStore()` is used without a selector, and the context `value` isn't memoized (`RequesterContext.tsx:21,33-44`). Every store change re-renders all consumers, which defeats `memo(RequesterHome)`.
    - **Multilang toggle** (`AnimeSerieForm.tsx:377-393`): it's a `<label>` around a clickable `div` with no `<input>`. Clicking the text does nothing, and it isn't keyboard accessible.

---

## B) Missing features vs Jellyseerr / Overseerr / Ombi (ranked)

| # | Feature | Ref app | Platform | Effort | Backend support / fit |
|---|---|---|---|---|---|
| B1 | **Admin approval queue**: pending list with approve/reject (+ optional reason), badge count | Overseerr/Jellyseerr "Requests → Pending", Ombi | 🌐 | M | **Fully supported** (`GET /api/admin/requests`, `POST /download/{id}/approve\|reject`). Highest-value gap. New `admin/ApprovalQueue.tsx` in AdminPanel. Reuse history row UI. WS `queue_update` keeps it live. |
| B2 | **Cancel an active download** (whole request or a single episode `S01E03`) | Overseerr (delete/cancel request), Sonarr queue | 🌐 | S | Supported: `POST /download/{id}/cancel[?episode=]`. The history row currently only offers Delete on terminal rows. Add a Cancel button on non-terminal rows plus a per-episode ✕ in the expanded episode list. |
| B3 | **Request detail / status timeline**: requested → approved (by whom, when) → queued → downloading (per-episode/season progress) → complete or error (with `error_message` for admins) | Overseerr request card + media page status | 🌐 | M | Data already in `DownloadRequest` (`approved_at`, `approved_by` incl. `discord:<user>`, `completed_at`, `error_message`) and WS `episode_update`/`season_update`. UI shows none of it (only status + `requested_at`). Expandable row on desktop, BottomSheet on phone. |
| B4 | **Requests list filters + pagination** (All / Mine / Pending / Active / Done / Failed, type chips, "Load more") | Overseerr Requests page filters & sort | 🌐 | S–M | Client-side filter over history. Pagination via `offset` (user ≤200, admin `GET /api/admin/history` ≤500). Show **requester username** on admin view (`user_id` is in the payload, not rendered). |
| B5 | **"Already in library / already requested" badges on search results** | Overseerr "Available"/"Requested" ribbons | 🌐 | M | No server support. Client can (a) match against loaded history by slug/imdb_id/url (S) and (b) query Jellyfin by name/`AnyProviderIdEquals=imdb.tt…` for movies (M). Movie imdb_id gives an exact Jellyfin match. |
| B6 | **Request from Jellyfin item details**: "Request missing seasons" on series pages; "Request" for movies not in the library, from global search | Jellyseerr integration, Overseerr "Request more" | 🌐 | M | Needs a mapping from Jellyfin series to an aniworld/s.to slug (title search + user confirm). Movies map cleanly via IMDb ProviderId. Deep-link into the Requester tab with a prefilled form via a small requester-intent store. |
| B7 | **Global search (Ctrl+K) surfaces request targets**: a "Request it" group when Jellyfin/Calibre return nothing, plus the user's matching requests | Overseerr search (one search box for discover + request) | 🌐 | M | `GlobalSearch.tsx` has no Requester group (grep). Add a lazy group calling `searchMovies` / `searchSeries` / `searchAnime` only when the Requester is authenticated. Click opens the Requester tab prefilled. |
| B8 | **Status-change notifications** (approved / rejected / complete / error) as toast + system notification when unfocused, and a pending-count badge for admins | Overseerr notification agents (webpush/Discord), Ombi mobile push | 🌐 | M | WS events already carry `status` + `title`. Needs an app-level WS (today it only lives while `RequesterHome` is mounted) in `requesterStore`, wired to the roadmap's §10 download-complete notification plumbing. |
| B9 | **Discover rows** (trending/popular/upcoming anime & series, airing-this-week from the schedule) | Overseerr/Jellyseerr Discover page | 🌐 | L | No discover endpoint (scrapers only, no TMDB). Cheap partial: "This week's schedule" row from `/api/admin/schedule` (admin only today). Real discover needs server work (TMDB/AniList). |
| B10 | **Per-episode language availability check** before submit ("S2: German Dub missing for eps 7–9") | Sonarr manual search/quality preview | 🌐 | S–M | Supported: `GET /api/info/episode-langs`. Fixes A7 too. Fetch lazily for the selected season + lang. |
| B11 | **Edit schedule entries** (day / season / lang) | Sonarr series monitor edit | 🌐 | S | Supported: `PUT /api/admin/schedule/{id}`. `updateScheduleEntry` already exists in `requesterApi.ts:312`, unused. Also: "Add to schedule" from the anime/series detail (prefill slug/url/lang). |
| B12 | **User management UI** (local-auth mode: list/create/role/reset password/delete) | Overseerr Users, Ombi user management | 🌐 | M | Supported: `/api/admin/users*`. Gate on `userInfo.auth_mode === 'local'`. |
| B13 | **Request quotas / auto-approve display** ("Your requests are auto-approved" for admins; "Pending admin approval" hint for users before submit) | Overseerr quotas + auto-approve permissions | 🌐 | S | Role is known (`userInfo.role`). Server semantics are documented (admins skip pending). Quotas need server work. |
| B14 | **Issue reporting on available media** ("wrong language / broken episode", re-request) | Overseerr/Jellyseerr Issues | 🌐 | L | No server support. Could map "re-download episode" onto a new request with `exclude_episodes` inverted (M). |
| B15 | **4K vs HD / quality profile choice** | Overseerr 4K requests | — | — | **Not applicable**: sources are streaming-site scrapers with no quality tiers. Skip. Season/episode-level requests *are* already supported (season chips + exclude list). |

---

## C) Small UI / polish (ranked)

| # | Item | Platform | Effort | Notes / fit |
|---|---|---|---|---|
| C1 | **Status badge system**: distinct colour for each state, pill badges | 🌐 | S | `STATUS_CONFIG` (`RequesterHome.tsx:36-45`) gives `downloading` **and** `complete` the same `text-theme-400` and checkmark-ish look, and `approved` and `queued` the same blue. Proposal: pending=yellow, approved=sky, queued=indigo, downloading=theme + progress, complete=green, error/rejected=red, cancelled=grey. Use pill backgrounds (`bg-x/15`) like Overseerr. |
| C2 | **Poster thumbnails in history + status ribbon** | 🌐 | S | `DownloadRequest.poster_url` is sent on create (`requesterApi.ts:176,196,218`) and typed optional, but history rows show only a type icon. Switch to a poster-card list/grid with a corner ribbon. |
| C3 | **Confirm dialogs**: Clear all, Delete, schedule Delete, future Reject/Cancel. BottomSheet on phone, inline popover on desktop | 🌐 | S | Fixes A10. `BottomSheet` exists. The "Clear all" text for admins should say "for **all users**". |
| C4 | **Requests tab badge** (pending-approval count for admins; active-download count for users) on `AppTabs` / `BottomTabBar` | 🌐 | S–M | Neither tab bar supports badges (grep). Add an optional `badge` to `appTabsConfig`, fed from `requesterStore`. Needs B8's app-level WS or a cheap poll. |
| C5 | **Phone layout of the anime/series flow**: stack results then detail (detail as a full-height page with back), reduce `p-8` to `phone:p-4`, sticky submit bar with `pb-safe` | 📱 | S–M | Fixes A13/A14. Register a back handler for the detail state. |
| C6 | **Swipe actions on history rows (phone)**: swipe left = cancel/delete, swipe right = approve (admin) + haptic | 📱 | M | Haptics wrapper exists. Pattern doesn't exist yet in the repo; would be reusable for downloads. |
| C7 | **Inline duplicate warning before submit** ("You already requested this on 12 Nov, status Downloading") | 🌐 | S | Pure client: index `history` by `slug` / `url` / imdb (imdb isn't in `DownloadRequest`; match on `title` + `typ` for movies or store it locally). Pairs with A3. |
| C8 | **Skeletons + real error/empty states**: history skeleton rows; "Couldn't load history — Retry"; search "Server error: <detail>" vs "No results" | 🌐 | S | Fixes the A5 symptom. Repo convention: `bg-white/10 animate-pulse`. |
| C9 | **Theme consistency**: forms hardcode amber (movie), pink/purple (music), red (YouTube); gradients pair `theme-*` with hardcoded `to-teal-*` (`RequesterSetup.tsx:58,61,151`, `AnimeSerieForm.tsx:440`) | 🌐 | S | Custom accent colours (Settings → Theme Colors) clash with fixed teal. Keep per-media-type colours as small icons only; buttons and focus rings use `theme-*`. |
| C10 | **Search-as-you-type** (debounced 350 ms like GlobalSearch) + clear (✕) button + preserve results when going back | 🌐 | S | Today search is Enter/button only. Also put the query box in the detail view's left column. |
| C11 | **Persist the last-used media tab and language choice** (localStorage, try/catch) | 🌐 | S | `activeTab` always resets to `anime`. Remember `langKey` / multilang per type. |
| C12 | **Season chips UX**: "All" vs individual is confusing (clicking a chip silently drops "All"). Add "Select none / invert", show total episodes, and live-preview the exclude parse ("excluding 1, 2, 3, 4, 5"), supporting ranges `1-5` | 🌐 | S | Fixes A9. |
| C13 | **Relative timestamps + requester name** ("2 h ago · alice") in history; `error_message` shown to admins | 🌐 | S | Data present, not rendered. |
| C14 | **Keyboard**: Ctrl/⌘+Enter submits the request from the detail panel; `/` focuses the search; Esc returns from detail to results | 🖥️ | S | Esc via `registerBackHandler` (A14). |
| C15 | **Pull-to-refresh preserves state**: PTR and the toolbar refresh remount `RequesterHome` (`RequesterView.tsx:48,126`), discarding an in-progress form | 📱 | S | Refresh only history + schedule (expose `loadHistory` via ref/store) instead of remounting. |

---

## D) Roadmap reconciliation

The roadmap has no Requester section. Proposed new section, to slot in as **§ 9b** (after Search & Discovery) or appended as **§ 13**:

```markdown
## 13. Requests (Requester)

| ☐ | Feature | Platform | Effort | Notes |
|---|---------|----------|--------|-------|
| ☐ | **Admin approval queue** (pending list, approve/reject, live via WS) | 🌐 | M | Server already has `GET /api/admin/requests` + `POST /api/download/{id}/approve\|reject`; client uses none of it — pending requests can't be actioned in-app today. |
| ☐ | **Cancel active downloads** (whole request or single episode) | 🌐 | S | `POST /api/download/{id}/cancel[?episode=S01E03]`; history rows only offer Delete on terminal rows. |
| ☐ | **Request detail / status timeline** (approved by/when, per-season/episode progress, error message) | 🌐 | M | All fields already in `DownloadRequest` + WS `episode_update`/`season_update`; BottomSheet on phone. |
| ☐ | **Requests list: filter chips + pagination + requester name** (Mine/Pending/Active/Done/Failed, Load more) | 🌐 | S–M | `offset` supported; admin `GET /api/admin/history` (≤500) unused; `user_id` never rendered. |
| ☐ | **Duplicate-request guard** ("already requested · Downloading") + disable submit during success state | 🌐 | S | Double-click currently files two requests; no server-side dedupe documented. |
| ☐ | **Surface server error details** (search/submit/history) instead of "No results"/"Request failed" | 🌐 | S | `requesterApi.ts` discards FastAPI `detail`; OMDb-not-configured looks like "no results". |
| ☐ | **Session handling without UI teardown** (background revalidate, retry after silent re-login, real Disconnect) | 🌐 | S | `isLoggingIn` spinner unmounts the forms on every tab entry/401; Disconnect immediately auto-re-logs-in. |
| ☐ | **Phone-native request flow** (stacked results → detail page with back handler, sticky submit, swipe actions on rows) | 📱 | M | Anime/series detail is a fixed `w-56` two-column row; no back handler for the detail sub-view. |
| ☐ | **Status-change notifications + tab badge** (approved/rejected/complete/error; admin pending count) | 🌐 | M | Move the `/ws/downloads` socket into `requesterStore` (app-level, with reconnect); badge support in `appTabsConfig`. |
| ☐ | **Per-episode language check before submit** | 🌐 | S–M | `GET /api/info/episode-langs` unused; also fixes stale `lang_key` after season change. |
| ☐ | **"Request this" from global search and Jellyfin details** (missing seasons / movie not in library) | 🌐 | M | Movies map exactly via IMDb ProviderId; series need a title→slug confirm step. Prefill via a requester-intent store. |
| ☐ | **"In library / requested" badges on request search results** | 🌐 | M | History match (S) + Jellyfin lookup by IMDb id / name (M). |
| ☐ | **Admin: edit schedule entries + "add to schedule" from detail** | 🌐 | S | `PUT /api/admin/schedule/{id}` wrapper exists, no UI. |
| ☐ | **Admin: local user management** | 🌐 | M | `/api/admin/users*`; show only when `auth_mode === 'local'`. |
| ☐ | **Discover rows** (airing this week, trending anime/series) | 🌐 | L | Needs a server discover endpoint (TMDB/AniList); "this week" from the schedule is a cheap first row. |
```

### Existing roadmap rows these findings touch

- **§9 "Search filters (type/library chips)"**: add a "Requests" chip/group once B7 lands. Global search currently has no Requester group at all.
- **§9 "Recent searches"** (done, Wave 1): could include Requester queries if B7 is built.
- **§10 "Download-complete notification"**: the Requester's WS `queue_update → complete` is a natural second source. Build B8 on the same toast/system-notification plumbing.
- **§10 "Deep links (`mediamaster://item/...`)"**: a `mediamaster://request/{id}` target lets Discord/notification clicks open a request's detail (the server already posts Discord approval buttons; see `approved_by: "discord:<user>"`).
- **§11 "Hide/reorder tabs"**: the Requester is the most likely tab for non-admin users to hide when their server has no Requester URL. Hide it automatically when `serverUrl` is empty.
- **§8 "Unified download manager screen"** (done): server-side Requester downloads are a different domain (server queue, not local files). Keep them out of `DownloadCenter`, but a "Server requests" link from the panel would be cheap.
- **Wave 2 §2/§3 "BottomSheet / long-press"**: extend to request rows (C3, C6).
- **Wave 1 "Esc = back" / Wave 2 "Edge-swipe back"**: the Requester detail sub-view isn't registered (A14).
- **§1 "Tap active tab → go home"**: the Requester tab reset only scrolls to top. It should also clear the anime/series detail state.
