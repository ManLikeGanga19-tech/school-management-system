import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { backendFetch } from "@/server/backend/client";
import {
  clearClientModeCookieOnResponse,
  clearTenantAuthCookiesOnResponse,
  setAccessTokenOnResponse,
  setRefreshTokenOnResponse,
  setTenantContextOnResponse,
  setClientModeCookieOnResponse,
} from "@/lib/auth/cookies";
import { decodeAccess } from "@/lib/auth/jwt";
import { resolvePortalContext } from "@/lib/platform-host";
import { extractCookieValue } from "@/server/http/set-cookie";

export async function POST() {
  const tenantRefresh = (await cookies()).get("sms_refresh")?.value;
  if (!tenantRefresh) {
    const response = NextResponse.json(
      { detail: "Missing refresh token" },
      { status: 401 }
    );
    clearTenantAuthCookiesOnResponse(response);
    clearClientModeCookieOnResponse(response);
    return response;
  }

  let res: Response;
  try {
    res = await backendFetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: `sms_refresh=${tenantRefresh}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Refresh service unavailable. Please try again." },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const response = NextResponse.json(data, { status: res.status });
    clearTenantAuthCookiesOnResponse(response);
    clearClientModeCookieOnResponse(response);
    return response;
  }

  const hdrs = await headers();
  const portal = resolvePortalContext(hdrs.get("x-forwarded-host") ?? hdrs.get("host"));
  let tenantId: string | null = null;
  let tenantSlug: string | null = null;

  if (data?.access_token) {
    const claims = decodeAccess(String(data.access_token));
    tenantId = typeof claims?.tenant_id === "string" ? claims.tenant_id : null;
    tenantSlug =
      portal.kind === "tenant" && portal.tenantSlug
        ? portal.tenantSlug
        : (await cookies()).get("sms_tenant_slug")?.value || null;
  }

  const response = NextResponse.json(
    {
      ok: true,
      access_token: data?.access_token,
      tenant_id: tenantId,
      tenant_slug: tenantSlug,
    },
    { status: 200 }
  );

  if (data?.access_token && tenantId) {
    setAccessTokenOnResponse(response, data.access_token);
    setTenantContextOnResponse(response, {
      tenant_id: tenantId,
      tenant_slug: tenantSlug ?? undefined,
    });
    setClientModeCookieOnResponse(response, "tenant");
  }
  const refresh = extractCookieValue(res.headers, "sms_refresh");
  if (refresh) {
    setRefreshTokenOnResponse(response, refresh);
  }

  return response;
}
