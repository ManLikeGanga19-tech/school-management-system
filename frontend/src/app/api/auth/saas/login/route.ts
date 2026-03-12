import { NextResponse } from "next/server";
import {
  clearAllAuthCookies,
  setClientModeCookie,
  setSaasAccessToken,
  setSaasRefreshToken,
} from "@/lib/auth/cookies";
import { backendFetch } from "@/server/backend/client";

function extractCookieValue(setCookie: string | null, cookieName: string) {
  if (!setCookie) return null;
  const re = new RegExp(`${cookieName}=([^;]+)`);
  const m = setCookie.match(re);
  return m?.[1] ?? null;
}

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

  // ✅ Clear both modes to avoid cross-mode confusion
  await clearAllAuthCookies();

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

  // ✅ Backend returns access token for Authorization header usage
  const access = data?.access_token as string | undefined;
  if (access) {
    await setSaasAccessToken(access);
    await setClientModeCookie("saas");
  }

  // Best-effort mirror refresh cookie (if backend sets one)
  const setCookie = res.headers.get("set-cookie");
  const refresh =
    extractCookieValue(setCookie, "sms_saas_refresh") ||
    extractCookieValue(setCookie, "sms_refresh");

  if (refresh) {
    await setSaasRefreshToken(refresh);
  }

  // ✅ IMPORTANT: return access_token so frontend stores it and apiFetch sends Bearer
  return NextResponse.json(
    { ok: true, access_token: access },
    { status: 200 }
  );
}
