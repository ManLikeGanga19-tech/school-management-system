// src/lib/auth/cookies.ts
//
// CHANGE FROM ORIGINAL
// --------------------
// Access tokens are now httpOnly: FALSE.
//
// WHY: The client-side apiFetch() needs to read the Bearer token from
// document.cookie to attach it to API requests. httpOnly cookies are
// invisible to JavaScript by design — making apiFetch always send requests
// with no Authorization header, causing 401s on every authenticated call.
//
// SECURITY TRADE-OFF:
// - Access tokens expire in 1 hour (short-lived) — risk window is small.
// - Refresh tokens remain httpOnly: TRUE — they cannot be stolen by XSS.
// - sameSite: "lax" + secure: true (production) prevent CSRF.
// - This is the standard pattern used by Next.js + FastAPI apps.

import { cookies } from "next/headers";

export const COOKIE_ACCESS       = "sms_access";
export const COOKIE_REFRESH      = "sms_refresh";
export const COOKIE_TENANT_ID    = "sms_tenant_id";
export const COOKIE_TENANT_SLUG  = "sms_tenant_slug";
export const COOKIE_MODE         = "sms_mode";

export const COOKIE_SAAS_ACCESS  = "sms_saas_access";
export const COOKIE_SAAS_REFRESH = "sms_saas_refresh";
export const COOKIE_PUBLIC_ACCESS = "sms_public_access";
export const COOKIE_PUBLIC_REFRESH = "sms_public_refresh";

function parseOptionalBool(value: string | undefined): boolean | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

const IS_SECURE = (() => {
  const fromEnv = parseOptionalBool(process.env.COOKIE_SECURE);
  if (fromEnv !== null) return fromEnv;
  return process.env.NODE_ENV === "production";
})();

const ACCESS_MAX_AGE  = 60 * 60;           // 1 hour
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Base options for SHORT-LIVED access tokens — NOT httpOnly so JS can read them */
function accessCookieOptions(maxAge: number) {
  return {
    httpOnly: false as const,   // ← CHANGED: must be readable by document.cookie
    sameSite: "lax" as const,
    secure: IS_SECURE,
    path: "/",
    maxAge,
  };
}

/** Base options for LONG-LIVED refresh tokens — httpOnly, never readable by JS */
function refreshCookieOptions(maxAge: number) {
  return {
    httpOnly: true as const,    // ← UNCHANGED: refresh tokens stay protected
    sameSite: "lax" as const,
    secure: IS_SECURE,
    path: "/",
    maxAge,
  };
}

/** Public prospect auth stays server-only: BFF routes read/write these cookies. */
function serverOnlyAuthCookieOptions(maxAge: number) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: IS_SECURE,
    path: "/",
    maxAge,
  };
}

/** Client-readable hints used for tenant resolution and mode selection. */
function clientHintCookieOptions(maxAge: number) {
  return {
    httpOnly: false as const,
    sameSite: "lax" as const,
    secure: IS_SECURE,
    path: "/",
    maxAge,
  };
}

/** Tenant/school login access token */
export async function setAccessToken(token: string) {
  (await cookies()).set(COOKIE_ACCESS, token, accessCookieOptions(ACCESS_MAX_AGE));
}

/** Tenant/school login refresh token */
export async function setRefreshToken(token: string) {
  (await cookies()).set(COOKIE_REFRESH, token, refreshCookieOptions(REFRESH_MAX_AGE));
}

/** SaaS super admin access token */
export async function setSaasAccessToken(token: string) {
  (await cookies()).set(COOKIE_SAAS_ACCESS, token, accessCookieOptions(ACCESS_MAX_AGE));
}

/** SaaS super admin refresh token */
export async function setSaasRefreshToken(token: string) {
  (await cookies()).set(COOKIE_SAAS_REFRESH, token, refreshCookieOptions(REFRESH_MAX_AGE));
}

export async function setPublicAccessToken(token: string) {
  (await cookies()).set(COOKIE_PUBLIC_ACCESS, token, serverOnlyAuthCookieOptions(ACCESS_MAX_AGE));
}

export async function setPublicRefreshToken(token: string) {
  (await cookies()).set(COOKIE_PUBLIC_REFRESH, token, serverOnlyAuthCookieOptions(REFRESH_MAX_AGE));
}

/** Tenant context cookies — not sensitive, readable by JS */
export async function setTenantContext(input: { tenant_id?: string; tenant_slug?: string }) {
  const c = await cookies();

  if (input.tenant_id) {
    c.set(COOKIE_TENANT_ID, input.tenant_id, {
      ...clientHintCookieOptions(REFRESH_MAX_AGE),
    });
  } else {
    c.delete(COOKIE_TENANT_ID);
  }

  if (input.tenant_slug) {
    c.set(COOKIE_TENANT_SLUG, input.tenant_slug, {
      ...clientHintCookieOptions(REFRESH_MAX_AGE),
    });
  } else {
    c.delete(COOKIE_TENANT_SLUG);
  }
}

export async function setClientModeCookie(mode: "tenant" | "saas") {
  (await cookies()).set(COOKIE_MODE, mode, clientHintCookieOptions(REFRESH_MAX_AGE));
}

export async function clearTenantAuthCookies() {
  const c = await cookies();
  c.delete(COOKIE_ACCESS);
  c.delete(COOKIE_REFRESH);
  c.delete(COOKIE_TENANT_ID);
  c.delete(COOKIE_TENANT_SLUG);
}

export async function clearSaasAuthCookies() {
  const c = await cookies();
  c.delete(COOKIE_SAAS_ACCESS);
  c.delete(COOKIE_SAAS_REFRESH);
}

export async function clearPublicAuthCookies() {
  const c = await cookies();
  c.delete(COOKIE_PUBLIC_ACCESS);
  c.delete(COOKIE_PUBLIC_REFRESH);
}

export async function clearAllAuthCookies() {
  await clearTenantAuthCookies();
  await clearSaasAuthCookies();
  await clearPublicAuthCookies();
  (await cookies()).delete(COOKIE_MODE);
}
