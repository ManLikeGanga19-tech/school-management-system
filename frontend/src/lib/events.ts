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

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "y"].includes(normalized)) return true;
    if (["false", "no", "0", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeScope(value: string): "ALL" | "CLASS" | "STUDENT" | "MIXED" {
  const cleaned = value.trim().toUpperCase();
  if (cleaned === "CLASS") return "CLASS";
  if (cleaned === "STUDENT") return "STUDENT";
  if (cleaned === "MIXED") return "MIXED";
  return "ALL";
}

export type TenantEvent = {
  id: string;
  name: string;
  term_id: string | null;
  term_code: string | null;
  term_name: string | null;
  academic_year: number;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  description: string | null;
  target_scope: "ALL" | "CLASS" | "STUDENT" | "MIXED";
  class_codes: string[];
  student_enrollment_ids: string[];
  student_names: string[];
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export function normalizeEvents(input: unknown): TenantEvent[] {
  return asArray<unknown>(input)
    .map((raw): TenantEvent | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      const name = asString(row.name);
      const startDate = asString(row.start_date);
      const endDate = asString(row.end_date);
      if (!id || !name || !startDate || !endDate) return null;

      return {
        id,
        name,
        term_id: asString(row.term_id) || null,
        term_code: asString(row.term_code) || null,
        term_name: asString(row.term_name) || null,
        academic_year: asNumber(row.academic_year, new Date().getFullYear()),
        start_date: startDate,
        end_date: endDate,
        start_time: asString(row.start_time) || null,
        end_time: asString(row.end_time) || null,
        location: asString(row.location) || null,
        description: asString(row.description) || null,
        target_scope: normalizeScope(asString(row.target_scope)),
        class_codes: asArray<unknown>(row.class_codes)
          .map((value) => asString(value).toUpperCase())
          .filter((value) => Boolean(value)),
        student_enrollment_ids: asArray<unknown>(row.student_enrollment_ids)
          .map((value) => asString(value))
          .filter((value) => Boolean(value)),
        student_names: asArray<unknown>(row.student_names)
          .map((value) => asString(value))
          .filter((value) => Boolean(value)),
        is_active: asBoolean(row.is_active, true),
        created_at: asString(row.created_at) || null,
        updated_at: asString(row.updated_at) || null,
      };
    })
    .filter((row): row is TenantEvent => Boolean(row))
    .sort((a, b) => {
      const byDate = a.start_date.localeCompare(b.start_date);
      if (byDate !== 0) return byDate;
      const byTime = (a.start_time || "").localeCompare(b.start_time || "");
      if (byTime !== 0) return byTime;
      return a.name.localeCompare(b.name);
    });
}
