import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

function readError(body: any, fallback: string) {
  if (!body) return fallback;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));

  const res = await backendFetch("/api/v1/finance/policy", {
    method: "PUT",
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json({ detail: readError(data, "Failed to update policy") }, { status: res.status });
  }

  return NextResponse.json(data, { status: 200 });
}