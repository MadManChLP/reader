import { app, BrowserWindow, ipcMain, dialog, protocol, net, safeStorage, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import axios from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import { pathToFileURL } from 'node:url'

// Fix for AMD/NVIDIA GPU rendering issues
app.disableHardwareAcceleration()

// Register protocol
protocol.registerSchemesAsPrivileged([
  { scheme: 'book-file', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } }
])

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

import https from 'node:https'

// Setup Axios with Cookie Jar for Session Management.
// SSL certificates are validated by default. For self-hosted servers with
// self-signed certificates, requests can pass `allowInsecureSsl: true` to use
// the insecure client (mirrors the Tauri backend's secure/insecure client split).
const jar = new CookieJar()
const client = wrapper(axios.create({ jar }))
const insecureClient = wrapper(axios.create({
  jar,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
}))

function pickClient(allowInsecureSsl?: boolean) {
  return allowInsecureSsl ? insecureClient : client
}

// ─── Filesystem path allowlist ──────────────────────────────────────────────
// The renderer can request arbitrary paths over IPC and via the book-file://
// protocol. Restrict access to known-safe roots to prevent path traversal.
// Folders the user explicitly picks via the folder dialog are added to the
// allowlist and persisted across sessions.

const userAllowedRootsFile = () => path.join(app.getPath('userData'), 'allowed-dirs.json')
let userAllowedRoots: string[] = []

async function loadUserAllowedRoots() {
  try {
    userAllowedRoots = JSON.parse(await fs.readFile(userAllowedRootsFile(), 'utf-8'))
    if (!Array.isArray(userAllowedRoots)) userAllowedRoots = []
  } catch {
    userAllowedRoots = []
  }
}

async function addUserAllowedRoot(dir: string) {
  const resolved = path.resolve(dir)
  if (!userAllowedRoots.includes(resolved)) {
    userAllowedRoots.push(resolved)
    try {
      await fs.writeFile(userAllowedRootsFile(), JSON.stringify(userAllowedRoots), 'utf-8')
    } catch (e) {
      console.error('Failed to persist allowed dirs:', e)
    }
  }
}

function getAllowedRoots(): string[] {
  return [
    app.getPath('userData'),
    app.getPath('documents'),
    app.getPath('downloads'),
    path.join(app.getPath('temp'), 'reader-cache'),
    path.join(process.cwd(), 'dl'),
    path.join(process.cwd(), 'cover-cache'),
    ...userAllowedRoots,
  ]
}

function isPathSafe(p: string): boolean {
  const normalize = (s: string) =>
    process.platform === 'win32' ? path.resolve(s).toLowerCase() : path.resolve(s)
  const resolved = normalize(p)
  return getAllowedRoots().some((root) => {
    const r = normalize(root)
    return resolved === r || resolved.startsWith(r + path.sep)
  })
}

const ACCESS_DENIED = { success: false, error: 'Access denied: Path is outside allowed directories' }

let win: BrowserWindow | null

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// ─── Window state persistence ───────────────────────────────────────────────
// Restore size/position (incl. which monitor), maximized and fullscreen state
// across restarts. Mirrors tauri-plugin-window-state on the Tauri backend.

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized?: boolean
  isFullScreen?: boolean
}

const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState(): WindowState {
  const fallback: WindowState = { width: 1200, height: 800 }
  try {
    const state: WindowState = JSON.parse(readFileSync(windowStateFile(), 'utf-8'))
    if (typeof state.width !== 'number' || typeof state.height !== 'number') return fallback
    // Only restore the position if it is still on a connected display
    // (the saved monitor may have been unplugged since last run)
    if (typeof state.x === 'number' && typeof state.y === 'number') {
      const visible = screen.getAllDisplays().some(({ workArea }) =>
        state.x! + state.width > workArea.x &&
        state.x! < workArea.x + workArea.width &&
        state.y! + state.height > workArea.y &&
        state.y! < workArea.y + workArea.height
      )
      if (!visible) {
        delete state.x
        delete state.y
      }
    }
    return state
  } catch {
    return fallback
  }
}

