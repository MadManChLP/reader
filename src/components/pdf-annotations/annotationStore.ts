import { create } from 'zustand'
import type {
  AnnotationTool,
  AnnotationStroke,
  AnnotationTextNote,
  BookAnnotations,
  PageAnnotations,
  AnnotationAction,
} from './types'
import { DEFAULT_PEN_COLOR, DEFAULT_HIGHLIGHTER_COLOR, DEFAULT_TEXT_COLOR } from './colorPalette'
import { loadAnnotations, saveAnnotationsDebounced, flushAnnotations } from './annotationStorage'

interface ToolConfig {
  penColor: string
  highlighterColor: string
  textColor: string
  penWidth: number          // normalized base width
  highlighterWidth: number  // normalized base width
}

interface AnnotationState {
  // Mode
  annotationMode: boolean
  activeTool: AnnotationTool
  toolConfig: ToolConfig

  // Data
  bookId: string | null
  annotations: BookAnnotations | null

  // Undo/redo
  undoStack: AnnotationAction[]
  redoStack: AnnotationAction[]

  // Text note editing
  editingNote: { pageNumber: number; note?: AnnotationTextNote; x: number; y: number } | null

  // Actions
  setAnnotationMode: (on: boolean) => void
  setActiveTool: (tool: AnnotationTool) => void
  setToolColor: (tool: 'pen' | 'highlighter' | 'text', color: string) => void
  setToolWidth: (tool: 'pen' | 'highlighter', width: number) => void
  initialize: (bookId: string) => Promise<void>
  cleanup: () => Promise<void>

  addStroke: (pageNumber: number, stroke: AnnotationStroke) => void
  removeStroke: (pageNumber: number, strokeId: string) => void
  addTextNote: (pageNumber: number, note: AnnotationTextNote) => void
  removeTextNote: (pageNumber: number, noteId: string) => void
  updateTextNote: (pageNumber: number, noteId: string, text: string) => void

  setEditingNote: (info: { pageNumber: number; note?: AnnotationTextNote; x: number; y: number } | null) => void

  undo: () => void
  redo: () => void

  getPageAnnotations: (pageNumber: number) => PageAnnotations
}

// Stable empty reference — never mutated, safe to share
const EMPTY_PAGE: PageAnnotations = { strokes: [], textNotes: [] }

function emptyPage(): PageAnnotations {
  return { strokes: [], textNotes: [] }
}

