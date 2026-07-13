// Caches the static app shell so the PWA opens offline. Worker API requests
// always go to the network (never cached). Bump CACHE on any change to
// index.html, css/, or js/*.js — installed clients keep the old files otherwise.
const CACHE = 'mirage-v1';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only serve the local shell from cache; everything else (the Worker,
  // Google Fonts) hits the network.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
