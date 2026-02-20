import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

function readError(body: any, fallback: string) {
  if (!body) return fallback;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") || "50";
  const offset = searchParams.get("offset") || "0";
  const action = searchParams.get("action") || "";
  const resource = searchParams.get("resource") || "";
  const actor = searchParams.get("actor_user_id") || "";

  const qs = new URLSearchParams({ limit, offset });
  if (action) qs.set("action", action);
  if (resource) qs.set("resource", resource);
  if (actor) qs.set("actor_user_id", actor);

  try {
    const res = await backendFetch(`/api/v1/audit/logs?${qs.toString()}`, {
      method: "GET",
    });
    const data = await res.json().catch(() => []);

    if (!res.ok) {
      return NextResponse.json(
        { detail: readError(data, "Failed to load audit logs") },
        { status: res.status }
      );
    }

    return NextResponse.json(Array.isArray(data) ? data : [], { status: 200 });
  } catch {
    return NextResponse.json(
      { detail: "Audit service unavailable" },
      { status: 503 }
    );
  }
}
