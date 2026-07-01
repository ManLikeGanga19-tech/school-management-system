import { backendFetch } from "@/server/backend/client";
import {
  normalizeTenantNotificationPreviews,
  parseTenantUnreadCount,
  type TenantNotificationPreview,
} from "@/lib/tenant-notifications";

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
    is_active: boolean;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  roles: string[];
  permissions: string[];
};

// ─── KPI shape returned by GET /director/kpis ────────────────────────────────

export type FinanceKPIs = {
  total_billed: number;
  total_collected: number;
  total_outstanding: number;
  collection_rate_pct: number;
  invoice_count: number;
  payment_count: number;
};

export type TermFinanceKPIs = {
  term_billed: number;
  term_collected: number;
  term_outstanding: number;
  term_collection_rate_pct: number;
  term_invoice_count: number;
  term_name: string | null;
  term_code: string | null;
  term_number: number | null;
  academic_year: number | null;
  scope: "structured" | "created_at_window";
} | null;

export type DemographicsKPIs = {
  total_students: number;
  male_count: number;
  female_count: number;
  unspecified_count: number;
  male_pct: number;
  female_pct: number;
  unspecified_pct: number;
};

export type FinanceByClass = {
  class_code: string;
  billed: number;
  collected: number;
  outstanding: number;
  invoice_count: number;
};
export type FinanceByTerm = {
  academic_year: number;
  term_number: number;
  label: string;
  billed: number;
  collected: number;
  outstanding: number;
  invoice_count: number;
};
export type FinanceByProvider = {
  provider: string;
  payment_count: number;
  amount: number;
};
export type TopOutstanding = {
  student_id: string | null;
  student_name: string;
  admission_no: string | null;
  class_code: string | null;
  outstanding: number;
  invoice_count: number;
};
// Phase M3 — scholarship breakdown surfaced on the director dashboard.
export type ScholarshipSummary = {
  total_discount_granted: number;
  active_allocations: number;
  unique_recipients: number;
  active_scholarships: number;
  active_grants: number;
  unique_grant_recipients: number;
};

export type ScholarshipProgramme = {
  scholarship_id: string;
  name: string;
  type: string; // FIXED | PERCENTAGE | FULL_WAIVER
  budget: number;
  allocated: number;
  remaining: number | null;
  max_recipients: number | null;
  unique_recipients: number;
  active_allocations: number;
  revoked_allocations: number;
  active_grants: number;
  is_active: boolean;
  covers_carry_forward: boolean;
};

export type ScholarshipBeneficiary = {
  student_id: string;
  student_name: string;
  admission_no: string;
  total_allocated: number;
  allocation_count: number;
  scholarship_count: number;
  active_grants: number;
};

export type ScholarshipBreakdown = {
  summary: ScholarshipSummary;
  by_scholarship: ScholarshipProgramme[];
  top_beneficiaries: ScholarshipBeneficiary[];
};

export type FinanceBreakdowns = {
  by_class: FinanceByClass[];
  by_term: FinanceByTerm[];
  by_provider: FinanceByProvider[];
  top_outstanding: TopOutstanding[];
  scholarships?: ScholarshipBreakdown;
};

export type EnrollmentKPIs = {
  total_enrolled: number;
  pending_intake: number;
  by_status: Record<string, number>;
};

export type SchoolMeta = {
  total_users: number;
  total_roles: number;
  total_audit_logs: number;
  fee_categories: number;
  fee_items: number;
};

export type ActiveTerm = {
  id: string;
  name: string;
  code: string;
  term_number: number | null;
  academic_year: number | null;
} | null;

export type RecentPayment = {
  payment_id: string;
  provider: string;
  reference: string | null;
  receipt_no: string | null;
  amount: number;
  received_at: string | null;
  student_name: string | null;
};

import type { TodayAtSchoolData } from "@/components/dashboard/TodayAtSchool";

export type DirectorKPIs = {
  finance: FinanceKPIs;
  term_finance: TermFinanceKPIs;
  finance_breakdowns: FinanceBreakdowns;
  demographics: DemographicsKPIs;
  enrollments: EnrollmentKPIs;
  school: SchoolMeta;
  active_term: ActiveTerm;
  today_at_school: TodayAtSchoolData | null;
  recent_payments: RecentPayment[];
};

// ─── Dashboard data bundle ────────────────────────────────────────────────────

export type DirectorDashboardData = {
  me: Resource<TenantMe>;
  kpis: Resource<DirectorKPIs>;
  notifications: Resource<TenantNotificationPreview[]>;
  notificationsUnreadCount: Resource<number>;
  notificationsTotalCount: Resource<number>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readJson<T>(res: Response): Promise<T | null> {
  return res.json().catch(() => null);
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const b = body as Record<string, unknown>;
  if (typeof b.detail === "string" && b.detail.trim()) return b.detail;
  if (typeof b.message === "string" && b.message.trim()) return b.message;
  return fallback;
}

async function getResource<T>(path: string): Promise<Resource<T>> {
  try {
    const res = await backendFetch(path, { method: "GET" });
    const body = await readJson<T>(res);
    if (!res.ok) {
      return { data: null, error: getErrorMessage(body, `Request failed (${res.status})`) };
    }
    return { data: body as T, error: null };
  } catch {
    return { data: null, error: "Network error while loading dashboard data" };
  }
}

// ─── Main loader ──────────────────────────────────────────────────────────────

export async function getDirectorDashboardData(): Promise<DirectorDashboardData> {
  const [me, kpis, notificationsRaw, notificationsCountRaw] = await Promise.all([
    getResource<TenantMe>("/auth/me"),
    getResource<DirectorKPIs>("/director/kpis"),
    getResource<unknown>("/tenants/notifications?limit=20&offset=0"),
    getResource<unknown>("/tenants/notifications/unread-count"),
  ]);

  const allNotifications = normalizeTenantNotificationPreviews(notificationsRaw.data);
  const notificationsList = allNotifications.slice(0, 2);

  const unreadCountFromEndpoint = parseTenantUnreadCount(notificationsCountRaw.data);
  const unreadCountFallback = notificationsList.filter((item) => item.unread).length;
  const unreadCount = unreadCountFromEndpoint ?? unreadCountFallback;

  return {
    me,
    kpis,
    notifications: {
      data: notificationsList,
      error: notificationsRaw.error && notificationsList.length === 0 ? notificationsRaw.error : null,
    },
    notificationsUnreadCount: {
      data: unreadCount,
      error: notificationsCountRaw.error && unreadCountFromEndpoint === null
        ? notificationsCountRaw.error
        : null,
    },
    notificationsTotalCount: {
      data: allNotifications.length,
      error: notificationsRaw.error && allNotifications.length === 0 ? notificationsRaw.error : null,
    },
  };
}
