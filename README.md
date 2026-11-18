# Mediamaster

🇬🇧 English · [🇩🇪 Deutsch](README.de.md)

**Mediamaster** is a modern, cross-platform media client for your self-hosted library.
Read books, watch movies and TV, listen to music and audiobooks, request new content,
and watch live TV — all from a single app, on desktop and mobile, with offline support.

> The repository and build artifacts use the codename **`reader`** (e.g. `reader.exe`,
> `Reader.apk`). The product itself is **Mediamaster**.

> [!IMPORTANT]
> **Viewing this on GitHub?** GitHub is only a **read-only mirror** used for building.
> The canonical repository — where issues, merge requests, and commits belong — lives on
> GitLab: **<https://gitlab.gpz-hs.de/chhammerl/reader>**. Please open issues and MRs there.

### Related repositories

Mediamaster is a client; two backend services live in their own repositories:

| Repository | Role |
|------------|------|
| [**calibre-web_API**](https://gitlab.gpz-hs.de/chhammerl/calibre-web_API) | The custom API server that sits between the app and Calibre-Web — OPDS proxy, reading-progress/read-status sync, covers, JWT/LDAP auth (port **8787**). |
| [**mediamaster-server**](https://gitlab.gpz-hs.de/chhammerl/mediamaster-server) | The backend that powers the **Requester** app (media requests, admin, scheduling). |

---

## ✨ Features

Mediamaster is organized into six apps you switch between from the top tab bar
(or the bottom tab bar on phones):

| App | What it does |
|-----|--------------|
| 📖 **Calibre** | Browse a Calibre-Web library over OPDS. Read EPUB, PDF, and manga (CBZ/CBR/CBT). Per-format reading-progress sync, offline downloads, appearance/theme controls. |
| 📺 **Jellyfin** | Movies & TV from Jellyfin. Full-featured player: resume, episode queues, "Up Next", trickplay thumbnails, chapter navigation, skip-intro, audio/subtitle track switching, Stats for Nerds, offline downloads. |
| 🎵 **JellyMusic** | Spotify/Feishin-style music client. Albums, artists, playlists, genres, a persistent player bar, a two-lane queue, shuffle/repeat, and autoplay radio. |
| 📨 **Requester** | Request new media — movies, series, anime, music, and YouTube — with an admin panel and scheduling (backed by the Mediamaster server). |
| 📡 **Live TV** | Live TV with an EPG grid and an integrated player. |
| 🎧 **Audiobooks** | Audiobookshelf client for audiobooks and podcasts, with an absolute-timeline player across multi-file tracks. |

**Across the whole app:**

- 🔍 Global search (`Ctrl+K`) across books, video, and music
- 🔄 Cross-device progress/state sync via the Sync API
- 📥 Offline downloads and cached metadata
- 🎨 Theming with per-tab accent colors
- 📱 Phone-native layout (bottom tabs, swipe-back, pull-to-refresh, haptics)
- ⬆️ In-app updater (desktop auto-download; mobile update notices)

---

## 📦 Download & Install

Prebuilt binaries are published on the **[Releases page](https://gitlab.gpz-hs.de/chhammerl/reader/-/releases)**.

| Platform | Download | Install method |
|----------|----------|----------------|
| **Windows** | `Reader-Setup.exe` (installer) or `reader.exe` (portable) | Run the installer |
| **Linux** | `Reader.AppImage` or `Reader.deb` | AppImage: `chmod +x` & run · deb: `apt install ./Reader.deb` |
| **macOS** | `Reader.dmg` | Open the DMG, drag to Applications |
| **Android** | Neo Store (F-Droid repo) or `Reader.apk` | Add the Mediamaster repo in Neo Store (auto-updates), or sideload the APK |
| **iOS / iPadOS** | `Reader.ipa` | Install via **SideStore / AltStore** |

👉 **Full step-by-step instructions for every platform are in
[docs/user/en/INSTALL.md](docs/user/en/INSTALL.md)** (auch auf
[Deutsch](docs/user/de/INSTALL.md)).

There are two release tracks: a rolling **dev** build (latest features) and
tagged **stable** releases (`v1.8.8`, …). See the install guide for how to pick one.

---

## 🚀 First-Run Configuration

On first launch, open **Settings** and configure:

1. **Credentials** — your username and password (shared across all services via LDAP/AD)
2. **API Server URL** — your Mediamaster / Calibre-Web Sync API (e.g. `http://your-server:8787`)
3. **Jellyfin Servers** — one or more Jellyfin server URLs
4. **Audiobookshelf** — your ABS server (OIDC/Authentik supported)
5. **Download Path** — where offline media is stored (defaults to `%APPDATA%`, next to the executable)

Not every service is required — configure only the apps you use.

---

## 🛠️ Tech Stack

- **Frontend:** React 19 + TypeScript + Tailwind CSS + Vite
- **Desktop runtime:** Tauri v2 (Rust) — Electron still supported for legacy
- **Mobile:** Tauri v2 mobile (iOS + Android)
- **State:** Zustand (5 stores)
- **Reader engines:** epub.js (EPUB), react-pdf (PDF), custom manga viewer
- **Video/Audio:** HTML5 media elements + [`@jellyfin/sdk`](https://github.com/jellyfin/jellyfin-sdk-typescript)
- **Backends:** [calibre-web_API](https://gitlab.gpz-hs.de/chhammerl/calibre-web_API) (FastAPI, PostgreSQL, LDAP) + [mediamaster-server](https://gitlab.gpz-hs.de/chhammerl/mediamaster-server) — see [Related repositories](#related-repositories)

---

## 🧑‍💻 Building from Source

For end users, prefer the [prebuilt releases](#-download--install). To build yourself:

**Prerequisites:** [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/)
(MSVC toolchain on Windows), and platform build tools.

```bash
npm install

# Development
npm run tauri:dev        # Tauri (recommended)
npm run dev              # Electron (legacy)

# Production build
npm run tauri:build      # Tauri
powershell ./build-tauri.ps1   # Windows helper (sets up MSVC toolchain)
npm run electron:build   # Electron
```

Per-platform build details (incl. iOS `.ipa` and Android `.apk`) live in
[`docs/development/`](docs/development/) — see [`ios-build.md`](docs/development/ios-build.md)
and [`android-build.md`](docs/development/android-build.md). See also
[CONTRIBUTING.md](CONTRIBUTING.md) for the full dev workflow.

---

## 🗂️ Project Structure

```
src/
  App.tsx                    # Main router / app-shell
  components/
    AppTabs.tsx              # Six-app tab switcher (single source: appTabsConfig.ts)
    Reader.tsx               # EPUB/PDF/Manga reader
    GlobalSearch.tsx         # Unified search modal (Ctrl+K)
    jellyfin/                #   Jellyfin video client + decomposed player + music/
    requester/               #   Requester (media requests + admin)
    livetv/                  #   Live TV (EPG grid + player)
    audiobookshelf/          #   Audiobookshelf client
  stores/                    # Zustand: settings, library, musicPlayer, playback, audiobookPlayer
  utils/                     # api.ts (Tauri/Electron), request queue, sync API, caches
electron/                    # Electron main process + preload (legacy)
src-tauri/                   # Tauri backend (Rust) — desktop + mobile
installer/                   # Inno Setup installer script (Windows)
docs/
  user/                      # End-user docs (installation, etc.)
    en/                      #   English
    de/                      #   German
  development/               # Contributor docs, English only (build guides, API refs, roadmap)
```

> The backend services live in separate repositories — see
> [Related repositories](#related-repositories).

---

## 🔌 Backend Servers

Mediamaster is a client and talks to two self-hosted backend services, each maintained
in its own repository:

### [calibre-web_API](https://gitlab.gpz-hs.de/chhammerl/calibre-web_API) — the API server

The custom API server that sits between the app and Calibre-Web. It:

- Proxies OPDS feeds from Calibre-Web (the app never talks to Calibre-Web directly)
- Exposes JWT-authenticated endpoints for reading progress, read status, and covers
- Stores sync data in PostgreSQL for cross-device support
- Authenticates users via LDAP / Active Directory

It runs on port **8787** by default — this is the **API Server URL** you set in Settings.
Setup instructions (incl. Docker) live in that repository's README.

### [mediamaster-server](https://gitlab.gpz-hs.de/chhammerl/mediamaster-server) — the Requester backend

Powers the **Requester** app: media requests (movies, series, anime, music, YouTube),
the admin panel, and scheduling.

API references for the backends are in [`docs/development/API_REFERENCE.md`](docs/development/API_REFERENCE.md)
and [`docs/development/REQUEST_API.md`](docs/development/REQUEST_API.md).

---

## ⌨️ Keyboard Shortcuts

**Global**

| Key | Action |
|-----|--------|
| `Ctrl+K` / `Cmd+K` | Open search |

**Video player**

| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| `←` / `→` | Seek ∓10s |
| `↑` / `↓` | Volume |
| `M` | Mute |
| `F` | Fullscreen |
| `I` | Stats for Nerds |
| `Esc` | Exit player |

---

## 🤝 Contributing

Contributions are welcome! Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the
development setup, coding conventions, commit style, and the release workflow, and
**[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** before opening an issue or merge request.

---

## 📄 License

[MIT](LICENSE) © 2026 Christian Hammerl
