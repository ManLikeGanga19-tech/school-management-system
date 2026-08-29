import { NextResponse } from "next/server";

import { backendFetch } from "@/server/backend/client";
import {
  setAccessTokenOnResponse,
  setTenantContextOnResponse,
  setRefreshTokenOnResponse,
} from "@/lib/auth/cookies";
import { extractCookieValue } from "@/server/http/set-cookie";

/**
 * Campus switch (BFF). The dashboards are server-rendered and resolve the tenant
 * from the `sms_tenant_slug` / `sms_tenant_id` cookies, so switching campus MUST
 * rewrite those cookies (and the access token) — not just localStorage. This
 * route calls the backend switch endpoint (which re-verifies group membership and
 * audits the move) using the caller's current cookies, then stamps the new
 * campus's session cookies so the next SSR render shows the right campus.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const tenant_id = String(body?.tenant_id ?? "").trim();
  const tenant_slug = String(body?.tenant_slug ?? "").trim().toLowerCase();

  if (!tenant_id) {
    return NextResponse.json({ detail: "tenant_id is required" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await backendFetch("/api/v1/auth/switch-campus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ detail: "Campus switch service unavailable." }, { status: 502 });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Forward the backend's reason (e.g. "not a member of that campus").
    return NextResponse.json(data, { status: res.status });
  }

  const response = NextResponse.json(
    { ok: true, access_token: data?.access_token, tenant_id, tenant_slug },
    { status: 200 }
  );

  if (data?.access_token) {
    setAccessTokenOnResponse(response, data.access_token, true);
    setTenantContextOnResponse(response, {
      tenant_id,
      tenant_slug: tenant_slug || undefined,
    });
  }
  const refresh = extractCookieValue(res.headers, "sms_refresh");
  if (refresh) {
    setRefreshTokenOnResponse(response, refresh, true);
  }

  return response;
}
