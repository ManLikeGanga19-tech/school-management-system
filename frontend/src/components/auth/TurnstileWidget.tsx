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
    if (!siteKey || !holder.current) return;

    let cancelled = false;

    function renderWidget() {
      if (cancelled || !holder.current || !window.turnstile) return;
      if (widgetId.current) return; // already rendered
      widgetId.current = window.turnstile.render(holder.current, {
        sitekey: siteKey,
        // Managed mode: invisible for legitimate users, interactive only when
        // Cloudflare's scoring says otherwise.
        appearance: "interaction-only",
        callback: (token: string) => cb.current(token),
        "expired-callback": () => cb.current(""),
        "error-callback": () => cb.current(""),
      });
    }

    if (window.turnstile) {
      renderWidget();
    } else if (!document.getElementById(SCRIPT_ID)) {
      const s = document.createElement("script");
      s.id = SCRIPT_ID;
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = renderWidget;
      document.head.appendChild(s);
    } else {
      // Script tag exists but the API has not initialised yet.
      const t = setInterval(() => {
        if (window.turnstile) {
          clearInterval(t);
          renderWidget();
        }
      }, 150);
      return () => clearInterval(t);
    }

    return () => {
      cancelled = true;
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
