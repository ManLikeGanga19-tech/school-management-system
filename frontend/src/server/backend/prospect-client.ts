import { cookies } from "next/headers";

import { backendFetch } from "@/server/backend/client";
import {
  clearPublicAuthCookies,
  setPublicAccessToken,
  setPublicRefreshToken,
} from "@/lib/auth/cookies";

function extractCookieValue(setCookie: string | null, cookieName: string) {
  if (!setCookie) return null;
  const re = new RegExp(`${cookieName}=([^;]+)`);
  const m = setCookie.match(re);
  return m?.[1] ?? null;
}

export async function syncPublicSession(res: Response, data?: any) {
  const body = data ?? (await res.json().catch(() => ({})));
  if (body?.access_token) {
    await setPublicAccessToken(String(body.access_token));
  }

  const refresh =
    extractCookieValue(res.headers.get("set-cookie"), "sms_public_refresh") || null;
  if (refresh) {
    await setPublicRefreshToken(refresh);
  }

  return body;
}

async function publicBackendFetch(path: string, init?: RequestInit) {
  const access = (await cookies()).get("sms_public_access")?.value;
  const headers = new Headers(init?.headers || {});
  if (access && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${access}`);
  }
  return backendFetch(path, { ...init, headers });
}

async function refreshPublicSession() {
  const refresh = (await cookies()).get("sms_public_refresh")?.value;
  if (!refresh) return false;

  let res: Response;
  try {
    res = await backendFetch("/api/v1/public/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: `sms_public_refresh=${refresh}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    return false;
  }

  if (!res.ok) {
    await clearPublicAuthCookies();
    return false;
  }

  await syncPublicSession(res);
  return true;
}

export async function publicBackendFetchWithRefresh(path: string, init?: RequestInit) {
  let res = await publicBackendFetch(path, init);
  if (res.status !== 401) return res;

  const refreshed = await refreshPublicSession();
  if (!refreshed) return res;

  res = await publicBackendFetch(path, init);
  if (res.status === 401) {
    await clearPublicAuthCookies();
  }
  return res;
}
