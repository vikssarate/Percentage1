// sw.js — shell precache + runtime cache for ALL images

// No more manual bumps: your CI adds ?v=<SHA> to questions.json in index.html.
// Keep this a simple, stable name.
const SHELL_CACHE = 'exam-shell-v1';
const IMG_CACHE   = 'exam-img-v1';

// Pre-cache only the tiny app shell (NOT questions.json)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll([
        './',          // GitHub Pages root
        './index.html', // shell only; questions.json is fetched with a versioned URL
        './questions.json'
      ])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, IMG_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Keep the image cache from growing forever (FIFO-ish)
async function trimCache(cacheName, maxEntries = 1500) {
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();
  if (keys.length > maxEntries) {
    await cache.delete(keys[0]);            // delete oldest
    return trimCache(cacheName, maxEntries); // keep trimming until under cap
  }
}

// Runtime caching: cache-first for ALL images
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.destination === 'image') {
    event.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit   = await cache.match(req);
      if (hit) return hit;                  // serve cached (offline)

      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          cache.put(req, res.clone());
          trimCache(IMG_CACHE, 1500);
        }
        return res;
      } catch {
        return new Response('Image fetch failed', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
    return;
  }

  // Default: let the browser handle non-image requests normally
});
