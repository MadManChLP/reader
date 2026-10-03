// Tauri API Implementation
import type { AppAPI, ApiRequestConfig, ApiResponse, FileResult, LocalBook, DownloadFileConfig, WriteFileConfig } from './api';

// Tauri v2 invoke function - uses global __TAURI__ when withGlobalTauri is true
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // Use the global Tauri object (withGlobalTauri: true in tauri.conf.json)
  if (typeof window !== 'undefined' && '__TAURI__' in window) {
    const tauri = (window as any).__TAURI__;
    if (tauri?.core?.invoke) {
      return tauri.core.invoke(cmd, args) as Promise<T>;
    }
  }

  throw new Error('Tauri API not available - ensure withGlobalTauri is true in tauri.conf.json');
}

// iOS/Android: multi-window is not available, so the OIDC login opens in the
// system browser and returns via a custom-scheme deep link instead of a
// second webview window. (Mirrors IS_IOS in api.ts — duplicated here to avoid
// a circular import; api.ts imports this module.)
const IS_MOBILE_OS = typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod|Android/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)));

/**
 * Mobile OIDC flow: listen for the deep-link callback (mediamaster://…,
 * emitted by tauri-plugin-deep-link as 'deep-link://new-url'), then open the
 * IdP authorize URL in the system browser. After login the server redirects
 * to the custom scheme, iOS foregrounds the app and the listener resolves
 * with the full callback URL. Returns null on timeout (treated as cancel).
 */
async function openOidcExternal(authorizeUrl: string, redirectPrefix: string): Promise<string | null> {
  const tauriEvent = (window as any).__TAURI__?.event;
  if (!tauriEvent?.listen) {
    // Throw (don't resolve null): null means "user cancelled" to the caller,
    // which silently ends the login. A setup failure must surface in the UI.
    throw new Error('Cannot start the login: Tauri event API is not available');
  }

  const prefix = redirectPrefix.toLowerCase();
  return new Promise<string | null>((resolve, reject) => {
    let unlisten: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const onVisible = () => {
      // App came back to the foreground. A successful login delivers the
      // deep link within ~1s of resume — if nothing arrives in 8s, the user
      // returned from Safari without finishing: treat as cancelled instead
      // of leaving the login spinner up for the full timeout.
      if (document.visibilityState === 'visible' && !graceTimer) {
        graceTimer = setTimeout(() => finish(null), 8_000);
      }
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      document.removeEventListener('visibilitychange', onVisible);
      unlisten?.();
    };
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: unknown) => {
      if (done) return;
      done = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    // Same 5-minute window as the desktop login window (JS timers are
    // suspended while the app is backgrounded behind Safari).
    timer = setTimeout(() => finish(null), 300_000);
    document.addEventListener('visibilitychange', onVisible);

    tauriEvent
      .listen('deep-link://new-url', (event: { payload: string[] | string }) => {
        const urls = Array.isArray(event.payload) ? event.payload : [event.payload];
        const match = urls.find((u) => typeof u === 'string' && u.toLowerCase().startsWith(prefix));
        if (match) finish(match);
      })
      .then((fn: () => void) => {
        unlisten = fn;
        // Listener is armed — hand the login page to the system browser.
        // open_external (our Rust command) routes through shell().open(),
        // which works on iOS — the JS-facing `plugin:shell|open` command
        // only has a desktop implementation and rejects on mobile.
        return invoke('open_external', { url: authorizeUrl });
      })
      .catch((error: unknown) => {
        console.error('openOidcExternal failed:', error);
        fail(error);
      });
  });
}

