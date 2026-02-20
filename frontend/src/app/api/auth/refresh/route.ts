import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";
import { setAccessToken, setRefreshToken } from "@/lib/auth/cookies";

export async function POST() {
  const res = await backendFetch("/api/v1/auth/refresh", { method: "POST" });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  if (data?.access_token) setAccessToken(data.access_token);

  // IMPORTANT:
  // Your backend returns new refresh in Set-Cookie (sms_refresh).
  // Since we call backend server-side, we can't “auto forward” it reliably.
  // Best practice: backend also returns the refresh token value in body OR we parse set-cookie.
  // To keep it enterprise-ready, update backend later to also return refresh token in body.
  //
  // For now we just keep access token rotation working; refresh cookie is already in browser if you logged in directly.
  // When we switch login to proxy cookie correctly, we'll setRefreshToken here too.
  //
  // If you want now: modify backend refresh endpoint to include refresh token in JSON response.

  return NextResponse.json({ ok: true }, { status: 200 });
}
