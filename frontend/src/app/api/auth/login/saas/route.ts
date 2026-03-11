import { NextResponse } from "next/server";
import { clearAllAuthCookies, setSaasAccessToken } from "@/lib/auth/cookies";
import { backendFetch } from "@/server/backend/client";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  // SaaS login must not depend on tenant cookies at all
  await clearAllAuthCookies();

  let res: Response;
  try {
    res = await backendFetch("/api/v1/auth/login/saas", {
      method: "POST",
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "SaaS login service unavailable. Please try again." },
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

  return NextResponse.json({ ok: true, access_token: data?.access_token }, { status: 200 });
}
