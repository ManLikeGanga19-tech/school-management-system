"use client";

import { useEffect } from "react";

/**
 * Registers the service worker so the app is an installable PWA (standalone),
 * not just a home-screen shortcut. Runs once on mount, after load, so it never
 * competes with the initial render. The worker itself (public/sw.js) only
 * caches immutable static assets — never HTML or /api — so multi-tenant/auth
 * behaviour is unaffected.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const host = window.location.hostname;
    const isDev =
      process.env.NODE_ENV !== "production" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".localhost");

    // In DEV a service worker caches build chunks and then serves STALE ones on
    // reload — the app appears to "revert to the old UI". So never run it in dev,
    // and actively tear down any worker + caches a previous run installed.
    if (isDev) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
      if (typeof caches !== "undefined") {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
      }
      return;
    }

    const register = () => {
      // Served from /api/sw (WAF-excluded); scope "/" via Service-Worker-Allowed.
      navigator.serviceWorker.register("/api/sw", { scope: "/" }).catch(() => {
        /* registration is best-effort; the app works without it */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
