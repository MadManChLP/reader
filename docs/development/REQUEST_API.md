# mediamaster-server — API Reference

All API endpoints are under `http(s)://your-server/api/`. An interactive OpenAPI UI is available at `/docs`.

---

## Authentication

All endpoints (except `/api/auth/login` and `/api/health`) require authentication.

### Token vs Cookie

| Client type | How to authenticate |
|---|---|
| Desktop client / scripts | JWT Bearer token in `Authorization` header |
| Browser (web UI) | Session cookie `mm_session` set automatically on login |

For API usage, always use the `Authorization: Bearer <token>` header.

---

### POST /api/auth/login

Authenticate and get a JWT token.

**Request body**
```json
{
  "username": "alice",
  "password": "secret"
}
```

**Response `200`**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

**Errors**
| Code | Meaning |
|---|---|
| `401` | Invalid username or password |

**Notes**
- Token expires after **24 hours**
- Also sets a `mm_session` cookie for browser sessions
- Works with both LDAP and local user accounts

---

### POST /api/auth/logout

Clears the session cookie.

**Response `200`**
```json
{ "detail": "Logged out" }
```

---

### GET /api/auth/me

Returns info about the currently authenticated user.

**Response `200`**
```json
{
  "username": "alice",
  "role": "admin",
  "display_name": "Alice Example",
  "auth_mode": "ldap"
}
```

`role` is either `"admin"` or `"user"`.
`auth_mode` is either `"ldap"` or `"local"`.

---

## Using the Token

Include the token in every request:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Example with `curl`:
```bash
TOKEN=$(curl -s -X POST http://your-server/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret"}' | jq -r .access_token)

curl -H "Authorization: Bearer $TOKEN" http://your-server/api/search/anime?q=naruto
```

---

## Status Lifecycle

Every download request moves through these states:

```
pending → approved → queued → downloading → complete
                                          → error
         rejected
                                          → cancelled
```

| Status | Meaning |
|---|---|
| `pending` | Submitted by a regular user, waiting for admin approval |
| `approved` | Approved, waiting for a download slot |
| `queued` | In the active queue (slot claimed, download starting soon) |
| `downloading` | Actively downloading |
| `complete` | Finished successfully |
| `error` | Failed — admin can see the error message |
| `rejected` | Rejected by admin |
| `cancelled` | Cancelled by admin |

**Admin users skip `pending`** — their requests are auto-approved and go straight to `queued`/`downloading`.

---

## Search

All search endpoints require authentication. No API keys are exposed — they are stored server-side.

---

### GET /api/search/anime

Search aniworld.to for anime.

**Query parameters**
| Param | Required | Description |
|---|---|---|
| `q` | yes | Search query string |

**Response `200`** — array of:
```json
[
  {
    "title": "Sword Art Online",
    "slug": "sword-art-online",
    "url": "https://aniworld.to/anime/stream/sword-art-online",
    "poster_url": "https://..."
  }
]
```

Use `slug` when calling `/api/info/anime` or `/api/download/anime`.

---

### GET /api/search/series

Search s.to (serienstream) for live-action series.

**Query parameters**
| Param | Required | Description |
|---|---|---|
| `q` | yes | Search query string |

**Response `200`** — array of:
```json
[
  {
    "title": "Breaking Bad",
    "slug": "breaking-bad",
    "url": "https://s.to/serie/stream/breaking-bad",
    "poster_url": "https://..."
  }
]
```

---

### GET /api/search/movie

Search OMDb for movies. Requires OMDb API key to be configured server-side.

**Query parameters**
| Param | Required | Description |
|---|---|---|
| `q` | yes | Movie title |

**Response `200`** — array of:
```json
[
  {
    "title": "Inception",
    "year": "2010",
    "imdb_id": "tt1375666",
    "poster_url": "https://...",
    "type": "movie"
  }
]
```

Use `imdb_id` when calling `/api/download/movie`.

**Errors**
| Code | Meaning |
|---|---|
| `503` | OMDb API key not configured on the server |

---

### GET /api/search/music

Search YouTube Music for artists or albums.

**Query parameters**
| Param | Required | Default | Description |
|---|---|---|---|
| `q` | yes | — | Search query |
| `type` | yes | — | `"artist"` or `"album"` |
| `limit` | no | `10` | Max results (1–25) |
| `offset` | no | `0` | Pagination offset |

