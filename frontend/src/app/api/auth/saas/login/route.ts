import { NextResponse } from "next/server";
import {
  clearAllAuthCookiesOnResponse,
  setClientModeCookieOnResponse,
  setSaasAccessTokenOnResponse,
  setSaasRefreshTokenOnResponse,
} from "@/lib/auth/cookies";
import { backendFetch } from "@/server/backend/client";
import { extractCookieValue } from "@/server/http/set-cookie";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const email = (body?.email || "").toString().trim().toLowerCase();
  const password = (body?.password || "").toString();

  if (!email || !password) {
    return NextResponse.json(
      { detail: "Email and password are required" },
      { status: 400 }
    );
  }

  let res: Response;
  try {
    res = await backendFetch("/api/v1/auth/login/saas", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "SaaS login service unavailable. Please try again." },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({} as any));

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  const response = NextResponse.json(
    { ok: true, access_token: data?.access_token },
    { status: 200 }
  );
  clearAllAuthCookiesOnResponse(response);

  // ✅ Backend returns access token for Authorization header usage
  const access = data?.access_token as string | undefined;
  if (access) {
    setSaasAccessTokenOnResponse(response, access);
    setClientModeCookieOnResponse(response, "saas");
  }

  // Best-effort mirror refresh cookie (if backend sets one)
  const refresh =
    extractCookieValue(res.headers, "sms_saas_refresh") ||
    extractCookieValue(res.headers, "sms_refresh");

  if (refresh) {
    setSaasRefreshTokenOnResponse(response, refresh);
  }

  return response;
}
