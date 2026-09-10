# Android Build (CI)

`.github/workflows/android-build.yml` builds a signed, aarch64-only `Reader.apk` on
`ubuntu-latest`. Like the iOS build, it is dispatched from GitLab (`workflow_dispatch`
with a required `build_id` input; run-name `Android build <build_id>`; artifact
`reader-android-apk` containing the single file `Reader.apk`).

`src-tauri/gen/android` is not committed — the workflow runs `npx tauri android init`
on the fly and then patches the generated project:

- **Signing:** injects a `signingConfigs.release` block into `app/build.gradle.kts`,
  fed by a runner-local `keystore.properties`.
- **Cleartext HTTP:** sets `android:usesCleartextTraffic="true"` in the
  AndroidManifest (Android twin of the iOS ATS `NSAllowsArbitraryLoads` exception) so
  the app can talk to LAN media servers over plain http.
- **Deep link:** adds a `mediamaster://` intent-filter to the main activity so the
  Audiobookshelf OIDC login returns from the browser into the app (same scheme the
  iOS build registers in Info.plist).

All patches are idempotent, so committing `gen/android` later is safe.

## Release signing: create the keystore ONCE

Signing with a persistent key is what lets a new APK install **over** the previous
one. Generate the keystore locally (keytool ships with any JDK, and with Android
Studio):

```
keytool -genkeypair -v -keystore reader-release.keystore -alias reader \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass YOUR_PASSWORD -keypass YOUR_PASSWORD \
  -dname "CN=Reader,O=Hammerl,C=DE"
```

Base64-encode it (this string becomes the secret):

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("reader-release.keystore")) | Set-Clipboard
```

```bash
# Linux/macOS
base64 -w0 reader-release.keystore
```

Then create **four GitHub secrets** (repo → Settings → Secrets and variables →
Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_B64` | the base64 string of `reader-release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | the `-storepass` you chose |
| `ANDROID_KEY_ALIAS` | `reader` (the `-alias` you chose) |
| `ANDROID_KEY_PASSWORD` | the `-keypass` (falls back to the store password if unset) |

Keep `reader-release.keystore` backed up somewhere safe: if it is lost, users must
uninstall/reinstall to get future updates (new key = Android rejects the upgrade).

## Debug-keystore fallback

If `ANDROID_KEYSTORE_B64` is not configured, the build still succeeds: it generates
an **ephemeral** debug keystore with keytool and prints a loud `::warning::` in the
log. The resulting APK installs fine, but every build has a *different* key — so the
next build's APK will NOT install over it (Android error "App not installed" /
signature mismatch). Uninstall first, or set up the secrets above.

## Sideloading the APK

- **adb:** enable USB debugging on the phone, then `adb install -r Reader.apk`
  (`-r` = replace/update the existing install).
- **Manual:** copy `Reader.apk` to the phone (USB, cloud, browser download), tap it,
  and allow "Install unknown apps" for the app you opened it with when prompted.

## Known follow-ups / Android readiness notes

Findings from the CI groundwork investigation (not CI blockers, but relevant for
running the app on Android):

1. **Credential persistence (keyring):** `secrets.rs` uses the `keyring` crate,
   which has **no Android backend** — it compiles against the in-memory mock store.
   Expected symptom: the stored LDAP/AD password does not survive an app restart on
   Android (iOS uses the real Keychain via `apple-native`). Follow-up: store secrets
   in the app-private data dir on Android or use a stronghold/keystore plugin.
2. **Self-signed HTTPS in the WebView:** the manifest patch only enables cleartext
   *http*. `<img>`/`<video>` tags loading directly from self-signed *https* servers
   will still fail Android WebView certificate validation (Rust-side requests are
   unaffected — reqwest's insecure client handles those). Same limitation as iOS.
3. **book-file:// URLs:** no JS changes needed. On Android, `convertFileSrc`
   produces `http://book-file.localhost/<path>` — the same shape as Windows, which
   `localUrlToFsPath`/`toLocalUrl` (src/utils/api.ts) and Rust's
   `decode_book_file_path` already handle, and the CSP already whitelists it.
4. **NDK pin:** the workflow pins `ndk;27.2.12479018` for reproducibility; bump the
   `NDK_VERSION` env in the workflow if Tauri raises its NDK requirement.
5. **Gradle patch anchors:** the signing patch anchors on `buildTypes {` /
   `getByName("release")` in the generated `build.gradle.kts`. If a future Tauri CLI
   changes the template, the step fails loudly and dumps the file — update the
   anchors in the workflow's patch script.

