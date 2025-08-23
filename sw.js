const CACHE = 'exam-practice-v73';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll([
      './',
      './index.html',
      './questions.json',            // << no query
      './images/vu1.jpeg',
      './images/vu2.jpeg',
      './images/vu3.jpeg',
      './images/vu4.jpeg',
      './images/vu5.jpg',
      './images/vu6.jpg',
      './images/vu7.jpg'
    ]))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request /*, { ignoreSearch: true }*/).then(r => r || fetch(e.request))
  );
});
