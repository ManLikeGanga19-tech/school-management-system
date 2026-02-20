import { cookies } from "next/headers";

const BACKEND_BASE_URL =
  process.env.BACKEND_BASE_URL || "http://127.0.0.1:8000";

const DEFAULT_TIMEOUT_MS = 12000;

async function getTenantHeaders() {
  const c = await cookies();
  const tenantId = c.get("sms_tenant_id")?.value;
  const tenantSlug = c.get("sms_tenant_slug")?.value;

  const headers: Record<string, string> = {};
  if (tenantId) headers["x-tenant-id"] = tenantId;
  if (tenantSlug) headers["x-tenant-slug"] = tenantSlug;
  return headers;
}

async function getAuthHeader() {
  const access = (await cookies()).get("sms_access")?.value;
  return access ? { Authorization: `Bearer ${access}` } : {};
}

async function getRefreshCookieHeader() {
  const refresh = (await cookies()).get("sms_refresh")?.value;
  return refresh ? { Cookie: `sms_refresh=${refresh}` } : {};
}

function withTimeoutSignal(init?: RequestInit, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
  if (init?.signal) return init.signal;

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

export async function backendFetch(path: string, init?: RequestInit) {
  const url = `${BACKEND_BASE_URL}${path}`;
  const headers = new Headers(init?.headers || {});

  const tenantHeaders = await getTenantHeaders();
  const authHeader = await getAuthHeader();

  // Do not override explicitly provided headers (critical for login with tenant switch).
  Object.entries(tenantHeaders).forEach(([k, v]) => {
    if (!headers.has(k)) headers.set(k, v);
  });

  Object.entries(authHeader).forEach(([k, v]) => {
    if (!headers.has(k)) headers.set(k, v);
  });

  if (path.startsWith("/api/v1/auth/refresh")) {
    const refreshHdr = await getRefreshCookieHeader();
    Object.entries(refreshHdr).forEach(([k, v]) => {
      if (!headers.has(k)) headers.set(k, v);
    });
  }

  if (!headers.get("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    signal: withTimeoutSignal(init),
  });
}