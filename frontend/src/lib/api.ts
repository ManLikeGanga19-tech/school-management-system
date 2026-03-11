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
// 4. api.get / api.post / api.put / api.patch / api.delete convenience wrappers.
//
// Everything else is unchanged:
//   - API base comes from NEXT_PUBLIC_API_BASE_URL when set
//   - Browser defaults to same-origin /api/v1 on non-local hosts
//   - Browser blocks unsafe loopback/private API bases on public hosts
//   - Token read from document.cookie / localStorage via storage.get()
//   - Tenant vs SaaS mode selection via pickToken()
//   - X-Tenant-Slug / X-Tenant-ID headers
//   - credentials: "include" for refresh-token cookie rotation

import { storage, keys } from "./storage";
import { resolveAdminPortalUrl, resolvePortalContext } from "./platform-host";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOCAL_API_BASE = "http://127.0.0.1:8000/api/v1";

function normalizeBase(value: string | undefined | null): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/g, "");
}

function isIpv4Host(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4Host(hostname)) return false;
  if (hostname.startsWith("10.")) return true;
  if (hostname.startsWith("192.168.")) return true;
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function isInternalHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (isIpv4Host(hostname)) return false;
  if (hostname.includes(":")) return false; // IPv6 / scoped formats
  return !hostname.includes(".");
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  return LOOPBACK_HOSTS.has(host) || isPrivateIpv4(host) || isInternalHostname(host);
}

function shouldBlockPublicToPrivate(candidateBase: string): boolean {
  if (typeof window === "undefined") return false;

  let target: URL;
  try {
    target = new URL(candidateBase, window.location.origin);
  } catch {
    return false;
  }

  const originHost = window.location.hostname.toLowerCase();
  const targetHost = target.hostname.toLowerCase();
  if (!isPrivateHost(targetHost)) return false;
  return !isPrivateHost(originHost);
}

function resolveApiBase(): string {
  const configured = normalizeBase(process.env.NEXT_PUBLIC_API_BASE_URL);

  // On non-local browser origins, default to same-origin API through nginx/proxy.
  const runtimeDefault =
    typeof window !== "undefined" && !isPrivateHost(window.location.hostname.toLowerCase())
      ? "/api/v1"
      : LOCAL_API_BASE;

  const candidate = configured ?? runtimeDefault;
  if (shouldBlockPublicToPrivate(candidate)) return "/api/v1";
  return candidate;
}

const API_BASE = resolveApiBase();

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
   * Defaults to endpoint-aware inference with stored mode as first signal.
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

type RefreshMode = "tenant" | "saas";

const _refreshPromises: Record<RefreshMode, Promise<boolean> | null> = {
  tenant: null,
  saas: null,
};

function normalizeApiPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/^api\/v1\/?/i, "");
}

function inferTenantRequired(path: string, explicit: boolean | undefined): boolean {
  if (typeof explicit === "boolean") return explicit;

  const normalized = normalizeApiPath(path);
  const storedMode = getStored("mode");
  if (storedMode === "tenant") return true;
  if (storedMode === "saas") return false;

  if (
    normalized.startsWith("admin/") ||
    normalized.startsWith("auth/login/saas") ||
    normalized.startsWith("auth/refresh/saas") ||
    normalized.startsWith("auth/me/saas")
  ) {
    return false;
  }

  if (normalized.startsWith("tenants/")) return true;
  return true;
}

function resolveRequestMode(path: string, opts?: ApiOptions): RefreshMode {
  const tenantRequired = inferTenantRequired(path, opts?.tenantRequired);
  return tenantRequired ? "tenant" : "saas";
}

/**
 * Attempt a silent token refresh via the Next.js /api/auth/refresh proxy.
 * Multiple concurrent 401 responses share a single refresh attempt.
 * Returns true on success, false if the refresh token is also expired.
 */
