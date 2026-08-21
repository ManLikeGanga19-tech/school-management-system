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
