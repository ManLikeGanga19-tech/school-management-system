import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

function readError(body: any, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

/**
 * GET /api/v1/finance/fee-structures
 *
 * Returns the list of fee structures configured for this tenant.
 * Used by the intake wizard Step 4 fee structure selector.
 *
 * Expected backend response shape:
 *   [{ id: string, name: string, class_code: string, code: string }, ...]
 */
export async function GET() {
  try {
    const res = await backendFetch("/api/v1/finance/fee-structures/", {
      method: "GET",
    });
    const data = await res.json().catch(() => []);

    if (!res.ok) {
      return NextResponse.json(
        { detail: readError(data, "Failed to load fee structures") },
        { status: res.status }
      );
    }

    return NextResponse.json(Array.isArray(data) ? data : [], { status: 200 });
  } catch {
    return NextResponse.json(
      { detail: "Finance service unavailable" },
      { status: 503 }
    );
  }
}