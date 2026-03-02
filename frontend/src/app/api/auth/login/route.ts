import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";
import {
  setAccessToken,
  setRefreshToken,
  setTenantContext,
  clearSaasAuthCookies,
  clearTenantAuthCookies,
} from "@/lib/auth/cookies";
import { decodeAccess } from "@/lib/auth/jwt";
import { resolveTenantDashboard } from "@/lib/auth/tenant-dashboard";

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

function resolveLoginTimeoutMs() {
  const raw = Number(process.env.AUTH_LOGIN_TIMEOUT_MS || "60000");
  if (!Number.isFinite(raw)) return 60000;
  return Math.max(10000, Math.floor(raw));
}

async function requestTenantLogin(
  tenant_slug: string,
  email: string,
  password: string
): Promise<Response> {
  const timeoutMs = resolveLoginTimeoutMs();
  const maxAttempts = 2;

  let lastError: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await backendFetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        headers: { "x-tenant-slug": tenant_slug },
        signal: controller.signal,
      });
    } catch (err: any) {
      lastError = err;
      const isAbort = err?.name === "AbortError";
      // One retry for transient timeout/network failures.
      if (attempt < maxAttempts && isAbort) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Login request failed");
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

  let res;
  try {
    res = await requestTenantLogin(tenant_slug, email, password);
  } catch (err: any) {
    if (err && err.name === "AbortError") {
      return NextResponse.json({ detail: "Login request timed out" }, { status: 504 });
    }
    return NextResponse.json({ detail: "Network error while contacting backend" }, { status: 502 });
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json({ detail: readError(data, "Tenant login failed") }, { status: res.status });
  }

  let redirect_to = "/dashboard";

  if (data?.access_token) {
    await setAccessToken(data.access_token);
    const claims = decodeAccess(String(data.access_token));
    redirect_to = resolveTenantDashboard(claims?.roles);
  }

  const setCookie = res.headers.get("set-cookie");
  const refresh = extractCookieValue(setCookie, "sms_refresh");
  if (refresh) {
    await setRefreshToken(refresh);
  }

  await setTenantContext({ tenant_slug });

  return NextResponse.json({ ok: true, redirect_to }, { status: 200 });
}
