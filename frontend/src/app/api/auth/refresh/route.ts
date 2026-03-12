import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";
import {
  clearClientModeCookie,
  clearTenantAuthCookies,
  setAccessToken,
  setRefreshToken,
  setTenantContext,
} from "@/lib/auth/cookies";
import { decodeAccess } from "@/lib/auth/jwt";
import { extractCookieValue } from "@/server/http/set-cookie";

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
    const claims = decodeAccess(String(data.access_token));
    if (claims?.tenant_id && typeof claims.tenant_id === "string") {
      await setTenantContext({ tenant_id: claims.tenant_id });
    }
  }

  const refresh = extractCookieValue(res.headers, "sms_refresh");
  if (refresh) {
    await setRefreshToken(refresh);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
