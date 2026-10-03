import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Settings, BookOpen, ArrowRight, ArrowLeft, Maximize, Minimize, List, ZoomIn, ZoomOut, Columns, FileText, AlignJustify, Move, Bookmark, BookmarkPlus, Trash2, Pen, Headphones, RotateCcw } from 'lucide-react'
import { useAnnotationStore } from './pdf-annotations'
import { useMusicPlayer } from '../stores/musicPlayerStore'
import { useAudiobookPlayer } from '../stores/audiobookPlayerStore'
import { AudiobookControlsMenu } from './reader/AudiobookControlsMenu'
import { getLocalBookmarks, saveLocalBookmark, deleteLocalBookmark, type EpubBookmark } from '../utils/syncServerApi'
import { toLocalUrl } from '../utils/api'
import { loadReaderPreferences, saveReaderPreferences, DEFAULT_READER_PREFERENCES } from '../utils/readerPreferences'
import PageThumbnailSidebar from './PageThumbnailSidebar'
import type { TocItem, PdfReaderState, ReaderProps } from './reader/types'
import {
  type EpubTheme, type EpubFontFamily, type EpubMargin,
  EPUB_THEME_COLORS, EPUB_FONT_STACKS, EPUB_FONT_LABELS, EPUB_MARGIN_LABELS,
  EPUB_LINE_HEIGHT_MIN, EPUB_LINE_HEIGHT_MAX, EPUB_LINE_HEIGHT_STEP,
} from './reader/epubStyles'

// Lazy-load each reader engine so only the needed one is bundled per session.
// Opening a PDF won't load epubjs/jszip/unrar, and vice versa.
const EpubReader = lazy(() => import('./reader/EpubReader'))
const PdfReader  = lazy(() => import('./reader/PdfReader'))
const MangaReader = lazy(() => import('./reader/MangaReader'))

const ReaderLoading = () => (
  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-gray-900 text-white">
    <div className="w-8 h-8 border-4 border-theme-500 border-t-transparent rounded-full animate-spin" />
  </div>
)

