import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

function readError(body: any, fallback: string) {
  if (!body) return fallback;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode || "assign").trim();
  const user_id = String(body?.user_id || "").trim();
  const role_code = String(body?.role_code || "").trim();

  if (!user_id || !role_code) {
    return NextResponse.json(
      { detail: "user_id and role_code are required" },
      { status: 400 }
    );
  }

  const path =
    mode === "remove" ? "/api/v1/admin/roles/remove" : "/api/v1/admin/roles/assign";

  const res = await backendFetch(path, {
    method: "POST",
    body: JSON.stringify({ user_id, role_code }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { detail: readError(data, "Role operation failed") },
      { status: res.status }
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