## Installing & updating with Obtainium

The pipeline builds **two** Android apps, installable side-by-side (like the iOS
stable/dev split):

| App | applicationId | Where the APK lives |
|---|---|---|
| Mediamaster (stable) | `com.hammerl.reader` | `Reader.apk` on each `v<x.y.z>` release |
| Mediamaster Dev | `com.hammerl.reader.dev` | `Reader-dev.apk` on the rolling `dev` release |

The dev APK is built by re-running `tauri android build` after patching the
Gradle `applicationId` to `.dev`, the launcher label to "Mediamaster Dev", and
`versionCode` to the **GitLab pipeline id** (monotonic — Android refuses to
install one dev build over another unless `versionCode` rises).

### Add the apps in Obtainium

Both apps live in the same repo, so each Obtainium entry needs filters to pick
the right release + APK. Use the **GitLab** source with the repo URL
`https://gitlab.gpz-hs.de/chhammerl/reader` (Obtainium must support self-hosted
GitLab hosts — recent versions do; set a GitLab host/token under Settings if
prompted). Add app twice:

**Stable (`com.hammerl.reader`)**
- URL: `https://gitlab.gpz-hs.de/chhammerl/reader`
- Filter Releases by Regex (tag): `^v\d+\.\d+\.\d+$`
- APK Filter Regex: `^Reader\.apk$`
- Version comes from the `v<x.y.z>` tag.

**Dev (`com.hammerl.reader.dev`)**
- URL: `https://gitlab.gpz-hs.de/chhammerl/reader`
- Filter Releases by Regex (tag): `^dev$`
- APK Filter Regex: `^Reader-dev\.apk$`
- Version: enable **"Use latest release date as version"** (the pipeline bumps
  the dev release's `released_at` every run), **or** set a Version Extraction
  Regex on the release name `Development Build 1.8.8-dev.235` →
  `(\d+\.\d+\.\d+-dev\.\d+)`, match group 1.

Obtainium then auto-checks and offers updates for each app independently. Option
names differ slightly between Obtainium versions — adjust to your UI.

> If your Obtainium build can't use a self-hosted GitLab host, use its **"HTML"**
> source pointed at the release page and configure the APK-link + version
> regexes there instead (same filters as above).

### Caveats

- Both apps register the `mediamaster://` URL scheme, so with both installed
  Android may route the Audiobookshelf OIDC callback to whichever it picks. Same
  trade-off as the iOS dev/stable split; fine unless you exercise ABS OIDC on
  both at once.
- The in-app "update available" notice on Android is informational only — it
  tells you a new version exists and to open Obtainium; the actual install is
  Obtainium's job. (Desktop still downloads + runs the installer in-app.)

## Installing & updating with Neo Store (F-Droid repository)

Obtainium works but has to *guess* the version from release names/dates, which
is unreliable for the rolling dev channel. The pipeline therefore also publishes
a **signed F-Droid repository** containing both apps, with explicit
`versionCode`/`versionName` metadata — so **Neo Store** (or any F-Droid client)
detects updates reliably, including dev builds (dev `versionCode` = pipeline id).

**One-time setup:** the repo index is signed with your **persistent Android
release keystore** (the `ANDROID_KEYSTORE_*` GitHub secrets). If those aren't
set, the F-Droid repo step is skipped (the ephemeral debug key changes every
build, so its fingerprint can't be pinned). No GitLab variables are needed — the
repo is generated on the GitHub android runner where the keystore already lives.

**Add the repo in Neo Store:**
1. The `publish-fdroid` job log (and the GitHub android build log) prints the
   repo URL and the signing **fingerprint**. The URL is:
   `https://gitlab.gpz-hs.de/api/v4/projects/<PROJECT_ID>/packages/generic/reader-fdroid/repo`
   (`<PROJECT_ID>` is your numeric project id.)
2. Neo Store → Settings/Repositories → add repository → paste the URL, then the
   **fingerprint** when prompted (this pins the repo's signing key).
3. Neo Store lists **Mediamaster** (`com.hammerl.reader`) and **Mediamaster Dev**
   (`com.hammerl.reader.dev`). Install either; both auto-update from the repo.

The repo holds the current build of each app (`archive_older: 0`). Stable's
`versionCode` only rises when `version` in `release.conf` bumps (a real
release), so stable users are offered an update only on a version bump; dev's
`versionCode` rises every pipeline.

> Both `com.hammerl.reader` and `com.hammerl.reader.dev` are signed with the
> **same** key (your release keystore), which is also the repo-signing key — one
> fingerprint to pin for everything.
