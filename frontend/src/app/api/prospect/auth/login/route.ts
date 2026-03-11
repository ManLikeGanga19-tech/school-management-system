import { NextResponse } from "next/server";

import { backendFetch } from "@/server/backend/client";
import { clearPublicAuthCookies } from "@/lib/auth/cookies";
import { syncPublicSession } from "@/server/backend/prospect-client";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  await clearPublicAuthCookies();

  let res: Response;
  try {
    res = await backendFetch("/api/v1/public/auth/login", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Prospect login service unavailable. Please try again." },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  await syncPublicSession(res, data);
  return NextResponse.json({ ok: true, account: data?.account ?? null }, { status: 200 });
}
