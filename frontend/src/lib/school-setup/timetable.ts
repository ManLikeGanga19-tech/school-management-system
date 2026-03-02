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

function asBoolean(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "y"].includes(normalized)) return true;
    if (["false", "no", "0", "n"].includes(normalized)) return false;
  }
  return fallback;
}

export const TIMETABLE_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export const TIMETABLE_SLOT_TYPES = [
  "LESSON",
  "SHORT_BREAK",
  "LONG_BREAK",
  "LUNCH_BREAK",
  "GAME_TIME",
  "OTHER",
] as const;

export type TimetableDay = (typeof TIMETABLE_DAYS)[number];
export type TimetableSlotType = (typeof TIMETABLE_SLOT_TYPES)[number];

export type SchoolTimetableEntry = {
  id: string;
  term_id: string;
  term_code: string | null;
  term_name: string | null;
  class_code: string;
  day_of_week: TimetableDay;
  slot_type: TimetableSlotType;
  title: string;
  subject_id: string | null;
  subject_code: string | null;
  subject_name: string | null;
  staff_id: string | null;
  staff_no: string | null;
  staff_name: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

function normalizeDay(value: string): TimetableDay {
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "_");
  return (TIMETABLE_DAYS.find((day) => day === cleaned) || "MONDAY") as TimetableDay;
}

function normalizeSlotType(value: string): TimetableSlotType {
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "_");
  return (TIMETABLE_SLOT_TYPES.find((slot) => slot === cleaned) || "LESSON") as TimetableSlotType;
}

const DAY_INDEX: Record<TimetableDay, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

export function normalizeSchoolTimetable(input: unknown): SchoolTimetableEntry[] {
  return asArray<unknown>(input)
    .map((raw): SchoolTimetableEntry | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      const termId = asString(row.term_id);
      const classCode = asString(row.class_code).toUpperCase();
      const day = normalizeDay(asString(row.day_of_week));
      const slotType = normalizeSlotType(asString(row.slot_type));
      const title = asString(row.title);
      const startTime = asString(row.start_time);
      const endTime = asString(row.end_time);
      if (!id || !termId || !classCode || !title || !startTime || !endTime) return null;

      return {
        id,
        term_id: termId,
        term_code: asString(row.term_code) || null,
        term_name: asString(row.term_name) || null,
        class_code: classCode,
        day_of_week: day,
        slot_type: slotType,
        title,
        subject_id: asString(row.subject_id) || null,
        subject_code: asString(row.subject_code) || null,
        subject_name: asString(row.subject_name) || null,
        staff_id: asString(row.staff_id) || null,
        staff_no: asString(row.staff_no) || null,
        staff_name: asString(row.staff_name) || null,
        start_time: startTime,
        end_time: endTime,
        location: asString(row.location) || null,
        notes: asString(row.notes) || null,
        is_active: asBoolean(row.is_active, true),
        created_at: asString(row.created_at) || null,
        updated_at: asString(row.updated_at) || null,
      };
    })
    .filter((row): row is SchoolTimetableEntry => Boolean(row))
    .sort((a, b) => {
      const byClass = a.class_code.localeCompare(b.class_code);
      if (byClass !== 0) return byClass;
      const byDay = DAY_INDEX[a.day_of_week] - DAY_INDEX[b.day_of_week];
      if (byDay !== 0) return byDay;
      const byStart = a.start_time.localeCompare(b.start_time);
      if (byStart !== 0) return byStart;
      return a.title.localeCompare(b.title);
    });
}
