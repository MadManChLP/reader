import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { IS_PHONE } from './utils/api'
import { installDebugCapture } from './utils/debugLog'

// Start capturing console output/errors before anything else runs, so the
// Troubleshooting "Generate Debug Report" button has full session context.
installDebugCapture();

console.log('Main.tsx: Script started');

// Phone-class device: enable the `phone:` Tailwind variant globally and prevent
// iOS Safari's auto-zoom on <16px inputs (desktop/iPad viewport stays untouched).
if (IS_PHONE) {
  document.documentElement.classList.add('phone');
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    viewportMeta.setAttribute('content', `${viewportMeta.getAttribute('content')}, maximum-scale=1.0`);
  }
}

// Safe IPC handling
if (window.ipcRenderer) {
  console.log('Main.tsx: ipcRenderer found');
  window.ipcRenderer.on('main-process-message', (_event, message) => {
    console.log('Message from Main:', message)
  })
} else {
  console.error('Main.tsx: CRITICAL - ipcRenderer is undefined!');
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('Main.tsx: Root element not found');
} else {
  console.log('Main.tsx: Root element found, mounting React...');
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
    console.log('Main.tsx: React mounted successfully');
    
    // Remove loader
    const loader = document.getElementById('loader');
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => loader.remove(), 500);
    }
  } catch (err) {
    console.error('Main.tsx: React mount failed', err);
    const errorHeading = document.createElement('h1');
    errorHeading.style.color = 'red';
    errorHeading.textContent = `React Mount Failed: ${err}`;
    rootElement.replaceChildren(errorHeading);
  }
}

