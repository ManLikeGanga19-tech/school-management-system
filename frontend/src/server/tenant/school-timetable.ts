import { normalizeClassOptions, normalizeStaff, normalizeSubjects } from "@/lib/hr";
import { normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";
import {
  normalizeSchoolTimetable,
  type SchoolTimetableEntry,
} from "@/lib/school-setup/timetable";
import type { TenantClassOption, TenantStaff, TenantSubject } from "@/lib/hr";
import { backendFetch } from "@/server/backend/client";

export type SchoolTimetableSetupInitialData = {
  entries: SchoolTimetableEntry[];
  terms: TenantTerm[];
  classes: TenantClassOption[];
  subjects: TenantSubject[];
  teachers: TenantStaff[];
  fallbackUsed: boolean;
  initialError: string | null;
};

type Resource = {
  ok: boolean;
  data: unknown;
  error: string | null;
};

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

function getErrorMessage(body: unknown, status: number, fallback: string): string {
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (typeof rec.detail === "string" && rec.detail.trim()) return rec.detail;
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message;
  }
  return `${fallback} (${status})`;
}

async function getResource(path: string): Promise<Resource> {
  try {
    const res = await backendFetch(path, { method: "GET" });
    const body = await readJson(res);
    if (!res.ok) {
      return {
        ok: false,
        data: null,
        error: getErrorMessage(body, res.status, "Request failed"),
      };
    }
    return {
      ok: true,
      data: body,
      error: null,
    };
  } catch {
    return {
      ok: false,
      data: null,
      error: "Network error while loading timetable data",
    };
  }
}

export async function getSchoolTimetableSetupInitialData(): Promise<SchoolTimetableSetupInitialData> {
  const [entriesRes, termsRes, classesRes, subjectsRes, teachersRes] = await Promise.all([
    getResource("/tenants/school-timetable?limit=1000&offset=0&include_inactive=true"),
    getResource("/tenants/terms?include_inactive=false"),
    getResource("/tenants/classes?include_inactive=false"),
    getResource("/tenants/subjects?include_inactive=false"),
    getResource("/tenants/hr/staff?staff_type=TEACHING&include_inactive=false&include_separated=false&limit=500"),
  ]);

  const errors: string[] = [];
  if (!entriesRes.ok && entriesRes.error) errors.push(entriesRes.error);
  if (!termsRes.ok && termsRes.error) errors.push(termsRes.error);
  if (!classesRes.ok && classesRes.error) errors.push(classesRes.error);
  if (!subjectsRes.ok && subjectsRes.error) errors.push(subjectsRes.error);
  if (!teachersRes.ok && teachersRes.error) errors.push(teachersRes.error);

  return {
    entries: entriesRes.ok ? normalizeSchoolTimetable(entriesRes.data) : [],
    terms: termsRes.ok ? normalizeTerms(termsRes.data) : [],
    classes: classesRes.ok ? normalizeClassOptions(classesRes.data) : [],
    subjects: subjectsRes.ok ? normalizeSubjects(subjectsRes.data) : [],
    teachers: teachersRes.ok ? normalizeStaff(teachersRes.data) : [],
    fallbackUsed: !entriesRes.ok,
    initialError: errors[0] || null,
  };
}

