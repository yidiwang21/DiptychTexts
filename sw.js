// sw.js — DiptychTexts service worker
// Caches the app shell so the UI loads even without a network connection.
// File System Access API still requires the app to run from a real origin
// (localhost or HTTPS), so the SW is mainly useful for faster startup and
// offline resilience of the app shell itself (not user files, which live on
// disk and are accessed via the File System Access API).

const CACHE_NAME = 'diptych-v0.9.5';

// All the static assets that make up the app shell.
// Note: './' is intentionally omitted — it can return a redirect rather than
// a clean 200, which would cause cache.addAll() to throw and abort the install.
const APP_SHELL = [
    './index.html',
    './style.css',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/favicon-32.png',
    './js/main.js',
    './js/state.js',
    './js/project_manager.js',
    './js/file_system.js',
    './js/ui_editor.js',
    './js/ui_sidebar.js',
    './js/ui_find_replace.js',
    './js/ui_print.js',
    './js/shortcuts.js',
    './js/ui_shortcuts.js',
];


// ── Install: pre-cache the app shell ──────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())   // activate immediately
    );
});


// ── Activate: remove old caches ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME)
                    .map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())  // take control immediately
    );
});


// ── Fetch: cache-first for app shell, network-only for everything else ─────────
self.addEventListener('fetch', (event) => {
    // Only handle GET requests for our own origin.
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request)
            .then(cached => {
                if (cached) return cached;
                // Not in cache — fetch from network and cache for next time.
                return fetch(event.request).then(response => {
                    if (!response || response.status !== 200) return response;
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                    return response;
                });
            })
    );
});
