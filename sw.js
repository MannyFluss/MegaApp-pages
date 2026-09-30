const VERSION = "megaapp-shell-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./src/app.js",
  "./src/canvas.js",
  "./src/marble.js",
  "./src/marble-physics.js",
  "./src/platformer.js",
  "./src/platformer-engine.js",
  "./src/state.js",
  "./src/capabilities.js",
  "./src/probes.js",
  "./src/render-worker.js",
  "./src/audio-worklet.js",
  "./src/webmcp.js",
];
const urls = new Set(ASSETS.map((p) => new URL(p, self.location).href));
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("megaapp-shell-") && key !== VERSION)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  requestUrl.hash = "";
  if (event.request.method !== "GET" || !urls.has(requestUrl.href)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(requestUrl.href, response.clone());
        return response;
      } catch {
        const saved = await cache.match(requestUrl.href);
        if (saved) return saved;
        return new Response(
          "Open MegaApp online once to prepare offline use.",
          { status: 503, headers: { "Content-Type": "text/plain" } },
        );
      }
    })(),
  );
});
