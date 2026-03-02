import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { setSaasAccessToken, setSaasRefreshToken } from "@/lib/auth/cookies";

function extractCookieValue(setCookie: string | null, cookieName: string) {
  if (!setCookie) return null;
  const re = new RegExp(`${cookieName}=([^;]+)`);
  const m = setCookie.match(re);
  return m?.[1] ?? null;
}

export async function POST() {
  const BACKEND =
    (process.env.BACKEND_BASE_URL || "http://127.0.0.1:8000/api/v1").replace(/\/+$/g, "");

  const saasRefresh = (await cookies()).get("sms_saas_refresh")?.value;
  if (!saasRefresh) {
    return NextResponse.json({ detail: "Missing refresh token" }, { status: 401 });
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND}/auth/refresh/saas`, {
      method: "POST",
      headers: {
        Cookie: `sms_refresh=${saasRefresh}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "SaaS refresh service unavailable. Please try again." },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  if (data?.access_token) {
    await setSaasAccessToken(data.access_token);
  }

  const setCookie = res.headers.get("set-cookie");
  const rotatedRefresh = extractCookieValue(setCookie, "sms_refresh");
  if (rotatedRefresh) {
    await setSaasRefreshToken(rotatedRefresh);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