function saveWindowState(w: BrowserWindow) {
  try {
    // getNormalBounds() = the un-maximized geometry, so restoring maximized →
    // un-maximize lands on the remembered size instead of the screen size
    const bounds = w.getNormalBounds()
    const state: WindowState = {
      ...bounds,
      isMaximized: w.isMaximized(),
      isFullScreen: w.isFullScreen(),
    }
    writeFileSync(windowStateFile(), JSON.stringify(state), 'utf-8')
  } catch (e) {
    console.error('Failed to save window state:', e)
  }
}

function createWindow() {
  const windowState = loadWindowState()

  win = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    frame: true, // Enabled for standard title bar
    backgroundColor: '#1e1e1e',
    icon: path.join(process.env.VITE_PUBLIC!, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // webSecurity stays enabled: all HTTP goes through the main process (api:request),
      // and local files are served via the privileged book-file:// protocol.
    },
    autoHideMenuBar: true,
  })

  if (windowState.isFullScreen) {
    win.setFullScreen(true)
  } else if (windowState.isMaximized) {
    win.maximize()
  }

  // Persist geometry on close ('close' fires before the window is destroyed,
  // so bounds/maximized/fullscreen are still readable)
  win.on('close', () => {
    if (win) saveWindowState(win)
  })

  // Handle book-file protocol
  protocol.handle('book-file', (request) => {
    try {
      const url = new URL(request.url)
      let filePath = url.pathname
      
      if (process.platform === 'win32') {
        // Remove leading slash from pathname if it precedes a drive letter (e.g. /C:/...)
        if (filePath.startsWith('/') && /^\/[a-zA-Z]:/.test(filePath)) {
          filePath = filePath.slice(1)
        }
        
        // If hostname exists and looks like a drive letter (e.g. book-file://c/Users/...), prepend it
        // This happens if the colon was stripped or interpreted as part of the host
        if (url.hostname && /^[a-zA-Z]$/.test(url.hostname)) {
           filePath = `${url.hostname}:${filePath}`
        }
      }
      
      // Decode any URI encoded characters (e.g. %20 -> space)
      filePath = decodeURIComponent(filePath)

      // Normalize path separators
      filePath = path.normalize(filePath)

      // Security check: only serve files from allowed directories
      if (!isPathSafe(filePath)) {
        console.error('Protocol: access denied for path:', filePath)
        return new Response('Access denied', { status: 403 })
      }

      return net.fetch(pathToFileURL(filePath).toString())
    } catch (e) {
      console.error("Protocol error", e)
      return new Response("File not found", { status: 404 })
    }
  })

  // win.webContents.openDevTools() // Disabled by default for production feel
  // win.webContents.openDevTools()


  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(process.env.DIST, 'index.html'))
  }
}

// --- IPC HANDLERS ---

// HTTP Request Handler (Bypass CORS)
ipcMain.handle('api:request', async (_, { method, url, data, headers, responseType, allowInsecureSsl, followRedirects }) => {
  try {
    const config: any = {
      method,
      url,
      data,
      headers,
      withCredentials: true,
      validateStatus: () => true // Resolve all status codes
    }

    if (responseType === 'arraybuffer') {
      config.responseType = 'arraybuffer'
    }

    // OIDC flows need to see 3xx responses (Location header) instead of
    // following them. The cookie jar is shared, so cookies still persist.
    if (followRedirects === false) {
      config.maxRedirects = 0
    }

    const response = await pickClient(allowInsecureSsl).request(config)
    
    let responseData = response.data
    // If arraybuffer, convert to base64 to pass over IPC
    if (responseType === 'arraybuffer') {
      responseData = Buffer.from(response.data).toString('base64')
    }

    return {
      success: response.status >= 200 && response.status < 300,
      data: responseData,
      status: response.status,
      headers: response.headers
    }
  } catch (error: any) {
    console.error('API Request Failed:', error.message)
    return {
      success: false,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    }
  }
})