function ensurePage(annotations: BookAnnotations, pageNumber: number): PageAnnotations {
  if (!annotations.pages[pageNumber]) {
    annotations.pages[pageNumber] = emptyPage()
  }
  return annotations.pages[pageNumber]
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  annotationMode: false,
  activeTool: 'pen',
  toolConfig: {
    penColor: DEFAULT_PEN_COLOR,
    highlighterColor: DEFAULT_HIGHLIGHTER_COLOR,
    textColor: DEFAULT_TEXT_COLOR,
    penWidth: 0.003,
    highlighterWidth: 0.025,
  },
  bookId: null,
  annotations: null,
  undoStack: [],
  redoStack: [],
  editingNote: null,

  setAnnotationMode: (on) => set({ annotationMode: on, editingNote: null }),

  setActiveTool: (tool) => set({ activeTool: tool, editingNote: null }),

  setToolColor: (tool, color) => {
    const cfg = { ...get().toolConfig }
    if (tool === 'pen') cfg.penColor = color
    else if (tool === 'highlighter') cfg.highlighterColor = color
    else if (tool === 'text') cfg.textColor = color
    set({ toolConfig: cfg })
  },

  setToolWidth: (tool, width) => {
    const cfg = { ...get().toolConfig }
    if (tool === 'pen') cfg.penWidth = width
    else if (tool === 'highlighter') cfg.highlighterWidth = width
    set({ toolConfig: cfg })
  },

  initialize: async (bookId) => {
    const data = await loadAnnotations(bookId)
    set({ bookId, annotations: data, undoStack: [], redoStack: [], editingNote: null })
  },

  cleanup: async () => {
    await flushAnnotations()
    set({ bookId: null, annotations: null, undoStack: [], redoStack: [], annotationMode: false, editingNote: null })
  },

  addStroke: (pageNumber, stroke) => {
    const state = get()
    if (!state.annotations) return
    const ann = structuredClone(state.annotations)
    const page = ensurePage(ann, pageNumber)
    page.strokes.push(stroke)
    ann.lastModified = Date.now()
    const action: AnnotationAction = { type: 'addStroke', pageNumber, stroke }
    set({
      annotations: ann,
      undoStack: [...state.undoStack, action],
      redoStack: [],
    })
    saveAnnotationsDebounced(ann)
  },

  removeStroke: (pageNumber, strokeId) => {
    const state = get()
    if (!state.annotations) return
    const ann = structuredClone(state.annotations)
    const page = ann.pages[pageNumber]
    if (!page) return
    const idx = page.strokes.findIndex(s => s.id === strokeId)
    if (idx === -1) return
    const removed = page.strokes.splice(idx, 1)[0]
    ann.lastModified = Date.now()
    const action: AnnotationAction = { type: 'removeStroke', pageNumber, stroke: removed }
    set({
      annotations: ann,
      undoStack: [...state.undoStack, action],
      redoStack: [],
    })
    saveAnnotationsDebounced(ann)
  },

  addTextNote: (pageNumber, note) => {
    const state = get()
    if (!state.annotations) return
    const ann = structuredClone(state.annotations)
    const page = ensurePage(ann, pageNumber)
    page.textNotes.push(note)
    ann.lastModified = Date.now()
    const action: AnnotationAction = { type: 'addTextNote', pageNumber, note }
    set({
      annotations: ann,
      undoStack: [...state.undoStack, action],
      redoStack: [],
    })
    saveAnnotationsDebounced(ann)
  },

  removeTextNote: (pageNumber, noteId) => {
    const state = get()
    if (!state.annotations) return
    const ann = structuredClone(state.annotations)
    const page = ann.pages[pageNumber]
    if (!page) return
    const idx = page.textNotes.findIndex(n => n.id === noteId)
    if (idx === -1) return
    const removed = page.textNotes.splice(idx, 1)[0]
    ann.lastModified = Date.now()
    const action: AnnotationAction = { type: 'removeTextNote', pageNumber, note: removed }
    set({
      annotations: ann,
      undoStack: [...state.undoStack, action],
      redoStack: [],
    })
    saveAnnotationsDebounced(ann)
  },

  updateTextNote: (pageNumber, noteId, text) => {
    const state = get()
    if (!state.annotations) return
    const ann = structuredClone(state.annotations)
    const page = ann.pages[pageNumber]
    if (!page) return
    const idx = page.textNotes.findIndex(n => n.id === noteId)
    if (idx === -1) return
    const oldNote = { ...page.textNotes[idx] }
    const newNote = { ...oldNote, text, timestamp: Date.now() }
    page.textNotes[idx] = newNote
    ann.lastModified = Date.now()
    const action: AnnotationAction = { type: 'editTextNote', pageNumber, oldNote, newNote }
    set({
      annotations: ann,
      undoStack: [...state.undoStack, action],
      redoStack: [],
    })
    saveAnnotationsDebounced(ann)
  },

  setEditingNote: (info) => set({ editingNote: info }),

  undo: () => {
    const state = get()
    if (!state.annotations || state.undoStack.length === 0) return
    const ann = structuredClone(state.annotations)
    const action = state.undoStack[state.undoStack.length - 1]
    const newUndoStack = state.undoStack.slice(0, -1)

    // Apply inverse
    switch (action.type) {
      case 'addStroke': {
        const page = ann.pages[action.pageNumber]
        if (page) page.strokes = page.strokes.filter(s => s.id !== action.stroke.id)
        break
      }
      case 'removeStroke': {
        const page = ensurePage(ann, action.pageNumber)
        page.strokes.push(action.stroke)
        break
      }
      case 'addTextNote': {
        const page = ann.pages[action.pageNumber]
        if (page) page.textNotes = page.textNotes.filter(n => n.id !== action.note.id)
        break
      }
      case 'removeTextNote': {
        const page = ensurePage(ann, action.pageNumber)
        page.textNotes.push(action.note)
        break
      }
      case 'editTextNote': {
        const page = ann.pages[action.pageNumber]
        if (page) {
          const idx = page.textNotes.findIndex(n => n.id === action.newNote.id)
          if (idx !== -1) page.textNotes[idx] = action.oldNote
        }
        break
      }
    }

    ann.lastModified = Date.now()
    set({
      annotations: ann,
      undoStack: newUndoStack,
      redoStack: [...state.redoStack, action],
    })
    saveAnnotationsDebounced(ann)
  },

  redo: () => {
    const state = get()
    if (!state.annotations || state.redoStack.length === 0) return
    const ann = structuredClone(state.annotations)
    const action = state.redoStack[state.redoStack.length - 1]
    const newRedoStack = state.redoStack.slice(0, -1)

    // Re-apply action
    switch (action.type) {
      case 'addStroke': {
        const page = ensurePage(ann, action.pageNumber)
        page.strokes.push(action.stroke)
        break
      }
      case 'removeStroke': {
        const page = ann.pages[action.pageNumber]
        if (page) page.strokes = page.strokes.filter(s => s.id !== action.stroke.id)
        break
      }
      case 'addTextNote': {
        const page = ensurePage(ann, action.pageNumber)
        page.textNotes.push(action.note)
        break
      }
      case 'removeTextNote': {
        const page = ann.pages[action.pageNumber]
        if (page) page.textNotes = page.textNotes.filter(n => n.id !== action.note.id)
        break
      }
      case 'editTextNote': {
        const page = ann.pages[action.pageNumber]
        if (page) {
          const idx = page.textNotes.findIndex(n => n.id === action.oldNote.id)
          if (idx !== -1) page.textNotes[idx] = action.newNote
        }
        break
      }
    }

    ann.lastModified = Date.now()
    set({
      annotations: ann,
      undoStack: [...state.undoStack, action],
      redoStack: newRedoStack,
    })
    saveAnnotationsDebounced(ann)
  },

  getPageAnnotations: (pageNumber) => {
    const state = get()
    if (!state.annotations) return EMPTY_PAGE
    return state.annotations.pages[pageNumber] ?? EMPTY_PAGE
  },
}))
