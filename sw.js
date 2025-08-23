const CACHE = 'exam-practice-v76';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll([
        './',
        './index.html',
        './questions.json',            // no query string
        './images/vu1.jpeg',
        './images/vu2.jpeg',
        './images/vu3.jpeg',
        './images/vu4.jpeg',
        './images/vu5.jpg',
        './images/vu6.jpg',
        './images/vu7.jpg',
        './images/vu8.jpg',
        './images/vu9.jpg',
        './images/vu10.jpg',
        './images/vu11.jpg',
        './images/vu12.jpg',
        './images/vu13.jpg',
        './images/vu14.jpg',
        './images/vu15.jpg',
        './images/vu16.jpg',
        './images/vu17.jpg',
        './images/vu18.jpg',
        './images/vu19.jpg',
        './images/vu20.jpg',
        './images/vu21.jpg',
        './images/vu22.jpg',
        './images/vu23.jpg',
        './images/vu24.jpg',
        './images/vu25.jpg',
        './images/vu26.jpg',
        './images/vu27.jpg',
      ])
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
