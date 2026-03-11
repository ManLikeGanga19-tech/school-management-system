import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { backendFetch } from "@/server/backend/client";
import { clearPublicAuthCookies } from "@/lib/auth/cookies";

export async function POST() {
  const refresh = (await cookies()).get("sms_public_refresh")?.value;

  await backendFetch("/api/v1/public/auth/logout", {
    method: "POST",
    headers: refresh ? { Cookie: `sms_public_refresh=${refresh}` } : {},
    cache: "no-store",
  }).catch(() => null);

  await clearPublicAuthCookies();
  return NextResponse.json({ ok: true }, { status: 200 });
}
