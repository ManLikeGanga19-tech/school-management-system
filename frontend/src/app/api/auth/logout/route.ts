// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendFetch } from "@/server/backend/client";
import {
  clearAllAuthCookies,
  COOKIE_TENANT_ID,
  COOKIE_TENANT_SLUG,
} from "@/lib/auth/cookies";

// Keep these here because middleware expects them
const COOKIE_SAAS_ACCESS = "sms_saas_access";
const COOKIE_SAAS_REFRESH = "sms_saas_refresh";

export async function POST() {
  // 1) Best-effort backend logout (both modes)
  // Tenant logout
  await backendFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
  // SaaS logout (if your backend supports it - your TenantMiddleware bypass list suggests it does)
  await backendFetch("/api/v1/auth/logout/saas", { method: "POST" }).catch(() => null);

  // 2) Clear our cookies (tenant + saas + tenant context)
  await clearAllAuthCookies(); // clears sms_access + sms_refresh

  const c = await cookies();
  c.delete(COOKIE_TENANT_ID);
  c.delete(COOKIE_TENANT_SLUG);
  c.delete(COOKIE_SAAS_ACCESS);
  c.delete(COOKIE_SAAS_REFRESH);

  return NextResponse.json({ ok: true }, { status: 200 });
}