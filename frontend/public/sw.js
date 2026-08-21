/*
 * ShuleHQ service worker.
 *
 * Purpose: make the app an INSTALLABLE PWA (standalone app, not just a home-
 * screen shortcut). Android/Chrome only offer real install once a service
 * worker with a fetch handler is controlling the page.
 *
 * Safety first for a multi-tenant, auth-heavy app: this worker NEVER caches
 * HTML navigations or /api responses — those always hit the network, so one
 * tenant can never be served another's cached page and auth stays live. It
 * only cache-firsts immutable, content-hashed static assets (Next build output,
 * icons, fonts), which are safe because a new build produces new filenames.
 */
const STATIC_CACHE = "shulehq-static-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept HTML navigations or API/auth — always fresh from network.
  if (req.mode === "navigate" || url.pathname.startsWith("/api")) return;

  // Cache-first for immutable static assets only.
  const isStatic =
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icons") ||
    /\.(?:png|svg|jpg|jpeg|webp|gif|ico|woff2?|ttf|css|js)$/.test(url.pathname);
  if (!isStatic) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    })()
  );
});
