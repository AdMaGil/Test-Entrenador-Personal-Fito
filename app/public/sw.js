// Service worker mínimo para que la app sea instalable y arranque rápido.
// Solo gestiona peticiones GET del mismo origen (la app). Las llamadas a
// Supabase y Intervals (otro origen) y a los mapas NO pasan por aquí, así que
// los datos siempre vienen de la red y nunca se sirven desactualizados.
const CACHE = "adolfo-training-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // Había cachés de otra versión (p. ej. el panel antiguo, que servía su
    // index.html desde caché para siempre): se borran y se recargan las
    // pestañas abiertas para que muestren la app actual sin tocar nada.
    const hadOld = keys.some((k) => k !== CACHE);
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    if (hadOld) {
      const wins = await self.clients.matchAll({ type: "window" });
      wins.forEach((w) => w.navigate(w.url).catch(() => {}));
    }
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Páginas (index.html): red primero, caché como respaldo sin conexión.
  // Así cada despliegue nuevo se ve al abrir la app con red.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match("./"))),
    );
    return;
  }
  // Recursos con hash (JS/CSS/fuentes/iconos): caché primero, se guardan al usarlos.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    })),
  );
});
