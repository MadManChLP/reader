import React, { useState, useEffect, useRef } from 'react'
import { Send, ArrowRight, Loader2, AlertCircle, Server, User, Lock } from 'lucide-react'
import { useRequester } from './RequesterContext'
import { useSettingsStore } from '../../stores/settingsStore'

export function RequesterSetup() {
  const { serverUrl, setServerUrl, login, isLoggingIn, loginError } = useRequester()
  const credentials = useSettingsStore((state) => state.credentials)

  const [inputUrl, setInputUrl] = useState(serverUrl || '')
  // Pre-fill from shared settings credentials, but allow editing
  const [username, setUsername] = useState(credentials?.username || '')
  const [password, setPassword] = useState(credentials?.password || '')

  // Auto sign-in with shared LDAP/AD credentials when a server URL is already
  // configured — only show the form when the automatic attempt fails.
  const [autoLoginFailed, setAutoLoginFailed] = useState(false)
  const autoLoginAttemptedRef = useRef(false)
  const credsDirtyRef = useRef(false)

  // The shared password arrives asynchronously from the OS credential store —
  // keep the pre-filled fields in sync until the user edits them.
  useEffect(() => {
    if (credsDirtyRef.current) return
    setUsername(credentials?.username || '')
    setPassword(credentials?.password || '')
  }, [credentials])

  useEffect(() => {
    if (autoLoginAttemptedRef.current) return
    if (!serverUrl || !credentials?.username || !credentials?.password) return
    autoLoginAttemptedRef.current = true
    login(credentials.username, credentials.password, serverUrl).then((success) => {
      if (!success) setAutoLoginFailed(true)
    })
  }, [serverUrl, credentials, login])

  const isAutoLoggingIn = !!(
    serverUrl && credentials?.username && credentials?.password && !autoLoginFailed
  )

  const canSubmit = !!(inputUrl.trim() && username.trim() && password.trim())

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const url = inputUrl.trim()
    setServerUrl(url)
    // Pass the URL explicitly so login doesn't depend on Zustand state propagation timing
    await login(username.trim(), password.trim(), url)
  }

  return (
    <div className="min-h-full flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-theme-500 to-teal-500 mb-6 shadow-2xl shadow-theme-500/30">
            <Send size={36} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-theme-400 to-teal-400 bg-clip-text text-transparent">
            Media Requester
          </h1>
          <p className="text-white/60 mt-2">
            Connect to your mediamaster server
          </p>
        </div>

        {/* Error Display */}
        {loginError && !isAutoLoggingIn && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <AlertCircle size={20} className="flex-shrink-0" />
            <span className="text-sm">{loginError}</span>
          </div>
        )}

        {/* Automatic sign-in with shared credentials */}
        {isAutoLoggingIn && (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-4 p-8 bg-white/5 border border-white/10 rounded-xl">
              <Loader2 size={32} className="animate-spin text-theme-400" />
              <div className="text-center">
                <div className="font-medium text-white">Signing in automatically…</div>
                <div className="text-sm text-white/50 mt-1">LDAP/AD: {credentials?.username}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAutoLoginFailed(true)}
              className="w-full text-sm text-white/50 hover:text-white/80 transition-colors"
            >
              Use different credentials
            </button>
          </div>
        )}

        {/* Form */}
        {!isAutoLoggingIn && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80 flex items-center gap-2">
              <Server size={14} className="text-theme-400" />
              Server URL
            </label>
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="https://media.example.com"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50 focus:border-transparent transition-all"
              disabled={isLoggingIn}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80 flex items-center gap-2">
              <User size={14} className="text-theme-400" />
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => { credsDirtyRef.current = true; setUsername(e.target.value) }}
              placeholder="LDAP username"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50 focus:border-transparent transition-all"
              disabled={isLoggingIn}
              autoComplete="username"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80 flex items-center gap-2">
              <Lock size={14} className="text-theme-400" />
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => { credsDirtyRef.current = true; setPassword(e.target.value) }}
              placeholder="LDAP password"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-theme-500/50 focus:border-transparent transition-all"
              disabled={isLoggingIn}
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={isLoggingIn || !canSubmit}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-theme-600 to-teal-500 hover:from-theme-500 hover:to-teal-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            {isLoggingIn ? (
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
      </div>
    </div>
  )
}
