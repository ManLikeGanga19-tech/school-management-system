import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

/**
 * GET /api/tenant/classes
 *
 * Returns all classes configured for the current tenant.
 * Used by both the secretary and director enrollment forms
 * to populate the Admission Class dropdown.
 *
 * Expected response shape from backend:
 *   Array<{ id: string; name: string; code: string; ... }>
 */
export async function GET(req: NextRequest) {
  try {
    const res  = await backendFetch("/api/v1/classes/", { method: "GET" });
    const data = await res.json().catch(() => []);

    if (!res.ok) {
      // Return empty array so the UI degrades gracefully (shows "No classes
      // configured yet") rather than crashing the form.
      return NextResponse.json([], { status: 200 });
    }

    // Normalise: always return an array regardless of backend shape
    return NextResponse.json(Array.isArray(data) ? data : [], { status: 200 });
  } catch {
    // Network / service errors → return empty array, not 503, so the
    // dropdown stays functional (just empty).
    return NextResponse.json([], { status: 200 });
  }
}