async function silentRefresh(mode: RefreshMode): Promise<boolean> {
  if (_refreshPromises[mode]) return _refreshPromises[mode] as Promise<boolean>;

  const refreshPath = mode === "saas" ? "/api/auth/saas/refresh" : "/api/auth/refresh";

  _refreshPromises[mode] = (async () => {
    try {
      const res = await fetch(refreshPath, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Reset after a short window so the next genuine expiry can retry
      setTimeout(() => {
        _refreshPromises[mode] = null;
      }, 5_000);
    }
  })();

  return _refreshPromises[mode] as Promise<boolean>;
}

/**
 * Redirect to /login, preserving the current path in ?next=
 * so the user lands back where they were after re-authenticating.
 */
function redirectToLogin(mode: RefreshMode) {
  if (typeof window === "undefined") return;
  const portal = resolvePortalContext(window.location.hostname);
  const next = encodeURIComponent(window.location.pathname + window.location.search);

  if (mode === "saas" || portal.kind === "admin") {
    window.location.href = resolveAdminPortalUrl(`/saas/login?next=${next}`) ?? `/saas/login?next=${next}`;
    return;
  }

  if (portal.kind === "tenant") {
    window.location.href = `/login?next=${next}`;
    return;
  }

  window.location.href = "/";
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getStored(name: keyof typeof keys): string | null {
  const key = keys[name];
  const val = storage.get(key);
  return typeof val === "string" && val.trim() ? val : null;
}

function isFormDataBody(body: unknown): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function shouldSetJsonContentType(opts?: ApiOptions): boolean {
  const body = opts?.body;
  if (body === undefined || body === null) return false;
  if (isFormDataBody(body)) return false;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return false;
  if (typeof Blob !== "undefined" && body instanceof Blob) return false;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return false;
  return true;
}

function serializeBody(body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (isFormDataBody(body)) return body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return body;
  if (typeof body === "string") return body;
  return JSON.stringify(body);
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

function buildHeaders(path: string, opts?: ApiOptions): Headers {
  const headers = new Headers(opts?.headers ?? {});

  const tenantRequired = inferTenantRequired(path, opts?.tenantRequired);

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

  if (shouldSetJsonContentType(opts) && !headers.has("Content-Type")) {
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
  const requestMode = resolveRequestMode(path, opts);

  // Build headers — may throw ApiError for auth/config problems before the request
  let headers: Headers;
  try {
    headers = buildHeaders(path, opts);
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
    const refreshed = await silentRefresh(requestMode);

    if (refreshed) {
      // Rebuild headers — storage.get() now returns the new token written by refresh
      try {
        headers = buildHeaders(path, opts);
      } catch {
        // If headers still can't be built after refresh, fall through to redirect
      }
      res = await doFetch();
    }

    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      const msg  = body?.detail ?? "Session expired. Please log in again.";
      if (!noRedirect) redirectToLogin(requestMode);
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

export async function apiFetchRaw(path: string, opts?: ApiOptions): Promise<Response> {
  const url = joinUrl(API_BASE, path);
  const { noRedirect, ...fetchOpts } = opts ?? {};
  const requestMode = resolveRequestMode(path, opts);

  let headers: Headers;
  try {
    headers = buildHeaders(path, opts);
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

  if (res.status === 401) {
    const refreshed = await silentRefresh(requestMode);
    if (refreshed) {
      try {
        headers = buildHeaders(path, opts);
      } catch {
        // no-op: request below will still return 401 and be handled.
      }
      res = await doFetch();
    }

    if (res.status === 401) {
      let body: any = {};
      try {
        body = await res.clone().json();
      } catch {
        body = {};
      }
      const msg = body?.detail ?? "Session expired. Please log in again.";
      if (!noRedirect) redirectToLogin(requestMode);
      throw new ApiError(401, msg, body);
    }
  }

  if (!res.ok) {
    let body: any = {};
    try {
      body = await res.clone().json();
    } catch {
      body = await res.clone().text().catch(() => "");
    }
    const msg =
      (typeof body === "object" ? body?.detail || body?.message : "") ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, typeof msg === "string" ? msg : JSON.stringify(msg), body);
  }

  return res;
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export const api = {
  get: <T = unknown>(path: string, opts?: ApiOptions) =>
    apiFetch<T>(path, { ...opts, method: "GET" }),

  post: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "POST",
      body: serializeBody(body),
    }),

  put: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "PUT",
      body: serializeBody(body),
    }),

  patch: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "PATCH",
      body: serializeBody(body),
    }),

  delete: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "DELETE",
      body: serializeBody(body),
    }),
};
