import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";
import {
  clearClientModeCookie,
  clearTenantAuthCookies,
  setAccessToken,
  setRefreshToken,
} from "@/lib/auth/cookies";

function extractCookieValue(setCookie: string | null, cookieName: string) {
  if (!setCookie) return null;
  const re = new RegExp(`${cookieName}=([^;]+)`);
  const m = setCookie.match(re);
  return m?.[1] ?? null;
}

export async function POST() {
  let res: Response;
  try {
    res = await backendFetch("/api/v1/auth/refresh", { method: "POST" });
  } catch {
    return NextResponse.json(
      { detail: "Refresh service unavailable. Please try again." },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    await clearTenantAuthCookies();
    await clearClientModeCookie();
    return NextResponse.json(data, { status: res.status });
  }

  if (data?.access_token) {
    await setAccessToken(data.access_token);
  }

  const setCookie = res.headers.get("set-cookie");
  const refresh = extractCookieValue(setCookie, "sms_refresh");
  if (refresh) {
    await setRefreshToken(refresh);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