const Reader: React.FC<ReaderProps> = ({ book, onClose, onProgress, headers, basicAuthHeaders }) => {
  const [extension] = useState(() => {
    let ext = ''
    if (book.formats && book.formats.length > 0) {
        const fmt = book.formats[0].toLowerCase()
        if (fmt.includes('epub')) return 'epub'
        if (fmt.includes('pdf')) return 'pdf'
        if (fmt.includes('cbr')) return 'cbr'
        if (fmt.includes('cbz')) return 'cbz'
    }

    const str = book.path || book.localPath || book.downloadUrl || ''
    if (str.includes('.')) {
        ext = str.split('.').pop()?.toLowerCase() || ''
    }

    if (!ext || ext.length > 4) {
        const lowerStr = str.toLowerCase()
        // First-class download URLs carry the format as a query param
        // (/api/books/{id}/download?format=EPUB) rather than a path segment.
        const fmtMatch = lowerStr.match(/[?&]format=(epub|pdf|cbz|cbr|cbt)/)
        if (fmtMatch) return fmtMatch[1]
        if (lowerStr.endsWith('/epub')) return 'epub'
        if (lowerStr.endsWith('/pdf')) return 'pdf'
        if (lowerStr.endsWith('/cbr')) return 'cbr'
        if (lowerStr.endsWith('/cbz')) return 'cbz'
    }

    return ext
  })

  // One medium at a time: pause background music when a book is opened.
  // Audiobooks keep playing alongside EPUB/PDF (read-along), but pause for
  // comics/manga — nobody listens to an audiobook of a CBZ/CBR.
  useEffect(() => {
    useMusicPlayer.getState().pause()
    if (extension === 'cbz' || extension === 'cbr') {
      useAudiobookPlayer.getState().pause()
    }
  }, [extension])

  // Whether an audiobook/podcast is loaded (controls shown for EPUB/PDF only)
  const hasAudiobook = useAudiobookPlayer((s) => s.currentItem !== null)
  const isAudiobookPlaying = useAudiobookPlayer((s) => s.isPlaying)
  const [showAudiobookControls, setShowAudiobookControls] = useState(false)

  const annotationMode = useAnnotationStore(s => s.annotationMode)
  const setAnnotationMode = useAnnotationStore(s => s.setAnnotationMode)

  // Last used settings per reader type (EPUB/PDF/Manga), restored on open
  const [readerPrefs] = useState(loadReaderPreferences)

  const [readingDirection, setReadingDirection] = useState<'ltr' | 'rtl'>(readerPrefs.manga.readingDirection)
  const [viewMode, setViewMode] = useState<'single' | 'double'>(readerPrefs.manga.viewMode)
  const [rendition, setRendition] = useState<any>(null)

  const [showSettings, setShowSettings] = useState(false)
  const [showToc, setShowToc] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])

  // Manga zoom state
  const [mangaZoom, setMangaZoom] = useState(1.0)

  // PDF-specific state (zoom always starts at 100% — not persisted)
  const [pdfState, setPdfState] = useState<PdfReaderState>({
    scale: 1.0,
    fitMode: readerPrefs.pdf.fitMode,
    displayMode: readerPrefs.pdf.displayMode
  })
  const [totalPages, setTotalPages] = useState(0)
  const [showPdfControls, setShowPdfControls] = useState(false)

  // Thumbnail sidebar state
  // Must be a separate copy — react-pdf detaches the ArrayBuffer when transferring to worker
  const [pdfDataForSidebar, setPdfDataForSidebar] = useState<Uint8Array | null>(null)
  const pdfFileForSidebar = React.useMemo(
    () => pdfDataForSidebar ? { data: new Uint8Array(pdfDataForSidebar) } : null,
    [pdfDataForSidebar]
  )
  const [mangaExtractor, setMangaExtractor] = useState<{
    extract: (index: number) => Promise<string | null>
    totalPages: number
  } | null>(null)

  // EPUB Bookmark state
  const [epubBookmarks, setEpubBookmarks] = useState<EpubBookmark[]>([])
  const [currentCfi, setCurrentCfi] = useState<string>('')
  const [showBookmarkDialog, setShowBookmarkDialog] = useState(false)
  const [newBookmarkName, setNewBookmarkName] = useState('')

  // Load bookmarks on mount
  useEffect(() => {
    if (extension === 'epub' && book.id) {
      getLocalBookmarks(book.id).then(setEpubBookmarks)
    }
  }, [book.id, extension])

  const [fontSize, setFontSize] = useState(readerPrefs.epub.fontSize)
  const [theme, setTheme] = useState<EpubTheme>(readerPrefs.epub.theme)
  const [spreadMode, setSpreadMode] = useState<'auto' | 'none' | 'always'>(readerPrefs.epub.spreadMode)
  const [fontFamily, setFontFamily] = useState<EpubFontFamily>(readerPrefs.epub.fontFamily)
  const [lineHeight, setLineHeight] = useState(readerPrefs.epub.lineHeight)
  const [epubMargin, setEpubMargin] = useState<EpubMargin>(readerPrefs.epub.margin)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const stepLineHeight = (dir: 1 | -1) => {
    setLineHeight(lh => {
      // From book default, step into the middle of the range
      if (lh === 0) return dir === 1 ? 1.6 : 1.4
      const next = Math.round((lh + dir * EPUB_LINE_HEIGHT_STEP) * 10) / 10
      return Math.min(EPUB_LINE_HEIGHT_MAX, Math.max(EPUB_LINE_HEIGHT_MIN, next))
    })
  }

  const resetEpubAppearance = () => {
    const d = DEFAULT_READER_PREFERENCES.epub
    setFontSize(d.fontSize)
    setTheme(d.theme)
    setSpreadMode(d.spreadMode)
    setFontFamily(d.fontFamily)
    setLineHeight(d.lineHeight)
    setEpubMargin(d.margin)
  }

  // Persist per-reader-type settings so the next book opens with them
  useEffect(() => {
    if (extension === 'epub') {
      saveReaderPreferences('epub', { fontSize, theme, spreadMode, fontFamily, lineHeight, margin: epubMargin })
    }
  }, [extension, fontSize, theme, spreadMode, fontFamily, lineHeight, epubMargin])

  useEffect(() => {
    if (extension === 'cbz' || extension === 'cbr') {
      saveReaderPreferences('manga', { readingDirection, viewMode })
    }
  }, [extension, readingDirection, viewMode])

  useEffect(() => {
    if (extension === 'pdf') {
      saveReaderPreferences('pdf', pdfState.fitMode === 'custom'
        ? { displayMode: pdfState.displayMode }
        : { displayMode: pdfState.displayMode, fitMode: pdfState.fitMode })
    }
  }, [extension, pdfState.displayMode, pdfState.fitMode])

  const [currentPage, setCurrentPage] = useState<string | number>(() => {
      if (typeof book.progress === 'number') return book.progress
      if (typeof book.progress === 'string' && !isNaN(parseInt(book.progress))) {
          // If it looks like a number (PDF/Manga page), parse it
          if (!book.progress.includes('epub')) return parseInt(book.progress)
      }
      return book.progress || 1
  })

  const sourcePath = book.localPath
    ? toLocalUrl(book.localPath)
    : book.downloadUrl!

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((e) => {
        console.error(`Error enabling fullscreen: ${e.message}`)
      })
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen()
      }
    }
  }

  const handleTocClick = (item: TocItem) => {
    if (extension === 'epub' && item.href && rendition) {
      rendition.display(item.href)
      setShowToc(false)
    } else if (extension === 'pdf' && item.page) {
      setCurrentPage(item.page)
      setShowToc(false)
    }
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  // Font size / theme / font family / line height / margins are applied live
  // inside EpubReader (injected CSS + debounced re-flow with CFI restore).

  useEffect(() => {
    if (rendition) {
      try { rendition.spread(spreadMode) } catch {}
    }
  }, [spreadMode, rendition])

  const [isIdle, setIsIdle] = useState(false)
  const idleTimer = useRef<NodeJS.Timeout | null>(null)

  const resetIdle = () => {
    setIsIdle(false)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIsIdle(true), 3000)
  }

  useEffect(() => {
    window.addEventListener('mousemove', resetIdle)
    window.addEventListener('mousedown', resetIdle)
    window.addEventListener('keydown', resetIdle)
    window.addEventListener('touchstart', resetIdle)

    resetIdle() // Init

    return () => {
      window.removeEventListener('mousemove', resetIdle)
      window.removeEventListener('mousedown', resetIdle)
      window.removeEventListener('keydown', resetIdle)
      window.removeEventListener('touchstart', resetIdle)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [])

  const TocList = ({ items, depth = 0 }: { items: TocItem[], depth?: number }) => (
    <div className="flex flex-col">
      {items.map((item, i) => (
        <React.Fragment key={i}>
          <button
            onClick={() => handleTocClick(item)}
            className="text-left px-4 py-3 hover:bg-white/10 text-white/80 hover:text-white transition-colors text-sm border-b border-white/5 truncate"
            style={{ paddingLeft: `${(depth + 1) * 16}px` }}
          >
            {item.label}
          </button>
          {item.subitems && item.subitems.length > 0 && (
            <TocList items={item.subitems} depth={depth + 1} />
          )}
        </React.Fragment>
      ))}
    </div>
  )

  return (
    <div className={`fixed inset-0 z-50 bg-gray-900 transition-colors duration-500 ${isIdle ? 'cursor-none' : ''}`}>
      {/* Header */}
      <div className={`absolute top-0 left-0 right-0 h-16 phone:h-auto phone:pt-safe phone:pb-1 px-6 phone:px-3 flex items-center justify-between z-50 select-none bg-gradient-to-b from-black/40 to-transparent transition-opacity duration-500 ${isIdle && !showSettings && !showToc && !showAudiobookControls ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2.5 bg-black/20 hover:bg-black/40 backdrop-blur-md rounded-full text-white transition-colors shadow-lg">
            <X size={22} />
          </button>
          <span className="text-sm font-medium text-white drop-shadow-md truncate max-w-md hidden sm:block">{book.title}</span>
        </div>

        <div className="flex items-center gap-3">
           {(extension === 'cbz' || extension === 'cbr') && (
             <div className="text-xs font-bold text-white bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full shadow-lg mr-2">
               {currentPage}
             </div>
           )}

           {extension === 'pdf' && totalPages > 0 && (
             <div className="flex items-center gap-2 mr-2">
               {/* Page input */}
               <input
                 type="number"
                 min={1}
                 max={totalPages}
                 value={typeof currentPage === 'number' ? currentPage : 1}
                 onChange={(e) => {
                   const val = parseInt(e.target.value)
                   if (!isNaN(val) && val >= 1 && val <= totalPages) {
                     setCurrentPage(val)
                   }
                 }}
                 className="w-14 text-center text-xs font-bold bg-black/40 backdrop-blur-md px-2 py-1.5 rounded-full shadow-lg text-white border-none outline-none"
               />
               <span className="text-xs text-white/70">/ {totalPages}</span>
             </div>
           )}

           <div className="flex items-center gap-2 p-1 bg-black/20 backdrop-blur-md rounded-full shadow-lg">
             {/* TOC Button */}
             {(extension === 'epub' || extension === 'pdf' || extension === 'cbz' || extension === 'cbr') && (
               <button
                 onClick={() => setShowToc(!showToc)}
                 className={`p-2 rounded-full transition-colors ${showToc ? 'bg-theme-600 text-white' : 'hover:bg-white/20 text-white'}`}
                 title={extension === 'epub' ? 'Table of Contents' : 'Page Thumbnails'}
               >
                 <List size={18} />
               </button>
             )}

             {/* PDF Annotation Toggle */}
             {extension === 'pdf' && (
               <button
                 onClick={() => setAnnotationMode(!annotationMode)}
                 className={`p-2 rounded-full transition-colors ${annotationMode ? 'bg-theme-600 text-white' : 'hover:bg-white/20 text-white'}`}
                 title="Annotations"
               >
                 <Pen size={18} />
               </button>
             )}

             {/* PDF Controls */}
             {extension === 'pdf' && (
               <>
                 {pdfState.fitMode === 'custom' && (
                   <button
                     onClick={() => setPdfState(s => ({ ...s, scale: 1.0, fitMode: 'page' }))}
                     className="px-2.5 py-1 rounded-full text-xs font-mono font-bold hover:bg-white/20 text-white transition-colors"
                     title="Reset zoom"
                   >
                     {Math.round(pdfState.scale * 100)}%
                   </button>
                 )}
                 <button
                   onClick={() => setShowPdfControls(!showPdfControls)}
                   className={`p-2 rounded-full transition-colors ${showPdfControls ? 'bg-theme-600 text-white' : 'hover:bg-white/20 text-white'}`}
                   title="PDF Settings"
                 >
                   <Settings size={18} />
                 </button>
               </>
             )}

             {(extension === 'cbz' || extension === 'cbr') && (
               <>
                 {mangaZoom > 1.05 && (
                   <button
                     onClick={() => setMangaZoom(1.0)}
                     className="px-2.5 py-1 rounded-full text-xs font-mono font-bold hover:bg-white/20 text-white transition-colors"
                     title="Reset zoom"
                   >
                     {Math.round(mangaZoom * 100)}%
                   </button>
                 )}
                 <button
                   onClick={() => setReadingDirection(d => d === 'ltr' ? 'rtl' : 'ltr')}
                   className="p-2 hover:bg-white/20 rounded-full text-white transition-colors"
                   title={readingDirection === 'ltr' ? 'LTR' : 'RTL'}
                 >
                   {readingDirection === 'ltr' ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
                 </button>
                 <button
                   onClick={() => setViewMode(m => m === 'single' ? 'double' : 'single')}
                   className="p-2 hover:bg-white/20 rounded-full text-white transition-colors"
                   title={viewMode === 'single' ? 'Single' : 'Double'}
                 >
                   {viewMode === 'single' ? <BookOpen size={18} /> : <div className="flex"><BookOpen size={14} /><BookOpen size={14} /></div>}
                 </button>
               </>
             )}

             {(extension === 'epub') && (
               <>
                 {/* Add Bookmark Button */}
                 <button
                   onClick={() => {
                     if (currentCfi) {
                       setShowBookmarkDialog(true)
                       setNewBookmarkName('')
                     }
                   }}
                   className="p-2 rounded-full transition-colors hover:bg-white/20 text-white"
                   title="Add Bookmark"
                 >
                   <BookmarkPlus size={18} />
                 </button>
                 <button
                   onClick={() => setShowSettings(!showSettings)}
                   className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-theme-600 text-white' : 'hover:bg-white/20 text-white'}`}
                 >
                   <Settings size={18} />
                 </button>
               </>
             )}

             {/* Audiobook Controls (EPUB/PDF only — comics pause the audiobook) */}
             {(extension === 'epub' || extension === 'pdf') && hasAudiobook && (
               <button
                 onClick={() => setShowAudiobookControls(!showAudiobookControls)}
                 className={`relative p-2 rounded-full transition-colors ${showAudiobookControls ? 'bg-theme-600 text-white' : 'hover:bg-white/20 text-white'}`}
                 title="Audiobook Controls"
               >
                 <Headphones size={18} />
                 {isAudiobookPlaying && !showAudiobookControls && (
                   <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-theme-400 animate-pulse" />
                 )}
               </button>
             )}

             <button
               onClick={toggleFullscreen}
               className="p-2 hover:bg-white/20 rounded-full text-white transition-colors"
             >
               {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
             </button>
           </div>

           {/* Audiobook Controls Dropdown */}
           {showAudiobookControls && hasAudiobook && <AudiobookControlsMenu />}

           {/* TOC Sidebar (EPUB text-based TOC only) */}
           {showToc && extension === 'epub' && (
             <div className="absolute top-full left-0 mt-4 ml-4 w-80 phone:w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl text-white overflow-hidden animate-in slide-in-from-left-5 fade-in duration-200">
               <div className="p-4 border-b border-white/10 font-bold bg-white/5">Table of Contents</div>
               <div className="overflow-y-auto flex-1 custom-scrollbar">
                  {/* EPUB Bookmarks Section */}
                  {extension === 'epub' && epubBookmarks.length > 0 && (
                    <div className="border-b border-white/10">
                      <div className="px-4 py-2 text-xs uppercase tracking-wider text-white/50 font-bold bg-white/5 flex items-center gap-2">
                        <Bookmark size={12} /> Bookmarks
                      </div>
                      {epubBookmarks.map((bm) => (
                        <div key={bm.id} className="flex items-center group">
                          <button
                            onClick={() => {
                              if (rendition) {
                                rendition.display(bm.cfi)
                                setShowToc(false)
                              }
                            }}
                            className="flex-1 text-left px-4 py-3 hover:bg-white/10 text-white/80 hover:text-white transition-colors text-sm truncate"
                          >
                            {bm.name}
                          </button>
                          <button
                            onClick={async () => {
                              await deleteLocalBookmark(book.id, bm.id)
                              setEpubBookmarks(prev => prev.filter(b => b.id !== bm.id))
                            }}
                            className="p-2 mr-2 text-white/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                            title="Delete bookmark"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Chapters */}
                  {toc.length > 0 ? (
                    <>
                      {extension === 'epub' && epubBookmarks.length > 0 && (
                        <div className="px-4 py-2 text-xs uppercase tracking-wider text-white/50 font-bold bg-white/5">
                          Chapters
                        </div>
                      )}
                      <TocList items={toc} />
                    </>
                  ) : epubBookmarks.length === 0 ? (
                    <div className="p-8 text-center text-white/50 text-sm">No chapters found</div>
                  ) : null}
               </div>
             </div>
           )}

           {/* EPUB Appearance Panel */}
           {showSettings && (
             <div className="absolute top-full right-0 mt-4 w-72 phone:w-[calc(100vw-2rem)] max-h-[calc(100vh-7rem)] overflow-y-auto custom-scrollbar bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-5 space-y-5 text-white animate-in slide-in-from-top-5 fade-in duration-200">
               {/* Theme */}
               <div>
                 <div className="text-[10px] uppercase tracking-wider font-bold text-white/50 mb-3">Theme</div>
                 <div className="grid grid-cols-4 gap-2">
                   {(['light', 'sepia', 'dark', 'black'] as EpubTheme[]).map((t) => (
                     <button
                       key={t}
                       onClick={() => setTheme(t)}
                       title={t === 'black' ? 'Black (OLED)' : t.charAt(0).toUpperCase() + t.slice(1)}
                       className={`h-10 phone:h-12 rounded-lg border-2 transition-all flex items-center justify-center text-xs font-serif ${theme === t ? 'border-theme-500 scale-105' : 'border-white/10'}`}
                       style={{ background: EPUB_THEME_COLORS[t].bg, color: EPUB_THEME_COLORS[t].fg }}
                     >
                       Aa
                     </button>
                   ))}
                 </div>
               </div>

               {/* Font Size */}
               <div>
                 <div className="text-[10px] uppercase tracking-wider font-bold text-white/50 mb-3">Font Size</div>
                 <div className="flex items-center gap-3">
                   <button onClick={() => setFontSize(s => Math.max(50, s - 10))} className="flex-1 py-2 phone:py-3 bg-white/10 rounded-lg hover:bg-white/20 transition-colors">-</button>
                   <span className="w-12 text-center text-sm font-mono">{fontSize}%</span>
                   <button onClick={() => setFontSize(s => Math.min(200, s + 10))} className="flex-1 py-2 phone:py-3 bg-white/10 rounded-lg hover:bg-white/20 transition-colors">+</button>
                 </div>
               </div>

               {/* Font Family */}
               <div>
                 <div className="text-[10px] uppercase tracking-wider font-bold text-white/50 mb-3">Font</div>
                 <div className="grid grid-cols-2 gap-2">
                   {(Object.keys(EPUB_FONT_LABELS) as EpubFontFamily[]).map((f) => (
                     <button
                       key={f}
                       onClick={() => setFontFamily(f)}
                       className={`py-2 phone:py-3 text-xs rounded-lg transition-colors ${f === 'default' ? 'col-span-2' : ''} ${fontFamily === f ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                       style={f !== 'default' ? { fontFamily: EPUB_FONT_STACKS[f] } : undefined}
                     >
                       {EPUB_FONT_LABELS[f]}
                     </button>
                   ))}
                 </div>
               </div>

               {/* Line Height */}
               <div>
                 <div className="text-[10px] uppercase tracking-wider font-bold text-white/50 mb-3">Line Height</div>
                 <div className="flex items-center gap-3">
                   <button onClick={() => stepLineHeight(-1)} className="flex-1 py-2 phone:py-3 bg-white/10 rounded-lg hover:bg-white/20 transition-colors">-</button>
                   <button
                     onClick={() => setLineHeight(0)}
                     title="Click to reset to the book's own line height"
                     className="w-14 text-center text-sm font-mono hover:text-theme-400 transition-colors"
                   >
                     {lineHeight === 0 ? 'Book' : lineHeight.toFixed(1)}
                   </button>
                   <button onClick={() => stepLineHeight(1)} className="flex-1 py-2 phone:py-3 bg-white/10 rounded-lg hover:bg-white/20 transition-colors">+</button>
                 </div>
               </div>

               {/* Margins */}
               <div>
                 <div className="text-[10px] uppercase tracking-wider font-bold text-white/50 mb-3">Margins</div>
                 <div className="grid grid-cols-3 gap-2">
                   {(['narrow', 'normal', 'wide'] as EpubMargin[]).map((m) => (
                     <button
                       key={m}
                       onClick={() => setEpubMargin(m)}
                       className={`py-2 phone:py-3 text-xs rounded-lg transition-colors ${epubMargin === m ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                     >
                       {EPUB_MARGIN_LABELS[m]}
                     </button>
                   ))}
                 </div>
               </div>

               {/* Layout (page spread) */}
               <div>
                 <div className="text-[10px] uppercase tracking-wider font-bold text-white/50 mb-3">Layout</div>
                 <div className="grid grid-cols-3 gap-2">
                   <button
                     onClick={() => setSpreadMode('auto')}
                     className={`py-2 phone:py-3 text-xs rounded-lg transition-colors ${spreadMode === 'auto' ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                   >
                     Auto
                   </button>
                   <button
                     onClick={() => setSpreadMode('none')}
                     className={`py-2 phone:py-3 text-xs rounded-lg transition-colors ${spreadMode === 'none' ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                   >
                     Single
                   </button>
                   <button
                     onClick={() => setSpreadMode('always')}
                     className={`py-2 phone:py-3 text-xs rounded-lg transition-colors ${spreadMode === 'always' ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                   >
                     Double
                   </button>
                 </div>
               </div>

               {/* Reset */}
               <button
                 onClick={resetEpubAppearance}
                 className="w-full flex items-center justify-center gap-2 py-2 phone:py-3 text-xs rounded-lg bg-white/5 hover:bg-white/15 text-white/70 hover:text-white transition-colors border border-white/10"
               >
                 <RotateCcw size={14} /> Reset to Defaults
               </button>
             </div>
           )}

           {/* EPUB Bookmark Dialog */}
           {showBookmarkDialog && (
             <div className="absolute top-full right-0 mt-4 w-72 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4 text-white animate-in slide-in-from-top-5 fade-in duration-200">
               <div className="text-sm font-bold">Add Bookmark</div>
               <input
                 type="text"
                 value={newBookmarkName}
                 onChange={(e) => setNewBookmarkName(e.target.value)}
                 placeholder="Bookmark name..."
                 className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none focus:border-theme-500"
                 autoFocus
                 onKeyDown={async (e) => {
                   if (e.key === 'Enter' && newBookmarkName.trim()) {
                     const bm = await saveLocalBookmark(book.id, newBookmarkName.trim(), currentCfi)
                     setEpubBookmarks(prev => [...prev, bm])
                     setShowBookmarkDialog(false)
                     setNewBookmarkName('')
                   } else if (e.key === 'Escape') {
                     setShowBookmarkDialog(false)
                   }
                 }}
               />
               <div className="flex gap-2">
                 <button
                   onClick={async () => {
                     if (newBookmarkName.trim()) {
                       const bm = await saveLocalBookmark(book.id, newBookmarkName.trim(), currentCfi)
                       setEpubBookmarks(prev => [...prev, bm])
                       setShowBookmarkDialog(false)
                       setNewBookmarkName('')
                     }
                   }}
                   className="flex-1 py-2 bg-theme-600 text-white rounded-lg text-sm font-medium hover:bg-theme-500 transition-colors"
                 >
                   Save
                 </button>
                 <button
                   onClick={() => setShowBookmarkDialog(false)}
                   className="flex-1 py-2 bg-white/10 text-white rounded-lg text-sm font-medium hover:bg-white/20 transition-colors"
                 >
                   Cancel
                 </button>
               </div>
             </div>
           )}

           {/* PDF Settings Dropdown */}
           {showPdfControls && (
             <div className="absolute top-full right-0 mt-4 w-72 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-5 space-y-5 text-white animate-in slide-in-from-top-5 fade-in duration-200">
               {/* Zoom Controls */}
               <div>
                 <div className="text-[10px] uppercase tracking-wider font-bold text-white/50 mb-3">Zoom</div>
                 <div className="flex items-center gap-3">
                   <button
                     onClick={() => setPdfState(s => ({ ...s, scale: Math.max(0.25, s.scale - 0.1), fitMode: 'custom' }))}
                     className="p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                     title="Zoom Out"
                   >
                     <ZoomOut size={16} />
                   </button>
                   <span className="w-16 text-center text-sm font-mono">{Math.round(pdfState.scale * 100)}%</span>
                   <button
                     onClick={() => setPdfState(s => ({ ...s, scale: Math.min(3, s.scale + 0.1), fitMode: 'custom' }))}
                     className="p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                     title="Zoom In"
                   >
                     <ZoomIn size={16} />
                   </button>
                 </div>
                 <div className="flex gap-2 mt-3">
                   <button
                     onClick={() => setPdfState(s => ({ ...s, fitMode: 'page', scale: 1.0 }))}
                     className={`flex-1 py-2 text-xs rounded-lg transition-colors ${pdfState.fitMode === 'page' ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                   >
                     Fit Page
                   </button>
                   <button
                     onClick={() => setPdfState(s => ({ ...s, fitMode: 'width', scale: 1.0 }))}
                     className={`flex-1 py-2 text-xs rounded-lg transition-colors ${pdfState.fitMode === 'width' ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                   >
                     Fit Width
                   </button>
                 </div>
               </div>

               {/* Display Mode */}
               <div>
                 <div className="text-[10px] uppercase tracking-wider font-bold text-white/50 mb-3">Display Mode</div>
                 <div className="grid grid-cols-2 gap-2">
                   <button
                     onClick={() => setPdfState(s => ({ ...s, displayMode: 'single' }))}
                     className={`flex items-center justify-center gap-2 py-2 text-xs rounded-lg transition-colors ${pdfState.displayMode === 'single' ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                     title="Single Page"
                   >
                     <FileText size={14} /> Single
                   </button>
                   <button
                     onClick={() => setPdfState(s => ({ ...s, displayMode: 'double-even' }))}
                     className={`flex items-center justify-center gap-2 py-2 text-xs rounded-lg transition-colors ${pdfState.displayMode === 'double-even' ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                     title="Two Pages (2-3, 4-5...)"
                   >
                     <Columns size={14} /> Double (Even)
                   </button>
                   <button
                     onClick={() => setPdfState(s => ({ ...s, displayMode: 'double-odd' }))}
                     className={`flex items-center justify-center gap-2 py-2 text-xs rounded-lg transition-colors ${pdfState.displayMode === 'double-odd' ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                     title="Two Pages (1-2, 3-4...)"
                   >
                     <Columns size={14} /> Double (Odd)
                   </button>
                   <button
                     onClick={() => setPdfState(s => ({ ...s, displayMode: 'scroll-v' }))}
                     className={`flex items-center justify-center gap-2 py-2 text-xs rounded-lg transition-colors ${pdfState.displayMode === 'scroll-v' ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                     title="Vertical Scroll"
                   >
                     <AlignJustify size={14} /> Vertical
                   </button>
                   <button
                     onClick={() => setPdfState(s => ({ ...s, displayMode: 'scroll-h' }))}
                     className={`col-span-2 flex items-center justify-center gap-2 py-2 text-xs rounded-lg transition-colors ${pdfState.displayMode === 'scroll-h' ? 'bg-theme-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                     title="Horizontal Scroll"
                   >
                     <Move size={14} /> Horizontal
                   </button>
                 </div>
               </div>
             </div>
           )}
        </div>
      </div>

      <div className="h-full w-full relative overflow-hidden bg-[#1a1a1a]">
         {/* Thumbnail sidebar for PDF/Manga — absolutely positioned */}
         {showToc && extension === 'pdf' && totalPages > 0 && pdfFileForSidebar && (
           <div className="absolute left-0 top-0 bottom-0 z-20">
             <PageThumbnailSidebar
               totalPages={totalPages}
               currentPage={typeof currentPage === 'number' ? currentPage : 1}
               onPageClick={(p) => setCurrentPage(p)}
               pdfFile={pdfFileForSidebar}
             />
           </div>
         )}
         {showToc && (extension === 'cbz' || extension === 'cbr') && mangaExtractor && (
           <div className="absolute left-0 top-0 bottom-0 z-20">
             <PageThumbnailSidebar
               totalPages={mangaExtractor.totalPages}
               currentPage={typeof currentPage === 'number' ? currentPage : 1}
               onPageClick={(p) => setCurrentPage(p)}
               extractThumbnail={mangaExtractor.extract}
             />
           </div>
         )}

         {/* Content area — padded when sidebar is visible */}
         {extension === 'epub' && (
           <Suspense fallback={<ReaderLoading />}>
             <EpubReader
               path={sourcePath}
               onRenditionReady={setRendition}
               initialLocation={book.progress ? book.progress.toString() : undefined}
               onLocationChange={(loc: string, percentage: number) => {
                 setCurrentCfi(loc)
                 onProgress?.(loc, percentage)
               }}
               onTocLoaded={setToc}
               appearance={{ theme, fontSize, fontFamily, lineHeight, margin: epubMargin }}
               onActivity={resetIdle}
               headers={headers}
               basicAuthHeaders={basicAuthHeaders}
             />
           </Suspense>
         )}
         {extension === 'pdf' && (
           <div className={`h-full w-full relative transition-[padding] duration-200 ${showToc && totalPages > 0 && pdfFileForSidebar ? 'pl-40' : ''}`}>
             <Suspense fallback={<ReaderLoading />}>
               <PdfReader
                 path={sourcePath}
                 headers={headers}
                 basicAuthHeaders={basicAuthHeaders}
                 page={typeof currentPage === 'number' ? currentPage : 1}
                 onPageChange={(p: number, percentage: number) => {
                   setCurrentPage(p)
                   onProgress?.(p, percentage)
                 }}
                 onTocLoaded={setToc}
                 onTotalPagesChange={setTotalPages}
                 onPdfDataLoaded={setPdfDataForSidebar}
                 scale={pdfState.scale}
                 fitMode={pdfState.fitMode}
                 displayMode={pdfState.displayMode}
                 bookId={book.id}
                 onScaleChange={(s) => setPdfState(prev => ({ ...prev, scale: s, fitMode: s <= 1.05 ? 'page' : 'custom' }))}
               />
             </Suspense>
           </div>
         )}
         {(extension === 'cbz' || extension === 'cbr') && (
           <div className={`h-full w-full relative transition-[padding] duration-200 ${showToc && mangaExtractor ? 'pl-40' : ''}`}>
             <Suspense fallback={<ReaderLoading />}>
               <MangaReader
                 path={sourcePath}
                 initialPage={typeof currentPage === 'number' ? currentPage : 1}
                 page={typeof currentPage === 'number' ? currentPage : undefined}
                 onPageChange={(p: number, percentage: number) => {
                   setCurrentPage(p)
                   onProgress?.(p, percentage)
                 }}
                 onArchiveReady={(info) => setMangaExtractor(info)}
                 headers={headers}
                 basicAuthHeaders={basicAuthHeaders}
                 extension={extension}
                 direction={readingDirection}
                 viewMode={viewMode}
                 scale={mangaZoom}
                 onScaleChange={setMangaZoom}
               />
             </Suspense>
           </div>
         )}
         {!['epub', 'pdf', 'cbz', 'cbr'].includes(extension || '') && (
           <div className="h-full flex items-center justify-center text-white/50">
             Unsupported format: {extension}
           </div>
         )}
      </div>

      {/* Floating Footer Controls (EPUB only) */}
      {extension === 'epub' && (
        <div className={`absolute bottom-8 phone:bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-1/2 -translate-x-1/2 flex items-center gap-4 p-1.5 bg-black/20 backdrop-blur-md rounded-full border border-white/10 shadow-2xl z-50 transition-opacity duration-500 select-none ${isIdle ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            <button onClick={() => rendition?.prev()} className="p-3 hover:bg-white/20 rounded-full text-white transition-colors">
              <ChevronLeft size={24} />
            </button>
            <div className="w-px h-6 bg-white/10 mx-1" />
            <button onClick={() => rendition?.next()} className="p-3 hover:bg-white/20 rounded-full text-white transition-colors">
              <ChevronRight size={24} />
            </button>
        </div>
      )}

      {/* Floating Footer Controls (PDF - page slider) */}
      {extension === 'pdf' && totalPages > 1 && pdfState.displayMode === 'single' && (
        <div className={`absolute bottom-8 phone:bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-1/2 -translate-x-1/2 flex items-center gap-4 px-6 py-3 bg-black/40 backdrop-blur-md rounded-full border border-white/10 shadow-2xl z-50 transition-opacity duration-500 select-none ${isIdle ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            <button
              onClick={() => setCurrentPage((p: string | number) => Math.max(1, (typeof p === 'number' ? p : 1) - 1))}
              className="p-2 hover:bg-white/20 rounded-full text-white transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <input
              type="range"
              min={1}
              max={totalPages}
              value={typeof currentPage === 'number' ? currentPage : 1}
              onChange={(e) => setCurrentPage(parseInt(e.target.value))}
              className="w-48 md:w-64 h-1 appearance-none bg-white/30 rounded-full cursor-pointer slider-thumb"
              style={{
                background: `linear-gradient(to right, rgb(var(--theme-600)) 0%, rgb(var(--theme-600)) ${((typeof currentPage === 'number' ? currentPage : 1) / totalPages) * 100}%, rgba(255,255,255,0.3) ${((typeof currentPage === 'number' ? currentPage : 1) / totalPages) * 100}%, rgba(255,255,255,0.3) 100%)`
              }}
            />
            <button
              onClick={() => setCurrentPage((p: string | number) => Math.min(totalPages, (typeof p === 'number' ? p : 1) + 1))}
              className="p-2 hover:bg-white/20 rounded-full text-white transition-colors"
            >
              <ChevronRight size={20} />
            </button>
        </div>
      )}
    </div>
  )
}

export default Reader
