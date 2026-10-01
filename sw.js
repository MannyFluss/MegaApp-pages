const VERSION = "megaapp-shell-v9";
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
  "./src/intro.js",
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
  "./reading/care-and-consequence.html",
];
const urls = new Set(ASSETS.map((p) => new URL(p, self.location).href));
// A new shell must not inherit still-fresh HTTP responses from the old app.
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) =>
        cache.addAll(
          [...urls].map((url) => new Request(url, { cache: "reload" })),
        ),
      ),
  ),
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
        // Revalidate online assets; the shell cache still handles offline use.
        const response = await fetch(event.request, { cache: "no-cache" });
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
