# Building the iOS App (.ipa)

The repo is iOS-ready (Tauri v2 mobile): the Rust crate is a library
(`src-tauri/src/lib.rs` with `#[cfg_attr(mobile, tauri::mobile_entry_point)]`),
desktop-only features (window-state plugin, window controls, folder picker,
OIDC login window) are `#[cfg]`-gated, and mobile capabilities live in
`src-tauri/capabilities/mobile.json`.

**iOS compilation requires macOS + Xcode.** It cannot run on Windows or Linux.

Distribution model: **personal sideloading** — build an *unsigned* .ipa on the
Mac, then sign + install it with **Sideloadly** (free Apple ID). Constraints of
the free Apple ID: certificates expire after **7 days** (re-sideload weekly,
app data is preserved), max **3** sideloaded apps per device.

---

## 1. The build machine

### Option A: macOS VM on Proxmox (chosen route)

> ⚠️ Running macOS on non-Apple hardware violates Apple's macOS EULA.
> Technically it works well; the legal call is yours.

- Use [OSX-PROXMOX](https://github.com/luchina-gabriel/OSX-PROXMOX) (automated
  installer for Proxmox 7/8) or [OSX-KVM](https://github.com/kholia/OSX-KVM).
- VM sizing: ≥4 vCPU (host CPU type), ≥8 GB RAM, ≥80 GB disk (Xcode alone
  needs ~40 GB during install). macOS Sonoma or newer (current Xcode requires it).
- AMD hosts work but need extra CPU args; Intel is smoother.

Once macOS boots, install:

```sh
# 1. Xcode — full app from the App Store or https://xcodereleases.com
#    (Command Line Tools alone are NOT enough for iOS builds)
sudo xcode-select -s /Applications/Xcode.app
sudo xcodebuild -license accept
xcodebuild -runFirstLaunch

# 2. Homebrew + CocoaPods
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install cocoapods node

# 3. Rust + iOS targets
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
```

Later, a GitLab runner can be installed in this VM (`brew install gitlab-runner`,
shell executor) so section 3 becomes a CI job.

### Option B: GitHub Actions (no Mac at all)

Set up a **push mirror** from the self-hosted GitLab to a GitHub repo
(GitLab: *Settings → Repository → Mirroring repositories*), then run the
commands from sections 2–3 in a workflow on `runs-on: macos-14`. macOS runners
consume 10× minutes on private repos.

---

## 2. One-time project setup (on the Mac; commit the results)

```sh
git clone <repo> && cd reader
npm ci

# Generate the Xcode project under src-tauri/gen/apple/
npx tauri ios init

# Generate iOS app icons into the asset catalog.
# Source must be square, ≥1024×1024. --ios-color flattens transparency
# (iOS forbids transparent app icons).
npx tauri icon src-tauri/icons/icon.png --ios-color "#1B1B1F"
```

Then **edit `src-tauri/gen/apple/reader_iOS/Info.plist`** (filename may vary
slightly) and add an App Transport Security exception — our self-hosted
servers (Sync API, Jellyfin) are often plain `http:`, which WKWebView blocks
by default:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
</dict>
```

Finally **commit `src-tauri/gen/apple/`** (it ships its own `.gitignore` for
Xcode build artifacts) so future builds don't need `ios init` again.

---

## 3. Building the sideloadable .ipa (repeatable)

Build **unsigned** — Sideloadly does the signing, so the Mac needs no Apple ID,
no provisioning profile, no device registration:

```sh
npm ci
npm run build:frontend            # tsc && vite build → dist/

cd src-tauri/gen/apple
xcodebuild -project reader.xcodeproj -scheme reader_iOS \
  -configuration release -sdk iphoneos -derivedDataPath build \
  CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO

# Wrap the .app into an .ipa (an .ipa is just a zip with a Payload/ folder)
mkdir -p Payload
cp -r build/Build/Products/release-iphoneos/*.app Payload/
zip -r Reader.ipa Payload
rm -rf Payload
```

Notes:
- The Xcode project's "Build Rust Code" phase calls `tauri ios xcode-script`,
  which cargo-builds `reader_lib` for `aarch64-apple-ios` automatically —
  no separate cargo invocation needed.
- Scheme/project names derive from the product name; check with
  `xcodebuild -project reader.xcodeproj -list` if the scheme name differs.

### Alternative: signed build via Xcode Personal Team

If the free Apple ID is added to Xcode (*Settings → Accounts*), you can instead:

```sh
export APPLE_DEVELOPMENT_TEAM=<TEAMID>   # or set bundle.iOS.developmentTeam in tauri.conf.json
npx tauri ios build --export-method debugging
# .ipa lands in src-tauri/gen/apple/build/arm64/
```

Free-tier export can fail if the target device's UDID isn't in the
provisioning profile — that's why the unsigned route above is the default.

---

## 4. Installing with Sideloadly

1. Install [Sideloadly](https://sideloadly.io/) on the Windows PC.
2. Connect the iPhone/iPad via USB (trust the computer).
3. Drag `Reader.ipa` into Sideloadly, enter the free Apple ID, click Start.
4. On the device: *Settings → General → VPN & Device Management* → trust the
   developer certificate.
5. Repeat every ≤7 days (free-ID certificate lifetime). App data survives
   re-sideloading.

---

## 5. What works / known v1 limitations on iOS

| Area | Status |
|---|---|
| Calibre reading, downloads, progress sync | expected to work (app-container storage) |
| Jellyfin / JellyMusic streaming | expected to work (ATS exception required for `http:` servers) |
| Download location | fixed to the app container; the "Change..." folder picker is hidden on iOS |
| OIDC / Audiobookshelf login | works via **Safari + deep link** (see below) |
| Window controls / geometry persistence | not applicable, cfg-gated out |
| Credential storage (Keychain) | should work; if entitlements block it under a free profile, passwords simply don't persist |
| Touch UX (hover menus, keyboard shortcuts, wheel volume) | unpolished — desktop-first UI, later pass |

Development iteration with a simulator: `npx tauri ios dev` (requires the Vite
dev server reachable from the simulator, e.g. `--host`).

---

## 6. Audiobookshelf OIDC login on iOS

iOS has no second webview window, so the login runs through the system
browser instead:

1. The app asks ABS for the IdP authorize URL (Rust HTTP client, cookies kept
   in-process) with `redirect_uri=mediamaster://abs-oauth-callback`.
2. The authorize URL opens in **Safari**; the user logs in at Authentik.
3. ABS redirects Safari to `mediamaster://abs-oauth-callback?code=…&state=…` —
   iOS routes that custom scheme back into the app (deep-link plugin), which
   completes the code exchange with the step-1 cookies.

**Server prerequisite:** add `mediamaster://abs-oauth-callback` to
ABS → *Settings → Authentication → OpenID → Mobile app redirect URIs*
(alongside the existing `http://localhost/abs-oauth-callback` used by the
desktop app).

The `mediamaster` URL scheme is registered in the generated `Info.plist` by
the CI workflow (PlistBuddy patch in `.github/workflows/ios-build.yml`). If
you ever commit `src-tauri/gen/apple/`, make sure `CFBundleURLTypes` with the
`mediamaster` scheme is present in the committed `Info.plist`.

The same workflow step also adds `NSLocalNetworkUsageDescription` — required
on iOS 14+ so connections to servers on private LAN addresses trigger the
Local Network permission prompt instead of being silently dropped (this was
the cause of the requester tab hanging at "Connecting..." forever; there is
also now a 15 s connect timeout in the Rust HTTP client).

It also sets `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` to
`true`, which expose the app's **Documents** folder in the system Files app.
On iOS `get_default_path` puts downloads under Documents (not Application
Support), so downloaded books/music/video show up under **Files → On My iPhone
→ Mediamaster** for the user to browse, copy out, or delete. If you commit
`src-tauri/gen/apple/`, keep both keys in the committed `Info.plist`.
