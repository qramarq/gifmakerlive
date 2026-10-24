// Precache is relative to this file so a subpath deploy only controls that folder.
const CACHE = "gifmaker-live-dev";
const PRECACHE = [
  "./",
  "./index.html",
  "./privacy.html",
  "./settings.html",
  "./studio.css",
  "./studio.js",
  "./video-editor.js",
  "./gif-encoder.js",
  "./motion.js",
  "./video-gif.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

async function purgeOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(path => cache.add(new Request(path, {cache: "reload"}))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(purgeOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  if (!url.href.startsWith(self.registration.scope)) return;
  if (request.headers.has("range")) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (request.mode === "navigate") {
      try {
        const fresh = await fetch(request);
        if (fresh.ok && fresh.type === "basic") await cache.put(request, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(request) || await cache.match("./index.html") || await cache.match("./");
        return cached || Response.error();
      }
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      if (fresh.ok && fresh.type === "basic" && !url.pathname.endsWith("/sw.js")) await cache.put(request, fresh.clone());
      return fresh;
    } catch {
      return Response.error();
    }
  })());
});
