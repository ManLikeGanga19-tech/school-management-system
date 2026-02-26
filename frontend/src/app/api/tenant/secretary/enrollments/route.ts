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

function readError(body: any, fallback: string): string {
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
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body?.action ?? "").trim() as EnrollmentAction;
  const enrollmentId = String(body?.enrollment_id ?? "").trim();

  // ── CREATE ────────────────────────────────────────────────────────────────
  if (action === "create") {
    const payload =
      body?.payload && typeof body.payload === "object" ? body.payload : null;

    if (!payload) {
      return NextResponse.json(
        { detail: "payload object is required for create action" },
        { status: 400 }
      );
    }

    try {
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
    } catch {
      return NextResponse.json(
        { detail: "Enrollment service unavailable" },
        { status: 503 }
      );
    }
  }

  // ── WORKFLOW ACTIONS ──────────────────────────────────────────────────────
  if (!enrollmentId) {
    return NextResponse.json(
      { detail: "enrollment_id is required for workflow actions" },
      { status: 400 }
    );
  }

  const base = `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}`;

  // Each entry: [path, fetchInit]
  type ActionDef = [string, RequestInit];

  const actionMap: Partial<Record<EnrollmentAction, ActionDef>> = {
    submit: [`${base}/submit`, { method: "POST" }],

    approve: [`${base}/approve`, { method: "POST" }],

    // reason is now a JSON body field (not a query param) — matches backend schema
    reject: [
      `${base}/reject`,
      {
        method: "POST",
        body: JSON.stringify({
          reason: String(body?.reason ?? "").trim() || null,
        }),
      },
    ],

    // admission_number forwarded from UI; backend auto-generates if absent
    enroll: [
      `${base}/enroll`,
      {
        method: "POST",
        body: JSON.stringify({
          admission_number: body?.admission_number
            ? String(body.admission_number).trim()
            : null,
        }),
      },
    ],

    transfer_request: [`${base}/transfer/request`, { method: "POST" }],

    transfer_approve: [`${base}/transfer/approve`, { method: "POST" }],
  };

  if (!(action in actionMap)) {
    return NextResponse.json(
      {
        detail:
          "Invalid action. Valid values: create | submit | approve | reject | enroll | transfer_request | transfer_approve",
      },
      { status: 400 }
    );
  }

  const [path, init] = actionMap[action]!;

  try {
    const res = await backendFetch(path, init);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { detail: readError(data, `Failed to execute action "${action}"`) },
        { status: res.status }
      );
    }

    return NextResponse.json({ ok: true, enrollment: data }, { status: 200 });
  } catch {
    return NextResponse.json(
      { detail: "Enrollment service unavailable" },
      { status: 503 }
    );
  }
}