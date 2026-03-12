import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { backendFetch } from "@/server/backend/client";

export async function GET() {
  const access = (await cookies()).get("sms_access")?.value;

  if (!access) {
    return NextResponse.json({ detail: "Missing access token" }, { status: 401 });
  }

  let res: Response;
  try {
    res = await backendFetch("/api/v1/auth/me", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${access}`,
      },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Tenant profile service unavailable. Please try again." },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return NextResponse.json(data, { status: 200 });
}
