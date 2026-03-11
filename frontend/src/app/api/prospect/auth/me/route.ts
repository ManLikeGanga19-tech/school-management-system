import { NextResponse } from "next/server";

import { publicBackendFetchWithRefresh } from "@/server/backend/prospect-client";

export async function GET() {
  let res: Response;
  try {
    res = await publicBackendFetchWithRefresh("/api/v1/public/auth/me", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Prospect profile service unavailable. Please try again." },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
