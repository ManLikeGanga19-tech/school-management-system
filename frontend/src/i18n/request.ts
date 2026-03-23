import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

const SUPPORTED_LOCALES = ["en", "sw"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolve the active locale for each request.
 *
 * Priority order:
 *   1. NEXT_LOCALE cookie (set by the LocaleSwitcher component)
 *   2. Default: "en"
 *
 * We intentionally do NOT parse Accept-Language here — the cookie gives a
 * deterministic, user-controlled preference that survives across requests.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get("NEXT_LOCALE")?.value ?? "en";
  const locale: SupportedLocale = isSupportedLocale(raw) ? raw : "en";

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
