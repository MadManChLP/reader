// ==UserScript==
// @name         Calibre-Web Auto-Save Progress
// @namespace    https://github.com/anthropics/calibre-reader
// @version      1.0.0
// @description  Automatically saves reading progress in Calibre-Web's EPUB reader (no manual bookmark clicks needed)
// @author       Calibre Reader Desktop App
// @match        */read/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const SAVE_DELAY_MS = 2000;  // Wait 2 seconds after page turn before saving
    const DEBUG = false;

    function log(...args) {
        if (DEBUG) console.log('[CW-AutoSave]', ...args);
    }

    // Wait for epub.js rendition to be available
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds max wait

    const interval = setInterval(() => {
        attempts++;

        // Check for rendition object (epub.js)
        if (window.rendition) {
            clearInterval(interval);
            log('Found rendition, setting up auto-save');
            setupAutoSave();
            return;
        }

        // Also check for reader object
        if (window.reader && window.reader.rendition) {
            clearInterval(interval);
            log('Found reader.rendition, setting up auto-save');
            setupAutoSave(window.reader.rendition);
            return;
        }

        if (attempts >= maxAttempts) {
            clearInterval(interval);
            log('Gave up waiting for rendition');
        }
    }, 500);

    function setupAutoSave(renditionOverride) {
        const rendition = renditionOverride || window.rendition;
        let lastCfi = null;
        let saveTimeout = null;

        rendition.on('relocated', (location) => {
            const cfi = location.start.cfi;

            if (cfi && cfi !== lastCfi) {
                lastCfi = cfi;
                log('Location changed:', cfi);

                // Debounce: save after delay of no page turns
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(() => {
                    saveBookmark(cfi);
                }, SAVE_DELAY_MS);
            }
        });

        log('Auto-save listener attached');

        // Also save on page unload
        window.addEventListener('beforeunload', () => {
            if (lastCfi) {
                saveBookmark(lastCfi, true);
            }
        });
    }

    function saveBookmark(cfi, sync = false) {
        // Extract book ID and format from URL: /read/<bookId>/<format>
        const match = window.location.pathname.match(/\/read\/(\d+)\/(\w+)/);
        if (!match) {
            log('Could not parse book ID from URL');
            return;
        }

        const [, bookId, format] = match;

        // Get CSRF token from page
        const csrfToken = getCSRFToken();

        const url = `/ajax/bookmark/${bookId}/${format}`;
        const body = `bookmark=${encodeURIComponent(cfi)}`;

        log('Saving bookmark:', { bookId, format, cfi: cfi.substring(0, 50) + '...' });

        // Use sendBeacon for sync saves (on page unload)
        if (sync && navigator.sendBeacon) {
            const formData = new FormData();
            formData.append('bookmark', cfi);
            if (csrfToken) {
                formData.append('csrf_token', csrfToken);
            }
            navigator.sendBeacon(url, formData);
            return;
        }

        // Regular fetch for normal saves
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
            },
            body: body,
            credentials: 'same-origin',
        })
        .then(response => {
            if (response.ok) {
                log('Bookmark saved successfully');
            } else {
                log('Failed to save bookmark:', response.status);
            }
        })
        .catch(error => {
            log('Error saving bookmark:', error);
        });
    }

    function getCSRFToken() {
        // Try hidden input field
        const input = document.querySelector('input[name="csrf_token"]');
        if (input) return input.value;

        // Try meta tag
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) return meta.getAttribute('content');

        // Try cookie
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'csrf_token' || name === 'csrf_access_token') {
                return decodeURIComponent(value);
            }
        }

        return null;
    }

    log('Calibre-Web Auto-Save script loaded');
})();
