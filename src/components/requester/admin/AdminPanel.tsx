import React from 'react'
import { Shield } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { ScheduleManager } from './ScheduleManager'
import { ApprovalQueue } from './ApprovalQueue'
import { ServerHealth } from './ServerHealth'
import { MangaMonitors } from './MangaMonitors'
import { CaptchaInbox } from './CaptchaInbox'
import { SectionErrorBoundary } from '../../SectionErrorBoundary'

/** Admin section: approvals, the weekly schedule and the server's health. */
export function AdminPanel() {
  const { isAdmin } = useRequester()
  if (!isAdmin) return null

  return (
    <div className="max-w-4xl mx-auto px-8 phone:px-4 py-6 space-y-6">
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-6 phone:p-4">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <Shield size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-400">Admin</h3>
            <p className="text-xs text-white/40">Approve requests, the download schedule and manga monitors</p>
          </div>
        </div>
        {/* Each block on its own: one that can't render (e.g. a changed
            server response) must not take the others down */}
        <SectionErrorBoundary label="the CAPTCHA inbox"><CaptchaInbox /></SectionErrorBoundary>
        <SectionErrorBoundary label="the approval queue"><ApprovalQueue /></SectionErrorBoundary>
        <SectionErrorBoundary label="the schedule"><ScheduleManager /></SectionErrorBoundary>
        <SectionErrorBoundary label="the manga monitors"><MangaMonitors /></SectionErrorBoundary>
      </div>
      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-6 phone:p-4">
        <SectionErrorBoundary label="the server health"><ServerHealth /></SectionErrorBoundary>
      </div>
    </div>
  )
}
