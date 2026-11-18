# Calibre-Web Sync API — Integration Reference

Base URL: `http://<host>:8787`

All endpoints except `/api/login` require a JWT Bearer token in the `Authorization` header.

---

## Authentication

### `POST /api/login`

Authenticate with Calibre-Web credentials and receive a JWT token.

**Request:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response `200`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
- `401` — Invalid credentials
- `502` — Calibre-Web unreachable

**Side effects:** If PostgreSQL is configured, all books marked as read in Calibre-Web are synced to the database on every login.

**Token usage:** Include in all subsequent requests:
```
Authorization: Bearer <token>
```

Tokens expire after 24 hours by default (configurable via `JWT_EXPIRE_HOURS`).

---

### `POST /api/refresh`

Exchange a still-valid token for a fresh one, extending the session **without
re-sending credentials**. Makes no Calibre-Web round trip — the (encrypted)
password claim is carried over from the presented token.

**Request:** No body. Requires the `Authorization: Bearer <token>` header.

**Response `200`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
- `401` — Token missing, invalid, or expired (an already-expired token cannot be refreshed — the client must log in again)

**Recommended usage:** Call this shortly before the token expires (e.g. when it's
within an hour of `exp`) to roll the session forward seamlessly.

---

## Health

### `GET /health`

Liveness/readiness probe. **No authentication**, no upstream calls — safe for
load balancers and container health checks.

**Response `200`:**
```json
{
  "status": "ok",
  "database": true
}
```

`database` is `true` when PostgreSQL is configured and initialised.

---

## Books

### `GET /api/books`

List all books from the Calibre-Web library. Results are cached server-side for 5 minutes.

**Query parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `format` | string | — | Filter by format: `EPUB`, `PDF`, `CBZ`, `CBR`, `CBT` |
| `search` | string | — | Case-insensitive substring filter over title, authors and series. Applied in-memory over the cached list (no extra Calibre-Web traffic). |
| `sort` | string | `title` | Sort order: `title`, `author`, or `series`. Unknown values leave the native order. |
| `limit` | int | `0` | Page size. `0` = return all as a flat array. |
| `offset` | int | `0` | Items to skip (only used when `limit > 0`). |

**Caching / conditional requests:** Responses carry a weak `ETag` and
`Cache-Control: private, max-age=0, must-revalidate`. Send the ETag back in an
`If-None-Match` header to receive `304 Not Modified` (empty body) when the list
hasn't changed — avoids re-downloading the full list on every poll. The ETag
reflects the current `format`/`search`/`sort`/`limit`/`offset` combination.

**Response `200` — flat list (limit=0):**
```json
[
  {
    "id": 2495,
    "title": "My Manga Vol. 3",
    "authors": ["Author Name"],
    "series": "My Manga",
    "series_index": 3.0,
    "formats": ["CBR"],
    "cover_url": "/opds/cover/2495"
  }
]
```

**Response `200` — paginated (limit > 0):**
```json
{
  "items": [ { "id": 2495, ... } ],
  "total": 2381,
  "offset": 0,
  "limit": 20
}
```

**Response fields (BookSummary):**

| Field | Type | Description |
|-------|------|-------------|
| `id` | int | Calibre book ID |
| `title` | string | Book title |
| `authors` | string[] | List of author names |
| `series` | string \| null | Series name |
| `series_index` | float \| null | Position within the series |
| `formats` | string[] | Available formats (uppercase) |
| `cover_url` | string | Relative URL to the cover image (`/opds/cover/{id}`) |

---

### `GET /api/books/recently-added`

Return the most recently added books. Fetches only the first OPDS page — fast (~500 ms), no full library crawl. Use for dashboard "Recently Added" widgets.

**Query parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `limit` | int | `20` | Max books to return (1–100). |

**Response `200`:** Array of `BookSummary` (same fields as `/api/books`).

---

### `GET /api/books/{id}`

Get full details for a single book. Uses the cached book list — fast after the first request within the 5-minute cache window.

**Path parameters:**

| Name | Type | Description |
|------|------|-------------|
| `id` | int | Calibre book ID |

**Response `200`:**
```json
{
  "id": 2495,
  "title": "My Manga Vol. 3",
  "authors": ["Author Name"],
  "series": "My Manga",
  "series_index": 3.0,
  "formats": ["CBR"],
  "cover_url": "/opds/cover/2495",
  "description": "Book description as plain text (HTML stripped).",
  "publisher": "Publisher Name",
  "language": "deu"
}
```

**Additional fields over list endpoint:**

| Field | Type | Description |
|-------|------|-------------|
| `description` | string \| null | Plain-text description (HTML tags stripped from Calibre-Web content) |
| `publisher` | string \| null | Publisher name |
| `language` | string \| null | ISO language code |

