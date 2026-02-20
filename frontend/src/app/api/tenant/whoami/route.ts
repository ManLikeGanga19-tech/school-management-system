import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

export async function GET() {
  const res = await backendFetch("/api/v1/tenants/whoami", { method: "GET" });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
