/**
 * Serves the service worker from under /api so it rides the Cloudflare WAF
 * exclusion (/api/* is never challenged) — a SW at a challenged path would 403
 * and never register. The `Service-Worker-Allowed: /` header lets a worker
 * served from /api/sw still control the whole origin (registered with scope "/").
 *
 * The worker caches ONLY immutable static assets — never HTML or /api — so
 * multi-tenant/auth behaviour is unaffected.
 */
const SW_SOURCE = `
const STATIC_CACHE = "shulehq-static-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept HTML navigations or API/auth — always fresh from network.
  if (req.mode === "navigate" || url.pathname.startsWith("/api")) return;
  const isStatic =
    url.pathname.startsWith("/_next/static") ||
    /\\.(?:png|svg|jpg|jpeg|webp|gif|ico|woff2?|ttf|css|js)$/.test(url.pathname);
  if (!isStatic) return;
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  })());
});
`;

export function GET() {
  return new Response(SW_SOURCE, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-cache",
    },
  });
}
