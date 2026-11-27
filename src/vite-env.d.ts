/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    DIST: string
    VITE_PUBLIC: string
  }
}

interface Window {
  ipcRenderer: import('electron').IpcRenderer
  // We will expose a cleaner API later, but for now we use direct ipcRenderer or add a custom one
  api: {
    selectFolder: () => Promise<string | null>
    getDefaultPath: () => Promise<string>
    readDirectory: (path: string) => Promise<Array<{name: string, path: string, type: 'local', cover?: string, author?: string, metadata?: any}>>
    createDirectory: (path: string) => Promise<{ success: boolean, error?: string }>
    deleteDirectory: (path: string) => Promise<{ success: boolean, error?: string }>
    writeFile: (config: { path: string, content: string }) => Promise<{ success: boolean, error?: string }>
    downloadFile: (config: { url: string, folderPath: string, fileName: string, headers?: any }) => Promise<{ success: boolean, path?: string, error?: string }>
    request: (config: { method: string, url: string, data?: any, headers?: any, responseType?: string }) => Promise<{ success: boolean, data?: any, error?: string, status?: number }>
    
    // New Cache Methods
    getCachePath: () => Promise<string>
    fileExists: (path: string) => Promise<boolean>
    deleteFile: (path: string) => Promise<{ success: boolean, error?: string }>
    clearCache: () => Promise<void>

    minimize: () => void
    maximize: () => void
    close: () => void
  }
}
