import { ipcRenderer, contextBridge } from 'electron'

// Only allow listening to known event channels — never expose raw send/invoke,
// which would let any renderer code call arbitrary IPC handlers.
const ALLOWED_EVENT_CHANNELS = new Set(['main-process-message', 'download-progress'])

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    if (!ALLOWED_EVENT_CHANNELS.has(channel)) return
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    if (!ALLOWED_EVENT_CHANNELS.has(channel)) return
    return ipcRenderer.off(channel, ...omit)
  },
})

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('dialog:openDirectory'),
  getDefaultPath: () => ipcRenderer.invoke('fs:getDefaultPath'),
  readDirectory: (path: string) => ipcRenderer.invoke('fs:readDirectory', path),
  createDirectory: (path: string) => ipcRenderer.invoke('fs:createDirectory', path),
  deleteDirectory: (path: string) => ipcRenderer.invoke('fs:deleteDirectory', path),
  writeFile: (config: { path: string, content: string }) => ipcRenderer.invoke('fs:writeFile', config),
  downloadFile: (config: { url: string, folderPath: string, fileName: string, headers?: any }) => ipcRenderer.invoke('fs:downloadFile', config),
  request: (config: any) => ipcRenderer.invoke('api:request', config),
  downloadToTemp: (config: { url: string, headers?: any, extension?: string }) => ipcRenderer.invoke('api:downloadToTemp', config),
  
  openOidcWindow: (authorizeUrl: string, redirectPrefix: string) => ipcRenderer.invoke('oidc:openWindow', { authorizeUrl, redirectPrefix }),

  secretSet: (key: string, value: string) => ipcRenderer.invoke('secret:set', { key, value }),
  secretGet: (key: string) => ipcRenderer.invoke('secret:get', key),
  secretDelete: (key: string) => ipcRenderer.invoke('secret:delete', key),

  getCachePath: () => ipcRenderer.invoke('fs:getCachePath'),
  fileExists: (path: string) => ipcRenderer.invoke('fs:fileExists', path),
  deleteFile: (path: string) => ipcRenderer.invoke('fs:deleteFile', path),
  clearCache: () => ipcRenderer.invoke('fs:clearCache'),

  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
})