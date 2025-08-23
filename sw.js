// sw (v1) for exam practice demo
const CACHE = 'exam-practice-v67'; // 🔹 Bump version to v10 so old cache is replaced

self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll([
            './',
            './index.html',
            './questions.json?v=img67', // 🔹 Also bump query param to force reload of JSON
            './images/beam_ud1.png',
            './images/Vu_m.png',
            './images/vu1.jpeg',
            './images/vu2.jpeg',
            './images/vu3.jpeg',
            './images/vu4.jpg',
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
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(r => r || fetch(e.request))
    );
});
