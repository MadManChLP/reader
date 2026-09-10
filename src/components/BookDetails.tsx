import { ArrowLeft, BookOpen, Check, Download, FileText, Layers, Trash2 } from 'lucide-react'
import AuthenticatedImage from './AuthenticatedImage'
import CircularProgress from './CircularProgress'
import { useDownloadFraction } from '../stores/downloadProgressStore'
import { useScrollToTopOnMount } from '../hooks/useScrollRestore'

interface BookDetailsProps {
  book: any
  onBack: () => void
  onRead: (book: any) => void
  onDownload?: (book: any) => void
  onMarkRead?: (book: any) => void
  onDelete?: (book: any) => void
  onOpenBook?: (book: any) => void
  isRead: boolean
  isDownloaded: boolean
  authHeaders?: any
  seriesBooks?: any[]
}

export function BookDetails({
  book,
  onBack,
  onRead,
  onDownload,
  onMarkRead,
  onDelete,
  onOpenBook,
  isRead,
  isDownloaded,
  authHeaders,
  seriesBooks = [],
}: BookDetailsProps) {
  const scrollTopAnchor = useScrollToTopOnMount()
  // undefined = not downloading, null = downloading (size unknown), 0..1 = fraction
  const downloadFraction = useDownloadFraction(book?.id)
  const isDownloading = downloadFraction !== undefined

  if (!book) return null

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300" ref={scrollTopAnchor}>
      {/* Hero backdrop */}
      <div className="absolute inset-x-0 top-0 h-[400px] overflow-hidden">
        {book.cover || book.cachedCover ? (
          <AuthenticatedImage
            src={(book.cover?.startsWith('http') ? book.cover : null) || book.cachedCover || book.cover}
            authHeaders={authHeaders}
            className="w-full h-full object-cover opacity-30 blur-2xl scale-110"
            alt=""
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-theme-900/50 to-gray-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/80 to-gray-900/40" />
      </div>

      {/* Header / Back Button */}
      <div className="relative z-10 p-6 phone:px-4 pt-safe flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        >
          <ArrowLeft size={24} className="text-white" />
        </button>
        <h2 className="text-xl font-semibold text-white truncate">{book.title}</h2>
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-y-auto px-8 phone:px-4 pb-8">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row gap-8">

          {/* Cover Image */}
          <div className="w-full md:w-1/3 max-w-[280px] phone:max-w-[220px] flex-shrink-0 mx-auto md:mx-0">
            <div className="aspect-[2/3] rounded-xl overflow-hidden shadow-2xl relative ring-1 ring-white/10">
               <AuthenticatedImage
                  src={(book.cover?.startsWith('http') ? book.cover : null) || book.cachedCover || book.cover}
                  authHeaders={authHeaders}
                  className="w-full h-full object-cover"
                  alt={book.title}
               />
               {/* Status Overlays */}
               <div className="absolute top-3 right-3 flex flex-col gap-2">
                  {isRead && (
                    <div className="bg-theme-500 p-1.5 rounded-full shadow-lg" title="Read">
                      <Check size={14} className="text-white"/>
                    </div>
                  )}
                  {isDownloaded && (
                    <div className="bg-green-500 p-1.5 rounded-full shadow-lg" title="Downloaded">
                      <Download size={14} className="text-white"/>
                    </div>
                  )}
               </div>
            </div>
          </div>

          {/* Details & Actions */}
          <div className="flex-1 space-y-6">
             <div className="phone:text-center">
                <h1 className="text-3xl md:text-4xl phone:text-2xl font-bold text-white mb-2">{book.title}</h1>
                <p className="text-xl text-white/60">{book.author}</p>
             </div>

             <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => onRead(book)}
                  className="px-6 py-3 phone:w-full justify-center bg-theme-600 hover:bg-theme-500 text-white rounded-lg font-semibold flex items-center gap-2 transition-all shadow-lg shadow-theme-600/30"
                >
                  <BookOpen size={20} /> Read Book
                </button>

                {!isDownloaded && onDownload && (
                  <button
                    onClick={() => { if (!isDownloading) onDownload(book) }}
                    disabled={isDownloading}
                    className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white border border-white/10 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:cursor-default disabled:hover:bg-white/10"
                  >
                    {isDownloading ? (
                      <>
                        <CircularProgress fraction={downloadFraction ?? null} size={20} className="text-theme-400" />
                        {typeof downloadFraction === 'number'
                          ? `Downloading ${Math.round(downloadFraction * 100)}%`
                          : 'Downloading…'}
                      </>
                    ) : (
                      <><Download size={20} /> Download</>
                    )}
                  </button>
                )}

                {isDownloaded && onDelete && (
                  <button
                    onClick={() => onDelete(book)}
                    className="px-6 py-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg font-medium flex items-center gap-2 hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 size={20} /> Delete Download
                  </button>
                )}

                {onMarkRead && !isRead && (
                   <button
                    onClick={() => onMarkRead(book)}
                    className="px-6 py-3 bg-white/5 border border-white/10 rounded-lg font-medium flex items-center gap-2 hover:bg-white/10 transition-colors text-white"
                  >
                    <Check size={20} /> Mark as Read
                  </button>
                )}

                {onMarkRead && isRead && (
                   <button
                    onClick={() => onMarkRead(book)}
                    className="px-6 py-3 bg-white/5 border border-white/10 rounded-lg font-medium flex items-center gap-2 hover:bg-white/10 transition-colors text-white/60"
                  >
                    <Check size={20} /> Mark as Unread
                  </button>
                )}
             </div>

             {book.description && (
               <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <FileText size={18} className="text-theme-400" /> Description
                  </h3>
                  <p className="text-white/60 leading-relaxed whitespace-pre-line">
                    {book.description.replace(/<[^>]*>/g, '').trim()}
                  </p>
               </div>
             )}

             {/* Tech Details */}
             <div className="pt-6 border-t border-white/10 text-xs text-white/40 font-mono space-y-1">
                <p>ID: {book.id}</p>
                {book.calibreId && <p>Calibre ID: {book.calibreId}</p>}
                {book.localPath && <p>Local Path: {book.localPath}</p>}
                <p>Format: {book.formats?.join(', ') || 'Unknown'}</p>
             </div>
          </div>
        </div>

        {/* Series siblings */}
        {seriesBooks.length > 0 && (
          <div className="mt-10 pt-8 border-t border-white/10">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
              <Layers size={18} className="text-theme-400" />
              More in "{book.series}"
            </h3>
            <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
              {seriesBooks.map((sibling) => (
                <button
                  key={sibling.id}
                  onClick={() => onOpenBook?.(sibling)}
                  className="flex-shrink-0 w-28 text-left group"
                >
                  <div className="w-28 h-40 rounded-lg overflow-hidden mb-2 ring-1 ring-white/10 group-hover:ring-theme-500/60 transition-all">
                    <AuthenticatedImage
                      src={sibling.cover}
                      authHeaders={authHeaders}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      alt={sibling.title}
                    />
                  </div>
                  {sibling.series_index != null && (
                    <p className="text-xs text-theme-400 font-medium">Vol. {sibling.series_index}</p>
                  )}
                  <p className="text-xs text-white/70 line-clamp-2 leading-tight">{sibling.title}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
