import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, X } from 'lucide-react'
import { BottomSheet } from '../BottomSheet'
import { blockGlobalEsc, registerBackHandler } from '../../utils/navigationBus'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '../../utils/readerAnnotations'

/** Edit a highlight: colour, note, delete. Sheet on phone, dialog on desktop. */
export function HighlightNoteEditor({
  isPhone,
  highlight,
  onSave,
  onDelete,
  onClose,
}: {
  isPhone: boolean
  highlight: Highlight
  onSave: (patch: { note: string; color: HighlightColor }) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [note, setNote] = useState(highlight.note ?? '')
  const [color, setColor] = useState<HighlightColor>(highlight.color)

  const save = () => {
    onSave({ note: note.trim(), color })
    onClose()
  }

  const body = (
    <div className="space-y-4 text-white">
      <blockquote
        className="text-sm text-white/80 border-l-4 pl-3 max-h-32 overflow-y-auto custom-scrollbar"
        style={{ borderColor: HIGHLIGHT_COLORS[color] }}
      >
        {highlight.text}
      </blockquote>
      <div className="flex items-center gap-2">
        {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-8 h-8 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
            style={{ background: HIGHLIGHT_COLORS[c] }}
            title={c}
            aria-label={`Colour ${c}`}
          />
        ))}
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Add a note…"
        rows={4}
        autoFocus={!isPhone}
        className="w-full bg-white/10 border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-theme-500 resize-none"
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save() }}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => { onDelete(); onClose() }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-red-300 hover:bg-red-500/15 transition-colors"
        >
          <Trash2 size={15} /> Delete
        </button>
        <div className="flex-1" />
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-white/10 hover:bg-white/15 transition-colors">Cancel</button>
        <button onClick={save} className="px-4 py-2 rounded-lg text-sm font-semibold bg-theme-600 hover:bg-theme-500 transition-colors">Save</button>
      </div>
    </div>
  )

  if (isPhone) {
    return (
      <BottomSheet title="Highlight" onClose={onClose} elevated>
        <div className="px-3 pb-3">{body}</div>
      </BottomSheet>
    )
  }
  return <Dialog onClose={onClose}>{body}</Dialog>
}

function Dialog({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const unblock = blockGlobalEsc()
    const unregister = registerBackHandler(() => { onClose(); return true })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => { unblock(); unregister(); window.removeEventListener('keydown', onKey, true) }
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-gray-900 border border-white/10 rounded-2xl shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/10 text-white/60" title="Close"><X size={16} /></button>
        <h3 className="font-semibold text-white mb-4">Highlight</h3>
        {children}
      </div>
    </div>,
    document.body,
  )
}