**Errors:**
- `404` — Book not found

---

### `GET /opds/cover/{id}`

Fetch a book's cover image. This is the **canonical cover URL** — all `cover_url` fields in API responses point here.

Uses Calibre-Web's OPDS cover endpoint (Basic Auth), so it works reliably without a web session. Responses carry `Cache-Control: max-age=86400, immutable` — clients should cache aggressively.

**Response `200`:** Binary image data (`image/jpeg` or `image/png`).

**Errors:**
- `404` — Cover not found

### `GET /api/books/{id}/cover`

Compatibility alias for `/opds/cover/{id}`. Prefer the OPDS URL for new integrations.

---

### `GET /api/books/{id}/download`

Stream the actual book file from Calibre-Web. The file is streamed to a temp
file on the server (never fully buffered in memory, honouring `MAX_COMIC_SIZE`
when set) and then streamed to the client; the temp file is removed after the
response completes. Prefer this over the raw `/opds/download/...` passthrough.

**Path parameters:**

| Name | Type | Description |
|------|------|-------------|
| `id` | int | Calibre book ID |

**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `format` | string | Yes | Format to download: `EPUB`, `PDF`, `CBZ`, `CBR`, `CBT`. |

**Response `200`:** Binary file stream with a format-appropriate `Content-Type`
(e.g. `application/epub+zip`, `application/pdf`, `application/vnd.comicbook+zip`)
and a `Content-Disposition: attachment; filename="{id}.{ext}"` header.

**Errors:**
- `404` — Book/format not found
- `502` — Calibre-Web unreachable or download failed

---

### `GET /api/books/started`

List books that have reading progress but are **not** marked as read (i.e., in-progress books). Requires PostgreSQL.

**Query parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `include_details` | bool | `false` | When `true`, enriches each row with book metadata (title, authors, cover, etc.) joined from the book-list cache. If the cache is warm the join is free; if cold, one OPDS crawl is triggered and cached for subsequent requests. |

**Response `200` — include_details=false (default):**
```json
[
  {
    "book_id": 2495,
    "format": "CBR",
    "position": "42",
    "updated_at": "2026-02-24T15:30:00+00:00"
  }
]
```

**Response `200` — include_details=true:**
```json
[
  {
    "book_id": 2495,
    "format": "CBR",
    "position": "42",
    "updated_at": "2026-02-24T15:30:00+00:00",
    "title": "Yona Vol. 1",
    "authors": ["Mizuho Kusanagi"],
    "cover_url": "/opds/cover/2495",
    "formats": ["CBR"],
    "series": "Yona of the Dawn",
    "series_index": 1.0
  }
]
```

**Note:** Fields from `include_details=true` are omitted (not null) when `include_details=false` — the response shape is identical to the previous version.

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `book_id` | int | Calibre book ID |
| `format` | string | Format the progress was saved for |
| `position` | string | Page number (comics/PDF) or CFI string (EPUB) |
| `updated_at` | string \| null | ISO 8601 timestamp of last update |

**Errors:**
- `503` — PostgreSQL not configured

---

## Reading Progress

### `GET /api/books/{id}/progress`

Get the current reading position for a book.

**Query parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `format` | string | No | Force a specific format. If omitted, auto-selected by priority. |

**Response `200`:**
```json
{
  "book_id": 2495,
  "position": "42",
  "total_pages": 120,
  "format": "CBR"
}
```

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `book_id` | int | Calibre book ID |
| `position` | string \| null | Current position. `null` if no progress saved. Page number string for comics/PDF, CFI string for EPUB. |
| `total_pages` | int \| null | Total image count in comic. `null` for EPUB/PDF, or on the **first** request for a comic whose page count isn't cached yet (see note). |
| `format` | string | Format used for this progress lookup |

**`total_pages` on first read:** Page counting requires downloading the comic,
which no longer blocks this endpoint. On the first `GET` for a comic that hasn't
been counted, `total_pages` is `null` and the count is computed in the
background; subsequent requests return the cached number. Clients should treat
`total_pages: null` as "unknown for now" and re-read shortly after (or on next
screen focus) to pick up the value.

**Sync behavior:**
- **CBZ/CBR/CBT:** Fetches position from both Calibre-Web and PostgreSQL. The higher page number wins. The winner is automatically synced back to whichever store was behind.
- **EPUB/PDF:** Reads from PostgreSQL only. Calibre-Web does not store server-side bookmarks for these formats.

**Format auto-selection priority:** EPUB > PDF > CBZ > CBR > CBT

---

### `PUT /api/books/{id}/progress`

Set the reading position for a book.

**Request:**
```json
{
  "position": "42",
  "format": "CBR"
}
```

