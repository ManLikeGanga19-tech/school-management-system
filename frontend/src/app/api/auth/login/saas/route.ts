import { NextResponse } from "next/server";
import { clearAllAuthCookies, setSaasAccessToken } from "@/lib/auth/cookies";

const BACKEND_BASE_URL =
  process.env.BACKEND_BASE_URL || "http://127.0.0.1:8000";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  // SaaS login must not depend on tenant cookies at all
  await clearAllAuthCookies();

  // IMPORTANT: backend route is /api/v1/auth/login/saas
  const res = await fetch(`${BACKEND_BASE_URL}/api/v1/auth/login/saas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  if (data?.access_token) {
    await setSaasAccessToken(data.access_token);
  }

  return NextResponse.json({ ok: true, access_token: data?.access_token }, { status: 200 });
}