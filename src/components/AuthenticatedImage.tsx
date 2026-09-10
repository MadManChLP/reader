import React, { useState, useEffect, useRef } from 'react'
import { api, isLocalFileUrl, toLocalUrl, localUrlToFsPath } from '../utils/api'
import { fetchImageViaApi, releaseImage } from '../utils/requestQueue'

interface AuthenticatedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string
  authHeaders?: any
}

/**
 * Extract a filesystem path from a local URL (any book-file form, incl.
 * iOS's book-file://localhost/…). Returns null if not a local file URL.
 */
function extractLocalFilePath(src: string): string | null {
  return isLocalFileUrl(src) ? localUrlToFsPath(src) : null
}

// Session cache: local file path → blob URL. Covers on disk are immutable, so
// each is read + decoded once and the blob URL is shared by every component
// instance. Previously each mount re-read the file over IPC and kept its own
// base64 data: URL alive in the DOM — much more memory and repeated disk I/O.
const localBlobCache = new Map<string, string>()
const localBlobPending = new Map<string, Promise<string | null>>()

function localFileToBlobUrl(fsPath: string): Promise<string | null> {
  const cached = localBlobCache.get(fsPath)
  if (cached) return Promise.resolve(cached)
  const pending = localBlobPending.get(fsPath)
  if (pending) return pending

  const promise = (async () => {
    try {
      const bytes = await api.readFileBinary(fsPath)
      if (!bytes) return null
      const lower = fsPath.toLowerCase()
      const mime = lower.endsWith('.png') ? 'image/png'
                 : lower.endsWith('.gif') ? 'image/gif'
                 : lower.endsWith('.webp') ? 'image/webp'
                 : 'image/jpeg'
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
      localBlobCache.set(fsPath, url)
      return url
    } catch {
      return null
    } finally {
      localBlobPending.delete(fsPath)
    }
  })()
  localBlobPending.set(fsPath, promise)
  return promise
}

const AuthenticatedImage: React.FC<AuthenticatedImageProps> = ({ src, authHeaders, alt, className, ...props }) => {
  const [imageSrc, setImageSrc] = useState<string>('')
  const [error, setError] = useState(false)

  // Track the source URL for proper cleanup with reference counting
  const sourceUrlRef = useRef<string | null>(null)
  const usedQueueRef = useRef(false)

  useEffect(() => {
    let active = true
    usedQueueRef.current = false
    sourceUrlRef.current = null

    const fetchImage = async () => {
      try {
        if (src.startsWith('data:') || src.startsWith('blob:')) {
          setImageSrc(src)
          return
        }

        if (isLocalFileUrl(src)) {
          // For local files in Tauri: read via IPC as base64 → blob URL.
          // This bypasses the custom protocol (http://book-file.localhost/) which
          // can fail in the compiled app if IS_TAURI was false at module-load time
          // or if the WebView2 protocol handler has any issues.
          const isTauri = typeof window !== 'undefined' && '__TAURI__' in window
          if (isTauri) {
            const fsPath = extractLocalFilePath(src)
            if (fsPath) {
              const blobUrl = await localFileToBlobUrl(fsPath)
              if (blobUrl && active) {
                setImageSrc(blobUrl)
                return
              }
            }
          }
          // Electron: book-file:// works directly as an img src
          setImageSrc(toLocalUrl(src))
          return
        }

        if (!authHeaders) {
          // No auth — use URL directly (works for public or same-origin resources)
          setImageSrc(src)
          return
        }

        // Authenticated HTTP image: fetch via backend to handle CORS + auth
        const blobUrl = await fetchImageViaApi(src, api, authHeaders)
        usedQueueRef.current = true
        sourceUrlRef.current = src

        if (active && blobUrl) {
          setImageSrc(blobUrl)
        } else if (!active) {
          releaseImage(src)
        }
      } catch (e) {
        console.error("Failed to load image", e)
        if (active) setError(true)
      }
    }

    fetchImage()

    return () => {
      active = false
    }
    // Depend on the token value, not the object identity (getAuthHeader()
    // returns a fresh object every call) — and skip a per-render JSON.stringify
  }, [src, authHeaders?.Authorization])

  // Clean up when component unmounts or src changes
  useEffect(() => {
    return () => {
      if (usedQueueRef.current && sourceUrlRef.current) {
        releaseImage(sourceUrlRef.current)
      }
    }
  }, [src])

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-gray-800 text-white/40 text-xs uppercase font-mono ${className}`} {...props}>
        Error
      </div>
    )
  }

  if (!imageSrc) {
    return (
        <div className={`bg-gray-800 animate-pulse ${className}`} {...props} />
    )
  }

  return <img src={imageSrc} alt={alt} className={className} {...props} />
}

export default AuthenticatedImage
