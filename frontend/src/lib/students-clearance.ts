import { asArray } from "@/lib/utils/asArray";

export type StudentClearanceRow = {
  enrollment_id: string;
  student_name: string;
  admission_number: string;
  class_code: string;
  term_code: string;
  status: string;
  nemis_no: string;
  assessment_no: string;
  fees_status: string;
  fees_balance: string;
  fees_cleared: boolean;
  outstanding_assets: number;
  assets_cleared: boolean;
  grade9_candidate: boolean;
  transfer_requested: boolean;
  transfer_approved: boolean;
  ready_for_transfer_request: boolean;
  ready_for_director_approval: boolean;
  blockers: string[];
  transfer_requested_at: string;
  transfer_approved_at: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const token = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(token)) return true;
    if (["false", "0", "no", "n"].includes(token)) return false;
  }
  return fallback;
}

function asInteger(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return fallback;
}

function normalizeBlockers(value: unknown): string[] {
  return asArray<unknown>(value)
    .map((item) => asString(item))
    .filter(Boolean);
}

export function normalizeStudentClearanceRows(input: unknown): StudentClearanceRow[] {
  const rows: StudentClearanceRow[] = [];
  const seen = new Set<string>();

  for (const raw of asArray<unknown>(input)) {
    const obj = asObject(raw);
    if (!obj) continue;

    const enrollmentId = asString(obj.enrollment_id);
    if (!enrollmentId || seen.has(enrollmentId)) continue;
    seen.add(enrollmentId);

    rows.push({
      enrollment_id: enrollmentId,
      student_name: asString(obj.student_name) || "Unknown student",
      admission_number: asString(obj.admission_number) || "N/A",
      class_code: asString(obj.class_code) || "N/A",
      term_code: asString(obj.term_code) || "N/A",
      status: asString(obj.status).toUpperCase() || "UNKNOWN",
      nemis_no: asString(obj.nemis_no) || "N/A",
      assessment_no: asString(obj.assessment_no) || "N/A",
      fees_status: asString(obj.fees_status).toUpperCase() || "UNKNOWN",
      fees_balance: asString(obj.fees_balance) || "0",
      fees_cleared: asBoolean(obj.fees_cleared),
      outstanding_assets: asInteger(obj.outstanding_assets),
      assets_cleared: asBoolean(obj.assets_cleared, true),
      grade9_candidate: asBoolean(obj.grade9_candidate),
      transfer_requested: asBoolean(obj.transfer_requested),
      transfer_approved: asBoolean(obj.transfer_approved),
      ready_for_transfer_request: asBoolean(obj.ready_for_transfer_request),
      ready_for_director_approval: asBoolean(obj.ready_for_director_approval),
      blockers: normalizeBlockers(obj.blockers),
      transfer_requested_at: asString(obj.transfer_requested_at),
      transfer_approved_at: asString(obj.transfer_approved_at),
    });
  }

  return rows;
}
