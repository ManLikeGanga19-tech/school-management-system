import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

function readError(body: any, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

/**
 * GET /api/tenant/secretary/invoices
 *
 * Query params forwarded to the backend:
 *   enrollment_id  – filter invoices for a specific enrollment
 *   purpose        – e.g. INTERVIEW_FEE | SCHOOL_FEES
 *   status         – e.g. PAID | UNPAID | PENDING
 *
 * Used by InterviewFeeCell to check whether an enrollment's interview fee
 * invoice exists and has been paid.
 */
export async function GET(req: NextRequest) {
  try {
    // Forward all query params as-is to the backend
    const incoming = req.nextUrl.searchParams;
    const qs = incoming.toString(); // already encoded
    const backendPath = `/api/v1/finance/invoices${qs ? `?${qs}` : ""}`;

    const res = await backendFetch(backendPath, { method: "GET" });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      // 404 from backend means no invoice exists for this enrollment — return
      // an empty array so the UI treats it as unpaid rather than an error.
      if (res.status === 404) {
        return NextResponse.json([], { status: 200 });
      }

      return NextResponse.json(
        { detail: readError(data, "Failed to load invoices") },
        { status: res.status }
      );
    }

    // Normalise: always return an array so the frontend doesn't need to
    // handle both shapes.
    const invoices = Array.isArray(data) ? data : data ? [data] : [];
    return NextResponse.json(invoices, { status: 200 });
  } catch {
    return NextResponse.json(
      { detail: "Finance service unavailable" },
      { status: 503 }
    );
  }
}