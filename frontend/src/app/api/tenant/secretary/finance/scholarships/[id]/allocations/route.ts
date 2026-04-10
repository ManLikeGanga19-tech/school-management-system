import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

/**
 * GET /api/tenant/secretary/finance/scholarships/[id]/allocations
 *
 * Proxies to backend GET /api/v1/finance/scholarships/{id}/allocations
 * Returns a list of students who received a specific scholarship.
 */
// Next.js 15+: params is a Promise — must be awaited before accessing properties
type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _req: NextRequest,
  { params }: RouteContext
) {
  const { id } = await params;
  try {
    const res = await backendFetch(
      `/api/v1/finance/scholarships/${id}/allocations`,
      { method: "GET" }
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const detail =
        typeof data?.detail === "string" ? data.detail : "Failed to load allocations";
      return NextResponse.json({ detail }, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { detail: "Upstream unavailable" },
      { status: 502 }
    );
  }
}
