import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

type EnrollmentAction =
  | "submit"
  | "approve"
  | "reject"
  | "enroll"
  | "transfer_request"
  | "transfer_approve";

function readError(body: any, fallback: string) {
  if (!body) return fallback;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

export async function GET() {
  const res = await backendFetch("/api/v1/enrollments/", { method: "GET" });
  const data = await res.json().catch(() => []);
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const enrollmentId = String(body?.enrollment_id || "").trim();
  const action = String(body?.action || "").trim() as EnrollmentAction;
  const reason = String(body?.reason || "").trim();

  if (!enrollmentId) {
    return NextResponse.json({ detail: "enrollment_id is required" }, { status: 400 });
  }

  const pathByAction: Record<EnrollmentAction, string> = {
    submit: `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/submit`,
    approve: `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/approve`,
    reject: `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/reject${
      reason ? `?reason=${encodeURIComponent(reason)}` : ""
    }`,
    enroll: `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/enroll`,
    transfer_request: `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/transfer/request`,
    transfer_approve: `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/transfer/approve`,
  };

  if (!pathByAction[action]) {
    return NextResponse.json(
      { detail: "Invalid action. Use submit|approve|reject|enroll|transfer_request|transfer_approve" },
      { status: 400 }
    );
  }

  const res = await backendFetch(pathByAction[action], { method: "POST" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json({ detail: readError(data, "Failed to execute enrollment action") }, { status: res.status });
  }

  return NextResponse.json({ ok: true, enrollment: data }, { status: 200 });
}
