// service-worker.js

const CACHE_NAME = 'paytrack-v2';
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/script.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js'
];

// Install: cache all core assets, but don’t fail on single errors
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        FILES_TO_CACHE.map(url => cache.add(url))
      )
    )
  );
  self.skipWaiting();
});

// Activate: remove old caches
self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch handler: route requests by type
self.addEventListener('fetch', evt => {
  const req = evt.request;
  const url = new URL(req.url);

  // 1) Navigation (HTML pages): network-first, fallback to cache
  if (req.mode === 'navigate') {
    evt.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2) Shell assets (your pre-cached files): cache-first
  if (FILES_TO_CACHE.some(path =>
        path === url.pathname || path === req.url
      )) {
    evt.respondWith(
      caches.match(req).then(cached => cached || fetch(req))
    );
    return;
  }

  // 3) API or dynamic JSON (adjust path as needed): network-first, then cache
  if (url.pathname.startsWith('/api/')) {
    evt.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 4) All else: just go to network
  evt.respondWith(fetch(req));
});
