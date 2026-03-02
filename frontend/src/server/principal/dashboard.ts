import {
  normalizeTenantNotificationPreviews,
  parseTenantUnreadCount,
  type TenantNotificationPreview,
} from "@/lib/tenant-notifications";
import { asArray } from "@/lib/utils/asArray";
import { backendFetch } from "@/server/backend/client";

export type Resource<T> = {
  data: T | null;
  error: string | null;
};

export type TenantMe = {
  user: {
    id: string;
    email: string;
    full_name?: string | null;
    phone?: string | null;
    is_active?: boolean;
  };
  tenant: {
    id?: string;
    slug: string;
    name: string;
  };
  roles: string[];
  permissions: string[];
};

export type TenantDashboardSummary = {
  total_users: number;
  total_roles: number;
  total_audit_logs: number;
  total_students?: number;
  total_exams?: number;
  total_events?: number;
  total_teacher_assignments?: number;
  total_timetable_entries?: number;
  unread_notifications?: number;
};

export type EnrollmentRow = {
  id: string;
  status: string;
};

export type ExamRow = {
  id: string;
  name: string;
  class_code: string;
  status: string;
  start_date: string;
  start_time: string | null;
  end_time: string | null;
  term_id: string | null;
};

export type EventRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  target_scope: string;
};

export type TeacherAssignmentRow = {
  id: string;
  class_code: string;
  subject_code: string;
  teacher_name: string;
  is_active: boolean;
};

