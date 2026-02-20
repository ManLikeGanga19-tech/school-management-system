import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";
import {
  setAccessToken,
  setRefreshToken,
  setTenantContext,
  clearSaasAuthCookies,
  clearTenantAuthCookies,
} from "@/lib/auth/cookies";

function extractCookieValue(setCookie: string | null, cookieName: string) {
  if (!setCookie) return null;
  const re = new RegExp(`${cookieName}=([^;]+)`);
  const m = setCookie.match(re);
  return m?.[1] ?? null;
}

function readError(data: any, fallback: string) {
  if (!data) return fallback;
  if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  return fallback;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const tenant_slug = (body?.tenant_slug as string | undefined)?.trim().toLowerCase();
  const email = (body?.email as string | undefined)?.trim().toLowerCase();
  const password = (body?.password as string | undefined) || "";

  if (!tenant_slug) {
    return NextResponse.json({ detail: "Missing tenant_slug" }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ detail: "Email and password are required" }, { status: 400 });
  }

  await clearSaasAuthCookies();
  await clearTenantAuthCookies();

  // backend can occasionally take longer (tenant bootstrap, heavy DB queries).
  // Use a longer timeout for this login request and handle aborts explicitly.
  const controller = new AbortController();
  const timeoutMs = 30000; // 30s for login
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await backendFetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      headers: { "x-tenant-slug": tenant_slug },
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err && err.name === "AbortError") {
      return NextResponse.json({ detail: "Login request timed out" }, { status: 504 });
    }
    return NextResponse.json({ detail: "Network error while contacting backend" }, { status: 502 });
  }

  clearTimeout(timeout);

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json({ detail: readError(data, "Tenant login failed") }, { status: res.status });
  }

  if (data?.access_token) {
    await setAccessToken(data.access_token);
  }

  const setCookie = res.headers.get("set-cookie");
  const refresh = extractCookieValue(setCookie, "sms_refresh");
  if (refresh) {
    await setRefreshToken(refresh);
  }

  await setTenantContext({ tenant_slug });

  return NextResponse.json({ ok: true }, { status: 200 });
}