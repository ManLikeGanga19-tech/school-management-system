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
  const user_id = String(body?.user_id || "").trim();
  const permission_code = String(body?.permission_code || "").trim();
  const effect = String(body?.effect || "ALLOW").trim().toUpperCase();

  if (!user_id || !permission_code) {
    return NextResponse.json({ detail: "user_id and permission_code are required" }, { status: 400 });
  }

  if (!["ALLOW", "DENY"].includes(effect)) {
    return NextResponse.json({ detail: "effect must be ALLOW or DENY" }, { status: 400 });
  }

  const res = await backendFetch("/api/v1/admin/permissions/override", {
    method: "POST",
    body: JSON.stringify({ user_id, permission_code, effect }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ detail: readError(data, "Failed to set permission override") }, { status: res.status });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const user_id = String(body?.user_id || "").trim();
  const permission_code = String(body?.permission_code || "").trim();

  if (!user_id || !permission_code) {
    return NextResponse.json({ detail: "user_id and permission_code are required" }, { status: 400 });
  }

  const res = await backendFetch("/api/v1/admin/permissions/override", {
    method: "DELETE",
    body: JSON.stringify({ user_id, permission_code }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ detail: readError(data, "Failed to delete permission override") }, { status: res.status });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}