import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") || "50";
  const offset = searchParams.get("offset") || "0";
  const action = searchParams.get("action") || "";
  const resource = searchParams.get("resource") || "";

  const qs = new URLSearchParams({ limit, offset });
  if (action) qs.set("action", action);
  if (resource) qs.set("resource", resource);

  const res = await backendFetch(`/api/v1/audit/logs?${qs.toString()}`, { method: "GET" });
  const data = await res.json().catch(() => []);
  return NextResponse.json(data, { status: res.status });
}