# Installing Mediamaster

🇬🇧 English · [🇩🇪 Deutsch](../de/INSTALL.md)

Mediamaster ships prebuilt binaries for **Windows, Linux, macOS, Android, and iOS**.
This guide covers installing the finished app on each platform. To build from source
instead, see [CONTRIBUTING.md](../../../CONTRIBUTING.md).

> **Codename note:** downloads are named `reader.*` / `Reader.*` — that's the internal
> codename. The installed app is **Mediamaster**.

---

## Where to download

All builds live on the **[Releases page](https://gitlab.gpz-hs.de/chhammerl/reader/-/releases)**.

There are two tracks:

| Track | Which release | For whom |
|-------|---------------|----------|
| **Stable** | Tagged releases `v1.8.8`, `v1.9.0`, … | Most people — tested, versioned builds |
| **Dev** | The rolling `dev` release (updated every pipeline) | Early adopters who want the latest features |

Grab the file for your platform from the release's **Assets → Download** section.

| Platform | File(s) |
|----------|---------|
| Windows | `Reader-Setup.exe` (installer), `reader.exe` (portable) |
| Linux | `Reader.AppImage`, `Reader.deb` |
| macOS | `Reader.dmg` |
| Android | `Reader.apk` — or install via **Neo Store** ([F-Droid repo](#-android-neo-store--f-droid-repo), recommended) |
| iOS / iPadOS | `Reader.ipa` (stable) · `Reader-dev.ipa` (dev) |

Mediamaster also has an **in-app updater** — once installed, it can notify you about
(and on desktop, download) newer builds, so you usually only do a manual install once.

---

## 🪟 Windows

**Installer (recommended)**

1. Download `Reader-Setup.exe`.
2. Run it. Windows SmartScreen may warn about an unrecognized publisher (the build is
   unsigned) — click **More info → Run anyway**.
3. Follow the wizard. Mediamaster installs and adds a Start-menu entry.

**Portable**

1. Download `reader.exe`.
2. Put it in a folder of your choice and run it directly — no installation.
   Offline downloads land in a `dl/` folder next to the exe.

---

## 🐧 Linux

**AppImage (works on most distros)**

```bash
chmod +x Reader.AppImage
./Reader.AppImage
```

> If it fails to start, install FUSE (`sudo apt install libfuse2` on Debian/Ubuntu),
> or extract and run with `./Reader.AppImage --appimage-extract-and-run`.

**Debian / Ubuntu (.deb)**

```bash
sudo apt install ./Reader.deb
# then launch "Mediamaster" from your app menu, or run: reader
```

---

## 🍎 macOS

1. Download `Reader.dmg`, open it, and drag **Mediamaster** into **Applications**.
2. The build is unsigned, so the first launch is blocked by Gatekeeper. Either:
   - **Right-click → Open**, then confirm **Open** in the dialog, or
   - run once: `xattr -dr com.apple.quarantine /Applications/Mediamaster.app`

> The `.dmg` is a best-effort/unsigned artifact and may occasionally be missing from a
> given dev build. If so, grab the previous release or use a stable one.

---

## 🤖 Android (Neo Store / F-Droid repo)

The recommended way to install **and auto-update** on Android is through
**[Neo Store](https://github.com/NeoApplications/Neo-Store)** (an F-Droid client), using
the Mediamaster F-Droid repository.

### One-time: add the Mediamaster repo

1. Install **Neo Store** (from [F-Droid](https://f-droid.org/) or its
   [GitHub releases](https://github.com/NeoApplications/Neo-Store/releases)).
2. In Neo Store, open the **Repositories** screen (the repo icon in the top bar, or
   *Settings → Repositories*) and tap **➕ Add repository**.
3. Enter:

   - **Address:**
     ```
     https://gitlab.gpz-hs.de/api/v4/projects/10/packages/generic/reader-fdroid/repo
     ```
   - **Fingerprint:**
     ```
     86f476fdc6d981a0804c3c63f68e6dc4f74bc1ed691507d6c799dc7965628f51
     ```

4. Confirm and let Neo Store **sync** the repo.

> ℹ️ Opening the repo address in a browser returns **404** — that's expected. F-Droid
> clients fetch `<address>/entry.jar`, not the bare path.

### Install & update

After syncing, search Neo Store for **Mediamaster** (stable) or **Mediamaster Dev**
and install. The two are separate apps (`com.hammerl.reader` and
`com.hammerl.reader.dev`) with distinct IDs, so you can keep both installed side by side.
From then on, Neo Store handles updates automatically whenever a new build is published.

### Or: install the raw APK

If you'd rather not use Neo Store, download `Reader.apk` from the
[Releases page](https://gitlab.gpz-hs.de/chhammerl/reader/-/releases), open it, and
**allow installing unknown apps** for your browser/file manager when prompted. Every
release is signed with the same key, so a newer APK installs **over** the old one and
keeps your data — but you won't get automatic updates this way.

> The app talks to LAN media servers over plain `http://` (cleartext is enabled), so
> local Jellyfin/Calibre/ABS servers work without extra setup.

---

## 📱 iOS / iPadOS (SideStore)

iOS apps can't be installed from a file directly — you sideload the `.ipa` with
**[SideStore](https://sidestore.io/)** (or AltStore). SideStore installs a signed copy
using your own Apple ID and refreshes it in the background so it doesn't expire.

### One-time SideStore setup

1. Install and set up **SideStore** on your device by following the official guide:
   <https://docs.sidestore.io/docs/intro>. This installs the SideStore app
   and pairs it with your Apple ID.

### Add the Mediamaster source

Mediamaster publishes a **SideStore/AltStore source** so you can install and update it
right from within SideStore (recommended over installing the raw `.ipa`).

1. Open **SideStore → Sources → `+` (Add)**.
2. Paste the Mediamaster source URL:

   ```
   https://gitlab.gpz-hs.de/api/v4/projects/10/packages/generic/reader-source/latest/updates.json
   ```

3. Open the new source and install **Mediamaster** (stable) or **Mediamaster Dev**.
   The two are separate apps with distinct bundle IDs, so you can run both side by side.

### Or: install the raw .ipa

If you prefer not to add the source, download `Reader.ipa` and open it with SideStore
(**SideStore → Apps → `+` → pick the `.ipa`**).

### Server prerequisites for iOS

- Local servers over `http://` work — the build ships an App Transport Security
  exception. On first LAN connection iOS asks for **Local Network** permission; allow it.
- **Audiobookshelf OIDC login** requires adding the redirect URI
  `mediamaster://abs-oauth-callback` to your ABS server
  (*Settings → Authentication → OpenID → Mobile app redirect URIs*).

### Refresh reminder

SideStore-signed apps must be refreshed periodically (typically every 7 days with a free
Apple ID). SideStore does this automatically while it can reach your pairing setup;
otherwise open SideStore and tap **Refresh All**. App data is preserved across refreshes.

---

## 🔧 Troubleshooting

| Problem | Fix |
|---------|-----|
| Windows "publisher not recognized" | Builds are unsigned — **More info → Run anyway**. |
| macOS "app is damaged / cannot be opened" | `xattr -dr com.apple.quarantine /Applications/Mediamaster.app` |
| Linux AppImage won't start | Install FUSE or use `--appimage-extract-and-run`. |
| Android blocks the raw-APK install | Allow "install unknown apps" for your browser/file manager. |
| Neo Store repo won't add / 404 in browser | The 404 is expected; enter the exact address + fingerprint and let Neo Store sync (it fetches `entry.jar`). |
| iOS app stopped opening after a week | Open SideStore → **Refresh All** (free Apple ID certs expire in 7 days). |
| Can't reach a local server | Use the server's LAN IP/hostname; on iOS allow the **Local Network** prompt. |

Still stuck? Open an issue — see [CONTRIBUTING.md](../../../CONTRIBUTING.md).