export type TimetableEntryRow = {
  id: string;
  class_code: string;
  entry_type: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

export type PrincipalDashboardData = {
  me: Resource<TenantMe>;
  summary: Resource<TenantDashboardSummary>;
  enrollments: Resource<EnrollmentRow[]>;
  exams: Resource<ExamRow[]>;
  events: Resource<EventRow[]>;
  teacherAssignments: Resource<TeacherAssignmentRow[]>;
  timetableEntries: Resource<TimetableEntryRow[]>;
  notifications: Resource<TenantNotificationPreview[]>;
  notificationsUnreadCount: Resource<number>;
};

type PrincipalDashboardPayload = {
  me?: unknown;
  summary?: unknown;
  enrollments?: unknown;
  exams?: unknown;
  events?: unknown;
  teacher_assignments?: unknown;
  timetable_entries?: unknown;
  notifications?: unknown;
  unread_notifications?: unknown;
};

async function readJson<T>(res: Response): Promise<T | null> {
  return res.json().catch(() => null);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function getErrorMessage(body: any, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

async function getResource<T>(path: string): Promise<Resource<T>> {
  try {
    const res = await backendFetch(path, { method: "GET" });
    const body = await readJson<T | { detail?: string; message?: string }>(res);

    if (!res.ok) {
      return {
        data: null,
        error: getErrorMessage(body, `Request failed (${res.status})`),
      };
    }

    return {
      data: body as T,
      error: null,
    };
  } catch {
    return {
      data: null,
      error: "Network error while loading principal dashboard data",
    };
  }
}

function normalizeMe(value: unknown): TenantMe | null {
  const root = asObject(value);
  if (!root) return null;
  const user = asObject(root.user);
  const tenant = asObject(root.tenant);
  const roles = asArray<unknown>(root.roles).map(asString).filter(Boolean);
  const permissions = asArray<unknown>(root.permissions).map(asString).filter(Boolean);
  if (!user || !tenant) return null;

  const tenantSlug = asString(tenant.slug);
  const tenantName = asString(tenant.name);
  const userId = asString(user.id);
  const userEmail = asString(user.email);
  if (!tenantSlug || !tenantName || !userId || !userEmail) return null;

  return {
    user: {
      id: userId,
      email: userEmail,
      full_name: asString(user.full_name) || null,
      phone: asString(user.phone) || null,
      is_active: user.is_active === false ? false : true,
    },
    tenant: {
      id: asString(tenant.id) || undefined,
      slug: tenantSlug,
      name: tenantName,
    },
    roles,
    permissions,
  };
}

function normalizeSummary(value: unknown): TenantDashboardSummary | null {
  const row = asObject(value);
  if (!row) return null;
  return {
    total_users: Math.max(0, Math.floor(asNumber(row.total_users))),
    total_roles: Math.max(0, Math.floor(asNumber(row.total_roles))),
    total_audit_logs: Math.max(0, Math.floor(asNumber(row.total_audit_logs))),
    total_students: Math.max(0, Math.floor(asNumber(row.total_students))),
    total_exams: Math.max(0, Math.floor(asNumber(row.total_exams))),
    total_events: Math.max(0, Math.floor(asNumber(row.total_events))),
    total_teacher_assignments: Math.max(
      0,
      Math.floor(asNumber(row.total_teacher_assignments))
    ),
    total_timetable_entries: Math.max(
      0,
      Math.floor(asNumber(row.total_timetable_entries))
    ),
    unread_notifications: Math.max(0, Math.floor(asNumber(row.unread_notifications))),
  };
}

function normalizeEnrollments(value: unknown): EnrollmentRow[] {
  return asArray<unknown>(value)
    .map((raw): EnrollmentRow | null => {
      const row = asObject(raw);
      if (!row) return null;
      const id = asString(row.id);
      if (!id) return null;
      return {
        id,
        status: asString(row.status).toUpperCase() || "UNKNOWN",
      };
    })
    .filter((row): row is EnrollmentRow => Boolean(row));
}

function normalizeExams(value: unknown): ExamRow[] {
  return asArray<unknown>(value)
    .map((raw): ExamRow | null => {
      const row = asObject(raw);
      if (!row) return null;
      const id = asString(row.id);
      const name = asString(row.name);
      const startDate = asString(row.start_date);
      if (!id || !name || !startDate) return null;
      return {
        id,
        name,
        class_code: asString(row.class_code),
        status: asString(row.status).toUpperCase() || "SCHEDULED",
        start_date: startDate,
        start_time: asString(row.start_time) || null,
        end_time: asString(row.end_time) || null,
        term_id: asString(row.term_id) || null,
      };
    })
    .filter((row): row is ExamRow => Boolean(row));
}

function normalizeEvents(value: unknown): EventRow[] {
  return asArray<unknown>(value)
    .map((raw): EventRow | null => {
      const row = asObject(raw);
      if (!row) return null;
      const id = asString(row.id);
      const name = asString(row.name);
      const startDate = asString(row.start_date);
      if (!id || !name || !startDate) return null;
      return {
        id,
        name,
        start_date: startDate,
        end_date: asString(row.end_date) || startDate,
        target_scope: asString(row.target_scope).toUpperCase() || "ALL",
      };
    })
    .filter((row): row is EventRow => Boolean(row));
}

function normalizeTeacherAssignments(value: unknown): TeacherAssignmentRow[] {
  return asArray<unknown>(value)
    .map((raw): TeacherAssignmentRow | null => {
      const row = asObject(raw);
      if (!row) return null;
      const id = asString(row.id);
      if (!id) return null;
      return {
        id,
        class_code: asString(row.class_code),
        subject_code: asString(row.subject_code),
        teacher_name: asString(row.staff_name) || "Unassigned",
        is_active: row.is_active === false ? false : true,
      };
    })
    .filter((row): row is TeacherAssignmentRow => Boolean(row));
}

function normalizeTimetableEntries(value: unknown): TimetableEntryRow[] {
  return asArray<unknown>(value)
    .map((raw): TimetableEntryRow | null => {
      const row = asObject(raw);
      if (!row) return null;
      const id = asString(row.id);
      const dayOfWeek = asString(row.day_of_week);
      const startTime = asString(row.start_time);
      const endTime = asString(row.end_time);
      if (!id || !dayOfWeek || !startTime || !endTime) return null;
      return {
        id,
        class_code: asString(row.class_code),
        entry_type: asString(row.slot_type) || "LESSON",
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
        is_active: row.is_active === false ? false : true,
      };
    })
    .filter((row): row is TimetableEntryRow => Boolean(row));
}

export async function getPrincipalDashboardData(): Promise<PrincipalDashboardData> {
  const [meResource, dashboard] = await Promise.all([
    getResource<TenantMe>("/auth/me"),
    getResource<PrincipalDashboardPayload>("/tenants/principal/dashboard"),
  ]);

  const meFromDashboard = dashboard.data ? normalizeMe(dashboard.data.me) : null;
  const meData = meFromDashboard ?? meResource.data ?? null;

  if (!dashboard.data) {
    const fallbackError = dashboard.error || "Principal dashboard is unavailable";
    return {
      me: {
        data: meData,
        error: meData ? null : meResource.error || fallbackError,
      },
      summary: { data: null, error: fallbackError },
      enrollments: { data: [], error: fallbackError },
      exams: { data: [], error: fallbackError },
      events: { data: [], error: fallbackError },
      teacherAssignments: { data: [], error: fallbackError },
      timetableEntries: { data: [], error: fallbackError },
      notifications: { data: [], error: fallbackError },
      notificationsUnreadCount: { data: 0, error: fallbackError },
    };
  }

  const summaryData = normalizeSummary(dashboard.data.summary);
  const enrollmentsData = normalizeEnrollments(dashboard.data.enrollments);
  const examsData = normalizeExams(dashboard.data.exams);
  const eventsData = normalizeEvents(dashboard.data.events);
  const teacherAssignmentsData = normalizeTeacherAssignments(
    dashboard.data.teacher_assignments
  );
  const timetableEntriesData = normalizeTimetableEntries(
    dashboard.data.timetable_entries
  );
  const notificationsData = normalizeTenantNotificationPreviews(
    dashboard.data.notifications
  );

  const unreadFromPayload = Math.max(
    0,
    Math.floor(asNumber(dashboard.data.unread_notifications))
  );
  const unreadFromSummary =
    summaryData && typeof summaryData.unread_notifications === "number"
      ? summaryData.unread_notifications
      : null;
  const unreadFromNotifications =
    parseTenantUnreadCount({ unread_count: unreadFromPayload }) ??
    parseTenantUnreadCount({ unread_count: unreadFromSummary }) ??
    notificationsData.filter((item) => item.unread).length;

  return {
    me: {
      data: meData,
      error: meData ? null : meResource.error || dashboard.error,
    },
    summary: {
      data: summaryData,
      error: summaryData ? null : dashboard.error,
    },
    enrollments: {
      data: enrollmentsData,
      error: null,
    },
    exams: {
      data: examsData,
      error: null,
    },
    events: {
      data: eventsData,
      error: null,
    },
    teacherAssignments: {
      data: teacherAssignmentsData,
      error: null,
    },
    timetableEntries: {
      data: timetableEntriesData,
      error: null,
    },
    notifications: {
      data: notificationsData,
      error: null,
    },
    notificationsUnreadCount: {
      data: unreadFromNotifications,
      error: null,
    },
  };
}
