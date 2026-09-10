// Electron API Implementation
// This wraps the existing window.api exposed by Electron's preload script
import type { AppAPI, ApiRequestConfig, ApiResponse, FileResult, LocalBook, DownloadFileConfig, WriteFileConfig } from './api';

// Type for the Electron API exposed via preload (in a separate declaration to avoid conflicts)
interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  getDefaultPath: () => Promise<string>;
  readDirectory: (path: string) => Promise<any[]>;
  createDirectory: (path: string) => Promise<any>;
  deleteDirectory: (path: string) => Promise<any>;
  writeFile: (config: any) => Promise<any>;
  downloadFile: (config: any) => Promise<any>;
  request: (config: any) => Promise<any>;
  secretSet?: (key: string, value: string) => Promise<{ success: boolean; error?: string }>;
  secretGet?: (key: string) => Promise<string | null>;
  secretDelete?: (key: string) => Promise<{ success: boolean; error?: string }>;
  openOidcWindow?: (authorizeUrl: string, redirectPrefix: string) => Promise<string | null>;
  openExternal?: (url: string) => Promise<void>;
  runInstaller?: (path: string) => Promise<void>;
  getCachePath: () => Promise<string>;
  fileExists: (path: string) => Promise<boolean>;
  deleteFile: (path: string) => Promise<any>;
  clearCache: () => Promise<any>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

// Access window.api with type assertion
function getElectronApi(): ElectronAPI | undefined {
  return (window as any).api;
}

