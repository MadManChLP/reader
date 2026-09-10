import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { api, isLocalFileUrl, toLocalUrl } from '../utils/api';
import { fetchImageViaApi, releaseImage } from '../utils/requestQueue';

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  authHeaders?: Record<string, string>;
  /** Distance from viewport to start loading (default: 200px) */
  rootMargin?: string;
  /** Priority for queue (higher = loads first) */
  priority?: number;
  /** Placeholder element to show while loading */
  placeholder?: React.ReactNode;
  /** Element to show on error */
  errorElement?: React.ReactNode;
}

/**
 * LazyImage - Lazy loading image component with:
 * - Intersection Observer for viewport detection
 * - Request queue with automatic retry and concurrency limiting
 * - Deduplication and ref-counted blob URL management
 * - Click-to-retry on error
 */
export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  authHeaders,
  rootMargin = '400px',
  priority = 0,
  placeholder,
  errorElement,
  className,
  alt,
  ...props
}) => {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [isInView, setIsInView] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const imgRef = useRef<HTMLDivElement>(null);
  const sourceUrlRef = useRef<string | null>(null);

  // Stable ref for authHeaders — prevents effect re-runs when parent re-renders
  // (getAuthHeader() creates a new object each call, causing unstable references)
  const authHeadersRef = useRef(authHeaders);
  authHeadersRef.current = authHeaders;

  // Auto-retry when auth token becomes available after a failed load.
  // Covers load before login completes (empty token → 401 → error).
  // When the token arrives, re-trigger the load effect via retryCount.
  //
  // Critical: do NOT update prevAuthTokenRef when hasError is false (request still
  // in-flight). If we did, the token would appear "already seen" when the request
  // later fails, and the retry would never fire.
  const prevAuthTokenRef = useRef(authHeaders?.Authorization || '');
  useEffect(() => {
    const newToken = authHeaders?.Authorization || '';
    if (newToken && newToken !== prevAuthTokenRef.current) {
      if (hasError) {
        // Token arrived (or changed) and we already have an error — retry now.
        prevAuthTokenRef.current = newToken;
        setRetryCount(c => c + 1);
      }
      // If hasError is false: don't update prevRef yet. The request may still be
      // in-flight. When it fails and sets hasError=true, the effect will re-run
      // and see that the token changed → retry.
    }
  }, [authHeaders?.Authorization, hasError]);

  // Intersection Observer to detect when image enters viewport
  useEffect(() => {
    const element = imgRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold: 0 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  // Load image when in view
  useEffect(() => {
    if (!isInView || !src) return;

    let isMounted = true;

    // Release previous ref if src changed
    if (sourceUrlRef.current && sourceUrlRef.current !== src) {
      releaseImage(sourceUrlRef.current);
      sourceUrlRef.current = null;
    }

    const loadImage = async () => {
      setIsLoading(true);
      setHasError(false);

      // Handle local/data/blob URLs directly
      if (src.startsWith('data:') || src.startsWith('blob:') || isLocalFileUrl(src)) {
        if (isMounted) {
          // Convert book-file:// URLs to correct platform format (Tauri v2 uses http://book-file.localhost/)
          setImageSrc(isLocalFileUrl(src) ? toLocalUrl(src) : src);
          setIsLoading(false);
        }
        return;
      }

      try {
        // All HTTP URLs go through the API backend (handles CORS + auth)
        const blobUrl = await fetchImageViaApi(src, api, authHeadersRef.current || {}, priority);
        sourceUrlRef.current = src;

        if (isMounted) {
          setImageSrc(blobUrl);
          setIsLoading(false);
        } else {
          releaseImage(src);
        }
      } catch (error) {
        if (isMounted) {
          setHasError(true);
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
    };
  }, [isInView, src, priority, retryCount]);

  // Release ref on unmount or src change
  useEffect(() => {
    return () => {
      if (sourceUrlRef.current) {
        releaseImage(sourceUrlRef.current);
        sourceUrlRef.current = null;
      }
    };
  }, [src]);

  // Retry loading on click
  const handleRetry = useCallback(() => {
    setRetryCount(c => c + 1);
  }, []);

  // Render error state (click to retry)
  if (hasError) {
    if (errorElement) {
      return <div onClick={handleRetry}>{errorElement}</div>;
    }
    return (
      <div
        ref={imgRef}
        className={`flex items-center justify-center bg-gray-800 text-white/40 text-xs uppercase font-mono cursor-pointer hover:bg-gray-700 transition-colors ${className}`}
        onClick={handleRetry}
        title="Click to retry"
        {...props}
      >
        Retry
      </div>
    );
  }

  // Render loading state
  if (!imageSrc || isLoading) {
    if (placeholder) {
      return (
        <div ref={imgRef} className={className} {...props}>
          {placeholder}
        </div>
      );
    }
    return (
      <div
        ref={imgRef}
        className={`bg-gray-800 animate-pulse ${className}`}
        {...props}
      />
    );
  }

  // Render loaded image with smooth fade-in animation
  return (
    <motion.img
      ref={imgRef as any}
      src={imageSrc}
      alt={alt}
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      loading="lazy"
      decoding="async"
      style={props.style}
      width={props.width}
      height={props.height}
      title={props.title}
    />
  );
};

export default LazyImage;
