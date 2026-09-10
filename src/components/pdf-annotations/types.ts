export type AnnotationTool = 'pen' | 'highlighter' | 'eraser' | 'text' | 'select'

export interface NormalizedPoint {
  x: number    // 0-1 fraction of page width
  y: number    // 0-1 fraction of page height
  pressure: number  // 0-1
}

export interface AnnotationStroke {
  id: string
  tool: 'pen' | 'highlighter'
  color: string              // hex
  baseWidth: number          // normalized (e.g. 0.003 pen, 0.025 highlighter)
  points: NormalizedPoint[]
  timestamp: number
}

export interface AnnotationTextNote {
  id: string
  x: number    // 0-1
  y: number    // 0-1
  text: string
  color: string
  timestamp: number
}

export interface PageAnnotations {
  strokes: AnnotationStroke[]
  textNotes: AnnotationTextNote[]
}

export interface BookAnnotations {
  version: 1
  bookId: string
  pages: Record<number, PageAnnotations>
  lastModified: number
}

export type AnnotationAction =
  | { type: 'addStroke'; pageNumber: number; stroke: AnnotationStroke }
  | { type: 'removeStroke'; pageNumber: number; stroke: AnnotationStroke }
  | { type: 'addTextNote'; pageNumber: number; note: AnnotationTextNote }
  | { type: 'removeTextNote'; pageNumber: number; note: AnnotationTextNote }
  | { type: 'editTextNote'; pageNumber: number; oldNote: AnnotationTextNote; newNote: AnnotationTextNote }
