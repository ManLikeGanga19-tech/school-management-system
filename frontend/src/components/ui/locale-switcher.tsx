"use client";

/**
 * LocaleSwitcher
 *
 * Toggles between English ("en") and Kiswahili ("sw") by writing the
 * NEXT_LOCALE cookie and triggering a server-side re-render via router.refresh().
 *
 * Usage — drop this into any layout or nav component:
 *   import { LocaleSwitcher } from "@/components/ui/locale-switcher";
 *   <LocaleSwitcher />
 *
 * The active locale is read from the cookie by src/i18n/request.ts on every
 * request, so the switch takes effect immediately without a full page reload.
 */

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  sw: "Kiswahili",
};

const LOCALE_SHORT: Record<string, string> = {
  en: "EN",
  sw: "SW",
};

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const otherLocale = locale === "en" ? "sw" : "en";

  function handleSwitch() {
    // Persist for one year; SameSite=Lax is safe for this first-party cookie.
    document.cookie = `NEXT_LOCALE=${otherLocale};path=/;max-age=${
      60 * 60 * 24 * 365
    };SameSite=Lax`;
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      onClick={handleSwitch}
      disabled={isPending}
      aria-label={`Switch to ${LOCALE_LABELS[otherLocale]}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="font-semibold">{LOCALE_SHORT[otherLocale]}</span>
      <span className="hidden sm:inline">{LOCALE_LABELS[otherLocale]}</span>
    </button>
  );
}
