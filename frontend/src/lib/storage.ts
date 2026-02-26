// src/lib/storage.ts
//
// ARCHITECTURE NOTE
// -----------------
// Auth tokens are written by Next.js server actions into httpOnly cookies
// (via cookies.ts). They are NOT accessible via document.cookie because
// httpOnly=true blocks JS access — that is intentional for security.
//
// The solution: store a PARALLEL non-httpOnly copy of the non-sensitive
// lookup values (tenantSlug, tenantId, mode) in localStorage/sessionStorage
// so the client-side apiFetch can read them.
//
// For the actual Bearer token, we use a different approach:
// The Next.js middleware or a /api/token route echoes the token into a
// readable cookie (NOT httpOnly) so apiFetch can attach it.
//
// If you don't want to change your cookie strategy, the fastest production
// fix is to set httpOnly: false on the access tokens only (they expire in
// 1h anyway) and keep refresh tokens httpOnly. That's what this file assumes.
//
// Keys written by server actions (cookies.ts) that apiFetch needs to read:
//   sms_access        → tenant Bearer token
//   sms_saas_access   → SaaS Bearer token
//   sms_tenant_id     → tenant UUID
//   sms_tenant_slug   → tenant slug string
//
// Non-sensitive session state written by client code:
//   sms_mode          → "tenant" | "saas"

// ─── Cookie names (must match cookies.ts exactly) ─────────────────────────────

export const COOKIE_NAMES = {
  accessToken:    "sms_access",
  saasAccessToken:"sms_saas_access",
  tenantId:       "sms_tenant_id",
  tenantSlug:     "sms_tenant_slug",
  mode:           "sms_mode",
} as const;

// ─── Key aliases used by api.ts getStored() calls ─────────────────────────────
// These map the logical names apiFetch uses to the actual cookie/storage names.

export const keys = {
  accessToken:    COOKIE_NAMES.accessToken,
  saasAccessToken:COOKIE_NAMES.saasAccessToken,
  saasAccess:     COOKIE_NAMES.saasAccessToken, // legacy alias
  tenantId:       COOKIE_NAMES.tenantId,
  tenantSlug:     COOKIE_NAMES.tenantSlug,
  mode:           COOKIE_NAMES.mode,
} as const;

// ─── Cookie reader (client-side only) ─────────────────────────────────────────

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null; // SSR guard
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  if (!match) return null;
  const val = match.split("=").slice(1).join("="); // handle = in value
  return decodeURIComponent(val) || null;
}

// ─── Storage adapter ──────────────────────────────────────────────────────────
// Reads from cookies first (set by server actions), falls back to localStorage.
// Writes go to localStorage for client-set values (mode, etc).

export const storage = {
  get(key: string): string | null {
    // Always try cookies first — server actions write there
    const fromCookie = readCookie(key);
    if (fromCookie) return fromCookie;

    // Fallback: localStorage for values set client-side
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(key) || null;
    }
    return null;
  },

  set(key: string, value: string): void {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  },

  remove(key: string): void {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
    }
    // Also clear the cookie version (client-writable cookies only)
    if (typeof document !== "undefined") {
      document.cookie = `${key}=; path=/; max-age=0`;
    }
  },

  clear(): void {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  },
};

// ─── Helpers used by login flows ──────────────────────────────────────────────

/** Call after tenant login succeeds to persist mode for client-side reads. */
export function setClientMode(mode: "tenant" | "saas"): void {
  storage.set(COOKIE_NAMES.mode, mode);
}

/** Call after tenant login to cache tenant context client-side. */
export function setClientTenantContext(tenantId: string, tenantSlug: string): void {
  storage.set(COOKIE_NAMES.tenantId, tenantId);
  storage.set(COOKIE_NAMES.tenantSlug, tenantSlug);
}

/** Clear all client-side session state on logout. */
export function clearClientSession(): void {
  Object.values(COOKIE_NAMES).forEach((key) => storage.remove(key));
}