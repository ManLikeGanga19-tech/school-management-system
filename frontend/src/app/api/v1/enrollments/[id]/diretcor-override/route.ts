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
 * POST /api/v1/enrollments/[id]/director-override
 *
 * Director-level action: clears the secretary edit lock on an enrolled
 * student record, resetting the edit counter to 0.
 *
 * Body: { note?: string }
 * Permission enforced on backend: enrollment.director.override
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // note is optional — empty body is fine
  }

  try {
    const res = await backendFetch(
      `/api/v1/enrollments/${encodeURIComponent(id)}/director-override`,
      {
        method: "POST",
        body: JSON.stringify({ note: body?.note ?? null }),
      }
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { detail: readError(data, "Director override failed") },
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