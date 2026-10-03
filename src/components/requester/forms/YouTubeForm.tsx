import React, { useState, useEffect } from 'react'
import { Send, Loader2, CheckCircle2, AlertCircle, Youtube, ListVideo, User } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { downloadYouTube, parseYouTubeUrl } from '../../../utils/requesterApi'
import type { YouTubeType } from '../../../types/requester'

const YOUTUBE_TYPES: { value: YouTubeType; label: string; icon: React.ReactNode }[] = [
  { value: 'individual', label: 'Video', icon: <Youtube size={20} /> },
  { value: 'playlist', label: 'Playlist', icon: <ListVideo size={20} /> },
  { value: 'channel', label: 'Channel', icon: <User size={20} /> },
]

export function YouTubeForm() {
  const { serverUrl, token } = useRequester()

  const [url, setUrl] = useState('')
  const [yttyp, setYttyp] = useState<YouTubeType>('individual')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message?: string } | null>(null)
  const [urlValid, setUrlValid] = useState<boolean | null>(null)

  useEffect(() => {
    if (!url.trim()) { setUrlValid(null); return }
    const parsed = parseYouTubeUrl(url.trim())
    setUrlValid(parsed.isValid)
    if (parsed.isValid && parsed.suggestedType) setYttyp(parsed.suggestedType)
  }, [url])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim() || !serverUrl || !token) return

    setIsSubmitting(true)
    setResult(null)

    const req = await downloadYouTube(serverUrl, token, url.trim(), yttyp)
    if (req) {
      setResult({ success: true })
      setTimeout(() => { setUrl(''); setYttyp('individual'); setResult(null) }, 2000)
    } else {
      setResult({ success: false, message: 'Request failed. Please try again.' })
    }
    setIsSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <label className="text-sm font-medium text-white/80">YouTube URL</label>
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=... or /playlist?list=... or /@channel"
          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-transparent transition-all"
          disabled={isSubmitting}
          autoFocus
        />
        {urlValid === false && <p className="text-xs text-red-400">Please enter a valid YouTube URL</p>}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-white/80">
          Content Type
          {urlValid && url && <span className="text-theme-400 ml-2 text-xs">(Auto-detected)</span>}
        </label>
        <div className="grid grid-cols-3 phone:grid-cols-1 gap-3">
          {YOUTUBE_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setYttyp(t.value)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                yttyp === t.value
                  ? 'border-red-500/50 bg-red-500/10 text-red-400'
                  : 'border-white/10 bg-white/5 hover:bg-white/10 text-white/60'
              }`}
            >
              {t.icon}
              <span className="text-sm font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {result && (
        <div className={`flex items-center gap-3 p-4 rounded-xl ${
          result.success
            ? 'bg-theme-500/10 border border-theme-500/20 text-theme-400'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          {result.success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span className="text-sm">{result.success ? 'YouTube request submitted!' : result.message}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || !url.trim() || urlValid === false}
        className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
      >
        {isSubmitting ? (
          <><Loader2 size={20} className="animate-spin" /> Submitting...</>
        ) : (
          <><Send size={20} /> Request {YOUTUBE_TYPES.find(t => t.value === yttyp)?.label}</>
        )}
      </button>
    </form>
  )
}
