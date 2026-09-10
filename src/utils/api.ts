// API Adapter - Unified interface for Electron and Tauri backends
// This module provides a consistent API regardless of the runtime environment

import { createTauriAPI } from './tauriApi';
import { createElectronAPI } from './electronApi';

// Type definitions for the API interface
export interface ApiRequestConfig {
  method: string;
  url: string;
  data?: any;
  headers?: Record<string, string>;
  responseType?: 'json' | 'text' | 'arraybuffer';
  /** Allow self-signed certificates (only for trusted self-hosted servers) */
  allowInsecureSsl?: boolean;
  /**
   * Set to false to receive 3xx responses (with their Location header) instead
   * of following them. Requests with followRedirects: false share a dedicated
   * cookie jar — multi-step auth flows must use it for every step.
   */
  followRedirects?: boolean;
}

export interface ApiResponse {
  success: boolean;
  data?: any;
  status: number;
  headers?: Record<string, string>;
  error?: string;
}

export interface FileResult {
  success: boolean;
  data?: string;
  error?: string;
  path?: string;
}

export interface LocalBook {
  name: string;
  path: string;
  type: string;
  cover?: string;
  author?: string;
  metadata?: any;
}

export interface DownloadFileConfig {
  url: string;
  folderPath: string;
  fileName: string;
  headers?: Record<string, string>;
}

export interface WriteFileConfig {
  path: string;
  content: string;
}

export interface DownloadToTempConfig {
  url: string;
  headers?: Record<string, string>;
  extension?: string;
}

export interface DownloadToTempResult {
  success: boolean;
  path?: string;
  status?: number;
  error?: string;
}

// The unified API interface
export interface AppAPI {
  // HTTP requests
  request: (config: ApiRequestConfig) => Promise<ApiResponse>;

  // Stream large file to temp (avoids OOM for binary downloads)
  downloadToTemp: (config: DownloadToTempConfig) => Promise<DownloadToTempResult>;

  // File system
  readDirectory: (path: string) => Promise<LocalBook[]>;
  createDirectory: (path: string) => Promise<FileResult>;
  deleteDirectory: (path: string) => Promise<FileResult>;
  writeFile: (config: WriteFileConfig) => Promise<FileResult>;
  downloadFile: (config: DownloadFileConfig) => Promise<FileResult>;
  // Abort an in-flight downloadFile by its URL (Tauri only; no-op in Electron).
  // The partial file is deleted by the backend.
  cancelDownload: (url: string) => Promise<void>;
  fileExists: (path: string) => Promise<boolean>;
  deleteFile: (path: string) => Promise<FileResult>;

  // Cache
  getCachePath: () => Promise<string>;
  clearCache: () => Promise<FileResult>;
  getDefaultPath: () => Promise<string>;

  // Archive operations (Tauri only — used by MangaReader and CoverCache)
  // List image file names in a ZIP/CBZ archive (natural-sorted, no decompression)
  listDirectoryNames: (path: string) => Promise<string[]>;
  listArchive: (path: string) => Promise<string[]>;
  // Decompress a single entry and return its raw bytes (Tauri: zero-copy IPC)
  extractArchiveEntry: (path: string, entry: string) => Promise<Uint8Array>;
  // Read a file as raw bytes (avoids cross-origin fetch() issues in Tauri)
  readFileBinary: (path: string) => Promise<Uint8Array | null>;

  // Secret storage (OS credential store / OS-encrypted file).
  // Used for the LDAP/AD password — never store secrets in localStorage.
  secretSet: (key: string, value: string) => Promise<boolean>;
  secretGet: (key: string) => Promise<string | null>;
  secretDelete: (key: string) => Promise<boolean>;

  // OIDC login: opens a window at authorizeUrl and resolves with the full
  // callback URL once it navigates to redirectPrefix (navigation is blocked).
  // Resolves null if the user closes the window or the login times out.
  openOidcWindow: (authorizeUrl: string, redirectPrefix: string) => Promise<string | null>;

  // Open an http(s) URL in the system browser (release notes, APK download).
  openExternal: (url: string) => Promise<void>;
  // Launch a downloaded desktop installer (Tauri/desktop only). No-op on mobile.
  runInstaller: (path: string) => Promise<void>;
  // Apply a downloaded Linux portable .tar.gz update in place (extract, swap the
  // running binary, relaunch). Linux/Tauri only; rejects elsewhere. Caller should
  // close the app on success so the swapped-in binary takes over.
  applyLinuxUpdate: (archivePath: string) => Promise<void>;
  // Install a downloaded Arch .pkg.tar.zst via `pkexec pacman -U` (Linux only).
  applyPacmanUpdate: (packagePath: string) => Promise<void>;

