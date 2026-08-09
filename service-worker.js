// Caches the static app shell so the PWA opens offline. Worker API requests
// always go to the network (never cached).
//
// The cache name derives from MIRAGE_VERSION (js/version.js) — the same
// constant the UI displays — so bumping that one string is all it takes to
// retire the old shell. Nothing to bump here.
importScripts('./js/version.js');

const CACHE = 'mirage-v' + self.MIRAGE_VERSION;
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/version.js',
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