// OIDC login window: opens authorizeUrl in a child window and resolves with the
// full callback URL once it navigates to redirectPrefix (navigation is blocked).
// Resolves null if the user closes the window or the login times out (5 min).
ipcMain.handle('oidc:openWindow', async (_, { authorizeUrl, redirectPrefix }) => {
  if (typeof authorizeUrl !== 'string' || !/^https?:\/\//.test(authorizeUrl)) return null
  if (typeof redirectPrefix !== 'string' || !redirectPrefix) return null

  return new Promise<string | null>((resolve) => {
    let settled = false
    const authWin = new BrowserWindow({
      width: 480,
      height: 720,
      parent: win ?? undefined,
      autoHideMenuBar: true,
      title: 'Anmelden',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const finish = (result: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
      if (!authWin.isDestroyed()) authWin.close()
    }

    const timeout = setTimeout(() => finish(null), 5 * 60 * 1000)

    const checkUrl = (event: Electron.Event, url: string) => {
      if (url.startsWith(redirectPrefix)) {
        event.preventDefault()
        finish(url)
      }
    }
    authWin.webContents.on('will-redirect', checkUrl)
    authWin.webContents.on('will-navigate', checkUrl)
    authWin.on('closed', () => finish(null))

    authWin.loadURL(authorizeUrl).catch(() => finish(null))
  })
})

// Download remote file to temp and return local path (avoids OOM for large files)
ipcMain.handle('api:downloadToTemp', async (_, { url, headers, extension, allowInsecureSsl }) => {
  try {
    const tempDir = path.join(app.getPath('temp'), 'reader-cache')
    await fs.mkdir(tempDir, { recursive: true })

    // Only use the extension part, never path segments from the caller
    const safeExt = String(extension || 'bin').replace(/[^a-zA-Z0-9]/g, '') || 'bin'
    const fileName = `dl_${Date.now()}.${safeExt}`
    const filePath = path.join(tempDir, fileName)

    const response = await pickClient(allowInsecureSsl).get(url, {
      headers,
      responseType: 'stream',
      withCredentials: true,
      validateStatus: () => true,
    })

    if (response.status < 200 || response.status >= 300) {
      return { success: false, status: response.status, error: `HTTP ${response.status}` }
    }

    const stream = response.data
    await pipeline(stream, createWriteStream(filePath))

    return { success: true, path: filePath, status: response.status }
  } catch (error: any) {
    console.error('Download to temp failed:', error.message)
    return { success: false, error: error.message, status: error.response?.status }
  }
})

// Read Local File
ipcMain.handle('fs:readFile', async (_, filePath: string) => {
  if (!isPathSafe(filePath)) return ACCESS_DENIED
  try {
    // Check if file exists first
    await fs.access(filePath)
    const content = await fs.readFile(filePath)
    // Return as base64
    return { success: true, data: content.toString('base64') }
  } catch (error: any) {
    console.error('Read File Failed:', error)
    return { success: false, error: error.message }
  }
})

// Open Directory Dialog
ipcMain.handle('dialog:openDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory']
  })
  if (canceled) {
    return null
  } else {
    // User explicitly chose this folder — add it to the filesystem allowlist
    await addUserAllowedRoot(filePaths[0])
    return filePaths[0]
  }
})

// Get Default Path
ipcMain.handle('fs:getDefaultPath', () => {
  const documentsPath = app.getPath('documents')
  return path.join(documentsPath, 'Calibre Reader Library')
})

// Read Directory Content (Enhanced for Folders + Metadata)
ipcMain.handle('fs:readDirectory', async (_, dirPath: string) => {
  if (!isPathSafe(dirPath)) return []
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const books = []

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      
      if (entry.isFile()) {
        // Flat file support
        if (/\.(epub|pdf|cbr|cbz)$/i.test(entry.name)) {
          books.push({
            name: entry.name,
            path: fullPath,
            type: 'local',
            cover: '', // No cover for flat files usually unless sidecar
            metadata: null
          })
        }
      } else if (entry.isDirectory()) {
        // Folder support (check for book file + metadata)
        try {
          const subEntries = await fs.readdir(fullPath)
          const bookFile = subEntries.find(f => /\.(epub|pdf|cbr|cbz)$/i.test(f))
          const coverFile = subEntries.find(f => /^cover\.(jpg|jpeg|png)$/i.test(f))
          const metadataFile = subEntries.find(f => f === 'metadata.json')

          if (bookFile) {
            let metadata = null
            let title = bookFile
            let author = ''

            if (metadataFile) {
              try {
                const metaContent = await fs.readFile(path.join(fullPath, 'metadata.json'), 'utf-8')
                metadata = JSON.parse(metaContent)
                title = metadata.title || title
                author = metadata.author || ''
              } catch (e) {
                console.error("Failed to read metadata", e)
              }
            }

            books.push({
              name: title,
              path: path.join(fullPath, bookFile),
              type: 'local',
              cover: coverFile ? `book-file://${path.join(fullPath, coverFile).replace(/\\/g, '/')}` : '',
              author,
              metadata
            })
          }
        } catch (e) {
          // Ignore empty or unreadable folders
        }
      }
    }
    return books
  } catch (err) {
    console.error('Failed to read directory:', err)
    return []
  }
})

