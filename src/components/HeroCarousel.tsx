import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Info } from 'lucide-react';
import { api, isLocalFileUrl, toLocalUrl } from '../utils/api';
import { fetchImageViaApi, releaseImage } from '../utils/requestQueue';

interface HeroCarouselProps {
  books: any[];
  onRead: (book: any) => void;
  onDetails?: (book: any) => void;
  authHeaders?: any;
}

export const HeroCarousel: React.FC<HeroCarouselProps> = ({ books, onRead, onDetails, authHeaders }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [coverUrl, setCoverUrl] = useState<string>('');
  // Track the source URL for proper ref-counted cleanup
  const sourceUrlRef = useRef<string | null>(null);

  // Stable ref for authHeaders — prevents effect re-runs when parent re-renders
  const authHeadersRef = useRef(authHeaders);
  authHeadersRef.current = authHeaders;

  // Auto-rotate every 10 seconds
  useEffect(() => {
    if (books.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % books.length);
    }, 10000);
    return () => clearInterval(interval);
  }, [books.length]);

  // Load cover image with deduplication and proper ref counting
  useEffect(() => {
    const book = books[currentIndex];
    if (!book?.cover) {
      setCoverUrl('');
      return;
    }

    let active = true;
    const src = book.cover;

    // Release previous image ref before loading new one
    if (sourceUrlRef.current) {
      releaseImage(sourceUrlRef.current);
      sourceUrlRef.current = null;
    }

    if (src.startsWith('data:') || src.startsWith('blob:') || isLocalFileUrl(src)) {
      if (active) setCoverUrl(isLocalFileUrl(src) ? toLocalUrl(src) : src);
      return;
    }

    const loadCover = async () => {
      try {
        const blobUrl = await fetchImageViaApi(src, api, authHeadersRef.current || {}, 10);
        if (active && blobUrl) {
          sourceUrlRef.current = src;
          setCoverUrl(blobUrl);
        } else if (!active) {
          // Component unmounted during fetch, release immediately
          releaseImage(src);
        }
      } catch (e) {
        console.error('HeroCarousel cover load failed:', e);
        if (active) setCoverUrl('');
      }
    };

    loadCover();

    return () => {
      active = false;
    };
  }, [currentIndex, books]);

  // Release ref on unmount
  useEffect(() => {
    return () => {
      if (sourceUrlRef.current) {
        releaseImage(sourceUrlRef.current);
        sourceUrlRef.current = null;
      }
    };
  }, []);

  if (!books || books.length === 0) return null;

  const book = books[currentIndex];

  return (
    <div className="relative w-full h-[400px] phone:h-[300px] overflow-hidden group">
      {/* Background (Blurry) */}
      <div className="absolute inset-0">
        {coverUrl ? (
           <img
             src={coverUrl}
             className="w-full h-full object-cover opacity-40 blur-2xl scale-110"
             alt=""
           />
        ) : (
           <div className="w-full h-full bg-gradient-to-br from-theme-900/50 to-gray-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-gray-900 via-gray-900/30 to-transparent" />
      </div>

      {/* Content */}
      <div className="absolute inset-0 flex items-center px-12 phone:px-4 gap-8 phone:gap-4">
        {/* Cover Image */}
        <div
          className="flex-shrink-0 h-[300px] phone:h-[180px] aspect-[2/3] rounded-xl overflow-hidden shadow-2xl z-10 transform transition-transform group-hover:scale-105 duration-500 cursor-pointer ring-1 ring-white/10"
          onClick={() => onDetails?.(book)}
        >
           {coverUrl ? (
             <img
               src={coverUrl}
               className="w-full h-full object-cover"
               alt={book.title}
             />
           ) : (
             <div className="w-full h-full bg-gray-800 flex items-center justify-center text-white/40">No Cover</div>
           )}
        </div>

        {/* Info */}
        <div className="flex flex-col gap-4 max-w-2xl z-10">
          <h1 className="text-4xl phone:text-xl font-bold leading-tight line-clamp-2 text-white drop-shadow-lg">
            {book.title}
          </h1>
          <div className="text-lg phone:text-sm text-white/70 font-medium">
            {book.author}
          </div>
          <p className="text-sm phone:text-xs text-white/50 line-clamp-3 phone:line-clamp-2 leading-relaxed max-w-xl">
            {(book.description || "No description available.").replace(/<[^>]*>/g, '').trim()}
          </p>

          <div className="flex gap-3 mt-4 phone:mt-2">
            <button
              onClick={() => onRead(book)}
              className="px-6 py-3 phone:px-4 phone:py-2 phone:text-sm bg-theme-600 hover:bg-theme-500 text-white rounded-lg font-semibold flex items-center gap-2 transition-all shadow-lg shadow-theme-600/30 hover:shadow-theme-500/40"
            >
              <BookOpen size={20} />
              Read Now
            </button>
            <button
              onClick={() => onDetails?.(book)}
              className="px-6 py-3 phone:px-4 phone:py-2 phone:text-sm bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-lg font-semibold flex items-center gap-2 hover:bg-white/20 transition-colors"
            >
              <Info size={20} />
              Details
            </button>
          </div>
        </div>
      </div>

      {/* Indicators */}
      {books.length > 1 && (
        <div className="absolute bottom-6 right-12 phone:right-4 phone:bottom-3 flex gap-2 z-20">
          {books.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                idx === currentIndex
                  ? 'w-8 bg-theme-500'
                  : 'w-2 bg-white/30 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};