**Response `200`** — array of:
```json
[
  {
    "name": "Daft Punk",
    "spotify_url": "https://open.spotify.com/artist/...",
    "cover_url": "https://...",
    "type": "artist",
    "artist": null,
    "year": null
  },
  {
    "name": "Random Access Memories",
    "spotify_url": "https://open.spotify.com/album/...",
    "cover_url": "https://...",
    "type": "album",
    "artist": "Daft Punk",
    "year": "2013"
  }
]
```

Use `spotify_url` when calling `/api/download/music`.

---

### GET /api/search/music/resolve

Resolve a YouTube Music `browseId` to a downloadable Spotify URL (albums only).

**Query parameters**
| Param | Required | Description |
|---|---|---|
| `browse_id` | yes | YouTube Music browseId (from internal YTM API) |
| `type` | yes | Must be `"album"` (artist not supported) |

**Response `200`**
```json
{ "spotify_url": "https://open.spotify.com/album/..." }
```

---

### GET /api/search/poster

Lightweight endpoint — returns just the poster URL for an anime or series without fetching full metadata.

**Query parameters**
| Param | Required | Description |
|---|---|---|
| `slug` | yes | Anime or series slug |
| `type` | yes | `"anime"` or `"series"` |

**Response `200`**
```json
{ "poster_url": "https://..." }
```

---

## Info / Metadata

Fetch detailed season and episode information before submitting a download request.

---

### GET /api/info/anime

Full metadata for an anime: all seasons, episode counts, available languages per season.

**Query parameters**
| Param | Required | Description |
|---|---|---|
| `slug` | yes | Anime slug (e.g. `sword-art-online`) or full aniworld.to URL |

**Response `200`**
```json
{
  "title": "Sword Art Online",
  "slug": "sword-art-online",
  "url": "https://aniworld.to/anime/stream/sword-art-online",
  "poster_url": "https://...",
  "description": "...",
  "seasons": [
    {
      "number": 1,
      "episode_count": 25,
      "lang_keys": [1, 3],
      "languages": ["German Dub", "German Sub"]
    },
    {
      "number": 2,
      "episode_count": 24,
      "lang_keys": [1, 2, 3],
      "languages": ["German Dub", "English Sub", "German Sub"]
    }
  ]
}
```

**Language key reference**
| `lang_key` | Language |
|---|---|
| `1` | German Dub |
| `2` | English Sub |
| `3` | German Sub |

---

### GET /api/info/series

Full metadata for a series from s.to.

**Query parameters**
| Param | Required | Description |
|---|---|---|
| `slug` | yes | Series slug (e.g. `breaking-bad`) or full s.to URL |

**Response `200`** — same shape as anime info:
```json
{
  "title": "Breaking Bad",
  "slug": "breaking-bad",
  "url": "https://s.to/serie/stream/breaking-bad",
  "poster_url": "https://...",
  "description": "...",
  "seasons": [
    {
      "number": 1,
      "episode_count": 7,
      "lang_keys": [1],
      "languages": ["German Dub"]
    }
  ]
}
```

**Series language key reference**
| `lang_key` | Language |
|---|---|
| `1` | German Dub |
| `2` | English Dub |

---

### GET /api/info/episode-langs

Per-episode language availability check for a specific season. Useful when a season has mixed availability.

**Query parameters**
| Param | Required | Description |
|---|---|---|
| `slug` | yes | Slug or URL |
| `season` | yes | Season number (≥1) |
| `lang_key` | yes | Language key to check (1–3) |
| `typ` | yes | `"anime"` or `"serie"` |

**Response `200`** — map of episode number to availability:
```json
{
  "1": true,
  "2": true,
  "3": false,
  "4": true
}
```

---

## Downloads

Submit download requests. The response always contains the created request record with its assigned `id` and `status`.

**Admin users:** requests are auto-approved and queued immediately — `status` will be `"approved"`.
**Regular users:** requests enter `"pending"` state and require admin approval before downloading begins.

---

### POST /api/download/anime