export function createTauriAPI(): AppAPI {
  return {
    // HTTP requests - routed through Rust for CORS bypass and cookie support
    async request(config: ApiRequestConfig): Promise<ApiResponse> {
      try {
        return await invoke<ApiResponse>('api_request', { config });
      } catch (error: any) {
        return {
          success: false,
          status: 0,
          error: error.message || String(error),
        };
      }
    },

    // Stream large file to temp via Rust (avoids OOM for large books)
    async downloadToTemp(config) {
      try {
        return await invoke<{ success: boolean; path?: string; status?: number; error?: string }>('download_to_temp', { config });
      } catch (error: any) {
        return { success: false, error: error.message || String(error) };
      }
    },

    // File system operations
    async readDirectory(path: string): Promise<LocalBook[]> {
      try {
        return await invoke<LocalBook[]>('read_directory', { dirPath: path });
      } catch {
        return [];
      }
    },

    async createDirectory(path: string): Promise<FileResult> {
      try {
        return await invoke<FileResult>('create_directory', { dirPath: path });
      } catch (error: any) {
        return { success: false, error: error.message || String(error) };
      }
    },

    async deleteDirectory(path: string): Promise<FileResult> {
      try {
        return await invoke<FileResult>('delete_directory', { dirPath: path });
      } catch (error: any) {
        return { success: false, error: error.message || String(error) };
      }
    },

    async writeFile(config: WriteFileConfig): Promise<FileResult> {
      try {
        return await invoke<FileResult>('write_file', { config });
      } catch (error: any) {
        return { success: false, error: error.message || String(error) };
      }
    },

    async downloadFile(config: DownloadFileConfig): Promise<FileResult> {
      try {
        return await invoke<FileResult>('download_file', { config });
      } catch (error: any) {
        return { success: false, error: error.message || String(error) };
      }
    },

    async cancelDownload(url: string): Promise<void> {
      try {
        await invoke('cancel_download', { url });
      } catch (error) {
        console.error('cancelDownload failed:', error);
      }
    },

    async fileExists(path: string): Promise<boolean> {
      try {
        return await invoke<boolean>('file_exists', { filePath: path });
      } catch {
        return false;
      }
    },

    async deleteFile(path: string): Promise<FileResult> {
      try {
        return await invoke<FileResult>('delete_file', { filePath: path });
      } catch (error: any) {
        return { success: false, error: error.message || String(error) };
      }
    },

    // Cache operations
    async getCachePath(): Promise<string> {
      try {
        return await invoke<string>('get_cache_path');
      } catch {
        return 'cover-cache';
      }
    },

    async clearCache(): Promise<FileResult> {
      try {
        return await invoke<FileResult>('clear_cache');
      } catch (error: any) {
        return { success: false, error: error.message || String(error) };
      }
    },

    async getDefaultPath(): Promise<string> {
      try {
        return await invoke<string>('get_default_path');
      } catch {
        return 'dl';
      }
    },

    // Archive operations
    async listDirectoryNames(path: string): Promise<string[]> {
      try {
        return await invoke<string[]>('list_directory_names', { dirPath: path });
      } catch {
        return [];
      }
    },

    async listArchive(path: string): Promise<string[]> {
      try {
        return await invoke<string[]>('list_archive', { path });
      } catch {
        return [];
      }
    },

    // Rust returns tauri::ipc::Response (raw bytes) — invoke resolves with an
    // ArrayBuffer, no base64/atob round-trip
    async extractArchiveEntry(path: string, entry: string): Promise<Uint8Array> {
      const buf = await invoke<ArrayBuffer | Uint8Array>('extract_archive_entry', { path, entry });
      return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    },

    async readFileBinary(path: string): Promise<Uint8Array | null> {
      try {
        const buf = await invoke<ArrayBuffer | Uint8Array>('read_file_binary', { filePath: path });
        return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      } catch {
        return null;
      }
    },

    // Secret storage (OS credential store via Rust keyring)
    async secretSet(key: string, value: string): Promise<boolean> {
      try {
        await invoke('secret_set', { key, value });
        return true;
      } catch (error) {
        console.error('secretSet failed:', error);
        return false;
      }
    },

    async secretGet(key: string): Promise<string | null> {
      try {
        return await invoke<string | null>('secret_get', { key });
      } catch (error) {
        console.error('secretGet failed:', error);
        return null;
      }
    },

    async secretDelete(key: string): Promise<boolean> {
      try {
        await invoke('secret_delete', { key });
        return true;
      } catch (error) {
        console.error('secretDelete failed:', error);
        return false;
      }
    },

    // OIDC login window (navigation to redirectPrefix is intercepted in Rust).
    // On iOS/Android there is no second window — system browser + deep link.
    async openOidcWindow(authorizeUrl: string, redirectPrefix: string): Promise<string | null> {
      if (IS_MOBILE_OS) {
        return openOidcExternal(authorizeUrl, redirectPrefix);
      }
      try {
        return await invoke<string | null>('open_oidc_window', { authorizeUrl, redirectPrefix });
      } catch (error) {
        console.error('openOidcWindow failed:', error);
        return null;
      }
    },

    // Open an http(s) URL in the system browser (routes through shell().open()
    // so it also works on iOS/Android, unlike plugin:shell|open).
    async openExternal(url: string): Promise<void> {
      await invoke('open_external', { url });
    },

    // Launch a downloaded desktop installer.
    async runInstaller(path: string): Promise<void> {
      await invoke('run_installer', { path });
    },

    // Apply a Linux portable .tar.gz update in place (Linux only; the Rust
    // command rejects on other platforms).
    async applyLinuxUpdate(archivePath: string): Promise<void> {
      await invoke('apply_linux_update', { archivePath });
    },

    // Install a downloaded Arch .pkg.tar.zst via pkexec pacman -U (Linux only).
    async applyPacmanUpdate(packagePath: string): Promise<void> {
      await invoke('apply_pacman_update', { packagePath });
    },

    // Dialog operations
    async selectFolder(): Promise<string | null> {
      try {
        return await invoke<string | null>('select_folder');
      } catch {
        return null;
      }
    },

    async saveFileDialog(config: { defaultName: string; content: string }): Promise<{ success: boolean; path?: string; canceled: boolean; error?: string }> {
      try {
        return await invoke('save_file_dialog', { config });
      } catch (error: any) {
        return { success: false, canceled: false, error: error?.message || String(error) };
      }
    },

    // Window controls
    minimize(): void {
      invoke('minimize_window').catch(console.error);
    },

    maximize(): void {
      invoke('maximize_window').catch(console.error);
    },

    close(): void {
      invoke('close_window').catch(console.error);
    },
  };
}
