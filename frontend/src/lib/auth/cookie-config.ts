export type AuthCookieSameSite = "lax" | "strict" | "none";

function parseOptionalBool(value: string | undefined): boolean | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function normalizeSameSite(value: string | undefined): AuthCookieSameSite {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "strict") return "strict";
  if (normalized === "none") return "none";
  return "lax";
}

function normalizeDomain(value: string | undefined): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export const COOKIE_SECURE = (() => {
  const fromEnv = parseOptionalBool(process.env.COOKIE_SECURE);
  if (fromEnv !== null) return fromEnv;
  return process.env.NODE_ENV === "production";
})();

export const COOKIE_SAMESITE = normalizeSameSite(process.env.COOKIE_SAMESITE);
export const COOKIE_DOMAIN = normalizeDomain(process.env.COOKIE_DOMAIN);

type BuildCookieOptionsInput = {
  maxAge: number;
  httpOnly: boolean;
  path?: string;
};

export function buildCookieOptions({
  maxAge,
  httpOnly,
  path = "/",
}: BuildCookieOptionsInput) {
  return {
    httpOnly,
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SECURE,
    path,
    maxAge,
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  };
}

type ExpiredCookieVariantInput = {
  path?: string;
  httpOnly?: boolean;
};

type ExpiredCookieVariant = {
  httpOnly: boolean;
  sameSite: AuthCookieSameSite;
  secure: boolean;
  path: string;
  maxAge: number;
  expires: Date;
  domain?: string;
};

export function expiredCookieVariants({
  path = "/",
  httpOnly = false,
}: ExpiredCookieVariantInput = {}): ExpiredCookieVariant[] {
  const variants: ExpiredCookieVariant[] = [
    {
      httpOnly,
      sameSite: COOKIE_SAMESITE,
      secure: COOKIE_SECURE,
      path,
      maxAge: 0,
      expires: new Date(0),
    },
  ];

  if (COOKIE_DOMAIN) {
    variants.push({
      httpOnly,
      sameSite: COOKIE_SAMESITE,
      secure: COOKIE_SECURE,
      path,
      maxAge: 0,
      expires: new Date(0),
      domain: COOKIE_DOMAIN,
    });
  }

  return variants;
}
