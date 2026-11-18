import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { useIsPhone } from '../hooks/useIsPhone'
import { BottomSheet } from './BottomSheet'
import { blockGlobalEsc, registerBackHandler } from '../utils/navigationBus'
import { hapticWarning } from '../utils/haptics'

// Promise-based confirm: a bottom sheet on phones, a small centred dialog on
// desktop — instead of window.confirm(), which is an unstyled native box
// (and a no-op in some mobile webviews).
//
//   const [confirm, confirmUi] = useConfirm()
//   if (!(await confirm({ title: 'Delete?', confirmLabel: 'Delete', destructive: true }))) return
//   ...
//   return <>{...}{confirmUi}</>

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => {
    if (opts.destructive) hapticWarning()
    setPending({ ...opts, resolve })
  }), [])

  const finish = useCallback((ok: boolean) => {
    setPending((p) => {
      p?.resolve(ok)
      return null
    })
  }, [])

  const ui = pending ? <ConfirmUi options={pending} onDone={finish} /> : null
  return [confirm, ui]
}

function ConfirmUi({ options, onDone }: { options: ConfirmOptions; onDone: (ok: boolean) => void }) {
  const isPhone = useIsPhone()
  const { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive } = options
  const decidedRef = useRef(false)
  const decide = (ok: boolean) => {
    if (decidedRef.current) return
    decidedRef.current = true
    onDone(ok)
  }

  const buttons = (
    <div className="flex gap-2 phone:flex-col-reverse">
      <button
        onClick={() => decide(false)}
        className="flex-1 py-2.5 phone:py-3 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors"
      >
        {cancelLabel}
      </button>
      <button
        onClick={() => decide(true)}
        autoFocus
        className={`flex-1 py-2.5 phone:py-3 rounded-lg text-white text-sm font-semibold transition-colors ${
          destructive ? 'bg-red-600 hover:bg-red-500' : 'bg-theme-600 hover:bg-theme-500'
        }`}
      >
        {confirmLabel}
      </button>
    </div>
  )

  if (isPhone) {
    return (
      <BottomSheet title={title} onClose={() => decide(false)} elevated>
        <div className="px-3 pb-3 space-y-4">
          {message && <p className="text-sm text-white/60">{message}</p>}
          {buttons}
        </div>
      </BottomSheet>
    )
  }
  return <DesktopConfirm title={title} message={message} destructive={destructive} buttons={buttons} onCancel={() => decide(false)} />
}

function DesktopConfirm({ title, message, destructive, buttons, onCancel }: {
  title: string; message?: string; destructive?: boolean; buttons: React.ReactNode; onCancel: () => void
}) {
  useEffect(() => {
    const unblock = blockGlobalEsc()
    const unregister = registerBackHandler(() => { onCancel(); return true })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }
    window.addEventListener('keydown', onKey, true)
    return () => { unblock(); unregister(); window.removeEventListener('keydown', onKey, true) }
  }, [onCancel])

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60" onClick={(e) => { e.stopPropagation(); onCancel() }} />
      <div
        role="alertdialog"
        aria-modal="true"
        className="relative w-full max-w-sm bg-gray-900 border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {destructive && <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />}
          <div className="space-y-1">
            <h3 className="font-semibold text-white">{title}</h3>
            {message && <p className="text-sm text-white/60">{message}</p>}
          </div>
        </div>
        {buttons}
      </div>
    </div>,
    document.body,
  )
}
