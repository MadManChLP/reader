import React from 'react'
import { Pen, Highlighter, Eraser, Type, MousePointer, Undo2, Redo2, X } from 'lucide-react'
import { useAnnotationStore } from './annotationStore'
import { ANNOTATION_COLORS } from './colorPalette'
import type { AnnotationTool } from './types'

const tools: { tool: AnnotationTool; icon: React.FC<{ size?: number }>; label: string }[] = [
  { tool: 'pen', icon: Pen, label: 'Pen' },
  { tool: 'highlighter', icon: Highlighter, label: 'Highlighter' },
  { tool: 'eraser', icon: Eraser, label: 'Eraser' },
  { tool: 'text', icon: Type, label: 'Text Note' },
  { tool: 'select', icon: MousePointer, label: 'Select' },
]

// Width ranges (normalized)
const PEN_MIN = 0.001
const PEN_MAX = 0.008
const HIGHLIGHTER_MIN = 0.010
const HIGHLIGHTER_MAX = 0.050
const SLIDER_STEPS = 100

function widthToSlider(tool: 'pen' | 'highlighter', width: number): number {
  const [min, max] = tool === 'pen' ? [PEN_MIN, PEN_MAX] : [HIGHLIGHTER_MIN, HIGHLIGHTER_MAX]
  return Math.round(((width - min) / (max - min)) * SLIDER_STEPS)
}

function sliderToWidth(tool: 'pen' | 'highlighter', value: number): number {
  const [min, max] = tool === 'pen' ? [PEN_MIN, PEN_MAX] : [HIGHLIGHTER_MIN, HIGHLIGHTER_MAX]
  return min + (value / SLIDER_STEPS) * (max - min)
}

// Preview circle diameter in px (4–24 range)
function previewSize(tool: 'pen' | 'highlighter', width: number): number {
  const [min, max] = tool === 'pen' ? [PEN_MIN, PEN_MAX] : [HIGHLIGHTER_MIN, HIGHLIGHTER_MAX]
  const t = (width - min) / (max - min)
  return 4 + t * 20
}

const AnnotationToolbar: React.FC = () => {
  const annotationMode = useAnnotationStore(s => s.annotationMode)
  const activeTool = useAnnotationStore(s => s.activeTool)
  const toolConfig = useAnnotationStore(s => s.toolConfig)
  const undoStack = useAnnotationStore(s => s.undoStack)
  const redoStack = useAnnotationStore(s => s.redoStack)
  const setActiveTool = useAnnotationStore(s => s.setActiveTool)
  const setToolColor = useAnnotationStore(s => s.setToolColor)
  const setToolWidth = useAnnotationStore(s => s.setToolWidth)
  const setAnnotationMode = useAnnotationStore(s => s.setAnnotationMode)
  const undo = useAnnotationStore(s => s.undo)
  const redo = useAnnotationStore(s => s.redo)

  if (!annotationMode) return null

  const showFlyout = activeTool === 'pen' || activeTool === 'highlighter' || activeTool === 'text'

  const activeColor = activeTool === 'pen'
    ? toolConfig.penColor
    : activeTool === 'highlighter'
      ? toolConfig.highlighterColor
      : toolConfig.textColor

  const colorTarget = activeTool === 'pen' ? 'pen' : activeTool === 'highlighter' ? 'highlighter' : 'text'

  const showThickness = activeTool === 'pen' || activeTool === 'highlighter'
  const widthTool = activeTool as 'pen' | 'highlighter'
  const activeWidth = activeTool === 'pen' ? toolConfig.penWidth : toolConfig.highlighterWidth

  return (
    <div className="absolute left-0 top-16 bottom-0 z-50 flex select-none">
      {/* Vertical sidebar */}
      <div className="flex flex-col items-center py-3 gap-1 w-12 bg-black/60 backdrop-blur-xl border-r border-white/10">
        {/* Tool buttons */}
        {tools.map(({ tool, icon: Icon, label }) => (
          <button
            key={tool}
            onClick={() => setActiveTool(tool)}
            className={`p-2 rounded-xl transition-colors ${
              activeTool === tool ? 'bg-theme-600 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
            title={label}
          >
            <Icon size={18} />
          </button>
        ))}

        {/* Divider */}
        <div className="h-px w-6 bg-white/10 my-1" />

        {/* Undo / Redo */}
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          className="p-2 rounded-xl transition-colors text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={18} />
        </button>
        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className="p-2 rounded-xl transition-colors text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={18} />
        </button>

        {/* Divider + Close at bottom */}
        <div className="mt-auto" />
        <div className="h-px w-6 bg-white/10 my-1" />
        <button
          onClick={() => setAnnotationMode(false)}
          className="p-2 rounded-xl transition-colors text-white/70 hover:bg-red-600/50 hover:text-white"
          title="Exit Annotations"
        >
          <X size={18} />
        </button>
      </div>

      {/* Flyout panel (color + thickness) */}
      {showFlyout && (
        <div className="flex flex-col gap-3 p-3 bg-black/70 backdrop-blur-xl border-r border-white/10 w-[140px]">
          {/* Color swatches — 2x4 grid */}
          <div className="grid grid-cols-4 gap-1.5">
            {ANNOTATION_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setToolColor(colorTarget, c)}
                className={`w-6 h-6 rounded-full border-2 transition-transform mx-auto ${
                  activeColor === c ? 'border-white scale-125' : 'border-transparent hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>

          {/* Thickness slider (only for pen/highlighter) */}
          {showThickness && (
            <div className="flex flex-col items-center gap-2">
              <div className="h-px w-full bg-white/10" />

              {/* Preview circle */}
              <div className="flex items-center justify-center h-8">
                <div
                  className="rounded-full"
                  style={{
                    width: previewSize(widthTool, activeWidth),
                    height: previewSize(widthTool, activeWidth),
                    backgroundColor: activeColor,
                  }}
                />
              </div>

              {/* Horizontal range slider */}
              <input
                type="range"
                min={0}
                max={SLIDER_STEPS}
                value={widthToSlider(widthTool, activeWidth)}
                onChange={e => setToolWidth(widthTool, sliderToWidth(widthTool, Number(e.target.value)))}
                className="w-full accent-theme-500 h-1.5 cursor-pointer"
                title="Thickness"
              />
              <span className="text-[10px] text-white/50">Thickness</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default React.memo(AnnotationToolbar)
