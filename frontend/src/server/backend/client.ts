import { cookies, headers as nextHeaders } from "next/headers";

import { normalizeHostname, resolvePortalContext } from "@/lib/platform-host";

function normalizeBase(value: string | undefined | null): string | null {
  const v = String(value || "").trim();
  if (!v) return null;
  return v.replace(/\/+$/g, "");
}

function unique(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function backendBaseCandidates(): string[] {
  return unique([
    normalizeBase(process.env.BACKEND_BASE_URL),
    normalizeBase(process.env.NEXT_PUBLIC_API_BASE_URL),
    "http://127.0.0.1:8000/api/v1",
    "http://localhost:8000/api/v1",
    "http://127.0.0.1:8080/api/v1",
    "http://localhost:8080/api/v1",
  ]);
}

function joinUrl(base: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.replace(/^\/+/, "").replace(/^api\/v1\/?/i, "");
  return `${base}/${p}`;
}

const DEFAULT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.BACKEND_FETCH_TIMEOUT_MS || "20000");
  if (!Number.isFinite(raw)) return 20000;
  return Math.max(1000, Math.floor(raw));
})();

async function getTenantHeaders() {
  const c = await cookies();
  const hdrs = await nextHeaders();
  const tenantId = c.get("sms_tenant_id")?.value;
  let tenantSlug = c.get("sms_tenant_slug")?.value;
  const host = normalizeHostname(hdrs.get("x-forwarded-host") ?? hdrs.get("host"));
  const portal = resolvePortalContext(host);

  const headers: Record<string, string> = {};
  if (host) headers["x-forwarded-host"] = host;
  if (!tenantSlug && portal.kind === "tenant" && portal.tenantSlug) {
    tenantSlug = portal.tenantSlug;
  }
  if (tenantId) headers["x-tenant-id"] = tenantId;
  if (tenantSlug) headers["x-tenant-slug"] = tenantSlug;
  return headers;
}

async function getAuthHeader(normalizedPath: string) {
  const c = await cookies();
  const access = normalizedPath.startsWith("public/")
    ? c.get("sms_public_access")?.value
    : c.get("sms_access")?.value;
  return access ? { Authorization: `Bearer ${access}` } : {};
}

async function getRefreshCookieHeader(normalizedPath: string) {
  const c = await cookies();
  const refreshName = normalizedPath.startsWith("public/auth/refresh")
    ? "sms_public_refresh"
    : "sms_refresh";
  const backendCookieName = normalizedPath.startsWith("public/auth/refresh")
    ? "sms_public_refresh"
    : "sms_refresh";
  const refresh = c.get(refreshName)?.value;
  return refresh ? { Cookie: `${backendCookieName}=${refresh}` } : {};
}

function createTimeoutController(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

export async function backendFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers || {});
  const normalizedPath = path.replace(/^\/+/, "").replace(/^api\/v1\/?/i, "");

  const tenantHeaders = await getTenantHeaders();
  const authHeader = await getAuthHeader(normalizedPath);

  // Do not override explicitly provided headers (critical for login with tenant switch).
  Object.entries(tenantHeaders).forEach(([k, v]) => {
    if (!headers.has(k)) headers.set(k, v);
  });

  Object.entries(authHeader).forEach(([k, v]) => {
    if (!headers.has(k)) headers.set(k, v);
  });

  // If this call targets the refresh endpoint, forward the refresh cookie
  if (normalizedPath.startsWith("auth/refresh")) {
    const refreshHdr = await getRefreshCookieHeader(normalizedPath);
    Object.entries(refreshHdr).forEach(([k, v]) => {
      if (!headers.has(k)) headers.set(k, v);
    });
  }
  if (normalizedPath.startsWith("public/auth/refresh")) {
    const refreshHdr = await getRefreshCookieHeader(normalizedPath);
    Object.entries(refreshHdr).forEach(([k, v]) => {
      if (!headers.has(k)) headers.set(k, v);
    });
  }

  if (!headers.get("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const reqInit: RequestInit = {
    ...init,
    headers,
    cache: "no-store",
  };

  const bases = backendBaseCandidates();
  const method = String(reqInit.method || "GET").toUpperCase();
  const maxAttempts = method === "GET" ? 2 : 1;

  let lastErr: unknown = null;
  for (const base of bases) {
    const url = joinUrl(base, path);

    // If caller already provided a signal, respect it directly.
    if (reqInit.signal) {
      try {
        return await fetch(url, reqInit);
      } catch (err) {
        lastErr = err;
        continue;
      }
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const timeoutMs =
        attempt === 1 ? DEFAULT_TIMEOUT_MS : Math.round(DEFAULT_TIMEOUT_MS * 1.5);
      const timeout = createTimeoutController(timeoutMs);
      try {
        return await fetch(url, { ...reqInit, signal: timeout.signal });
      } catch (err: any) {
        lastErr = err;
        const isAbort = err?.name === "AbortError";
        if (!isAbort || attempt >= maxAttempts) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      } finally {
        timeout.clear();
      }
    }
  }

  throw lastErr ?? new Error("Unable to reach backend");
}
