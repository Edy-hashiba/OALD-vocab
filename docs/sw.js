/*
 * Offline shell for the web app.
 *
 * HTML is network-first so a deploy is picked up immediately - a cache-first
 * page is the classic reason "my changes aren't showing up". Static assets are
 * cache-first but revalidated in the background. Cross-origin requests (the
 * Google sign-in library, OALD audio and illustrations) are never cached.
 */
const VERSION = 'v1';
const SHELL = 'oald-shell-' + VERSION;

const ASSETS = [
  './',
  'index.html',
  'review.css',
  'mobile.css',
  'db.js',
  'quiz.js',
  'review.js',
  'sync.js',
  'web.js',
  'config.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // Google, OALD media: straight to network

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((hit) => {
      const net = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