  // Dialogs
  selectFolder: () => Promise<string | null>;
  // Native "Save As" dialog that writes text to the chosen path (desktop only;
  // mobile uses the Web Share API from the frontend — see fileExport.ts).
  // canceled=true when the user dismisses the dialog.
  saveFileDialog: (config: { defaultName: string; content: string }) => Promise<{ success: boolean; path?: string; canceled: boolean; error?: string }>;

  // Window controls
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

// Detect runtime environment.
// Checked at module-load time for the api singleton — Tauri injects window.__TAURI__
// as a preload script so it should be available before any JS module runs.
// toLocalUrl() re-checks at call time as an extra safety measure.
export const IS_TAURI = typeof window !== 'undefined' && '__TAURI__' in window;

// iOS has no folder picker and apps are sandboxed to their container —
// used to hide desktop-only UI (e.g. the download-location "Change..." button).
// Capability gating ONLY — never use for layout decisions (use IS_PHONE for that).
// The maxTouchPoints check catches iPadOS, which reports a Mac user agent.
export const IS_IOS = typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)));

// Phone-class device (iPhone / small Android): touch-capable with a screen whose
// smaller dimension is under 600px. Rotation-stable (screen, not viewport) and
// never true on desktop regardless of window size. Drives the phone layout.
export const IS_PHONE = typeof navigator !== 'undefined' && typeof screen !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) &&
  Math.min(screen.width, screen.height) < 600;

// Create and export the appropriate API implementation
export const api: AppAPI = IS_TAURI ? createTauriAPI() : createElectronAPI();

/**
 * Check if a URL is a local file URL (book-file:// or http://book-file.localhost/).
 */
export function isLocalFileUrl(url: string): boolean {
  return url.startsWith('book-file:') || url.startsWith('http://book-file.localhost/');
}

/**
 * Decode any book-file URL form back to a plain filesystem path (mirror of
 * Rust's decode_book_file_path). Handles every platform's URL shape:
 *   http://book-file.localhost/C:/Users/...   (Tauri on Windows)
 *   book-file://localhost/var/mobile/...      (Tauri on iOS/macOS/Linux)
 *   book-file:///var/mobile/...               (Rust-built URLs, absolute path)
 *   book-file://C:/Users/...                  (Electron)
 * Non-URL inputs (already plain paths) are returned unchanged.
 *
 * The `localhost` authority variant matters: convertFileSrc on iOS produces
 * book-file://localhost/<path> — stripping only `book-file://` would leave a
 * bogus `localhost/...` relative path that Rust's path-safety check rejects
 * (the cause of broken offline covers/archives on iOS).
 */
export function localUrlToFsPath(url: string): string {
  let p = url;
  if (p.startsWith('http://book-file.localhost/')) {
    p = p.slice('http://book-file.localhost/'.length);
  } else if (p.startsWith('https://book-file.localhost/')) {
    p = p.slice('https://book-file.localhost/'.length);
  } else if (p.startsWith('book-file://localhost/')) {
    p = p.slice('book-file://localhost/'.length);
  } else if (p.startsWith('book-file://')) {
    p = p.slice('book-file://'.length);
  } else {
    return p; // already a plain filesystem path
  }

  try {
    p = decodeURIComponent(p);
  } catch { /* not percent-encoded — keep as-is */ }

  // Unix absolute paths lose their leading slash when the prefix is stripped
  // (book-file://localhost/var/... → var/...). Restore it — unless it's a
  // Windows drive path (C:/...), which must NOT start with a slash.
  if (!p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p)) {
    p = '/' + p;
  }
  return p;
}

/**
 * Convert a file path to a URL loadable by the webview.
 * In Tauri v2 on Windows, custom protocols use http://<scheme>.localhost/<path>
 * In Electron / browser, book-file:// works directly.
 * Also converts existing book-file:// URLs to the correct platform format.
 *
 * NOTE: Checks window.__TAURI__ at call time (not module-load time) to handle
 * the case where Tauri injects globals after the module is first evaluated.
 */
export function toLocalUrl(filePath: string, protocol = 'book-file'): string {
  // If already a book-file URL (any platform form), extract the path first
  const path = localUrlToFsPath(filePath);

  // Normalize backslashes to forward slashes
  const normalized = path.replace(/\\/g, '/');

  // Check at call time — window.__TAURI__ may not exist at module-load time
  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

  if (isTauri) {
    // Tauri v2: use convertFileSrc if available, otherwise construct manually
    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.convertFileSrc) {
        return tauri.core.convertFileSrc(normalized, protocol);
      }
    } catch { /* fallback below */ }
    // Manual construction for Windows: http://<protocol>.localhost/<path>
    return `http://${protocol}.localhost/${normalized}`;
  }

  // Electron / browser: use the custom protocol directly
  return `${protocol}://${normalized}`;
}

// Also export as default
export default api;
