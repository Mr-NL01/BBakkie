const CACHE_NAME = "inner-clock-v6";

const ASSETS = [
  "./",
  "index.html",
  "css/styles.css",
  "js/config.js",
  "js/engine.js",
  "js/ui.js",
  "js/main.js",
  "mexen.html",
  "css/mexen.css",
  "js/mexen/config.js",
  "js/mexen/engine.js",
  "js/mexen/ui.js",
  "js/mexen/main.js",
  "manifest.webmanifest",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Cache-first: static files only, no push, no background sync.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
