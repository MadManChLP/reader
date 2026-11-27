import React, { useState, useEffect, useRef } from 'react'
import { Server, User, Eye, EyeOff, ArrowRight, Loader2, AlertCircle, Key } from 'lucide-react'
import { useJellyfin } from './JellyfinContext'
import { loadSettings } from '../../types/settings'

interface JellyfinSetupProps {
  onComplete: () => void
}

type Step = 'server' | 'login'

export function JellyfinSetup({ onComplete }: JellyfinSetupProps) {
  const { connectToServer, login, loginWithSharedCredentials, isLoading, error, isConnected, serverName, sharedCredentials } = useJellyfin()

  const [step, setStep] = useState<Step>(isConnected ? 'login' : 'server')
  const [serverUrl, setServerUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [useSharedCreds, setUseSharedCreds] = useState(!!sharedCredentials)

  // Auto sign-in with shared LDAP/AD credentials: assume they are correct and
  // only show the login form when the automatic attempt fails (or is cancelled).
  const [autoLoginFailed, setAutoLoginFailed] = useState(false)
  const autoLoginAttemptedRef = useRef(false)
  const manualOverrideRef = useRef(false)

  useEffect(() => {
    if (step !== 'login' || !sharedCredentials) return
    if (autoLoginAttemptedRef.current) return
    autoLoginAttemptedRef.current = true

    ;(async () => {
      const success = await loginWithSharedCredentials()
      if (success) {
        // Skip completion if the user switched to manual sign-in meanwhile
        if (!manualOverrideRef.current) onComplete()
      } else {
        setUseSharedCreds(false)
        setLocalError('Automatic sign-in with shared credentials failed. Please sign in manually.')
        setAutoLoginFailed(true)
      }
    })()
  }, [step, sharedCredentials, loginWithSharedCredentials, onComplete])

  const cancelAutoLogin = () => {
    manualOverrideRef.current = true
    setUseSharedCreds(false)
    setAutoLoginFailed(true)
  }

  const isAutoLoggingIn = step === 'login' && !!sharedCredentials && !autoLoginFailed

  // Pre-fill server URL from settings if available
  useEffect(() => {
    const settings = loadSettings()
    const activeServer = settings.jellyfinServers.find(s => s.id === settings.activeJellyfinServerId)
    if (activeServer && !serverUrl) {
      setServerUrl(activeServer.url)
    }
    // Pre-fill credentials from shared settings
    if (sharedCredentials) {
      setUsername(sharedCredentials.username)
      setPassword(sharedCredentials.password)
    }
  }, [sharedCredentials])

  const handleServerSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!serverUrl.trim()) {
      setLocalError('Please enter a server address')
      return
    }

    const success = await connectToServer(serverUrl)
    if (success) {
      // New server: allow a fresh automatic sign-in attempt
      autoLoginAttemptedRef.current = false
      manualOverrideRef.current = false
      setAutoLoginFailed(false)
      setStep('login')
    }
  }

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (useSharedCreds && sharedCredentials) {
      const success = await loginWithSharedCredentials()
      if (success) {
        onComplete()
      }
      return
    }

    if (!username.trim()) {
      setLocalError('Please enter your username')
      return
    }

    const success = await login(username, password)
    if (success) {
      onComplete()
    }
  }

  const displayError = localError || error

  return (
    <div className="min-h-full flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-theme-500 to-pink-500 mb-6 shadow-2xl shadow-theme-500/30">
            {step === 'server' ? (
              <Server size={40} className="text-white" />
            ) : (
              <User size={40} className="text-white" />
            )}
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-theme-400 to-pink-400 bg-clip-text text-transparent">
            {step === 'server' ? 'Connect to Server' : 'Sign In'}
          </h1>
          <p className="text-white/60 mt-2">
            {step === 'server'
              ? 'Enter your Jellyfin server address'
              : `Sign in to ${serverName || 'your server'}`}
          </p>
        </div>

        {/* Error Display */}
        {displayError && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <AlertCircle size={20} />
            <span className="text-sm">{displayError}</span>
          </div>
        )}

        {/* Server Form */}
        {step === 'server' && (
          <form onSubmit={handleServerSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Server Address</label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://jellyfin.example.com"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50 focus:border-transparent transition-all"
                disabled={isLoading}
                autoFocus
              />
              <p className="text-xs text-white/40">
                Example: https://demo.jellyfin.org/stable
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-theme-600 to-pink-500 hover:from-theme-500 hover:to-pink-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {isLoading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  Connect
                  <ArrowRight size={20} />
                </>
              )}
            </button>
          </form>
        )}

        {/* Automatic sign-in with shared credentials */}
        {isAutoLoggingIn && (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-4 p-8 bg-white/5 border border-white/10 rounded-xl">
              <Loader2 size={32} className="animate-spin text-theme-400" />
              <div className="text-center">
                <div className="font-medium text-white">Signing in automatically…</div>
                <div className="text-sm text-white/50 mt-1">LDAP/AD: {sharedCredentials?.username}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={cancelAutoLogin}
              className="w-full text-sm text-white/50 hover:text-white/80 transition-colors"
            >
              Use different credentials
            </button>
          </div>
        )}

        {/* Login Form */}
        {step === 'login' && !isAutoLoggingIn && (
          <form onSubmit={handleLoginSubmit} className="space-y-6">
            {/* Shared Credentials Option */}
            {sharedCredentials && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setUseSharedCreds(!useSharedCreds)}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all ${
                    useSharedCreds
                      ? 'border-theme-500/50 bg-theme-500/10'
                      : 'border-white/10 hover:border-white/20 bg-white/5'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    useSharedCreds ? 'bg-theme-500' : 'bg-white/10'
                  }`}>
                    <Key size={20} className="text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium text-white">Use Shared Credentials</div>
                    <div className="text-sm text-white/50">LDAP/AD: {sharedCredentials.username}</div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    useSharedCreds ? 'border-theme-500 bg-theme-500' : 'border-white/30'
                  }`}>
                    {useSharedCreds && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </button>
              </div>
            )}

            {/* Manual Credentials */}
            {(!sharedCredentials || !useSharedCreds) && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white/80">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50 focus:border-transparent transition-all"
                    disabled={isLoading}
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-white/80">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50 focus:border-transparent transition-all"
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60 transition-colors"
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-theme-600 to-pink-500 hover:from-theme-500 hover:to-pink-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {isLoading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight size={20} />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setStep('server')}
              className="w-full text-sm text-white/50 hover:text-white/80 transition-colors"
            >
              Connect to a different server
            </button>
          </form>
        )}

        {/* Progress indicator */}
        <div className="flex justify-center gap-2">
          <div className={`w-2 h-2 rounded-full transition-colors ${step === 'server' ? 'bg-theme-500' : 'bg-white/20'}`} />
          <div className={`w-2 h-2 rounded-full transition-colors ${step === 'login' ? 'bg-theme-500' : 'bg-white/20'}`} />
        </div>
      </div>
    </div>
  )
}
