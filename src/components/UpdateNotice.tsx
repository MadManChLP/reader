// Bottom-corner card shown when an update is available. Behaviour depends on
// how the update is delivered on this platform (see src/utils/updater.ts):
//   - desktop (desktop-installer): Download & Install -> downloads the
//     installer, launches it, and quits the app so it can replace files.
//   - mobile (mobile-store): informational only — tells the user a new version
//     is out, shows the release notes, and points them at their app store
//     (Obtainium on Android, SideStore on iOS) which performs the install.
import { useEffect, useState } from 'react'
import { Download, X, ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import { useUpdaterStore } from '../stores/updaterStore'
import { useSettingsStore } from '../stores/settingsStore'
import api from '../utils/api'

export function UpdateNotice() {
  const info = useUpdaterStore((s) => s.info)
  const dismiss = useUpdaterStore((s) => s.dismiss)
  const autoCheckUpdates = useSettingsStore((s) => s.autoCheckUpdates)
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'error'>('idle')
  const [error, setError] = useState('')
  const [selectedFmt, setSelectedFmt] = useState<string | null>(null)

  // Auto-check at startup (and whenever connectivity returns). Mounted once at
  // the app root, so this effectively runs on launch. The store guards against
  // running while offline and against resurfacing a dismissed build.
  useEffect(() => {
    if (!autoCheckUpdates) return
    const run = () => { useUpdaterStore.getState().check().catch(() => {}) }
    run()
    window.addEventListener('online', run)
    return () => window.removeEventListener('online', run)
  }, [autoCheckUpdates])

  if (!info) return null

  const openUrl = (url?: string) => { if (url) api.openExternal(url).catch(() => {}) }

  const installFromUrl = async (url: string) => {
    setPhase('downloading')
    setError('')
    try {
      const ext = url.split('.').pop() || 'bin'
      const res = await api.downloadToTemp({ url, extension: ext })
      if (!res.success || !res.path) throw new Error(res.error || 'Download failed')
      await api.runInstaller(res.path)
      // Let the installer process spawn, then quit so it can replace files.
      setTimeout(() => api.close(), 900)
    } catch (e: any) {
      setPhase('error')
      setError(e?.message || 'Update failed')
    }
  }

  // Linux portable .tar.gz: download it, then have the backend extract, swap the
  // running binary in place and relaunch. On success the app quits so the newly
  // spawned binary takes over.
  const selfUpdateFromUrl = async (url: string) => {
    setPhase('downloading')
    setError('')
    try {
      const res = await api.downloadToTemp({ url, extension: 'tar.gz' })
      if (!res.success || !res.path) throw new Error(res.error || 'Download failed')
      await api.applyLinuxUpdate(res.path)
      // Backend has relaunched the new binary — quit this one to complete the swap.
      setTimeout(() => api.close(), 900)
    } catch (e: any) {
      setPhase('error')
      setError(e?.message || 'Update failed')
    }
  }

  // Arch .pkg.tar.zst: download it, then install via `pkexec pacman -U` (a
  // polkit root prompt appears). On success the backend relaunches and we quit.
  const pacmanUpdateFromUrl = async (url: string) => {
    setPhase('downloading')
    setError('')
    try {
      const res = await api.downloadToTemp({ url, extension: 'pkg.tar.zst' })
      if (!res.success || !res.path) throw new Error(res.error || 'Download failed')
      await api.applyPacmanUpdate(res.path)
      setTimeout(() => api.close(), 900)
    } catch (e: any) {
      setPhase('error')
      setError(e?.message || 'Update failed')
    }
  }

  const isBusy = phase === 'downloading'
  const isMobile = info.method === 'mobile-store'
  const store = info.storeName || 'your app store'

  // Linux offers multiple install formats; pick one (deb/rpm install in-app,
  // AppImage/tar.gz download in the browser). Other desktops have a single one.
  const linuxFormats = info.linuxFormats && info.linuxFormats.length ? info.linuxFormats : null
  const curFmt = linuxFormats
    ? (linuxFormats.find((f) => f.key === selectedFmt) ?? linuxFormats[0])
    : null

  const onDesktopPrimary = () => {
    if (curFmt) {
      if (curFmt.mode === 'install') installFromUrl(curFmt.url)
      else if (curFmt.mode === 'selfupdate') selfUpdateFromUrl(curFmt.url) // tar.gz -> in-place swap
      else if (curFmt.mode === 'pacman') pacmanUpdateFromUrl(curFmt.url) // .pkg.tar.zst -> pkexec pacman -U
      else openUrl(curFmt.url) // AppImage -> download in browser
    } else if (info.downloadUrl) {
      installFromUrl(info.downloadUrl) // Windows / macOS
    }
  }
  const primaryDisabled = isBusy || (!curFmt && !info.downloadUrl)

  return (
    <div className="fixed bottom-4 right-4 z-[80] w-[min(92vw,360px)] rounded-2xl border border-white/10 bg-zinc-900/95 backdrop-blur shadow-2xl text-white overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-theme-600 flex items-center justify-center shrink-0">
            <Sparkles size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">Update available</div>
            <div className="text-xs text-white/60 mt-0.5">
              <span className="text-theme-300 font-medium">{info.displayVersion}</span>
              {info.currentVersion && (
                <span className="text-white/40"> · you have {info.currentVersion}</span>
              )}
            </div>
          </div>
          <button
            onClick={dismiss}
            disabled={isBusy}
            className="text-white/40 hover:text-white/80 transition-colors disabled:opacity-30"
            aria-label="Dismiss"
          >
            <X size={18} />
          </button>
        </div>

        {/* Release notes (both mobile and desktop, when present). */}
        {info.notes && info.notes.trim() && (
          <div className="mt-3 text-xs text-white/70 whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar border-l-2 border-white/10 pl-3">
            {info.notes.trim()}
          </div>
        )}

        {isMobile && (
          <p className="text-xs text-white/60 mt-3">
            Open <span className="text-white/80 font-medium">{store}</span> and update Mediamaster to install this version.
          </p>
        )}

        {/* Linux install-format chooser (deb/rpm/AppImage/tar.gz). */}
        {!isMobile && linuxFormats && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {linuxFormats.map((f) => (
              <button
                key={f.key}
                onClick={() => setSelectedFmt(f.key)}
                disabled={isBusy}
                className={`px-2.5 py-1 rounded-md text-xs border transition-colors disabled:opacity-40 ${
                  curFmt?.key === f.key
                    ? 'bg-theme-600 border-theme-600 text-white'
                    : 'border-white/15 text-white/60 hover:bg-white/5'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {phase === 'error' && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="flex items-center gap-2 mt-4">
          {isMobile ? (
            // Informational only — the store installs. Primary action opens the
            // release page (notes / manual download if the user wants it).
            <button
              onClick={() => openUrl(info.releaseUrl)}
              disabled={!info.releaseUrl}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-theme-600 hover:bg-theme-500 disabled:opacity-40 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            >
              <ExternalLink size={16} /> View release
            </button>
          ) : (
            <>
              <button
                onClick={onDesktopPrimary}
                disabled={primaryDisabled}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-theme-600 hover:bg-theme-500 disabled:opacity-60 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                {isBusy ? (
                  <><RefreshCw size={16} className="animate-spin" /> Downloading…</>
                ) : phase === 'error' ? (
                  <><RefreshCw size={16} /> Retry</>
                ) : curFmt && curFmt.mode === 'download' ? (
                  <><Download size={16} /> Download {curFmt.label}</>
                ) : (
                  <><Download size={16} /> Download &amp; Install</>
                )}
              </button>
              {info.releaseUrl && (
                <button
                  onClick={() => openUrl(info.releaseUrl)}
                  disabled={isBusy}
                  className="inline-flex items-center justify-center gap-1.5 border border-white/15 hover:bg-white/5 disabled:opacity-40 rounded-lg px-3 py-2 text-sm transition-colors"
                  title="View release"
                >
                  <ExternalLink size={16} />
                  <span className="hidden sm:inline">Notes</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
