import React from 'react'
import AuthenticatedImage from './AuthenticatedImage'
import { isLocalFileUrl } from '../utils/api'

interface LocalOrRemoteImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /**
   * Preferred local filesystem path (book-file:// or http://book-file.localhost/).
   * When provided, the file is read via Tauri IPC (compiled app) or served as-is (Electron/dev).
   */
  localPath?: string | null
  /**
   * Remote URL (Jellyfin API image endpoint, OPDS cover, etc.).
   * Used as fallback when localPath is not available.
   */
  remoteUrl?: string | null
  /** Auth headers to use for authenticated remote URLs. */
  authHeaders?: Record<string, string>
}

/**
 * Renders a cover image from either a local downloaded file or a remote URL.
 * Priority: localPath > remoteUrl > placeholder.
 *
 * Uses AuthenticatedImage (Tauri IPC) for local paths so they work correctly
 * in the compiled Tauri app (where `book-file://` direct img src is unreliable).
 */
const LocalOrRemoteImage: React.FC<LocalOrRemoteImageProps> = ({
  localPath,
  remoteUrl,
  authHeaders,
  alt,
  className,
  ...imgProps
}) => {
  if (localPath && isLocalFileUrl(localPath)) {
    return (
      <AuthenticatedImage
        src={localPath}
        alt={alt}
        className={className}
        {...imgProps}
      />
    )
  }

  if (localPath) {
    // Raw filesystem path (not yet prefixed with book-file://) — prefix it
    const bookFileUrl = localPath.startsWith('http') ? localPath : `book-file://${localPath}`
    return (
      <AuthenticatedImage
        src={bookFileUrl}
        alt={alt}
        className={className}
        {...imgProps}
      />
    )
  }

  if (remoteUrl) {
    if (authHeaders) {
      return (
        <AuthenticatedImage
          src={remoteUrl}
          authHeaders={authHeaders}
          alt={alt}
          className={className}
          {...imgProps}
        />
      )
    }
    return (
      <img
        src={remoteUrl}
        alt={alt}
        className={className}
        loading="lazy"
        decoding="async"
        {...imgProps}
      />
    )
  }

  return null
}

export default LocalOrRemoteImage
