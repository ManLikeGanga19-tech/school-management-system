// src/lib/api.ts
//
// CHANGES FROM PREVIOUS VERSION
// ──────────────────────────────
// 1. Silent token refresh on 401 — intercepts 401, calls POST /api/auth/refresh
//    (the Next.js proxy route), retries the original request once, then redirects
//    to /login only if refresh also fails. Concurrent 401s share one refresh attempt.
//
// 2. Redirect to login preserves ?next= so the user lands back where they were.
//
// 3. ApiError class replaces plain Error so callers can inspect status codes.
//
// 4. api.get / api.post / api.patch / api.delete convenience wrappers.
//
// Everything else is unchanged:
//   - Direct browser → backend calls (API_BASE = http://127.0.0.1:8000)
//   - Token read from document.cookie / localStorage via storage.get()
//   - Tenant vs SaaS mode selection via pickToken()
//   - X-Tenant-Slug / X-Tenant-ID headers
//   - credentials: "include" for refresh-token cookie rotation

import { storage, keys } from "./storage";

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api/v1").replace(/\/+$/g, "");

function joinUrl(base: string, path: string) {
  // Absolute URL passthrough
  if (/^https?:\/\//i.test(path)) return path;

  // Normalize: remove any leading slashes and optional leading api/v1 prefixes
  let p = path.replace(/^\/+/, "").replace(/^api\/v1\/?/i, "");
  return `${base}/${p}`;
}

export type ApiOptions = RequestInit & {
  /**
   * true  → tenant endpoint: sends tenant token + X-Tenant-Slug/ID headers.
   * false → SaaS endpoint:   sends SaaS token, no tenant headers.
   *
   * Defaults to true if stored mode === "tenant", false otherwise.
   * Always set this explicitly on subscription/finance calls.
   */
  tenantRequired?: boolean;
  requestId?: string;
  /**
   * If true, a 401 after refresh still throws instead of redirecting to /login.
   * Useful for background/silent checks that should not disrupt the user.
   */
  noRedirect?: boolean;
};

// ─── Typed error ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Silent refresh (de-duplicated) ──────────────────────────────────────────

let _refreshPromise: Promise<boolean> | null = null;

/**
 * Attempt a silent token refresh via the Next.js /api/auth/refresh proxy.
 * Multiple concurrent 401 responses share a single refresh attempt.
 * Returns true on success, false if the refresh token is also expired.
 */
async function silentRefresh(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const res = await fetch(joinUrl(API_BASE, "/auth/refresh"), {
        method: "POST",
        cache: "no-store",
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Reset after a short window so the next genuine expiry can retry
      setTimeout(() => { _refreshPromise = null; }, 5_000);
    }
  })();

  return _refreshPromise;
}

/**
 * Redirect to /login, preserving the current path in ?next=
 * so the user lands back where they were after re-authenticating.
 */
function redirectToLogin() {
  if (typeof window === "undefined") return;
  const next = encodeURIComponent(
    window.location.pathname + window.location.search
  );
  window.location.href = `/login?next=${next}`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getStored(name: keyof typeof keys): string | null {
  const key = keys[name];
  const val = storage.get(key);
  return typeof val === "string" && val.trim() ? val : null;
}

function hasJsonBody(opts?: ApiOptions): boolean {
  return opts?.body !== undefined && opts?.body !== null;
}

/**
 * Select the correct Bearer token based on whether this is a tenant or SaaS call.
 *
 * Tenant calls  → must use the tenant access token (sms_access cookie)
 * SaaS calls    → must use the SaaS access token   (sms_saas_access cookie)
 */
function pickToken(tenantRequired: boolean): string {
  const tenantToken = getStored("accessToken");     // sms_access
  const saasToken   = getStored("saasAccessToken"); // sms_saas_access

  if (tenantRequired) {
    if (tenantToken) return tenantToken;
    if (saasToken) {
      throw new ApiError(
        401,
        "You are in SaaS mode. Switch to school (tenant) login to access this page."
      );
    }
    throw new ApiError(
      401,
      "Not authenticated. Please log in to your school account and try again."
    );
  }

  // SaaS endpoint
  if (saasToken) return saasToken;
  if (tenantToken) {
    throw new ApiError(
      401,
      "You are in school (tenant) mode. Log in as a Super Admin to access this."
    );
  }
  throw new ApiError(401, "Not authenticated. Please log in and try again.");
}

function buildHeaders(opts?: ApiOptions): Headers {
  const headers = new Headers(opts?.headers ?? {});

  const storedMode     = getStored("mode");         // "tenant" | "saas" | null
  const tenantRequired = opts?.tenantRequired ?? (storedMode === "tenant");

  const token = pickToken(tenantRequired);
  headers.set("Authorization", `Bearer ${token}`);

  if (tenantRequired) {
    const tenantSlug = getStored("tenantSlug");
    const tenantId   = getStored("tenantId");

    if (!tenantSlug && !tenantId) {
      throw new ApiError(
        400,
        "No school selected. Please log in through your school's login page."
      );
    }
    if (tenantSlug) headers.set("X-Tenant-Slug", tenantSlug);
    if (tenantId)   headers.set("X-Tenant-ID",   tenantId);
  }

  if (hasJsonBody(opts) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (opts?.requestId) {
    headers.set("X-Request-ID", opts.requestId);
  }

  return headers;
}

// ─── Main fetch wrapper ───────────────────────────────────────────────────────

export async function apiFetch<T>(path: string, opts?: ApiOptions): Promise<T> {
  const url = joinUrl(API_BASE, path);
  const { noRedirect, ...fetchOpts } = opts ?? {};

  // Build headers — may throw ApiError for auth/config problems before the request
  let headers: Headers;
  try {
    headers = buildHeaders(opts);
  } catch (err: any) {
    throw err instanceof ApiError
      ? err
      : new ApiError(401, err?.message ?? "Authentication error");
  }

  const doFetch = () =>
    fetch(url, {
      ...fetchOpts,
      headers,
      credentials: "include",
      cache: "no-store",
    });

  let res = await doFetch();

  // ── Silent refresh on 401 ─────────────────────────────────────────────────
  if (res.status === 401) {
    const refreshed = await silentRefresh();

    if (refreshed) {
      // Rebuild headers — storage.get() now returns the new token written by refresh
      try {
        headers = buildHeaders(opts);
      } catch {
        // If headers still can't be built after refresh, fall through to redirect
      }
      res = await doFetch();
    }

    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      const msg  = body?.detail ?? "Session expired. Please log in again.";
      if (!noRedirect) redirectToLogin();
      throw new ApiError(401, msg, body);
    }
  }

  // ── Parse response ────────────────────────────────────────────────────────
  // 204 No Content
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      data?.detail || data?.message || `Request failed (${res.status})`;
    throw new ApiError(
      res.status,
      typeof msg === "string" ? msg : JSON.stringify(msg),
      data
    );
  }

  return data as T;
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export const api = {
  get: <T = unknown>(path: string, opts?: ApiOptions) =>
    apiFetch<T>(path, { ...opts, method: "GET" }),

  post: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  patch: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  delete: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "DELETE",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
};