import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendFetch } from "@/server/backend/client";
import {
  clearClientModeCookieOnResponse,
  clearSaasAuthCookiesOnResponse,
  setSaasAccessTokenOnResponse,
  setSaasRefreshTokenOnResponse,
  setClientModeCookieOnResponse,
} from "@/lib/auth/cookies";
import { extractCookieValue } from "@/server/http/set-cookie";

export async function POST() {
  const saasRefresh = (await cookies()).get("sms_saas_refresh")?.value;
  if (!saasRefresh) {
    return NextResponse.json({ detail: "Missing refresh token" }, { status: 401 });
  }

  let res: Response;
  try {
    res = await backendFetch("/api/v1/auth/refresh/saas", {
      method: "POST",
      headers: {
        Cookie: `sms_refresh=${saasRefresh}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    // Backward compatibility: some older backend branches exposed /auth/saas/refresh.
    if (res.status === 404) {
      res = await backendFetch("/api/v1/auth/saas/refresh", {
        method: "POST",
        headers: {
          Cookie: `sms_refresh=${saasRefresh}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
    }
  } catch {
    return NextResponse.json(
      { detail: "SaaS refresh service unavailable. Please try again." },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const response = NextResponse.json(data, { status: res.status });
    clearSaasAuthCookiesOnResponse(response);
    clearClientModeCookieOnResponse(response);
    return response;
  }

  const response = NextResponse.json(
    {
      ok: true,
      access_token: data?.access_token,
    },
    { status: 200 }
  );

  if (data?.access_token) {
    setSaasAccessTokenOnResponse(response, data.access_token);
    setClientModeCookieOnResponse(response, "saas");
  }

  const rotatedRefresh = extractCookieValue(res.headers, "sms_refresh");
  if (rotatedRefresh) {
    setSaasRefreshTokenOnResponse(response, rotatedRefresh);
  }

  return response;
}
