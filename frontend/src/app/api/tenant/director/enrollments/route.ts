import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

type WorkflowAction =
  | "submit"
  | "approve"
  | "reject"
  | "enroll"
  | "transfer_request"
  | "transfer_approve"
  | "delete";

const WORKFLOW_ACTIONS = new Set<WorkflowAction>([
  "submit",
  "approve",
  "reject",
  "enroll",
  "transfer_request",
  "transfer_approve",
  "delete",
]);

function readError(body: any, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

// ─── GET /api/tenant/director/enrollments ─────────────────────────────────────
// Fetch all enrollment records for this tenant (director sees every status).

export async function GET() {
  const res  = await backendFetch("/api/v1/enrollments/", { method: "GET" });
  const data = await res.json().catch(() => []);
  return NextResponse.json(data, { status: res.status });
}

// ─── POST /api/tenant/director/enrollments ────────────────────────────────────
// Sub-cases distinguished by `action`:
//   action === "create"        → POST /api/v1/enrollments/         (new intake)
//   action === "delete"        → POST /api/v1/enrollments/:id/soft-delete
//   action === <workflow>      → POST /api/v1/enrollments/:id/<action>

export async function POST(req: Request) {
  const body   = await req.json().catch(() => ({}));
  const action = String(body?.action || "").trim();

  // ── Create new enrollment ──
  if (action === "create") {
    const payload = body?.payload;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        { detail: "payload object is required for create" },
        { status: 400 }
      );
    }

    const res  = await backendFetch("/api/v1/enrollments/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { detail: readError(data, "Failed to create enrollment") },
        { status: res.status }
      );
    }
    return NextResponse.json({ ok: true, enrollment: data }, { status: 201 });
  }

  // ── All other actions need an enrollment_id ──
  const enrollmentId    = String(body?.enrollment_id   || "").trim();
  const reason          = String(body?.reason          || "").trim();
  const admissionNumber = body?.admission_number
    ? String(body.admission_number).trim()
    : undefined;

  if (!enrollmentId) {
    return NextResponse.json({ detail: "enrollment_id is required" }, { status: 400 });
  }

  if (!WORKFLOW_ACTIONS.has(action as WorkflowAction)) {
    return NextResponse.json(
      {
        detail:
          "Invalid action. Use create|submit|approve|reject|enroll|transfer_request|transfer_approve|delete",
      },
      { status: 400 }
    );
  }

  const id = encodeURIComponent(enrollmentId);

  // ── Soft delete (director only) ──
  // Sets status → DELETED. Frontend confirms hard DELETE separately.
  if (action === "delete") {
    const res  = await backendFetch(`/api/v1/enrollments/${id}/soft-delete`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { detail: readError(data, "Failed to mark enrollment as deleted") },
        { status: res.status }
      );
    }
    return NextResponse.json({ ok: true, enrollment: data }, { status: 200 });
  }

  // ── Standard workflow actions ──
  type StandardAction = Exclude<WorkflowAction, "delete">;

  const pathByAction: Record<StandardAction, string> = {
    submit:           `/api/v1/enrollments/${id}/submit`,
    approve:          `/api/v1/enrollments/${id}/approve`,
    reject:           `/api/v1/enrollments/${id}/reject`,
    enroll:           `/api/v1/enrollments/${id}/enroll`,
    transfer_request: `/api/v1/enrollments/${id}/transfer/request`,
    transfer_approve: `/api/v1/enrollments/${id}/transfer/approve`,
  };

  let fetchOptions: RequestInit = { method: "POST" };

  if (action === "reject" && reason) {
    fetchOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    };
  } else if (action === "enroll" && admissionNumber) {
    fetchOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admission_number: admissionNumber }),
    };
  }

  const res  = await backendFetch(
    pathByAction[action as StandardAction],
    fetchOptions
  );
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json(
      { detail: readError(data, `Failed to execute action: ${action}`) },
      { status: res.status }
    );
  }

  return NextResponse.json({ ok: true, enrollment: data }, { status: 200 });
}

// ─── PATCH /api/tenant/director/enrollments ───────────────────────────────────
// Update the payload of an existing enrollment (director has no edit limit).
// Body: { enrollment_id: string, payload: Partial<EnrollmentPayload> }

export async function PATCH(req: Request) {
  const body         = await req.json().catch(() => ({}));
  const enrollmentId = String(body?.enrollment_id || "").trim();
  const payload      = body?.payload;

  if (!enrollmentId) {
    return NextResponse.json({ detail: "enrollment_id is required" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ detail: "payload object is required" }, { status: 400 });
  }

  const res  = await backendFetch(
    `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    }
  );
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json(
      { detail: readError(data, "Failed to update enrollment record") },
      { status: res.status }
    );
  }

  return NextResponse.json({ ok: true, enrollment: data }, { status: 200 });
}

// ─── DELETE /api/tenant/director/enrollments ──────────────────────────────────
// Hard-delete: permanently removes the enrollment from the database.
// Body: { enrollment_id: string }
// Only call this after soft-delete has already been confirmed.

export async function DELETE(req: Request) {
  const body         = await req.json().catch(() => ({}));
  const enrollmentId = String(body?.enrollment_id || "").trim();

  if (!enrollmentId) {
    return NextResponse.json({ detail: "enrollment_id is required" }, { status: 400 });
  }

  const res = await backendFetch(
    `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}`,
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
}