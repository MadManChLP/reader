import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'

type ToastVariant = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextType {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const variantConfig: Record<ToastVariant, { icon: React.ReactNode; border: string; bg: string }> = {
  success: {
    icon: <CheckCircle2 size={16} className="text-green-400" />,
    border: 'border-green-500/30',
    bg: 'bg-green-500/10',
  },
  error: {
    icon: <XCircle size={16} className="text-red-400" />,
    border: 'border-red-500/30',
    bg: 'bg-red-500/10',
  },
  info: {
    icon: <Info size={16} className="text-theme-400" />,
    border: 'border-theme-500/30',
    bg: 'bg-theme-500/10',
  },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const addToast = useCallback((message: string, variant: ToastVariant) => {
    const id = nextId.current++
    setToasts(prev => [...prev, { id, message, variant }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const ctx: ToastContextType = {
    success: useCallback((msg: string) => addToast(msg, 'success'), [addToast]),
    error: useCallback((msg: string) => addToast(msg, 'error'), [addToast]),
    info: useCallback((msg: string) => addToast(msg, 'info'), [addToast]),
  }

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => {
            const cfg = variantConfig[toast.variant]
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, x: 80, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 80, scale: 0.95 }}
                transition={{ duration: 0.25 }}
                className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-xl border backdrop-blur-md ${cfg.border} ${cfg.bg} bg-gray-900/80 shadow-lg max-w-sm`}
              >
                {cfg.icon}
                <span className="text-sm text-white/90 flex-1">{toast.message}</span>
                <button
                  onClick={() => dismiss(toast.id)}
                  className="p-0.5 hover:bg-white/10 rounded transition-colors"
                >
                  <X size={14} className="text-white/50" />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
