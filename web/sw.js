const CACHE = "entrenador-__CACHE_VERSION__";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.url.includes("supabase.co")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
