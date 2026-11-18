import React, { useState, useRef, useEffect } from 'react'
import { useAnnotationStore } from './annotationStore'
import type { AnnotationTextNote } from './types'

const TextNoteEditor: React.FC = () => {
  const editingNote = useAnnotationStore(s => s.editingNote)
  const setEditingNote = useAnnotationStore(s => s.setEditingNote)
  const addTextNote = useAnnotationStore(s => s.addTextNote)
  const updateTextNote = useAnnotationStore(s => s.updateTextNote)
  const removeTextNote = useAnnotationStore(s => s.removeTextNote)
  const toolConfig = useAnnotationStore(s => s.toolConfig)

  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editingNote) {
      setText(editingNote.note?.text ?? '')
      // Focus after render
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [editingNote])

  if (!editingNote) return null

  const isExisting = !!editingNote.note

  const handleSave = () => {
    if (!text.trim()) return

    if (isExisting && editingNote.note) {
      updateTextNote(editingNote.pageNumber, editingNote.note.id, text.trim())
    } else {
      const note: AnnotationTextNote = {
        id: crypto.randomUUID(),
        x: editingNote.x,
        y: editingNote.y,
        text: text.trim(),
        color: toolConfig.textColor,
        timestamp: Date.now(),
      }
      addTextNote(editingNote.pageNumber, note)
    }
    setEditingNote(null)
  }

  const handleDelete = () => {
    if (isExisting && editingNote.note) {
      removeTextNote(editingNote.pageNumber, editingNote.note.id)
    }
    setEditingNote(null)
  }

  const handleCancel = () => {
    setEditingNote(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      handleCancel()
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.stopPropagation()
      handleSave()
    }
  }

  // Position: centered on screen (anchoring to the note position on-canvas
  // would require tracking canvas position, simpler to center)
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center" onClick={handleCancel}>
      <div
        className="w-80 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 space-y-3 text-white"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-sm font-bold">{isExisting ? 'Edit Note' : 'Add Note'}</div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your note..."
          rows={4}
          className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none focus:border-theme-500 resize-none"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={!text.trim()}
            className="flex-1 py-2 bg-theme-600 text-white rounded-lg text-sm font-medium hover:bg-theme-500 transition-colors disabled:opacity-40"
          >
            Save (Ctrl+Enter)
          </button>
          {isExisting && (
            <button
              onClick={handleDelete}
              className="py-2 px-3 bg-red-600/50 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
            >
              Delete
            </button>
          )}
          <button
            onClick={handleCancel}
            className="py-2 px-3 bg-white/10 text-white rounded-lg text-sm font-medium hover:bg-white/20 transition-colors"
          >
            Cancel
          </button>
        </div>
        <div className="text-[10px] text-white/40">Escape to cancel</div>
      </div>
    </div>
  )
}

export default React.memo(TextNoteEditor)
