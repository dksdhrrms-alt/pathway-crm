// Bump this version on every release that changes the bundled JS chunks
// or the offline page. Bumping forces installed PWAs (e.g. on users'
// phone home screens) to install a new SW, which then aggressively
// reloads every controlled window so users automatically see the new UI
// without having to reinstall, force-kill, or tap a refresh link.
//
// How the auto-update works (no user action required):
//   1. User opens PWA. The OLD SW is network-first for navigations, so
//      it fetches fresh HTML from the server.
//   2. The fresh HTML contains an inline script (in app/layout.tsx) that
//      calls registration.update() — this forces the browser to check
//      /sw.js for byte-diffs against what's installed.
//   3. Byte-diff detected (CACHE_NAME changed), browser installs the new
//      SW. install() calls skipWaiting() so it activates immediately.
//   4. activate() below: cleans old caches, claims all clients, then
//      calls WindowClient.navigate(client.url) for every controlled
//      window — forcing every PWA tab/window to reload. After reload the
//      new HTML loads new JS chunks and the user sees the new UI.
//
// Why navigate() and not postMessage + client-side reload: iOS Safari /
// WebKit have known reliability issues with the `controllerchange` event
// inside installed PWAs. WindowClient.navigate() is driven by the SW
// itself and bypasses any client-side listener — much more reliable.
const CACHE_NAME = 'pi-crm-v3';
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
  // Take over without waiting for the old SW to be released.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1) Drop any caches that aren't ours (old versions).
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));

    // 2) Become the controller for every page in scope, including pages
    //    that were loaded under the previous SW.
    await self.clients.claim();

    // 3) Force every controlled window to reload itself. We append a
    //    cache-busting query param so any intermediate proxy/HTTP cache
    //    layer doesn't return a stale entry. The query is harmless —
    //    the app ignores unknown query keys — and only appears once
    //    immediately after a SW upgrade.
    //
    //    This is what makes "next PWA open auto-shows the new version"
    //    work without requiring users to tap a refresh link, force-kill
    //    the app twice, or reinstall the home-screen shortcut.
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        try {
          const url = new URL(client.url);
          // Don't loop: skip if we already added our stamp on this load.
          if (url.searchParams.has('_swrefresh')) continue;
          url.searchParams.set('_swrefresh', String(Date.now()));
          // navigate() is async; ignore individual failures so one bad
          // client doesn't stop the others.
          await client.navigate(url.toString()).catch(() => {});
        } catch {
          // navigate() can throw on cross-origin or detached clients —
          // safe to ignore, those windows aren't ours.
        }
      }
    } catch {
      // matchAll() shouldn't fail, but if it does we still want activate
      // to resolve so the new SW takes over normally.
    }
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
  }
});
