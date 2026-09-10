# Contributing to Mediamaster

Thanks for your interest in improving **Mediamaster**! This document explains how to set
up a development environment, the conventions we follow, and how to get changes merged.

By participating in this project you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

---

## Table of Contents

- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Running & building](#running--building)
- [Coding conventions](#coding-conventions)
- [Documentation & translations](#documentation--translations)
- [Commit messages](#commit-messages)
- [Branches & merge requests](#branches--merge-requests)
- [Release workflow](#release-workflow)
- [Reporting bugs & requesting features](#reporting-bugs--requesting-features)

---

## Ways to contribute

- 🐛 **Report bugs** and 💡 **suggest features** via issues.
- 📝 **Improve docs** — the README, this file, or anything under `docs/`.
- 🌐 **Translations** — the user-facing docs are available in English and German
  (see [Documentation & translations](#documentation--translations)).
- 🔧 **Fix bugs / build features** and open a merge request (MR).
- 🌍 Help test builds on platforms you own (Windows/Linux/macOS/Android/iOS).

Small fixes (typos, docs, obvious bugs) can go straight to an MR. For larger changes,
please open an issue first so we can agree on the approach before you invest time.

---

## Development setup

**Prerequisites**

- [Node.js](https://nodejs.org/) 18+ and npm
- [Rust](https://rustup.rs/) (for Tauri) — on Windows use the **MSVC** toolchain:
  `rustup default stable-x86_64-pc-windows-msvc`
- Platform build tools:
  - **Windows:** Visual Studio Build Tools with "Desktop development with C++"
  - **Linux:** `webkit2gtk`, `libappindicator`, `librsvg`, `patchelf` (see the Tauri docs)
  - **macOS:** Xcode Command Line Tools
- A backend to talk to — a running
  [calibre-web_API](https://gitlab.gpz-hs.de/chhammerl/calibre-web_API) instance
  (the API server on port 8787), and optionally the
  [mediamaster-server](https://gitlab.gpz-hs.de/chhammerl/mediamaster-server) (Requester)
  and Jellyfin / Audiobookshelf servers.

**Install**

```bash
git clone https://gitlab.gpz-hs.de/chhammerl/reader.git
cd reader
npm install
```

---

## Project layout

See the [Project Structure](README.md#️-project-structure) section of the README for the
directory map. In short:

- `src/` — React + TypeScript frontend (the six apps, stores, utils)
- `src-tauri/` — Rust backend for desktop **and** mobile
- `electron/` — legacy Electron backend
- `docs/user/` — end-user docs, localized (`en/`, `de/`)
- `docs/development/` — contributor docs: build guides, API references, roadmap (English only)

The backend services live in their own repositories:
[calibre-web_API](https://gitlab.gpz-hs.de/chhammerl/calibre-web_API) (API server) and
[mediamaster-server](https://gitlab.gpz-hs.de/chhammerl/mediamaster-server) (Requester).

`CLAUDE.md` contains extended architecture notes worth skimming before larger changes.

---

## Running & building

```bash
# Development
npm run tauri:dev        # Tauri (recommended)
npm run dev              # Electron (legacy)

# Type-check only
npx tsc --noEmit

# Production builds
npm run tauri:build            # Tauri desktop
powershell ./build-tauri.ps1   # Windows helper (sets up MSVC toolchain)
npm run electron:build         # Electron desktop
```

Mobile and per-platform packaging are documented in
[`docs/development/ios-build.md`](docs/development/ios-build.md) and [`docs/development/android-build.md`](docs/development/android-build.md).
CI produces the official cross-platform artifacts automatically (see below).

**Before opening an MR**, make sure the project type-checks:

```bash
npx tsc --noEmit
```

---

## Coding conventions

- **TypeScript + React** — match the style of the surrounding code (naming, comment
  density, idioms). Prefer functional components and hooks.
- **State (Zustand):** always use `useShallow` for object selectors — bare object
  selectors cause infinite re-render loops. Don't call bare `useMusicPlayer()` etc.;
  select the slices you need.
- **Styling:** Tailwind CSS. Use the `theme-*` accent classes (CSS variables) for accent
  colors — **never hardcode** `purple`/`blue`/etc. for accents.
- **Cross-platform:** guard desktop-only APIs (window controls, folder pickers, OIDC
  login window) behind the platform helpers; keep the mobile (`cfg(mobile)`) paths intact.
- **Video player:** the decomposed `src/components/jellyfin/player/` follows the
  Two-Effect pattern and uses refs to avoid stale closures — read the notes in `CLAUDE.md`
  before changing it.
- **Cover images / auth headers:** store auth headers in a `useRef` (not as an effect
  dependency) to avoid blob-URL revocation races; use `releaseImage()` for cleanup.

When in doubt, look at how a neighboring component solves the same problem and follow it.

---

## Documentation & translations

Documentation is split by audience — and the user-facing half is localized:

| Path | Audience | Languages |
|------|----------|-----------|
| `README.md` / `README.de.md` | Everyone | English + German |
| `docs/user/en/`, `docs/user/de/` | End users | English + German |
| `.gitlab/issue_templates/` | Everyone | English + German (`… (DE).md`) |
| `docs/development/` | Contributors | **English only** |
| `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | Contributors | **English only** |
| `.gitlab/merge_request_templates/` | Contributors | **English only** |

Guidelines:

- **English is the source of truth.** Write or update the English version first, then
  mirror the change into the German one.
- **Keep the pair in sync.** If a merge request changes `README.md`, anything in
  `docs/user/en/`, or an issue template, update the German counterpart in the same MR. If
  you can't, say so in the MR description so it can be picked up as a follow-up.
- **Issue templates must keep matching labels.** The `/label` lines in a German template
  have to be identical to the English one, otherwise triage and filtering break.
- **Keep the structure identical** — same headings, same order, same anchors. Translated
  headings are fine, but don't add or drop sections in one language only.
- **Don't translate** code blocks, file names, CLI commands, URLs, fingerprints, or UI
  labels that the app itself shows in English.
- Each localized file starts with a language switcher line linking to its counterpart —
  keep it when adding new pages.
- Developer docs stay English-only; there's no need to translate `docs/development/`.

Issues and merge requests may be written in English or German.

---

## Commit messages

We use **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
<type>(<optional scope>): <short summary>
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `ci`.

Examples:

```
feat(livetv): add EPG grid keyboard navigation
fix(music): prevent queue desync on shuffle toggle
docs: add iOS SideStore install steps
```

Keep commits focused and the summary in the imperative mood. Reference issues where
relevant (e.g. `Closes #42`).

---

## Branches & merge requests

1. Create a branch off `master`: `git checkout -b feat/my-thing`.
2. Make your change; keep it scoped to one concern.
3. Run `npx tsc --noEmit` and manually test the affected app(s).
4. Push and open a **merge request** against `master`.

**MR checklist**

- [ ] The project type-checks (`npx tsc --noEmit`).
- [ ] I tested the change on at least one platform and described how.
- [ ] Accent colors use `theme-*` classes; no hardcoded accent colors.
- [ ] Object selectors use `useShallow`.
- [ ] Docs updated if behavior/config changed.
- [ ] Commits follow Conventional Commits.

Keep MRs reasonably small and reviewable. Draft MRs are welcome for early feedback.

---

## Release workflow

Versioning is driven by a **single source of truth**: [`release.conf`](release.conf).

- `version=X.Y.Z` is stamped into `package.json`, `package-lock.json`,
  `src-tauri/tauri.conf.json`, and `installer/reader-setup.iss` by CI.
- `full_release=false` → CI publishes only the rolling **dev** build (and the SideStore
  dev channel).
- `full_release=true` → CI builds every platform as `X.Y.Z`, publishes the tagged
  release `vX.Y.Z` (and SideStore stable channel), then commits the version bump back to
  `master` and resets `full_release=false` (marked `[skip ci]`).

To cut a full release: bump `version`, set `full_release=true`, commit & push. After the
pipeline is green, `git pull` to get the auto-committed bump. Release notes can be added
via `RELEASENOTES.md` + `release_notes=true` (one-shot; consumed by the pipeline).

The CI pipeline (`.gitlab-ci.yml`) builds all five platforms (dispatching macOS/iOS/
Android builds to GitHub Actions in `.github/workflows/`) and uploads artifacts to the
GitLab release assets and package registry.

**Do not** hand-edit versions in the four generated files — edit `release.conf` only.

---

## Reporting bugs & requesting features

Open an issue and include, where relevant:

- What you expected vs. what happened
- Steps to reproduce
- Platform + version (Help/Settings shows the build version)
- Which app/tab (Calibre, Jellyfin, JellyMusic, Requester, Live TV, Audiobooks)
- Logs / screenshots

Issue templates are provided under `.gitlab/issue_templates/` — pick the one that fits:

- **Bug** — something is broken or produces the wrong result
- **Feature** — a new capability or app that doesn't exist yet
- **Visual improvement** — it works but *looks* off (spacing, color, sizing, consistency)
- **Interaction / UX** — it works but *feels* off (awkward flow, too many steps, unclear, sluggish)

Each template also exists in German — the ones marked **(DE)** in the dropdown
(`Bug (DE)`, `Feature (DE)`, …). They apply the same labels as their English twins, so
filtering and triage work the same regardless of the language you report in.

Thanks for contributing! 🎉
