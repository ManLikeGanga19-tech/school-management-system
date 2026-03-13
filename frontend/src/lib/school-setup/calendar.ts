import type { TenantTerm } from "@/lib/school-setup/terms";

export type SchoolCalendarEventType = "HALF_TERM_BREAK" | "EXAM_WINDOW";

export type TenantSchoolCalendarEvent = {
  id: string;
  academic_year: number;
  event_type: SchoolCalendarEventType;
  title: string;
  term_code?: string | null;
  start_date: string;
  end_date: string;
  notes?: string | null;
  is_active?: boolean;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSchoolCalendarEvents(input: unknown): TenantSchoolCalendarEvent[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((row, idx): TenantSchoolCalendarEvent | null => {
      if (!row || typeof row !== "object") return null;
      const rec = row as Record<string, unknown>;
      const eventType = asString(rec.event_type).toUpperCase();
      if (eventType !== "HALF_TERM_BREAK" && eventType !== "EXAM_WINDOW") return null;

      const title = asString(rec.title);
      const startDate = asString(rec.start_date);
      const endDate = asString(rec.end_date);
      if (!title || !startDate || !endDate) return null;

      return {
        id: asString(rec.id) || `calendar-event-${idx}`,
        academic_year: Number(rec.academic_year) || new Date(startDate).getFullYear() || new Date().getFullYear(),
        event_type: eventType,
        title,
        term_code: asString(rec.term_code) || null,
        start_date: startDate,
        end_date: endDate,
        notes: asString(rec.notes) || null,
        is_active: typeof rec.is_active === "boolean" ? rec.is_active : true,
      };
    })
    .filter((row): row is TenantSchoolCalendarEvent => Boolean(row))
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title));
}

function inferTermCode(terms: TenantTerm[], termNo: number): string | null {
  const sorted = [...terms]
    .filter((term) => term.is_active !== false)
    .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || "") || a.name.localeCompare(b.name));
  const match = sorted[termNo - 1];
  return match?.code ?? null;
}

export function buildRecommendedCalendarSeed(
  academicYear: number,
  terms: TenantTerm[] = []
): TenantSchoolCalendarEvent[] {
  if (academicYear !== 2026) return [];

  return [
    {
      id: `seed-${academicYear}-break-1`,
      academic_year: academicYear,
      event_type: "HALF_TERM_BREAK",
      title: "Term 1 Half-Term Break",
      term_code: inferTermCode(terms, 1),
      start_date: "2026-02-25",
      end_date: "2026-03-01",
      notes: "Recommended Kenya school calendar half-term break.",
      is_active: true,
    },
    {
      id: `seed-${academicYear}-break-2`,
      academic_year: academicYear,
      event_type: "HALF_TERM_BREAK",
      title: "Term 2 Half-Term Break",
      term_code: inferTermCode(terms, 2),
      start_date: "2026-06-24",
      end_date: "2026-06-28",
      notes: "Recommended Kenya school calendar half-term break.",
      is_active: true,
    },
    {
      id: `seed-${academicYear}-exam-1`,
      academic_year: academicYear,
      event_type: "EXAM_WINDOW",
      title: "KPSEA / KILEA / KJSEA / KPLEA",
      term_code: null,
      start_date: "2026-10-26",
      end_date: "2026-10-26",
      notes: "Assessment window starts on October 26, 2026.",
      is_active: true,
    },
    {
      id: `seed-${academicYear}-exam-2`,
      academic_year: academicYear,
      event_type: "EXAM_WINDOW",
      title: "KCSE Examination Period",
      term_code: null,
      start_date: "2026-11-02",
      end_date: "2026-11-20",
      notes: "National KCSE examination window.",
      is_active: true,
    },
  ];
}
