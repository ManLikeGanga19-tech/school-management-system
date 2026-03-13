import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";
import {
  clearAllAuthCookiesOnResponse,
} from "@/lib/auth/cookies";

export async function POST() {
  // 1) Best-effort backend logout (both modes)
  // Tenant logout
  await backendFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
  // SaaS logout (if your backend supports it - your TenantMiddleware bypass list suggests it does)
  await backendFetch("/api/v1/auth/logout/saas", { method: "POST" }).catch(() => null);

  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearAllAuthCookiesOnResponse(response);
  return response;
}
