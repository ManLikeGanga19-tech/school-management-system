"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile widget.
 *
 * Renders nothing at all when no siteKey is supplied, so the login form is
 * unchanged until Turnstile is switched on server-side. The site key arrives
 * as a prop from the server component rather than a NEXT_PUBLIC_* build
 * variable, because Next.js inlines those at BUILD time — using one would mean
 * a full CI rebuild every time the key changed.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
      reset: (id?: string) => void;
    };
    onloadTurnstileCallback?: () => void;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Props = {
  siteKey?: string;
  /** Called with the solved token, or "" when it expires and must be re-solved. */
  onToken: (token: string) => void;
};

export function TurnstileWidget({ siteKey, onToken }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  // Keep the latest callback without re-rendering the widget on every keystroke.
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    if (!siteKey) return;

    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    // Render as soon as BOTH the holder is mounted and the Turnstile API is
    // ready. Returns true once rendered so callers can stop polling.
    function tryRender(): boolean {
      if (cancelled || widgetId.current) return true;
      if (!holder.current || !window.turnstile?.render) return false;
      widgetId.current = window.turnstile.render(holder.current, {
        sitekey: siteKey,
        // Managed mode: invisible for legitimate users, interactive only when
        // Cloudflare's scoring says otherwise.
        appearance: "interaction-only",
        callback: (token: string) => cb.current(token),
        "expired-callback": () => cb.current(""),
        "error-callback": () => cb.current(""),
      });
      return true;
    }

    // The script's `load` event can fire a tick before `window.turnstile` is
    // fully attached, so we never rely on a single onload — we poll until the
    // API is actually callable. This is what fixes the "widget missing on the
    // first page load, appears on refresh" race.
    function waitAndRender() {
      if (tryRender()) return;
      poll = setInterval(() => {
        if (tryRender() && poll) clearInterval(poll);
      }, 100);
    }

    if (window.turnstile?.render) {
      tryRender();
    } else {
      if (!document.getElementById(SCRIPT_ID)) {
        const s = document.createElement("script");
        s.id = SCRIPT_ID;
        s.src = SCRIPT_SRC;
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
      }
      // Whether we just injected the script or another mount already did,
      // poll for the API to become ready.
      waitAndRender();
    }

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* widget already gone */
        }
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={holder} className="flex justify-center" />;
}
