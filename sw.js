// sw.js  — shell precache + runtime cache for ALL images
const SHELL_CACHE = 'exam-shell-v85';   // bump when index.html / questions.json change
const IMG_CACHE   = 'exam-img-v1';      // bump if you want to flush image cache

// Pre-cache the app shell (small, critical files only)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(c =>
      c.addAll([
        './',                 // GitHub Pages root of this app
        './index.html',
        './questions.json',   // you already version it with ?v=..., still fine to keep here
      ])
    )
  );
  self.skipWaiting();
});

// Clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, IMG_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Helper: keep image cache from growing forever (FIFO-ish)
async function trimCache(cacheName, maxEntries = 1500) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    // delete oldest until under the cap
    await cache.delete(keys[0]);
    return trimCache(cacheName, maxEntries);
  }
}

// Runtime caching:
// - For any request where request.destination === 'image':
//   cache-first: return cached if present; else fetch, store, return.
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Cache ALL images on-demand
  if (req.destination === 'image') {
    e.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;               // offline after first view

      try {
        const res = await fetch(req, { cache: 'no-store' });
        // only cache OK responses (not errors/opaques without CORS)
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          cache.put(req, res.clone());
          trimCache(IMG_CACHE, 1500);    // adjust cap if needed
        }
        return res;
      } catch (err) {
        // Network failed and not cached -> let it fail (or return a fallback image if you add one)
        return new Response('Image fetch failed', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
    return;
  }

  // Default: let the browser handle other requests normally.
});