// Create Directory
ipcMain.handle('fs:createDirectory', async (_, dirPath: string) => {
  if (!isPathSafe(dirPath)) return ACCESS_DENIED
  try {
    await fs.mkdir(dirPath, { recursive: true })
    return { success: true }
  } catch (error: any) {
     return { success: false, error: error.message }
  }
})

// Delete Directory
ipcMain.handle('fs:deleteDirectory', async (_, dirPath: string) => {
  if (!isPathSafe(dirPath)) return ACCESS_DENIED
  try {
    await fs.rm(dirPath, { recursive: true, force: true })
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// Write Text File
ipcMain.handle('fs:writeFile', async (_, { path: filePath, content }) => {
  if (!isPathSafe(filePath)) return ACCESS_DENIED
  try {
    await fs.writeFile(filePath, content, 'utf-8')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// Get Cache Path
ipcMain.handle('fs:getCachePath', () => {
  // User requested installation/project directory
  return path.join(process.cwd(), 'cover-cache')
})

// Check File Exists
ipcMain.handle('fs:fileExists', async (_, filePath: string) => {
  if (!isPathSafe(filePath)) return false
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
})

// Delete File
ipcMain.handle('fs:deleteFile', async (_, filePath: string) => {
  if (!isPathSafe(filePath)) return ACCESS_DENIED
  try {
    await fs.unlink(filePath)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// Clear Cache
ipcMain.handle('fs:clearCache', async () => {
  try {
    const cacheDir = path.join(app.getPath('userData'), 'cover-cache')
    await fs.rm(cacheDir, { recursive: true, force: true })
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// Download File Handler (streams to disk to avoid OOM on large files)
ipcMain.handle('fs:downloadFile', async (_, { url, folderPath, fileName, headers, allowInsecureSsl }) => {
  try {
    const filePath = path.join(folderPath, fileName)
    if (!isPathSafe(filePath)) return ACCESS_DENIED
    await fs.mkdir(folderPath, { recursive: true })
    const response = await pickClient(allowInsecureSsl).get(url, {
      responseType: 'stream',
      headers
    })
    await pipeline(response.data, createWriteStream(filePath))
    return { success: true, path: filePath }
  } catch (error: any) {
    console.error('Download failed:', error.message)
    return { success: false, error: error.message }
  }
})

// ─── Secret storage (OS-encrypted via Electron safeStorage) ─────────────────
// Secrets are encrypted with the OS user's key (DPAPI on Windows) and stored
// in userData/secrets.json. Never stored in plaintext.

const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json')

async function readSecretsFile(): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await fs.readFile(secretsFile(), 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

ipcMain.handle('secret:set', async (_, { key, value }: { key: string; value: string }) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: 'OS encryption not available' }
    }
    const secrets = await readSecretsFile()
    secrets[key] = safeStorage.encryptString(value).toString('base64')
    await fs.writeFile(secretsFile(), JSON.stringify(secrets), 'utf-8')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('secret:get', async (_, key: string) => {
  try {
    const secrets = await readSecretsFile()
    const encrypted = secrets[key]
    if (!encrypted) return null
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch (error: any) {
    console.error('secret:get failed:', error.message)
    return null
  }
})

ipcMain.handle('secret:delete', async (_, key: string) => {
  try {
    const secrets = await readSecretsFile()
    if (key in secrets) {
      delete secrets[key]
      await fs.writeFile(secretsFile(), JSON.stringify(secrets), 'utf-8')
    }
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// Window Controls
ipcMain.on('window:minimize', () => win?.minimize())
ipcMain.on('window:maximize', () => {
  if (win?.isMaximized()) {
    win.unmaximize()
  } else {
    win?.maximize()
  }
})
ipcMain.on('window:close', () => win?.close())

// --------------------

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  await loadUserAllowedRoots()
  createWindow()
})
