import { NextResponse } from "next/server";

import { publicBackendFetchWithRefresh } from "@/server/backend/prospect-client";

export async function GET() {
  let res: Response;
  try {
    res = await publicBackendFetchWithRefresh("/api/v1/public/requests", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Prospect request service unavailable. Please try again." },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => []);
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  let res: Response;
  try {
    res = await publicBackendFetchWithRefresh("/api/v1/public/requests", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Prospect request service unavailable. Please try again." },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
