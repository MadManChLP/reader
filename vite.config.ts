import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// Detect build target from environment
const isTauri = process.env.TAURI_PLATFORM !== undefined || process.env.TAURI_DEV === 'true'
const isElectron = !isTauri

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Only include Electron plugin when building for Electron
    ...(isElectron ? [
      electron({
        main: {
          // Shortcut of `build.lib.entry`.
          entry: 'electron/main.ts',
        },
        preload: {
          // Shortcut of `build.rollupOptions.input`.
          // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
          input: 'electron/preload.ts',
          vite: {
            build: {
              rollupOptions: {
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].cjs',
                },
              },
            },
          },
        },
        // Ployfill the Electron and Node.js built-in modules for Renderer process.
        // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        renderer: {},
      }),
    ] : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Configure for Tauri
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/calibre/**', '**/.git/**', '**/node_modules/**', '**/src-tauri/**', '**/dl/**'],
      usePolling: false, // Ensure we use native events which are faster
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  // Workers must use ES module format when code-splitting (manualChunks) is active.
  // jassub and pdfjs-dist both embed web workers; IIFE format is rejected by Rollup
  // when multiple output chunks are being produced.
  worker: {
    format: 'es',
  },
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: isTauri ? ['es2021', 'chrome100', 'safari14'] : 'esnext',
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        // Split large vendor libraries into separate chunks.
        // This keeps the initial JS bundle lean and allows the browser/WebView
        // to cache stable vendor chunks independently across app updates.
        manualChunks: {
          // Core React runtime — always needed immediately
          'vendor-react': ['react', 'react-dom'],
          // Jellyfin SDK — only needed when Jellyfin/JellyMusic views load
          'vendor-jellyfin': ['@jellyfin/sdk'],
          // Reader engines — loaded lazily when a book is opened
          'vendor-epub': ['epubjs'],
          'vendor-manga': ['jszip', 'node-unrar-js'],
          'vendor-pdf': ['react-pdf', 'pdfjs-dist'],
          // Subtitle renderers — loaded lazily with the video player
          'vendor-subs': ['jassub', 'libpgs'],
        },
      },
    },
  },
})