**Request body**
```json
{
  "slug": "sword-art-online",
  "lang_key": 1,
  "multilang": false,
  "seasons": [1, 2],
  "exclude_episodes": { "1": [1, 2] },
  "poster_url": "https://..."
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `slug` | string | yes | — | Anime slug from search results |
| `lang_key` | int | no | `1` | `1`=German Dub, `2`=English Sub, `3`=German Sub |
| `multilang` | bool | no | `false` | Produce a dual-audio MKV (dub + sub merged). Overrides `lang_key`. |
| `seasons` | int[] | no | `null` | Explicit list of season numbers to download. `null` = all seasons. |
| `exclude_episodes` | object | no | `null` | Episodes to skip per season: `{"season_num": [ep_nums]}` |
| `poster_url` | string | no | `null` | Optional poster URL for display purposes |

**Response `201`** — `DownloadRequest` object (see [Response Object](#download-request-response-object))

**Errors**
| Code | Meaning |
|---|---|
| `404` | Anime slug not found or no seasons available |
| `400` | `seasons` filter resulted in nothing to download |

**Notes**
- The server resolves available seasons from aniworld.to at request time.
- Seasons are downloaded sequentially with a cooldown between them to avoid rate limiting.
- For `multilang`: German sub files are sourced from AnimeToSho. If no subtitle file is found for an episode, the admin is notified via Discord/admin panel and can choose to abort, continue dub-only, or sub-only.

---

### POST /api/download/series

**Request body**
```json
{
  "slug": "breaking-bad",
  "lang_key": 1,
  "seasons": [1],
  "exclude_episodes": null,
  "poster_url": "https://..."
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `slug` | string | yes | — | Series slug from search results |
| `lang_key` | int | no | `1` | `1`=German Dub, `2`=English Dub |
| `seasons` | int[] | no | `null` | Season list. `null` = all seasons. |
| `exclude_episodes` | object | no | `null` | `{"season_num": [ep_nums]}` |
| `poster_url` | string | no | `null` | Optional poster URL |

**Response `201`** — `DownloadRequest` object

**Errors**
| Code | Meaning |
|---|---|
| `404` | Series not found |
| `400` | Season filter resulted in nothing to download |

---

### POST /api/download/movie

**Request body**
```json
{
  "imdb_id": "tt1375666",
  "poster_url": "https://..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `imdb_id` | string | yes | IMDb ID from movie search (e.g. `"tt1375666"`) |
| `poster_url` | string | no | Optional poster URL |

**Response `201`** — `DownloadRequest` object

**Errors**
| Code | Meaning |
|---|---|
| `503` | OMDb API key not configured on server |

---

### POST /api/download/youtube

**Request body**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "content_type": "individual"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | YouTube URL |
| `content_type` | string | yes | `"individual"`, `"playlist"`, or `"channel"` |

**Response `201`** — `DownloadRequest` object

**Errors**
| Code | Meaning |
|---|---|
| `422` | `content_type` is not one of the allowed values |

**Notes**
- Downloads go to the configured YouTube media path
- Jellyfin NFO and thumbnail metadata files are created automatically

---

### POST /api/download/music

**Request body**
```json
{
  "url": "https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv",
  "title": "Random Access Memories"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Spotify album/artist URL or YouTube Music URL |
| `title` | string | no | Display name (cosmetic, shown in history) |

**Response `201`** — `DownloadRequest` object

**Errors**
| Code | Meaning |
|---|---|
| `422` | URL is not a Spotify or YouTube Music link |

---

### Download Request Response Object

All five download endpoints return this object:

```json
{
  "id": 42,
  "user_id": "alice",
  "typ": "anime",
  "title": "Sword Art Online",
  "slug": "sword-art-online",
  "url": null,
  "season": null,
  "lang": "German Dub",
  "status": "pending",
  "requested_at": "2025-03-20T12:00:00Z",
  "approved_at": null,
  "completed_at": null,
  "error_message": null,
  "approved_by": null
}
```

| Field | Description |
|---|---|
| `id` | Request ID — use this for approval, polling, cancellation |
| `typ` | `"anime"`, `"serie"`, `"movie"`, `"youtube"`, `"music"` |
| `status` | Current lifecycle state (see [Status Lifecycle](#status-lifecycle)) |
| `error_message` | Populated on `"error"` status — admin-visible only |
| `approved_by` | Username or `"discord:<user>"` if approved via Discord button |

---

## Download History

### GET /api/download/history

Returns download requests.

**Query parameters**
| Param | Default | Description |
|---|---|---|
| `limit` | `50` | Max results (≤200) |
| `offset` | `0` | Pagination offset |

**Response `200`** — array of `DownloadRequest` objects, newest first.

**Notes**
- Admins see all users' requests.
- Regular users see only their own.

---

### DELETE /api/download/{request_id}

Remove a request from history.

**Rules**
- Admins can delete any request in a terminal state.
- Users can delete only their own requests in a terminal state.
- Active downloads (`queued`, `downloading`) must be cancelled first.

**Response `200`**
```json
{ "ok": true }
```

**Errors**
| Code | Meaning |
|---|---|
| `403` | Not your request |
| `400` | Download is still active |
| `404` | Not found |

---

### POST /api/download/history/clear

Delete all terminal-state requests at once.

- Admins clear all users' history.
- Regular users clear their own.

**Response `200`**
```json
{ "ok": true }
```

---

## Admin — Approvals

Admin role required for all endpoints in this section.

---

### GET /api/admin/requests

All pending approval requests (across all users).

**Response `200`** — array of `DownloadRequest` objects with `status = "pending"`

---

### POST /api/download/{request_id}/approve

Approve a pending request. Immediately queues the download.

**Response `200`** — updated `DownloadRequest` object (`status` = `"approved"`)

**Errors**
| Code | Meaning |
|---|---|
| `400` | Request is not in `"pending"` state |
| `404` | Not found |

---

### POST /api/download/{request_id}/reject

Reject a pending request.

**Response `200`** — updated `DownloadRequest` object (`status` = `"rejected"`)

---

### POST /api/download/{request_id}/cancel

Cancel an active download.

**Query parameters**
| Param | Description |
|---|---|
| `episode` | Optional. Episode key (e.g. `S01E03`) for episode-level cancel. Omit to cancel the whole request. |

**Response `200`**
```json
{ "ok": true }
```

---

## Admin — Download History

### GET /api/admin/history

Full download history for all users.

**Query parameters**
| Param | Default | Description |
|---|---|---|
| `limit` | `50` | Max results (≤500) |
| `offset` | `0` | Pagination offset |

**Response `200`** — array of `DownloadRequest` objects

---

## Admin — Schedule

The daily download scheduler runs at **00:30 UTC**, downloading content scheduled for the previous ISO weekday (so Monday content downloads Tuesday morning).

---

### GET /api/admin/schedule

List all schedule entries.

**Response `200`** — array of:
```json
[
  {
    "id": 1,
    "slug": "sword-art-online",
    "url": "https://aniworld.to/anime/stream/sword-art-online",
    "typ": "anime",
    "day": 2,
    "season": 1,
    "lang": "German Dub",
    "title": "Sword Art Online",
    "poster_url": "https://...",
    "episode_count": 25,
    "last_enriched": "2025-03-01T03:00:00Z"
  }
]
```

| Field | Description |
|---|---|
| `day` | ISO weekday: 1=Monday … 7=Sunday |
| `season` | The specific season being monitored (not "all seasons") |
| `typ` | `"anime"` or `"serie"` |
| `title`, `poster_url`, `episode_count` | Populated by the "Enrich" operation, may be `null` initially |

---

### POST /api/admin/schedule

Add a new schedule entry.

**Request body**
```json
{
  "slug": "sword-art-online",
  "url": "https://aniworld.to/anime/stream/sword-art-online",
  "typ": "anime",
  "day": 2,
  "season": 1,
  "lang": "German Dub",
  "title": "Sword Art Online"
}
```

| Field | Required | Description |
|---|---|---|
| `slug` | yes | Series slug |
| `url` | yes | Full source URL |
| `typ` | yes | `"anime"` or `"serie"` |
| `day` | yes | 1–7 (ISO weekday) |
| `season` | yes | Season number to monitor |
| `lang` | no | Language label (e.g. `"German Dub"`) |
| `title` | no | Display title (can be left empty and filled by Enrich) |

**Response `201`** — created entry

---

### PUT /api/admin/schedule/{id}

Update a schedule entry. All fields are optional — only sent fields are updated.

**Request body** — any subset of the create fields.

**Response `200`** — updated entry

---

### DELETE /api/admin/schedule/{id}

Delete a schedule entry.

**Response `200`**
```json
{ "ok": true }
```

---

### POST /api/admin/schedule/enrich

Fetch live metadata (title, poster, episode count) for all schedule entries and cache it in the database.

**Response `200`**
```json
{ "enriched": 12, "failed": 0 }
```

---

## Admin — Users (local user mode only)

Only relevant when the server is configured with local user accounts, not LDAP.

---

### GET /api/admin/users

List all local users.

**Response `200`** — array of:
```json
[
  {
    "id": 1,
    "username": "alice",
    "role": "admin",
    "created_at": "2025-01-01T00:00:00Z"
  }
]
```

---

### POST /api/admin/users

Create a new local user.

**Request body**
```json
{
  "username": "bob",
  "password": "strongpassword",
  "role": "user"
}
```

`role` is `"admin"` or `"user"`.

**Response `201`** — created user object

**Errors**
| Code | Meaning |
|---|---|
| `400` | Username already exists |

---

### PUT /api/admin/users/{id}

Update a user's password and/or role. All fields optional.

**Request body**
```json
{
  "password": "newpassword",
  "role": "admin"
}
```

**Response `200`** — updated user object

---

### DELETE /api/admin/users/{id}

Delete a local user.

**Response `200`**
```json
{ "ok": true }
```

---

## Real-Time Status — WebSocket

### WS /ws/downloads

Connect to receive live download progress events.

**URL**
```
ws://your-server/ws/downloads?token=<jwt>
```

Authentication is via the `token` query parameter (same JWT as the Bearer token).

**Visibility**
- Admins receive events for all users.
- Regular users receive only their own events.

---

### Event types

All events are JSON objects with a `type` field.

#### `queue_update` — request status changed

```json
{
  "type": "queue_update",
  "request_id": 42,
  "status": "downloading",
  "title": "Sword Art Online"
}
```

#### `episode_update` — individual episode progress

```json
{
  "type": "episode_update",
  "request_id": 42,
  "episode": "S01E03",
  "ep_status": "downloading",
  "progress": 67.4,
  "speed": "2.3 MB/s",
  "eta": "00:01:12"
}
```

`ep_status` values: `"queued"`, `"downloading"`, `"complete"`, `"error"`, `"skipped"`, `"cancelled"`

#### `season_update` — whole season status changed

```json
{
  "type": "season_update",
  "request_id": 42,
  "season": 1,
  "season_status": "complete"
}
```

`season_status` values: `"queued"`, `"downloading"`, `"complete"`, `"error"`, `"cancelled"`

---

### WebSocket connection example (Python)

```python
import asyncio
import json
import websockets

async def watch_downloads(server_url: str, token: str):
    uri = f"ws://{server_url}/ws/downloads?token={token}"
    async with websockets.connect(uri) as ws:
        async for message in ws:
            event = json.loads(message)
            print(event)

asyncio.run(watch_downloads("localhost:8000", "eyJ..."))
```

---

## Health Check

### GET /api/health

No authentication required.

**Response `200`**
```json
{ "status": "ok" }
```

---

## Error Responses

All errors follow FastAPI's standard format:

```json
{
  "detail": "Human-readable error message"
}
```

| HTTP code | Typical cause |
|---|---|
| `400` | Bad request (invalid parameters, wrong state) |
| `401` | Missing or expired token |
| `403` | Insufficient role (admin required) |
| `404` | Resource not found |
| `422` | Request body validation failed |
| `503` | External service not configured (OMDb, Jellyfin, etc.) |

---

## Typical Client Workflow

### 1 — Login and store token
```http
POST /api/auth/login
{"username": "alice", "password": "secret"}
→ {"access_token": "eyJ...", "token_type": "bearer"}
```

### 2 — Search for content
```http
GET /api/search/anime?q=sword+art+online
→ [{"title": "Sword Art Online", "slug": "sword-art-online", ...}]
```

### 3 — Get season/language details
```http
GET /api/info/anime?slug=sword-art-online
→ {"title": "...", "seasons": [{"number": 1, "lang_keys": [1, 3], ...}]}
```

### 4 — Submit download
```http
POST /api/download/anime
{"slug": "sword-art-online", "lang_key": 1, "seasons": [1]}
→ {"id": 42, "status": "pending", ...}   ← regular user
→ {"id": 42, "status": "approved", ...}  ← admin user
```

### 5a — Poll for status (regular user)
```http
GET /api/download/history
→ [{"id": 42, "status": "downloading", ...}]
```

### 5b — Or subscribe via WebSocket for real-time updates
```
WS /ws/downloads?token=eyJ...
← {"type": "episode_update", "request_id": 42, "episode": "S01E01", "progress": 45.2, ...}
```

### 6 — Admin approves a pending request (if not auto-approved)
```http
POST /api/download/42/approve
→ {"id": 42, "status": "approved", ...}
```