export function createElectronAPI(): AppAPI {
  return {
    // HTTP requests
    async request(config: ApiRequestConfig): Promise<ApiResponse> {
      const api = getElectronApi();
      if (!api?.request) {
        return { success: false, status: 0, error: 'Electron API not available' };
      }
      const res = await api.request(config);
      return {
        success: res.success ?? false,
        data: res.data,
        status: res.status ?? 0,
        headers: res.headers,
        error: res.error,
      };
    },

    // Stream large file to temp (avoids OOM for binary downloads)
    async downloadToTemp(config) {
      const api = getElectronApi();
      if (!(api as any)?.downloadToTemp) {
        return { success: false, error: 'downloadToTemp not available' };
      }
      return (api as any).downloadToTemp(config);
    },

    // File system operations
    async readDirectory(path: string): Promise<LocalBook[]> {
      const api = getElectronApi();
      if (!api?.readDirectory) return [];
      const result = await api.readDirectory(path);
      return result.map((item: any) => ({
        name: item.name ?? '',
        path: item.path ?? '',
        type: item.type ?? 'local',
        cover: item.cover,
        author: item.author,
        metadata: item.metadata,
      }));
    },

    async createDirectory(path: string): Promise<FileResult> {
      const api = getElectronApi();
      if (!api?.createDirectory) {
        return { success: false, error: 'Electron API not available' };
      }
      return api.createDirectory(path);
    },

    async deleteDirectory(path: string): Promise<FileResult> {
      const api = getElectronApi();
      if (!api?.deleteDirectory) {
        return { success: false, error: 'Electron API not available' };
      }
      return api.deleteDirectory(path);
    },

    async writeFile(config: WriteFileConfig): Promise<FileResult> {
      const api = getElectronApi();
      if (!api?.writeFile) {
        return { success: false, error: 'Electron API not available' };
      }
      return api.writeFile(config);
    },

    async downloadFile(config: DownloadFileConfig): Promise<FileResult> {
      const api = getElectronApi();
      if (!api?.downloadFile) {
        return { success: false, error: 'Electron API not available' };
      }
      return api.downloadFile(config);
    },

    async cancelDownload(_url: string): Promise<void> {
      // Not supported in Electron — the JS-side post-download guard in the
      // download managers prevents cancelled items from being recorded.
    },

    async fileExists(path: string): Promise<boolean> {
      const api = getElectronApi();
      if (!api?.fileExists) return false;
      return api.fileExists(path);
    },

    async deleteFile(path: string): Promise<FileResult> {
      const api = getElectronApi();
      if (!api?.deleteFile) {
        return { success: false, error: 'Electron API not available' };
      }
      return api.deleteFile(path);
    },

    // Cache operations
    async getCachePath(): Promise<string> {
      const api = getElectronApi();
      if (!api?.getCachePath) return 'cover-cache';
      return api.getCachePath();
    },

    async clearCache(): Promise<FileResult> {
      const api = getElectronApi();
      if (!api?.clearCache) {
        return { success: false, error: 'Electron API not available' };
      }
      return api.clearCache();
    },

    async getDefaultPath(): Promise<string> {
      const api = getElectronApi();
      if (!api?.getDefaultPath) return 'dl';
      return api.getDefaultPath();
    },

    // Archive operations (Tauri-only — stubs for Electron compatibility)
    async listDirectoryNames(_path: string): Promise<string[]> {
      return [];
    },

    async listArchive(_path: string): Promise<string[]> {
      return [];  // MangaReader falls back to JSZip when this returns empty
    },

    async extractArchiveEntry(_path: string, _entry: string): Promise<Uint8Array> {
      throw new Error('extractArchiveEntry is not supported in Electron');
    },

    async readFileBinary(_path: string): Promise<Uint8Array | null> {
      return null;  // Electron uses fetch() directly for CBR reading
    },

    // Secret storage (safeStorage in the Electron main process)
    async secretSet(key: string, value: string): Promise<boolean> {
      const api = getElectronApi();
      if (!api?.secretSet) return false;
      const res = await api.secretSet(key, value);
      return res?.success ?? false;
    },

    async secretGet(key: string): Promise<string | null> {
      const api = getElectronApi();
      if (!api?.secretGet) return null;
      return api.secretGet(key);
    },

    async secretDelete(key: string): Promise<boolean> {
      const api = getElectronApi();
      if (!api?.secretDelete) return false;
      const res = await api.secretDelete(key);
      return res?.success ?? false;
    },

    // OIDC login window (second BrowserWindow with redirect interception)
    async openOidcWindow(authorizeUrl: string, redirectPrefix: string): Promise<string | null> {
      const api = getElectronApi();
      if (!api?.openOidcWindow) return null;
      return api.openOidcWindow(authorizeUrl, redirectPrefix);
    },

    // Open an http(s) URL externally (best-effort: uses the preload bridge if
    // present, else falls back to window.open).
    async openExternal(url: string): Promise<void> {
      const api = getElectronApi();
      if (api?.openExternal) { await api.openExternal(url); return; }
      try { window.open(url, '_blank'); } catch { /* ignore */ }
    },

    // Launch a downloaded installer (only if the preload bridge provides it).
    async runInstaller(path: string): Promise<void> {
      const api = getElectronApi();
      if (api?.runInstaller) { await api.runInstaller(path); return; }
      console.warn('runInstaller not available in this Electron build:', path);
    },

    // In-place tar.gz self-update is a Tauri/Linux feature; not implemented for
    // the legacy Electron backend.
    async applyLinuxUpdate(archivePath: string): Promise<void> {
      throw new Error(`In-place update not supported in this build: ${archivePath}`);
    },

    async applyPacmanUpdate(packagePath: string): Promise<void> {
      throw new Error(`pacman update not supported in this build: ${packagePath}`);
    },

    // Dialog operations
    async selectFolder(): Promise<string | null> {
      const api = getElectronApi();
      if (!api?.selectFolder) return null;
      return api.selectFolder();
    },

    // Not implemented in the legacy Electron backend — the frontend falls back
    // to writing into the download folder / clipboard.
    async saveFileDialog(config: { defaultName: string; content: string }): Promise<{ success: boolean; path?: string; canceled: boolean; error?: string }> {
      return { success: false, canceled: false, error: `Save dialog unsupported in this build: ${config.defaultName}` };
    },

    // Window controls
    minimize(): void {
      getElectronApi()?.minimize?.();
    },

    maximize(): void {
      getElectronApi()?.maximize?.();
    },

    close(): void {
      getElectronApi()?.close?.();
    },
  };
}
