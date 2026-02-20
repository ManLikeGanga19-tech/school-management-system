import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

type EnrollmentAction =
  | "create"
  | "submit"
  | "approve"
  | "reject"
  | "enroll"
  | "transfer_request"
  | "transfer_approve";

type EnrollmentWorkflowAction = Exclude<EnrollmentAction, "create">;

function readError(body: any, fallback: string) {
  if (!body) return fallback;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

export async function GET() {
  try {
    const res = await backendFetch("/api/v1/enrollments/", { method: "GET" });
    const data = await res.json().catch(() => []);

    if (!res.ok) {
      return NextResponse.json(
        { detail: readError(data, "Failed to load enrollments") },
        { status: res.status }
      );
    }

    return NextResponse.json(Array.isArray(data) ? data : [], { status: 200 });
  } catch {
    return NextResponse.json(
      { detail: "Enrollment service unavailable" },
      { status: 503 }
    );
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "").trim() as EnrollmentAction;
  const enrollmentId = String(body?.enrollment_id || "").trim();
  const reason = String(body?.reason || "").trim();

  if (action === "create") {
    const payload =
      body?.payload && typeof body.payload === "object" ? body.payload : null;

    if (!payload) {
      return NextResponse.json(
        { detail: "payload object is required for create action" },
        { status: 400 }
      );
    }

    const res = await backendFetch("/api/v1/enrollments/", {
      method: "POST",
      body: JSON.stringify({ payload }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { detail: readError(data, "Failed to create enrollment") },
        { status: res.status }
      );
    }

    return NextResponse.json({ ok: true, enrollment: data }, { status: 200 });
  }

  if (!enrollmentId) {
    return NextResponse.json({ detail: "enrollment_id is required" }, { status: 400 });
  }

  const actionPath: Record<EnrollmentWorkflowAction, string> = {
    submit: `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/submit`,
    approve: `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/approve`,
    reject: `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/reject${
      reason ? `?reason=${encodeURIComponent(reason)}` : ""
    }`,
    enroll: `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/enroll`,
    transfer_request: `/api/v1/enrollments/${encodeURIComponent(
      enrollmentId
    )}/transfer/request`,
    transfer_approve: `/api/v1/enrollments/${encodeURIComponent(
      enrollmentId
    )}/transfer/approve`,
  };

  if (!(action in actionPath)) {
    return NextResponse.json(
      {
        detail:
          "Invalid action. Use create|submit|approve|reject|enroll|transfer_request|transfer_approve",
      },
      { status: 400 }
    );
  }

  const res = await backendFetch(actionPath[action as EnrollmentWorkflowAction], {
    method: "POST",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { detail: readError(data, "Failed to execute enrollment action") },
      { status: res.status }
    );
  }

  return NextResponse.json({ ok: true, enrollment: data }, { status: 200 });
}
