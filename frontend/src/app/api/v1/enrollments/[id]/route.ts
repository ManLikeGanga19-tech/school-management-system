import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

function readError(body: any, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

// Next.js 15+: params is a Promise — must be awaited before accessing properties
type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/v1/enrollments/[id]
 * Fetch a single enrollment by ID.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  try {
    const res = await backendFetch(
      `/api/v1/enrollments/${encodeURIComponent(id)}`,
      { method: "GET" }
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { detail: readError(data, "Enrollment not found") },
        { status: res.status }
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json(
      { detail: "Enrollment service unavailable" },
      { status: 503 }
    );
  }
}

/**
 * PATCH /api/v1/enrollments/[id]
 *
 * Merge-update an enrollment's payload.
 * Only fields present in body.payload are merged — existing fields are preserved.
 * Body: { payload: { field: value, ... } }
 */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const payload =
    body?.payload && typeof body.payload === "object" ? body.payload : null;

  if (payload === null) {
    return NextResponse.json(
      { detail: "payload object is required" },
      { status: 400 }
    );
  }

  try {
    const res = await backendFetch(
      `/api/v1/enrollments/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ payload }),
      }
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { detail: readError(data, "Failed to update enrollment") },
        { status: res.status }
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json(
      { detail: "Enrollment service unavailable" },
      { status: 503 }
    );
  }
}

/**
 * DELETE /api/v1/enrollments/[id]
 *
 * Permanently removes an enrollment record from the database.
 * Director-only. Should only be called after a soft-delete (status=DELETED)
 * has already been confirmed by the director.
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  try {
    const res = await backendFetch(
      `/api/v1/enrollments/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );

    if (res.status === 204 || res.status === 200) {
      return NextResponse.json({ deleted: true }, { status: 200 });
    }

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(
      { detail: readError(data, "Permanent delete failed") },
      { status: res.status }
    );
  } catch {
    return NextResponse.json(
      { detail: "Enrollment service unavailable" },
      { status: 503 }
    );
  }
}