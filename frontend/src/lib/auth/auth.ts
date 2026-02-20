// src/lib/auth/auth.ts

import { storage, keys } from "../storage";

export type AuthMode = "saas" | "tenant";

export type LoginResponse = {
  ok?: boolean;
  access_token?: string;
  detail?: string;
  message?: string;
};

function normalizeEmail(email: string) {
  return (email || "").trim().toLowerCase();
}

function normalizeTenantSlug(slug?: string) {
  const s = (slug || "").trim().toLowerCase();
  return s || null;
}

async function readJson(res: Response) {
  return res.json().catch(() => ({} as any));
}

function pickErrorMessage(data: any, fallback: string) {
  return (
    (data && (data.detail || data.message || data.error)) ||
    fallback
  );
}

/**
 * Enterprise auth client (BFF-first)
 *
 * IMPORTANT:
 * - We authenticate via Next.js API routes (BFF) so cookies are set correctly:
 *   - tenant: POST /api/auth/login
 *   - saas:   POST /api/auth/saas/login
 *
 * - We keep localStorage "mode" + "tenantSlug" to help your client header builder,
 *   but we do NOT rely on localStorage for the session itself (cookies do that).
 *
 * - If your BFF returns `access_token`, we store it for legacy direct-backend calls.
 *   If it returns only `{ ok: true }`, cookies still work (recommended).
 */
export async function login(params: {
  mode: AuthMode;
  email: string;
  password: string;
  tenantSlug?: string;
}) {
  const { mode, password } = params;
  const email = normalizeEmail(params.email);
  const tenantSlug = normalizeTenantSlug(params.tenantSlug);

  // Reset client session markers
  storage.remove(keys.accessToken);
  storage.remove(keys.tenantSlug);
  storage.remove(keys.mode);

  // Set mode early (used by your UI / header builder)
  storage.set(keys.mode, mode);

  if (mode === "tenant") {
    if (!tenantSlug) {
      storage.remove(keys.mode);
      throw new Error("Tenant slug is required for tenant login.");
    }
    storage.set(keys.tenantSlug, tenantSlug);
  }

  const path = mode === "saas" ? "/api/auth/saas/login" : "/api/auth/login";

  const payload =
    mode === "saas"
      ? { email, password }
      : { tenant_slug: tenantSlug, email, password };

  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // ensure cookies from BFF are stored
    body: JSON.stringify(payload),
  });

  const data = (await readJson(res)) as LoginResponse;

  if (!res.ok) {
    // Cleanup on failed login
    storage.remove(keys.accessToken);
    storage.remove(keys.tenantSlug);
    storage.remove(keys.mode);

    throw new Error(pickErrorMessage(data, "Login failed"));
  }

  // Optional: if your BFF returns access_token, keep it for legacy direct-backend calls.
  if (data?.access_token) {
    storage.set(keys.accessToken, data.access_token);
  }

  return data;
}

/**
 * Logout via BFF so the correct cookie jar is cleared server-side.
 */
export async function logout() {
  const mode = (storage.get(keys.mode) as AuthMode | null) || null;

  // Always attempt both server-side logouts (safe + enterprise-friendly),
  // because user might have switched between modes.
  const paths = mode === "saas"
    ? ["/api/auth/saas/logout", "/api/auth/logout"]
    : ["/api/auth/logout", "/api/auth/saas/logout"];

  for (const path of paths) {
    try {
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
    } catch {
      // ignore (best-effort)
    }
  }

  // Clear client markers
  storage.remove(keys.accessToken);
  storage.remove(keys.tenantSlug);
  storage.remove(keys.mode);
}

/**
 * Current user (BFF-first).
 * - tenant: GET /api/auth/me
 * - saas:   GET /api/auth/saas/me
 *
 * If you haven’t created these BFF endpoints yet, you can:
 * - keep using backend `/api/v1/auth/me` routes server-side, OR
 * - add thin BFF proxy routes that forward cookies and return JSON.
 */
export async function getCurrentUser() {
  const mode = storage.get(keys.mode) as AuthMode | null;

  if (!mode) {
    throw new Error("No auth mode set.");
  }

  const path = mode === "saas" ? "/api/auth/saas/me" : "/api/auth/me";

  const res = await fetch(path, {
    method: "GET",
    credentials: "include",
  });

  const data = await readJson(res);

  if (!res.ok) {
    throw new Error(pickErrorMessage(data, "Failed to load current user"));
  }

  return data;
}