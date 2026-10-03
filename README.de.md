# Mediamaster

[🇬🇧 English](README.md) · 🇩🇪 Deutsch

**Mediamaster** ist ein moderner, plattformübergreifender Medien-Client für die eigene,
selbst gehostete Bibliothek. Bücher lesen, Filme und Serien schauen, Musik und Hörbücher
hören, neue Medien anfragen und Live-TV sehen — alles in einer App, auf Desktop und
Mobilgeräten, mit Offline-Unterstützung.

> Das Repository und die Build-Artefakte verwenden den Codenamen **`reader`** (z. B.
> `reader.exe`, `Reader.apk`). Das Produkt selbst heißt **Mediamaster**.

> [!IMPORTANT]
> **Diese Seite gerade auf GitHub geöffnet?** GitHub ist nur ein **schreibgeschützter
> Spiegel**, der zum Bauen verwendet wird. Das maßgebliche Repository — für Issues, Merge
> Requests und Commits — liegt auf GitLab:
> **<https://gitlab.gpz-hs.de/chhammerl/reader>**. Issues und MRs bitte dort eröffnen.

### Zugehörige Repositories

Mediamaster ist ein Client; zwei Backend-Dienste liegen in eigenen Repositories:

| Repository | Aufgabe |
|------------|---------|
| [**calibre-web_API**](https://gitlab.gpz-hs.de/chhammerl/calibre-web_API) | Der eigene API-Server zwischen App und Calibre-Web — OPDS-Proxy, Synchronisierung von Lesefortschritt/Lesestatus, Cover, JWT-/LDAP-Authentifizierung (Port **8787**). |
| [**mediamaster-server**](https://gitlab.gpz-hs.de/chhammerl/mediamaster-server) | Das Backend für die **Requester**-App (Medienanfragen, Administration, Zeitplanung). |

---

## ✨ Funktionen

Mediamaster besteht aus sechs Apps, zwischen denen sich über die obere Tab-Leiste (auf
Smartphones über die untere Tab-Leiste) wechseln lässt:

| App | Funktion |
|-----|----------|
| 📖 **Calibre** | Calibre-Web-Bibliothek über OPDS durchsuchen. EPUB, PDF und Manga (CBZ/CBR/CBT) lesen. Formatgenaue Synchronisierung des Lesefortschritts, Offline-Downloads, Darstellungs- und Theme-Einstellungen. |
| 📺 **Jellyfin** | Filme & Serien aus Jellyfin. Vollwertiger Player: Fortsetzen, Episoden-Warteschlangen, „Up Next“, Trickplay-Vorschaubilder, Kapitelnavigation, Intro überspringen, Umschalten von Ton- und Untertitelspuren, Stats for Nerds, Offline-Downloads. |
| 🎵 **JellyMusic** | Musik-Client im Spotify-/Feishin-Stil. Alben, Interpreten, Playlists, Genres, dauerhafte Player-Leiste, zweispurige Warteschlange, Zufallswiedergabe/Wiederholung und Autoplay-Radio. |
| 📨 **Requester** | Neue Medien anfragen — Filme, Serien, Anime, Musik und YouTube — inklusive Admin-Bereich und Zeitplanung (über den Mediamaster-Server). |
| 📡 **Live TV** | Live-Fernsehen mit EPG-Raster und integriertem Player. |
| 🎧 **Hörbücher** | Audiobookshelf-Client für Hörbücher und Podcasts, mit durchgehender Zeitleiste über mehrere Dateien hinweg. |

**App-übergreifend:**

- 🔍 Globale Suche (`Strg+K`) über Bücher, Videos und Musik
- 🔄 Geräteübergreifende Synchronisierung von Fortschritt und Status über die Sync-API
- 📥 Offline-Downloads und zwischengespeicherte Metadaten
- 🎨 Themes mit eigenen Akzentfarben pro Tab
- 📱 Smartphone-optimiertes Layout (untere Tabs, Wisch-Geste zurück, Pull-to-Refresh, Haptik)
- ⬆️ Integrierter Updater (Desktop mit automatischem Download, mobil als Update-Hinweis)

---

## 📦 Download & Installation

Fertige Builds werden auf der
**[Releases-Seite](https://gitlab.gpz-hs.de/chhammerl/reader/-/releases)** veröffentlicht.

| Plattform | Download | Installation |
|-----------|----------|--------------|
| **Windows** | `Reader-Setup.exe` (Installer) oder `reader.exe` (portabel) | Installer ausführen |
| **Linux** | `Reader.AppImage` oder `Reader.deb` | AppImage: `chmod +x` und starten · deb: `apt install ./Reader.deb` |
| **macOS** | `Reader.dmg` | DMG öffnen und in „Programme“ ziehen |
| **Android** | Neo Store (F-Droid-Repo) oder `Reader.apk` | Mediamaster-Repo in Neo Store hinzufügen (automatische Updates) oder APK manuell installieren |
| **iOS / iPadOS** | `Reader.ipa` | Installation über **SideStore / AltStore** |

👉 **Die ausführliche Schritt-für-Schritt-Anleitung für jede Plattform steht in
[docs/user/de/INSTALL.md](docs/user/de/INSTALL.md).**

Es gibt zwei Release-Kanäle: einen rollenden **Dev**-Build (neueste Funktionen) und
getaggte **Stable**-Releases (`v1.8.8`, …). Die Installationsanleitung erklärt die Auswahl.

---

## 🚀 Ersteinrichtung

Beim ersten Start die **Einstellungen** öffnen und konfigurieren:

1. **Zugangsdaten** — Benutzername und Passwort (über LDAP/AD für alle Dienste gemeinsam)
2. **API-Server-URL** — die eigene Mediamaster-/Calibre-Web-Sync-API (z. B. `http://dein-server:8787`)
3. **Jellyfin-Server** — eine oder mehrere Jellyfin-Server-URLs
4. **Audiobookshelf** — der eigene ABS-Server (OIDC/Authentik wird unterstützt)
5. **Download-Pfad** — Speicherort für Offline-Medien (Standard: `%APPDATA%`, neben der ausführbaren Datei)

Es werden nicht alle Dienste benötigt — nur die tatsächlich genutzten Apps konfigurieren.

---

## 🛠️ Technologie

- **Frontend:** React 19 + TypeScript + Tailwind CSS + Vite
- **Desktop-Runtime:** Tauri v2 (Rust) — Electron wird weiterhin unterstützt (Legacy)
- **Mobil:** Tauri v2 Mobile (iOS + Android)
- **State:** Zustand (5 Stores)
- **Reader-Engines:** epub.js (EPUB), react-pdf (PDF), eigener Manga-Viewer
- **Video/Audio:** HTML5-Medienelemente + [`@jellyfin/sdk`](https://github.com/jellyfin/jellyfin-sdk-typescript)
- **Backends:** [calibre-web_API](https://gitlab.gpz-hs.de/chhammerl/calibre-web_API) (FastAPI, PostgreSQL, LDAP) + [mediamaster-server](https://gitlab.gpz-hs.de/chhammerl/mediamaster-server) — siehe [Zugehörige Repositories](#zugehörige-repositories)

---

## 🧑‍💻 Selbst kompilieren

Für Endanwender sind die [fertigen Releases](#-download--installation) der empfohlene Weg.
Zum Selbst-Bauen:

**Voraussetzungen:** [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/)
(unter Windows die MSVC-Toolchain) sowie die jeweiligen Build-Tools der Plattform.

```bash
npm install

# Entwicklung
npm run tauri:dev        # Tauri (empfohlen)
npm run dev              # Electron (Legacy)

# Produktions-Build
npm run tauri:build      # Tauri
powershell ./build-tauri.ps1   # Windows-Hilfsskript (richtet die MSVC-Toolchain ein)
npm run electron:build   # Electron
```

Details zu den einzelnen Plattformen (inkl. iOS-`.ipa` und Android-`.apk`) stehen in
[`docs/development/`](docs/development/) — siehe [`ios-build.md`](docs/development/ios-build.md)
und [`android-build.md`](docs/development/android-build.md). Der vollständige
Entwicklungs-Workflow steht in [CONTRIBUTING.md](CONTRIBUTING.md).

> ℹ️ Die Entwicklerdokumentation ist ausschließlich auf Englisch verfügbar.

---

## 🗂️ Projektstruktur

```
src/
  App.tsx                    # Haupt-Router / App-Shell
  components/
    AppTabs.tsx              # Tab-Umschalter der sechs Apps (Quelle: appTabsConfig.ts)
    Reader.tsx               # EPUB-/PDF-/Manga-Reader
    GlobalSearch.tsx         # Globale Suche (Strg+K)
    jellyfin/                #   Jellyfin-Video-Client + zerlegter Player + music/
    requester/               #   Requester (Medienanfragen + Administration)
    livetv/                  #   Live TV (EPG-Raster + Player)
    audiobookshelf/          #   Audiobookshelf-Client
  stores/                    # Zustand: settings, library, musicPlayer, playback, audiobookPlayer
  utils/                     # api.ts (Tauri/Electron), Request-Queue, Sync-API, Caches
electron/                    # Electron-Hauptprozess + Preload (Legacy)
src-tauri/                   # Tauri-Backend (Rust) — Desktop + Mobil
installer/                   # Inno-Setup-Installerskript (Windows)
docs/
  user/                      # Anwenderdokumentation (Installation usw., EN + DE)
  development/               # Entwicklerdokumentation (Build-Anleitungen, API-Referenzen, Roadmap)
```

> Die Backend-Dienste liegen in eigenen Repositories — siehe
> [Zugehörige Repositories](#zugehörige-repositories).

---

## 🔌 Backend-Server

Mediamaster ist ein Client und kommuniziert mit zwei selbst gehosteten Backend-Diensten,
die jeweils in einem eigenen Repository gepflegt werden:

### [calibre-web_API](https://gitlab.gpz-hs.de/chhammerl/calibre-web_API) — der API-Server

Der eigene API-Server zwischen App und Calibre-Web. Er:

- leitet OPDS-Feeds von Calibre-Web weiter (die App spricht nie direkt mit Calibre-Web)
- stellt JWT-authentifizierte Endpunkte für Lesefortschritt, Lesestatus und Cover bereit
- speichert Sync-Daten in PostgreSQL für die geräteübergreifende Nutzung
- authentifiziert Benutzer über LDAP / Active Directory

Standardmäßig läuft er auf Port **8787** — das ist die **API-Server-URL** in den
Einstellungen. Die Einrichtung (inkl. Docker) ist in der README des Repositories beschrieben.

### [mediamaster-server](https://gitlab.gpz-hs.de/chhammerl/mediamaster-server) — das Requester-Backend

Betreibt die **Requester**-App: Medienanfragen (Filme, Serien, Anime, Musik, YouTube),
den Admin-Bereich und die Zeitplanung.

Die API-Referenzen der Backends stehen in
[`docs/development/API_REFERENCE.md`](docs/development/API_REFERENCE.md) und
[`docs/development/REQUEST_API.md`](docs/development/REQUEST_API.md).

---

## ⌨️ Tastenkürzel

**Global**

| Taste | Aktion |
|-------|--------|
| `Strg+K` / `Cmd+K` | Suche öffnen |

**Video-Player**

| Taste | Aktion |
|-------|--------|
| `Leertaste` / `K` | Wiedergabe / Pause |
| `←` / `→` | 10 s zurück / vor |
| `↑` / `↓` | Lautstärke |
| `M` | Stumm schalten |
| `F` | Vollbild |
| `I` | Stats for Nerds |
| `Esc` | Player verlassen |

---

## 🤝 Mitwirken

Beiträge sind willkommen! Vor dem Eröffnen eines Issues oder Merge Requests bitte
**[CONTRIBUTING.md](CONTRIBUTING.md)** (Entwicklungsumgebung, Code-Konventionen,
Commit-Stil und Release-Workflow) sowie **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** lesen.

> ℹ️ Diese Dokumente liegen nur auf Englisch vor; Issues und Merge Requests dürfen aber
> gerne auf Deutsch verfasst werden.

Beim Anlegen eines Issues stehen deutsche Vorlagen zur Verfügung — im
Vorlagen-Auswahlfeld die mit **(DE)** markierten Einträge wählen:

| Vorlage | Wofür |
|---------|-------|
| `Bug (DE)` | Etwas ist kaputt oder liefert ein falsches Ergebnis |
| `Feature (DE)` | Eine neue Funktion, die es noch nicht gibt |
| `Visual_Improvement (DE)` | Funktioniert, *sieht* aber nicht gut aus (Abstände, Farben, Größen) |
| `Interaction_UX (DE)` | Funktioniert, *fühlt* sich aber falsch an (umständlich, unklar, träge) |

---

## 📄 Lizenz

[MIT](LICENSE) © 2026 Christian Hammerl
