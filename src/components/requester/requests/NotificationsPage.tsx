import React, { useEffect, useState } from 'react'
import { Loader2, Bell, Send, Save, AlertCircle, MonitorSmartphone } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { PageHeader } from '../discover/PageHeader'
import { useToast } from '../../Toast'
import { getNotificationSettings, saveNotificationSettings, testNotifications } from '../../../utils/requesterDiscoverApi'
import { requesterErrorMessage } from '../../../utils/requesterApi'
import { getOsNotifyEnabled, setOsNotifyEnabled } from '../../../stores/requesterLiveStore'
import { requestNotificationPermission, systemNotify } from '../../../utils/systemNotify'
import type { AdminNotifyEvent, NotificationSettings, NotifyEvent } from '../../../types/requesterDiscover'

const EVENTS: { id: NotifyEvent; label: string }[] = [
  { id: 'complete', label: 'Download finished' },
  { id: 'failed', label: 'Download failed (also partly)' },
  { id: 'rejected', label: 'Request rejected' },
]
const ADMIN_EVENTS: { id: AdminNotifyEvent; label: string }[] = [
  { id: 'pending', label: 'A request waits for approval' },
  { id: 'error', label: 'Any download failed (with the reason)' },
  { id: 'monitor', label: 'A watched manga has new volumes' },
]

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      className={`w-10 h-5 rounded-full relative flex-shrink-0 transition-colors disabled:opacity-40 ${on ? 'bg-theme-500' : 'bg-white/20'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

/** In-app/OS alerts (this device) + the server's own channels (Discord, webhook). */
export function NotificationsPage() {
  const { serverUrl, token, isAdmin } = useRequester()
  const toast = useToast()
  const [osOn, setOsOn] = useState(getOsNotifyEnabled)
  const [s, setS] = useState<NotificationSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [discordId, setDiscordId] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!serverUrl || !token) return
    getNotificationSettings(serverUrl, token)
      .then(v => { setS(v); setDiscordId(v.discord_id ?? '') })
      .catch(e => setError(requesterErrorMessage(e, 'Could not load the notification settings')))
  }, [serverUrl, token])

  const toggleOs = async (on: boolean) => {
    if (on) {
      const p = await requestNotificationPermission()
      if (p !== 'granted') { toast.error('Notifications are blocked for this app in the system settings'); return }
      void systemNotify('Notifications on', 'You will be told when your requests change.')
    }
    setOsNotifyEnabled(on)
    setOsOn(on)
  }

  const toggleEvent = <T extends string>(list: T[], id: T) => list.includes(id) ? list.filter(x => x !== id) : [...list, id]

  const save = async () => {
    if (!serverUrl || !token || !s) return
    setSaving(true)
    try {
      const body = {
        discord: s.discord,
        webhook_url: s.webhook_url?.trim() || null,
        events: s.events,
        admin_events: s.admin_events,
        ...(s.discord_id_locked ? {} : { discord_id: discordId.trim() }),
      }
      const saved = await saveNotificationSettings(serverUrl, token, body)
      if (saved && typeof saved === 'object' && 'events' in saved) setS(saved)
      toast.success('Saved')
    } catch (e) {
      toast.error(requesterErrorMessage(e, 'Could not save'))
    }
    setSaving(false)
  }

  const test = async () => {
    if (!serverUrl || !token) return
    setTesting(true)
    try {
      const { results } = await testNotifications(serverUrl, token)
      const text = Object.entries(results).map(([ch, r]) => `${ch}: ${r}`).join(' · ') || 'No channel is on'
      toast.info(text)
    } catch (e) {
      toast.error(requesterErrorMessage(e, 'Test failed'))
    }
    setTesting(false)
  }

  const card = 'bg-white/5 border border-white/10 rounded-xl p-5 phone:p-4 space-y-4'
  const input = 'w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-theme-500/50 disabled:opacity-50'

  return (
    <div className="pb-12 max-w-2xl">
      <PageHeader title="Notifications" />
      <div className="px-8 phone:px-4 space-y-6">
        <div className={card}>
          <h2 className="font-semibold flex items-center gap-2"><MonitorSmartphone size={16} className="text-theme-400" /> This device</h2>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm text-white/80">System notifications</p>
              <p className="text-xs text-white/40">When one of your requests finishes, fails or gets approved while the app is in the background. In the app you always get a toast and a badge on the Requester tab.</p>
            </div>
            <Toggle on={osOn} onChange={toggleOs} />
          </div>
        </div>

        <div className={card}>
          <h2 className="font-semibold flex items-center gap-2"><Bell size={16} className="text-theme-400" /> From the server</h2>
          <p className="text-xs text-white/40">The server can also message you while this app is closed.</p>
          {error ? (
            <p className="text-sm text-red-300/80 flex items-center gap-2"><AlertCircle size={14} /> {error}</p>
          ) : !s ? (
            <Loader2 size={20} className="animate-spin text-white/40" />
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm text-white/80">Discord direct message</p>
                  {!s.available.discord && <p className="text-xs text-white/40">Not offered by this server</p>}
                </div>
                <Toggle on={s.discord} disabled={!s.available.discord} onChange={v => setS({ ...s, discord: v })} />
              </div>
              {s.discord && (
                <div className="space-y-1">
                  <label className="text-xs text-white/50">Discord user ID</label>
                  <input value={discordId} onChange={e => setDiscordId(e.target.value)} disabled={s.discord_id_locked}
                    placeholder="123456789012345678" className={input} inputMode="numeric" />
                  {s.discord_id_locked && <p className="text-xs text-white/30">Comes from your directory account</p>}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs text-white/50">Webhook URL {s.available.webhook ? '(Discord, Slack, Gotify, …)' : '— not offered by this server'}</label>
                <input value={s.webhook_url ?? ''} onChange={e => setS({ ...s, webhook_url: e.target.value })} disabled={!s.available.webhook}
                  placeholder="https://…" className={input} />
              </div>

              <div className="space-y-2">
                <p className="text-xs text-white/50">About your requests</p>
                {EVENTS.map(ev => (
                  <label key={ev.id} className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                    <input type="checkbox" checked={s.events.includes(ev.id)} onChange={() => setS({ ...s, events: toggleEvent(s.events, ev.id) })}
                      className="accent-[rgb(var(--theme-500))]" />
                    {ev.label}
                  </label>
                ))}
              </div>

              {isAdmin && (
                <div className="space-y-2">
                  <p className="text-xs text-amber-300/70">Admin</p>
                  {ADMIN_EVENTS.map(ev => (
                    <label key={ev.id} className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                      <input type="checkbox" checked={s.admin_events.includes(ev.id)} onChange={() => setS({ ...s, admin_events: toggleEvent(s.admin_events, ev.id) })}
                        className="accent-[rgb(var(--theme-500))]" />
                      {ev.label}
                    </label>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button type="button" onClick={save} disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-theme-600 hover:bg-theme-500 text-sm font-medium disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                </button>
                <button type="button" onClick={test} disabled={testing}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm disabled:opacity-50">
                  {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send test
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