**Request fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `position` | string | Yes | Page number string for comics/PDF, or CFI string for EPUB |
| `format` | string | No | Target format. Defaults to auto-detection, fallback `CBR`. |

**Response `200`:**
```json
{
  "success": true,
  "position": "42"
}
```

**Write behavior:**
- **CBZ/CBR/CBT:** Writes to PostgreSQL (primary store) synchronously, then pushes the bookmark to Calibre-Web in the background — so page-turn calls return without waiting on Calibre-Web. Without a DB configured, the Calibre-Web write stays synchronous so failures surface.
- **EPUB/PDF:** Writes to PostgreSQL only.

**Errors:**
- `502` — Failed to write bookmark to Calibre-Web (only when no DB is configured)

---

### `POST /api/books/progress`

Get saved progress for **many books in one request** — intended for shelf /
"continue reading" views so clients don't need one `GET /progress` per book.
Served from a single bulk database query plus one bulk page-count lookup; makes
**no** Calibre-Web round trips. Requires PostgreSQL.

**Request:**
```json
{
  "book_ids": [12, 34, 56]
}
```

**Response `200`:**
```json
[
  { "book_id": 12, "format": "CBZ", "position": "42", "total_pages": 180 },
  { "book_id": 34, "format": "EPUB", "position": "epubcfi(/6/14!/4/2/1:0)", "total_pages": null }
]
```

**Notes:**
- Books with no saved progress simply **do not appear** in the response.
- A book with progress in several formats yields **one item per format**.
- `total_pages` follows the same caching rules as the single `GET /progress`
  (populated for comics once counted; `null` for EPUB/PDF or not-yet-counted).
- This endpoint reads DB values only; it does **not** perform the bidirectional
  Calibre-Web sync that the single-book `GET /progress` does. Open a book with
  `GET /progress` when the reader actually starts, to trigger that sync.

**Errors:**
- `503` — PostgreSQL not configured

---

## Read Status

### `GET /api/books/{id}/read-status`

Check if a book is marked as read or unread.

**Response `200`:**
```json
{
  "book_id": 2495,
  "is_read": true
}
```

When PostgreSQL is configured this returns the DB value **instantly** (no
Calibre-Web request). It falls back to a live Calibre-Web lookup only when no DB
is configured. Use `GET /api/books/read` to trigger a full two-way reconcile
with Calibre-Web.

---

### `PUT /api/books/{id}/read-status`

Mark a book as read or unread.

**Request:**
```json
{
  "read": true
}
```

**Response `200`:**
```json
{
  "book_id": 2495,
  "is_read": true
}
```

**Write behavior:** With PostgreSQL configured (the primary store), the DB is
written synchronously and the Calibre-Web toggle is pushed in the **background**
— so this call returns without waiting on Calibre-Web's read + toggle round
trips. The response echoes the requested state, and `GET /read-status` /
`GET /api/books/read` (both DB-backed) reflect it immediately; Calibre-Web's own
UI converges a moment later. When marking as read, comic progress is advanced to
the final page for any comic format whose page count is already cached (no
download triggered). Without a DB, the Calibre-Web write stays synchronous.

**Errors:**
- `502` — Failed to update read status in Calibre-Web (only when no DB is configured)

---

## OPDS Passthrough

### `GET /opds/{path}`

Proxies any OPDS request to Calibre-Web and returns raw Atom XML.

**Examples:**
- `GET /opds/` — OPDS root catalog
- `GET /opds/new` — newest books
- `GET /opds/readbooks` — books marked as read
- `GET /opds/formats/CBR` — all CBR books
- `GET /opds/search/myquery` — search
- `GET /opds/download/2495/cbr/` — download a book file

**Response:** Raw XML/binary from Calibre-Web with original `Content-Type`.

---

## Data Types Reference

### Position strings

The `position` field is always a string. Its content depends on the format:

| Format | Position example | Description |
|--------|-----------------|-------------|
| CBZ/CBR/CBT | `"42"` | Zero-indexed page number |
| PDF | `"15"` | Page number |
| EPUB | `"epubcfi(/6/14!/4/2/1:0)"` | EPUB Canonical Fragment Identifier |

### Format strings

Always uppercase in API responses and requests: `EPUB`, `PDF`, `CBZ`, `CBR`, `CBT`.

---

## Progress Storage Summary

| Format | Calibre-Web (server-side) | PostgreSQL | Sync |
|--------|--------------------------|------------|------|
| CBZ | Yes | Yes | Bidirectional, higher page wins |
| CBR | Yes | Yes | Bidirectional, higher page wins |
| CBT | Yes | Yes | Bidirectional, higher page wins |
| EPUB | No | Yes | DB only |
| PDF | No | Yes | DB only |

---

## Error Responses

All errors follow this format:
```json
{
  "detail": "Error description"
}
```

