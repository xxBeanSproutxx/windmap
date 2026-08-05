const CACHE_NAME = 'blue-lake-wave-v35';
const STATIC_ASSETS = [
  './',
  './lake.html',
  './manifest.json',
  './tailwind.css',
  './js/theme.js',
  './icon-192.png',
  './icon-512.png',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Take over immediately — don't wait for old tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Purge old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  // Claim all clients so the new SW controls pages immediately
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first for HTML — always get the latest (bypass HTTP cache: GitHub
  // Pages sends max-age=600 on HTML, which would otherwise serve stale pages
  // for up to 10 minutes after a deploy)
  if (event.request.destination === 'document' || event.request.url.endsWith('/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Network-only for data — never cache
  if (event.request.url.includes('lake_static') || event.request.url.includes('lake_data') || event.request.url.includes('open-meteo') || event.request.url.includes('data/lakes')) {
    return;
  }

  // Cache-first for static assets (icons, manifest)
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
