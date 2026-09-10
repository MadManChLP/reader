// Updates controls for the Advanced settings section: channel toggle (desktop
// only — mobile apps auto-detect their own channel), an auto-check-at-startup
// switch, and a manual "Check for updates" button.
import { RefreshCw, GitBranch } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { useUpdaterStore } from '../stores/updaterStore'
import { IS_DESKTOP } from '../utils/updater'
import { BUILD_INFO } from '../buildInfo'
import { useToast } from './Toast'

export function UpdateSettings() {
  const updateChannel = useSettingsStore((s) => s.updateChannel)
  const setUpdateChannel = useSettingsStore((s) => s.setUpdateChannel)
  const autoCheckUpdates = useSettingsStore((s) => s.autoCheckUpdates)
  const setAutoCheckUpdates = useSettingsStore((s) => s.setAutoCheckUpdates)
  const check = useUpdaterStore((s) => s.check)
  const checking = useUpdaterStore((s) => s.checking)
  const toast = useToast()

  const currentLabel = BUILD_INFO.buildId
    ? `${BUILD_INFO.version} (build ${BUILD_INFO.buildId})`
    : `${BUILD_INFO.version} (local build)`

  const onCheck = async () => {
    const res = await check({ manual: true })
    if (res === 'available') toast.info('Update available')
    else if (res === 'uptodate') toast.success("You're up to date")
    else if (res === 'error') toast.error("Couldn't check for updates")
    else toast.info('You appear to be offline')
  }

  return (
    <div className="pt-5 border-t border-white/10 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-white/80">
        <RefreshCw size={16} className="text-white/60" /> Updates
      </div>
      <p className="text-xs text-white/50 -mt-2">
        Current version: <span className="text-white/70">{currentLabel}</span>
      </p>

      {IS_DESKTOP && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-white/80 flex items-center gap-2">
            <GitBranch size={14} className="text-white/60" /> Update channel
          </label>
          <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
            {(['stable', 'dev'] as const).map((ch) => (
              <button
                key={ch}
                onClick={() => setUpdateChannel(ch)}
                className={`px-4 py-1.5 text-sm transition-colors ${
                  updateChannel === ch
                    ? 'bg-theme-600 text-white'
                    : 'bg-transparent text-white/60 hover:bg-white/5'
                }`}
              >
                {ch === 'dev' ? 'Dev' : 'Latest stable'}
              </button>
            ))}
          </div>
          <p className="text-xs text-white/50">
            {updateChannel === 'dev'
              ? 'Dev builds update on every pipeline — newest features, less stable.'
              : 'Only released, versioned builds.'}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-white/80">Check for updates at startup</span>
        <button
          onClick={() => setAutoCheckUpdates(!autoCheckUpdates)}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
            autoCheckUpdates ? 'bg-theme-600' : 'bg-white/15'
          }`}
          role="switch"
          aria-checked={autoCheckUpdates}
          aria-label="Check for updates at startup"
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              autoCheckUpdates ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </div>

      <button
        onClick={onCheck}
        disabled={checking}
        className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 disabled:opacity-50 rounded-lg px-4 py-2 text-sm transition-colors"
      >
        <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
        {checking ? 'Checking…' : 'Check for updates'}
      </button>
    </div>
  )
}