| Status | Meaning |
|--------|---------|
| `304` | `GET /api/books` — list unchanged since the `ETag` you sent in `If-None-Match` (not an error; body is empty) |
| `401` | Invalid or expired JWT token / bad credentials |
| `404` | Book or resource not found |
| `502` | Calibre-Web unreachable or returned an error |
| `503` | Feature requires PostgreSQL but it is not configured |

---

## Typical Integration Flow

1. **Login** — `POST /api/login` with username/password → store the JWT token
2. **List library** — `GET /api/books` (optionally `format`/`search`/`sort`); cache the `ETag` and send `If-None-Match` on later polls
3. **Show cover** — `GET /api/books/{id}/cover` → display as image
4. **Continue reading list** — `GET /api/books/started`, then `POST /api/books/progress` with the visible IDs → render progress bars in one round trip
5. **Resume reading** — `GET /api/books/{id}/progress?format=CBR` → jump to `position` (triggers Calibre-Web sync)
6. **Save progress** — `PUT /api/books/{id}/progress` with current position on every page turn or at intervals
7. **Mark finished** — `PUT /api/books/{id}/read-status` with `{"read": true}`
8. **Download the file** — `GET /api/books/{id}/download?format=EPUB` when you need the book itself
9. **Token refresh** — `POST /api/refresh` shortly before the token expires (24h default), instead of re-sending credentials

---

## Changelog

### Unreleased — performance & API pass

**New endpoints**
- **`POST /api/books/progress`** — batch progress lookup for many books in one
  request (shelf / continue-reading views). DB-only, single bulk query.
- **`GET /api/books/{id}/download`** — first-class streamed book-file download
  (previously only reachable via the raw `/opds/` passthrough).
- **`POST /api/refresh`** — exchange a valid token for a fresh one without
  re-sending credentials.
- **`GET /health`** — unauthenticated liveness/readiness probe.

**Updated endpoints**
- **`GET /api/books`** — added `search` and `sort` query params (applied
  in-memory over the cached list); responses now carry a weak `ETag` and support
  `If-None-Match` → `304 Not Modified`.
- **`PUT /api/books/{id}/read-status`** — now DB-first: writes PostgreSQL
  synchronously and pushes the Calibre-Web toggle in the background (when a DB is
  configured), so the call no longer blocks on Calibre-Web's read+toggle round
  trips. Response semantics unchanged.
- **`GET /api/books/{id}/progress`** — first read of an uncounted comic no longer
  blocks on downloading the file: `total_pages` returns `null` and is computed in
  the background, then cached for subsequent requests.

**Infrastructure (transparent to clients)**
- Shared keep-alive HTTP connection pool to Calibre-Web — every request reuses
  pooled connections instead of paying a fresh TCP+TLS handshake.
- `gzip` response compression for payloads over ~1 KB (e.g. the full book list).
- PostgreSQL index on `read_status (username, is_read)` created idempotently on
  startup.

---

## Impact on Clients

**None of the changes are breaking.** Response shapes are unchanged; everything
below is either additive or a behavioural refinement you can adopt at your own
pace.

**Action item (one):**
- **Tolerate `total_pages: null`.** On the *first* `GET /api/books/{id}/progress`
  (or `POST /api/books/progress`) for a comic that hasn't been counted yet,
  `total_pages` is now `null` more often, because counting moved to the
  background. This field was always nullable — just make sure a `null` renders as
  an indeterminate/hidden progress bar rather than crashing. Optionally re-fetch a
  few seconds later (or on next screen focus) to pick up the count.

**Transparent — no client change needed:**
- **Shared connection pool & gzip.** Pure server-side speedups. Any standard HTTP
  client already sends `Accept-Encoding: gzip` and decompresses automatically.
- **`PUT /read-status` is now eventual w.r.t. Calibre-Web.** The response still
  echoes the requested state and the DB (which every read-back endpoint uses) is
  updated synchronously, so an immediate read-back is correct. Only Calibre-Web's
  own web UI converges a moment later — don't poll *it* for instant confirmation.

**Optional adoption (recommended, in rough priority order):**
1. **Batch progress** — replace N per-book `GET /progress` calls on shelf views
   with one `POST /api/books/progress`. Biggest client-side speedup.
2. **Conditional book-list fetch** — store the `ETag` from `GET /api/books` and
   send it as `If-None-Match`; handle `304` by reusing your cached copy.
3. **Server-side search/sort** — pass `search`/`sort` instead of downloading the
   whole list and filtering locally.
4. **Token refresh** — call `POST /api/refresh` near expiry instead of prompting
   for credentials again.
5. **Downloads** — switch any raw `/opds/download/...` usage to
   `GET /api/books/{id}/download?format=...`.
