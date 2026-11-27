import React from 'react'
import { RotateCcw } from 'lucide-react'

/**
 * Shown on a reader's error screen when a *downloaded* book fails to open
 * (truncated or corrupt file). Deletes the local copy and downloads it again.
 */
export function RedownloadButton({ onRedownload }: { onRedownload?: () => void }) {
  if (!onRedownload) return null
  return (
    <button
      type="button"
      onClick={onRedownload}
      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-theme-600 hover:bg-theme-500 text-white text-sm font-medium transition-colors"
    >
      <RotateCcw size={16} /> Re-download book
    </button>
  )
}
