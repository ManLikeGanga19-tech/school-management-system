import { asArray } from "@/lib/utils/asArray";

type UnknownRecord = Record<string, unknown>;

function asObject(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asBoolean(value: unknown, defaultValue = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return defaultValue;
}

export type TenantExam = {
  id: string;
  name: string;
  term_id: string | null;
  term_code: string | null;
  term_name: string | null;
  class_code: string;
  subject_id: string | null;
  subject_code: string | null;
  subject_name: string | null;
  invigilator_staff_id: string | null;
  invigilator_staff_no: string | null;
  invigilator_name: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  location: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type TenantExamMark = {
  id: string;
  exam_id: string;
  exam_name: string;
  term_id: string | null;
  term_code: string | null;
  term_name: string | null;
  class_code: string;
  subject_id: string;
  subject_code: string | null;
  subject_name: string | null;
  student_enrollment_id: string;
  student_name: string;
  admission_number: string | null;
  marks_obtained: string;
  max_marks: string;
  grade: string | null;
  remarks: string | null;
  recorded_at: string | null;
  updated_at: string | null;
};

export function normalizeExams(input: unknown): TenantExam[] {
  return asArray<unknown>(input)
    .map((raw): TenantExam | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      const name = asString(row.name);
      const classCode = asString(row.class_code).toUpperCase();
      const startDate = asString(row.start_date);
      const endDate = asString(row.end_date);
      if (!id || !name || !classCode || !startDate || !endDate) return null;

      return {
        id,
        name,
        term_id: asString(row.term_id) || null,
        term_code: asString(row.term_code) || null,
        term_name: asString(row.term_name) || null,
        class_code: classCode,
        subject_id: asString(row.subject_id) || null,
        subject_code: asString(row.subject_code) || null,
        subject_name: asString(row.subject_name) || null,
        invigilator_staff_id: asString(row.invigilator_staff_id) || null,
        invigilator_staff_no: asString(row.invigilator_staff_no) || null,
        invigilator_name: asString(row.invigilator_name) || null,
        start_date: startDate,
        end_date: endDate,
        start_time: asString(row.start_time) || null,
        end_time: asString(row.end_time) || null,
        status: asString(row.status).toUpperCase() || "SCHEDULED",
        location: asString(row.location) || null,
        notes: asString(row.notes) || null,
        is_active: asBoolean(row.is_active, true),
        created_at: asString(row.created_at) || null,
        updated_at: asString(row.updated_at) || null,
      };
    })
    .filter((row): row is TenantExam => Boolean(row))
    .sort((a, b) => {
      const byDate = a.start_date.localeCompare(b.start_date);
      if (byDate !== 0) return byDate;
      const byTime = (a.start_time || "").localeCompare(b.start_time || "");
      if (byTime !== 0) return byTime;
      const byClass = a.class_code.localeCompare(b.class_code);
      if (byClass !== 0) return byClass;
      return a.name.localeCompare(b.name);
    });
}

export function normalizeExamMarks(input: unknown): TenantExamMark[] {
  return asArray<unknown>(input)
    .map((raw): TenantExamMark | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      const examId = asString(row.exam_id);
      const subjectId = asString(row.subject_id);
      const enrollmentId = asString(row.student_enrollment_id);
      if (!id || !examId || !subjectId || !enrollmentId) return null;

      return {
        id,
        exam_id: examId,
        exam_name: asString(row.exam_name) || "Exam",
        term_id: asString(row.term_id) || null,
        term_code: asString(row.term_code) || null,
        term_name: asString(row.term_name) || null,
        class_code: asString(row.class_code).toUpperCase(),
        subject_id: subjectId,
        subject_code: asString(row.subject_code) || null,
        subject_name: asString(row.subject_name) || null,
        student_enrollment_id: enrollmentId,
        student_name: asString(row.student_name) || "Unknown student",
        admission_number: asString(row.admission_number) || null,
        marks_obtained: asString(row.marks_obtained) || "0",
        max_marks: asString(row.max_marks) || "0",
        grade: asString(row.grade) || null,
        remarks: asString(row.remarks) || null,
        recorded_at: asString(row.recorded_at) || null,
        updated_at: asString(row.updated_at) || null,
      };
    })
    .filter((row): row is TenantExamMark => Boolean(row))
    .sort((a, b) => {
      const byUpdated = (b.updated_at || "").localeCompare(a.updated_at || "");
      if (byUpdated !== 0) return byUpdated;
      return b.id.localeCompare(a.id);
    });
}

export function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
