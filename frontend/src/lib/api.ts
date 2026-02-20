// src/lib/api.ts
import { storage, keys } from "./storage";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

type ApiOptions = RequestInit & { tenantRequired?: boolean };

function buildHeaders(opts?: ApiOptions) {
  const headers = new Headers(opts?.headers || {});
  headers.set("Content-Type", "application/json");

  const token = storage.get(keys.accessToken);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const mode = storage.get(keys.mode);
  const tenantSlug = storage.get(keys.tenantSlug);

  // attach tenant context for tenant-mode calls
  const tenantRequired = opts?.tenantRequired ?? (mode === "tenant");
  if (tenantRequired) {
    if (tenantSlug) headers.set("X-Tenant-Slug", tenantSlug);
    // if your backend uses X-Tenant-ID instead, we can switch easily
  }

  return headers;
}

export async function apiFetch<T>(path: string, opts?: ApiOptions): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: buildHeaders(opts),
    credentials: "include", // IMPORTANT for refresh cookie usage
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data as T;
}
