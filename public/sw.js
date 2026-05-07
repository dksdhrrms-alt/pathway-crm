// Bump this version on every release that changes the bundled JS chunks
// or the offline page. The `activate` handler below deletes any cache
// whose name doesn't match — so bumping forces installed PWAs (e.g. on
// users' phone home screens) to refresh their cached HTML and force
// browsers to re-fetch chunks. Without this, mobile PWAs can keep
// serving an older UI long after the production deploy.
const CACHE_NAME = 'pi-crm-v2';
const OFFLINE_URL = '/offline';

const PRECACHE_URLS = [
  '/',
  '/dashboard',
  '/offline',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
  }
});
