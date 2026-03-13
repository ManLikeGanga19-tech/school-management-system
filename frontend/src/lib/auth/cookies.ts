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

import {
  buildCookieOptions,
  expiredCookieVariants,
} from "@/lib/auth/cookie-config";

export const COOKIE_ACCESS       = "sms_access";
export const COOKIE_REFRESH      = "sms_refresh";
export const COOKIE_TENANT_ID    = "sms_tenant_id";
export const COOKIE_TENANT_SLUG  = "sms_tenant_slug";
export const COOKIE_MODE         = "sms_mode";

export const COOKIE_SAAS_ACCESS  = "sms_saas_access";
export const COOKIE_SAAS_REFRESH = "sms_saas_refresh";
export const COOKIE_PUBLIC_ACCESS = "sms_public_access";
export const COOKIE_PUBLIC_REFRESH = "sms_public_refresh";

const ACCESS_MAX_AGE  = 60 * 60;           // 1 hour
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

type CookieWriter = {
  cookies: {
    set(name: string, value: string, options: Record<string, any>): void;
  };
};

/** Base options for SHORT-LIVED access tokens — NOT httpOnly so JS can read them */
function accessCookieOptions(maxAge: number) {
  return buildCookieOptions({
    maxAge,
    httpOnly: false, // must remain readable by document.cookie
  });
}

/** Base options for LONG-LIVED refresh tokens — httpOnly, never readable by JS */
function refreshCookieOptions(maxAge: number) {
  return buildCookieOptions({
    maxAge,
    httpOnly: true,
  });
}

/** Public prospect auth stays server-only: BFF routes read/write these cookies. */
function serverOnlyAuthCookieOptions(maxAge: number) {
  return buildCookieOptions({
    maxAge,
    httpOnly: true,
  });
}

/** Client-readable hints used for tenant resolution and mode selection. */
function clientHintCookieOptions(maxAge: number) {
  return buildCookieOptions({
    maxAge,
    httpOnly: false,
  });
}

async function expireCookie(name: string) {
  const c = await cookies();
  for (const variant of expiredCookieVariants()) {
    c.set(name, "", variant);
  }
}

function expireCookieOnResponse(response: CookieWriter, name: string) {
  for (const variant of expiredCookieVariants()) {
    response.cookies.set(name, "", variant);
  }
}

function setCookieOnResponse(
  response: CookieWriter,
  name: string,
  value: string,
  options: Record<string, any>
) {
  response.cookies.set(name, value, options);
}

/** Tenant/school login access token */
export async function setAccessToken(token: string) {
  (await cookies()).set(COOKIE_ACCESS, token, accessCookieOptions(ACCESS_MAX_AGE));
}

export function setAccessTokenOnResponse(response: CookieWriter, token: string) {
  setCookieOnResponse(response, COOKIE_ACCESS, token, accessCookieOptions(ACCESS_MAX_AGE));
}

/** Tenant/school login refresh token */
export async function setRefreshToken(token: string) {
  (await cookies()).set(COOKIE_REFRESH, token, refreshCookieOptions(REFRESH_MAX_AGE));
}

export function setRefreshTokenOnResponse(response: CookieWriter, token: string) {
  setCookieOnResponse(response, COOKIE_REFRESH, token, refreshCookieOptions(REFRESH_MAX_AGE));
}

/** SaaS super admin access token */
export async function setSaasAccessToken(token: string) {
  (await cookies()).set(COOKIE_SAAS_ACCESS, token, accessCookieOptions(ACCESS_MAX_AGE));
}

export function setSaasAccessTokenOnResponse(response: CookieWriter, token: string) {
  setCookieOnResponse(response, COOKIE_SAAS_ACCESS, token, accessCookieOptions(ACCESS_MAX_AGE));
}

/** SaaS super admin refresh token */
export async function setSaasRefreshToken(token: string) {
  (await cookies()).set(COOKIE_SAAS_REFRESH, token, refreshCookieOptions(REFRESH_MAX_AGE));
}

export function setSaasRefreshTokenOnResponse(response: CookieWriter, token: string) {
  setCookieOnResponse(response, COOKIE_SAAS_REFRESH, token, refreshCookieOptions(REFRESH_MAX_AGE));
}

