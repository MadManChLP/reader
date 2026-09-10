import React, { useRef, useEffect, useCallback } from 'react'
import { useAnnotationStore } from './annotationStore'
import type { NormalizedPoint, AnnotationStroke } from './types'

const ERASER_RADIUS = 0.015 // normalized distance

interface AnnotationCanvasProps {
  pageNumber: number
  width: number   // rendered pixel width of the page
  height: number  // rendered pixel height of the page
}

const AnnotationCanvas: React.FC<AnnotationCanvasProps> = ({ pageNumber, width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawingRef = useRef(false)
  const currentPointsRef = useRef<NormalizedPoint[]>([])
  const rafIdRef = useRef<number>(0)

  const annotationMode = useAnnotationStore(s => s.annotationMode)
  const activeTool = useAnnotationStore(s => s.activeTool)
  const toolConfig = useAnnotationStore(s => s.toolConfig)
  const addStroke = useAnnotationStore(s => s.addStroke)
  const removeStroke = useAnnotationStore(s => s.removeStroke)
  const setEditingNote = useAnnotationStore(s => s.setEditingNote)

  const pageAnnotations = useAnnotationStore(s => s.getPageAnnotations(pageNumber))

  const dpr = window.devicePixelRatio || 1

  // Render committed strokes + text note pins
  const renderCommitted = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

    const cw = width * dpr
    const ch = height * dpr

    // Draw strokes
    for (const stroke of pageAnnotations.strokes) {
      drawStroke(ctx, stroke, cw, ch)
    }

    // Draw text note pins
    for (const note of pageAnnotations.textNotes) {
      const px = note.x * cw
      const py = note.y * ch
      const pinSize = 10 * dpr

      ctx.save()
      ctx.fillStyle = note.color
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(px, py, pinSize, 0, Math.PI * 2)
      ctx.fill()

      // Inner dot
      ctx.fillStyle = '#000'
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.arc(px, py, pinSize * 0.35, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }, [pageAnnotations, width, height, dpr])

  // Redraw when annotations or dimensions change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    renderCommitted(ctx)
  }, [renderCommitted])

  // Set canvas dimensions
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (ctx) renderCommitted(ctx)
  }, [width, height, dpr, renderCommitted])

  const getActiveColor = useCallback(() => {
    if (activeTool === 'pen') return toolConfig.penColor
    if (activeTool === 'highlighter') return toolConfig.highlighterColor
    return toolConfig.penColor
  }, [activeTool, toolConfig])

  const getActiveWidth = useCallback(() => {
    if (activeTool === 'pen') return toolConfig.penWidth
    if (activeTool === 'highlighter') return toolConfig.highlighterWidth
    return toolConfig.penWidth
  }, [activeTool, toolConfig])

  const getNormalizedPos = useCallback((e: React.PointerEvent): NormalizedPoint => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      pressure: e.pressure > 0 ? e.pressure : 0.5,
    }
  }, [])

  // Eraser: check if any stroke passes near the pointer
  const eraseAt = useCallback((nx: number, ny: number) => {
    for (const stroke of pageAnnotations.strokes) {
      for (const pt of stroke.points) {
        const dx = pt.x - nx
        const dy = pt.y - ny
        if (Math.sqrt(dx * dx + dy * dy) < ERASER_RADIUS) {
          removeStroke(pageNumber, stroke.id)
          return
        }
      }
    }
  }, [pageAnnotations.strokes, removeStroke, pageNumber])

  // Live drawing preview
  const drawLiveStroke = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    renderCommitted(ctx)

    const pts = currentPointsRef.current
    if (pts.length < 2) return

    const cw = width * dpr
    const ch = height * dpr
    const baseWidth = getActiveWidth()
    const color = getActiveColor()
    const isHighlighter = activeTool === 'highlighter'

    ctx.save()
    ctx.strokeStyle = color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (isHighlighter) {
      ctx.globalAlpha = 0.35
      ctx.globalCompositeOperation = 'multiply'
    }

    ctx.beginPath()
    ctx.moveTo(pts[0].x * cw, pts[0].y * ch)

    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]
      const prev = pts[i - 1]
      const w = baseWidth * cw * p.pressure * 2
      ctx.lineWidth = Math.max(1, w)

      if (i < pts.length - 1) {
        const next = pts[i + 1]
        const cpx = p.x * cw
        const cpy = p.y * ch
        const epx = (p.x + next.x) / 2 * cw
        const epy = (p.y + next.y) / 2 * ch
        ctx.quadraticCurveTo(cpx, cpy, epx, epy)
      } else {
        ctx.lineTo(p.x * cw, p.y * ch)
      }
    }
    ctx.stroke()
    ctx.restore()
  }, [renderCommitted, width, height, dpr, getActiveWidth, getActiveColor, activeTool])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!annotationMode) return
    e.preventDefault()
    e.stopPropagation()

    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)

    const pt = getNormalizedPos(e)

    if (activeTool === 'text') {
      setEditingNote({ pageNumber, x: pt.x, y: pt.y })
      return
    }

    if (activeTool === 'select') return

    if (activeTool === 'eraser') {
      eraseAt(pt.x, pt.y)
      isDrawingRef.current = true
      return
    }

    // pen or highlighter
    isDrawingRef.current = true
    currentPointsRef.current = [pt]
  }, [annotationMode, activeTool, getNormalizedPos, setEditingNote, pageNumber, eraseAt])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDrawingRef.current || !annotationMode) return
    e.preventDefault()
    e.stopPropagation()

    const pt = getNormalizedPos(e)

    if (activeTool === 'eraser') {
      eraseAt(pt.x, pt.y)
      return
    }

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      currentPointsRef.current.push(pt)
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = requestAnimationFrame(drawLiveStroke)
    }
  }, [annotationMode, activeTool, getNormalizedPos, eraseAt, drawLiveStroke])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false

    const canvas = canvasRef.current
    if (canvas) canvas.releasePointerCapture(e.pointerId)

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      const pts = currentPointsRef.current
      if (pts.length >= 2) {
        const stroke: AnnotationStroke = {
          id: crypto.randomUUID(),
          tool: activeTool,
          color: getActiveColor(),
          baseWidth: getActiveWidth(),
          points: [...pts],
          timestamp: Date.now(),
        }
        addStroke(pageNumber, stroke)
      }
      currentPointsRef.current = []
    }

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = 0
    }
  }, [activeTool, getActiveColor, getActiveWidth, addStroke, pageNumber])

  // Handle clicking on existing text note pins
  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    if (!annotationMode) return
    if (activeTool !== 'select') return

    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height

    // Check if we clicked on a text note pin
    const pinRadius = 0.015
    for (const note of pageAnnotations.textNotes) {
      const dx = note.x - nx
      const dy = note.y - ny
      if (Math.sqrt(dx * dx + dy * dy) < pinRadius) {
        setEditingNote({ pageNumber, note, x: note.x, y: note.y })
        return
      }
    }
  }, [annotationMode, activeTool, pageAnnotations.textNotes, pageNumber, setEditingNote])

  const getCursor = () => {
    if (!annotationMode) return 'default'
    switch (activeTool) {
      case 'pen': return 'crosshair'
      case 'highlighter': return 'crosshair'
      case 'eraser': return 'cell'
      case 'text': return 'text'
      case 'select': return 'default'
      default: return 'crosshair'
    }
  }

  if (width <= 0 || height <= 0) return null

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 left-0"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: annotationMode ? 'auto' : 'none',
        cursor: getCursor(),
        touchAction: annotationMode ? 'none' : 'auto',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onCanvasClick}
    />
  )
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: AnnotationStroke,
  canvasWidth: number,
  canvasHeight: number,
) {
  const pts = stroke.points
  if (pts.length < 2) return

  ctx.save()
  ctx.strokeStyle = stroke.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.35
    ctx.globalCompositeOperation = 'multiply'
  }

  ctx.beginPath()
  ctx.moveTo(pts[0].x * canvasWidth, pts[0].y * canvasHeight)

  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]
    const w = stroke.baseWidth * canvasWidth * p.pressure * 2
    ctx.lineWidth = Math.max(1, w)

    if (i < pts.length - 1) {
      const next = pts[i + 1]
      const cpx = p.x * canvasWidth
      const cpy = p.y * canvasHeight
      const epx = (p.x + next.x) / 2 * canvasWidth
      const epy = (p.y + next.y) / 2 * canvasHeight
      ctx.quadraticCurveTo(cpx, cpy, epx, epy)
    } else {
      ctx.lineTo(p.x * canvasWidth, p.y * canvasHeight)
    }
  }

  ctx.stroke()
  ctx.restore()
}

export default React.memo(AnnotationCanvas)
