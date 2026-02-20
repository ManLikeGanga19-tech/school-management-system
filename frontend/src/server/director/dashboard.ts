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

export type TenantDashboardSummary = {
  total_users: number;
  total_roles: number;
  total_audit_logs: number;
};

export type TenantUser = {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
};

export type EnrollmentRow = {
  id: string;
  tenant_id: string;
  status: string;
  payload: Record<string, unknown>;
};

export type FinancePolicy = {
  id: string;
  tenant_id: string;
  allow_partial_enrollment: boolean;
  min_percent_to_enroll: number | null;
  min_amount_to_enroll: string | null;
  require_interview_fee_before_submit: boolean;
};

export type InvoiceRow = {
  id: string;
  tenant_id: string;
  invoice_type: string;
  status: string;
  enrollment_id?: string | null;
  currency: string;
  total_amount: string | number;
  paid_amount: string | number;
  balance_amount: string | number;
};

export type FeeCategory = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type FeeItem = {
  id: string;
  category_id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type Scholarship = {
  id: string;
  name: string;
  type: string;
  value: string | number;
  is_active: boolean;
};

export type AuditRow = {
  id: string;
  tenant_id: string;
  actor_user_id?: string | null;
  action: string;
  resource: string;
  resource_id?: string | null;
  payload?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

export type DirectorDashboardData = {
  me: Resource<TenantMe>;
  summary: Resource<TenantDashboardSummary>;
  users: Resource<TenantUser[]>;
  enrollments: Resource<EnrollmentRow[]>;
  invoices: Resource<InvoiceRow[]>;
  policy: Resource<FinancePolicy>;
  feeCategories: Resource<FeeCategory[]>;
  feeItems: Resource<FeeItem[]>;
  scholarships: Resource<Scholarship[]>;
  auditLogs: Resource<AuditRow[]>;
};

async function readJson<T>(res: Response): Promise<T | null> {
  return res.json().catch(() => null);
}

function getErrorMessage(body: any, fallback: string): string {
  if (!body) return fallback;

  if (typeof body.detail === "string" && body.detail.trim()) {
    return body.detail;
  }

  if (typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }

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
      error: "Network error while loading dashboard data",
    };
  }
}

export async function getDirectorDashboardData(): Promise<DirectorDashboardData> {
  const [
    me,
    summary,
    users,
    enrollments,
    invoices,
    policy,
    feeCategories,
    feeItems,
    scholarships,
    auditLogs,
  ] = await Promise.all([
    getResource<TenantMe>("/api/v1/auth/me"),
    getResource<TenantDashboardSummary>("/api/v1/admin/summary"),
    getResource<TenantUser[]>("/api/v1/admin/users"),
    getResource<EnrollmentRow[]>("/api/v1/enrollments/"),
    getResource<InvoiceRow[]>("/api/v1/finance/invoices"),
    getResource<FinancePolicy>("/api/v1/finance/policy"),
    getResource<FeeCategory[]>("/api/v1/finance/fee-categories"),
    getResource<FeeItem[]>("/api/v1/finance/fee-items"),
    getResource<Scholarship[]>("/api/v1/finance/scholarships"),
    getResource<AuditRow[]>("/api/v1/audit/logs?limit=8&offset=0"),
  ]);

  return {
    me,
    summary,
    users,
    enrollments,
    invoices,
    policy,
    feeCategories,
    feeItems,
    scholarships,
    auditLogs,
  };
}