export async function setPublicAccessToken(token: string) {
  (await cookies()).set(COOKIE_PUBLIC_ACCESS, token, serverOnlyAuthCookieOptions(ACCESS_MAX_AGE));
}

export function setPublicAccessTokenOnResponse(response: CookieWriter, token: string) {
  setCookieOnResponse(
    response,
    COOKIE_PUBLIC_ACCESS,
    token,
    serverOnlyAuthCookieOptions(ACCESS_MAX_AGE)
  );
}

export async function setPublicRefreshToken(token: string) {
  (await cookies()).set(COOKIE_PUBLIC_REFRESH, token, serverOnlyAuthCookieOptions(REFRESH_MAX_AGE));
}

export function setPublicRefreshTokenOnResponse(response: CookieWriter, token: string) {
  setCookieOnResponse(
    response,
    COOKIE_PUBLIC_REFRESH,
    token,
    serverOnlyAuthCookieOptions(REFRESH_MAX_AGE)
  );
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

export function setTenantContextOnResponse(
  response: CookieWriter,
  input: { tenant_id?: string; tenant_slug?: string }
) {
  if (input.tenant_id) {
    setCookieOnResponse(response, COOKIE_TENANT_ID, input.tenant_id, clientHintCookieOptions(REFRESH_MAX_AGE));
  } else {
    expireCookieOnResponse(response, COOKIE_TENANT_ID);
  }

  if (input.tenant_slug) {
    setCookieOnResponse(
      response,
      COOKIE_TENANT_SLUG,
      input.tenant_slug,
      clientHintCookieOptions(REFRESH_MAX_AGE)
    );
  } else {
    expireCookieOnResponse(response, COOKIE_TENANT_SLUG);
  }
}

export async function setClientModeCookie(mode: "tenant" | "saas") {
  (await cookies()).set(COOKIE_MODE, mode, clientHintCookieOptions(REFRESH_MAX_AGE));
}

export function setClientModeCookieOnResponse(
  response: CookieWriter,
  mode: "tenant" | "saas"
) {
  setCookieOnResponse(response, COOKIE_MODE, mode, clientHintCookieOptions(REFRESH_MAX_AGE));
}

export async function clearTenantAuthCookies() {
  await expireCookie(COOKIE_ACCESS);
  await expireCookie(COOKIE_REFRESH);
  await expireCookie(COOKIE_TENANT_ID);
  await expireCookie(COOKIE_TENANT_SLUG);
}

export function clearTenantAuthCookiesOnResponse(response: CookieWriter) {
  expireCookieOnResponse(response, COOKIE_ACCESS);
  expireCookieOnResponse(response, COOKIE_REFRESH);
  expireCookieOnResponse(response, COOKIE_TENANT_ID);
  expireCookieOnResponse(response, COOKIE_TENANT_SLUG);
}

export async function clearSaasAuthCookies() {
  await expireCookie(COOKIE_SAAS_ACCESS);
  await expireCookie(COOKIE_SAAS_REFRESH);
}

export function clearSaasAuthCookiesOnResponse(response: CookieWriter) {
  expireCookieOnResponse(response, COOKIE_SAAS_ACCESS);
  expireCookieOnResponse(response, COOKIE_SAAS_REFRESH);
}

export async function clearPublicAuthCookies() {
  await expireCookie(COOKIE_PUBLIC_ACCESS);
  await expireCookie(COOKIE_PUBLIC_REFRESH);
}

export function clearPublicAuthCookiesOnResponse(response: CookieWriter) {
  expireCookieOnResponse(response, COOKIE_PUBLIC_ACCESS);
  expireCookieOnResponse(response, COOKIE_PUBLIC_REFRESH);
}

export async function clearClientModeCookie() {
  await expireCookie(COOKIE_MODE);
}

export function clearClientModeCookieOnResponse(response: CookieWriter) {
  expireCookieOnResponse(response, COOKIE_MODE);
}

export async function clearAllAuthCookies() {
  await clearTenantAuthCookies();
  await clearSaasAuthCookies();
  await clearPublicAuthCookies();
  await clearClientModeCookie();
}

export function clearAllAuthCookiesOnResponse(response: CookieWriter) {
  clearTenantAuthCookiesOnResponse(response);
  clearSaasAuthCookiesOnResponse(response);
  clearPublicAuthCookiesOnResponse(response);
  clearClientModeCookieOnResponse(response);
}
