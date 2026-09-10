import React from 'react'
import { Shield } from 'lucide-react'
import { useRequester } from '../RequesterContext'
import { ScheduleManager } from './ScheduleManager'

export function AdminPanel() {
  const { isAdmin } = useRequester()
  if (!isAdmin) return null

  return (
    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
          <Shield size={18} className="text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-amber-400">Admin Panel</h3>
          <p className="text-xs text-white/40">Manage the automatic download schedule</p>
        </div>
      </div>
      <ScheduleManager />
    </div>
  )
}
