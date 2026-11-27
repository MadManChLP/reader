import React, { useState } from 'react'
import { Headphones, LogIn, AlertTriangle } from 'lucide-react'
import { useAudiobookshelf } from './AudiobookshelfContext'
import { useSettingsStore } from '../../stores/settingsStore'

// Connect/sign-in screen shown when no Audiobookshelf session exists.
// Login is SSO-only: the button opens the identity provider's login window
// (see absAuth.ts). Also doubles as the "session expired" re-login screen.

const AbsSetup: React.FC = () => {
  const { login, isLoading, error, sessionExpired } = useAudiobookshelf()
  const configUrl = useSettingsStore((state) => state.audiobookshelf.url)
  const updateAudiobookshelf = useSettingsStore((state) => state.updateAudiobookshelf)
  const [inputUrl, setInputUrl] = useState(configUrl || '')
  const [isSigningIn, setIsSigningIn] = useState(false)

  const handleSignIn = async () => {
    const url = inputUrl.trim()
    if (!url) return
    updateAudiobookshelf({ url })
    setIsSigningIn(true)
    try {
      await login(url)
    } finally {
      setIsSigningIn(false)
    }
  }

  const busy = isLoading || isSigningIn

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-theme-500 to-theme-700 flex items-center justify-center">
            <Headphones size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold">Audiobookshelf</h1>
          <p className="text-sm text-white/50">
            {sessionExpired
              ? 'Your session has expired — please sign in again.'
              : 'Connect to your audiobook & podcast server.'}
          </p>
        </div>

        <div className="bg-white/5 rounded-xl p-6 border border-white/10 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Server URL</label>
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
              placeholder="https://audiobooks.mydomain.com"
              disabled={busy}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-theme-500 focus:border-theme-500 disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}

          <button
            onClick={handleSignIn}
            disabled={busy || !inputUrl.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-theme-500 hover:bg-theme-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors"
          >
            {busy ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Waiting for sign-in...
              </>
            ) : (
              <>
                <LogIn size={16} />
                Sign in with SSO
              </>
            )}
          </button>

          <p className="text-xs text-white/40 text-center">
            A login window from your identity provider will open. You only need to do this once.
          </p>
        </div>
      </div>
    </div>
  )
}

export default AbsSetup
