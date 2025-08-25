// sw.js — shell precache + runtime cache for ALL images
const SHELL_CACHE = 'exam-shell-v49d69ef';
const IMG_CACHE   = 'exam-img-v49d69ef';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) =>
      c.addAll(['./','./index.html'])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, IMG_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trimCache(cacheName, maxEntries = 1500) {
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();
  if (keys.length > maxEntries) {
    await cache.delete(keys[0]);
    return trimCache(cacheName, maxEntries);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.destination === 'image') {
    e.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit   = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
          cache.put(req, res.clone());
          trimCache(IMG_CACHE, 1500);
        }
        return res;
      } catch {
        return new Response('Image fetch failed', { status: 504 });
      }
    })());
  }
});
