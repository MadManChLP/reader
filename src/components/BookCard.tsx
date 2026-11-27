import React from 'react';
import { Play, Download, Check, CheckCircle, Library, BookOpen, Info } from 'lucide-react';
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu';
import { hapticLight } from '../utils/haptics';
import AuthenticatedImage from './AuthenticatedImage';
import CircularProgress from './CircularProgress';
import { useDownloadFraction } from '../stores/downloadProgressStore';
import { isLocalFileUrl, toLocalUrl } from '../utils/api';

interface BookCardProps {
  book: any;
  onClick: () => void;
  onPlay?: (book: any) => void;
  onDownload?: (e: React.MouseEvent) => void;
  onToggleRead?: (book: any) => void;
  isRead?: boolean;
  authHeaders?: any;
  /** Fills the parent grid cell instead of the fixed slider width */
  fluid?: boolean;
}

export const BookCard: React.FC<BookCardProps> = React.memo(function BookCard({ book, onClick, onPlay, onDownload, onToggleRead, isRead, authHeaders, fluid = false }) {
  // Touch has no hover, so the overlay buttons are desktop-only: a tap opens
  // the book's details right away (it used to take two taps — the first only
  // revealed the overlay) and a long-press opens the same actions as a menu.
  // undefined = not downloading, null = downloading (size unknown), 0..1 = fraction
  const downloadFraction = useDownloadFraction(book.id);
  const isDownloading = downloadFraction !== undefined;
  const { menuPosition, openAt, close: closeMenu, longPressHandlers } = useContextMenu();

  const fakeEvent = { stopPropagation() {}, preventDefault() {} } as unknown as React.MouseEvent;
  const menuItems: ContextMenuItem[] = book.isFolder ? [] : [
    { label: 'Read now', icon: BookOpen, onClick: () => (onPlay ? onPlay(book) : onClick()) },
    { label: 'Details', icon: Info, onClick: onClick },
    ...(onDownload && !book.localPath ? [{
      label: isDownloading ? 'Downloading…' : 'Download', icon: Download, disabled: isDownloading,
      onClick: () => onDownload(fakeEvent), separator: true,
    }] : []),
    ...(onToggleRead ? [{
      label: isRead ? 'Mark as unread' : 'Mark as read', icon: CheckCircle, onClick: () => onToggleRead(book),
      separator: !(onDownload && !book.localPath),
    }] : []),
  ];
  // book.cover is either an OPDS URL (http) or local book-file:// path (from cross-check)
  // cachedCover is only an offline fallback — skip it if book.cover is available
  const rawCover = book.cover || book.cachedCover || '';
  // Convert book-file:// to http://book-file.localhost/ for WebView2 (Tauri v2 on Windows)
  const coverSrc = rawCover && isLocalFileUrl(rawCover) ? toLocalUrl(rawCover) : rawCover;
  // Pass auth headers only for HTTP server URLs (not local file:// covers)
  const isHttpCover = coverSrc?.startsWith('http') && !isLocalFileUrl(coverSrc);
  // percentage is the 0..1 fraction for the bar; book.progress holds the raw
  // reading position (page number or CFI). Old cached books may still carry the
  // fraction in progress, so accept it as a fallback when it looks like one.
  const progress = typeof book.percentage === 'number'
    ? book.percentage
    : (typeof book.progress === 'number' && book.progress > 0 && book.progress < 1 ? book.progress : 0);

  return (
    <div
      onClick={onClick}
      onContextMenu={book.isFolder ? undefined : (e) => { hapticLight(); openAt(e) }}
      {...(book.isFolder ? {} : longPressHandlers)}
      className={`group relative flex-shrink-0 ${fluid ? 'w-full' : 'w-40'} cursor-pointer`}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-2">
        {coverSrc ? (
          <AuthenticatedImage
            src={coverSrc}
            alt={book.title}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
            authHeaders={isHttpCover ? authHeaders : undefined}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-theme-900/50 to-pink-900/50">
            {book.isFolder ? (
              <>
                <Library size={32} className="text-white/30" />
                <span className="text-[10px] text-white/40 mt-2 px-2 text-center line-clamp-2">{book.title}</span>
              </>
            ) : (
              <span className="text-white/30 text-xs">No Cover</span>
            )}
          </div>
        )}

        {/* Hover Overlay */}
        {!book.isFolder && (
          <div className={`absolute inset-0 bg-black/60 transition-opacity flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100 [@media(hover:none)]:hidden`}>
            <button
              onClick={(e) => { e.stopPropagation(); if (onPlay) onPlay(book); else onClick() }}
              className="p-3 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform shadow-lg"
              title="Read now"
            >
              <Play size={20} fill="currentColor" />
            </button>
            <div className="flex items-center gap-2">
              {onDownload && !book.localPath && (
                <button
                  onClick={(e) => { e.stopPropagation(); if (!isDownloading) onDownload(e) }}
                  disabled={isDownloading}
                  className="p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:scale-110 transition-transform disabled:hover:scale-100"
                  title={isDownloading ? 'Downloading…' : 'Download'}
                >
                  {isDownloading ? (
                    <CircularProgress fraction={downloadFraction ?? null} size={18} />
                  ) : (
                    <Download size={18} />
                  )}
                </button>
              )}
              {onToggleRead && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleRead(book) }}
                  className="p-2 bg-white/20 backdrop-blur-sm rounded-full hover:scale-110 transition-transform"
                  title={isRead ? 'Mark as Unread' : 'Mark as Read'}
                >
                  <CheckCircle size={18} className={isRead ? 'text-green-400 fill-green-400' : 'text-white'} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Progress Bar */}
        {progress > 0 && progress < 1 && !book.isFolder && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
            <div
              className="h-full bg-theme-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}

        {/* Download-in-progress Badge - Top Right (visible without hover) */}
        {isDownloading && !book.localPath && !book.isFolder && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-black/70 rounded-full flex items-center justify-center shadow-lg text-theme-400">
            <CircularProgress fraction={downloadFraction ?? null} size={16} />
          </div>
        )}

        {/* Downloaded Badge - Top Right */}
        {book.localPath && !book.isFolder && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
            <Check size={12} className="text-white" strokeWidth={3} />
          </div>
        )}

        {/* Read Badge - Top Left */}
        {isRead && !book.isFolder && (
          <div className="absolute top-2 left-2 w-6 h-6 bg-theme-500 rounded-full flex items-center justify-center shadow-lg">
            <Check size={12} className="text-white" strokeWidth={3} />
          </div>
        )}
      </div>

      {/* Title & Author */}
      <h3 className="text-sm font-medium text-white/90 truncate">{book.title}</h3>
      {book.author && (
        <p className="text-xs text-white/50 truncate">{book.author}</p>
      )}

      {menuPosition && menuItems.length > 0 && (
        <ContextMenu items={menuItems} position={menuPosition} onClose={closeMenu} />
      )}
    </div>
  );
});
