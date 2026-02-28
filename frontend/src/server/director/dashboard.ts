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

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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
  // Use tenant-aggregated endpoints to reduce DB fan-out and improve dashboard
  // resilience under load.
  const [me, dashboard, finance] = await Promise.all([
    getResource<TenantMe>("/auth/me"),
    getResource<{
      summary?: TenantDashboardSummary;
      users?: TenantUser[];
      audit?: AuditRow[];
      enrollments?: EnrollmentRow[];
      invoices?: InvoiceRow[];
    }>("/tenants/secretary/dashboard"),
    getResource<{
      policy?: FinancePolicy | null;
      invoices?: InvoiceRow[];
      fee_categories?: FeeCategory[];
      fee_items?: FeeItem[];
      scholarships?: Scholarship[];
      enrollments?: EnrollmentRow[];
    }>("/tenants/director/finance"),
  ]);

  const dashboardData = dashboard.data;
  const financeData = finance.data;

  const summary: Resource<TenantDashboardSummary> = {
    data: dashboardData?.summary ?? null,
    error: dashboardData?.summary ? null : dashboard.error,
  };

  const users: Resource<TenantUser[]> = {
    data: asArray<TenantUser>(dashboardData?.users),
    error: dashboardData?.users ? null : dashboard.error,
  };

  const auditLogs: Resource<AuditRow[]> = {
    data: asArray<AuditRow>(dashboardData?.audit),
    error: dashboardData?.audit ? null : dashboard.error,
  };

  const enrollments: Resource<EnrollmentRow[]> = {
    data:
      asArray<EnrollmentRow>(financeData?.enrollments).length > 0
        ? asArray<EnrollmentRow>(financeData?.enrollments)
        : asArray<EnrollmentRow>(dashboardData?.enrollments),
    error:
      asArray<EnrollmentRow>(financeData?.enrollments).length > 0 ||
      asArray<EnrollmentRow>(dashboardData?.enrollments).length > 0
        ? null
        : finance.error || dashboard.error,
  };

  const invoices: Resource<InvoiceRow[]> = {
    data:
      asArray<InvoiceRow>(financeData?.invoices).length > 0
        ? asArray<InvoiceRow>(financeData?.invoices)
        : asArray<InvoiceRow>(dashboardData?.invoices),
    error:
      asArray<InvoiceRow>(financeData?.invoices).length > 0 ||
      asArray<InvoiceRow>(dashboardData?.invoices).length > 0
        ? null
        : finance.error || dashboard.error,
  };

  const policy: Resource<FinancePolicy> = {
    data: (financeData?.policy as FinancePolicy) ?? null,
    error: financeData?.policy ? null : finance.error,
  };

  const feeCategories: Resource<FeeCategory[]> = {
    data: asArray<FeeCategory>(financeData?.fee_categories),
    error: financeData?.fee_categories ? null : finance.error,
  };

  const feeItems: Resource<FeeItem[]> = {
    data: asArray<FeeItem>(financeData?.fee_items),
    error: financeData?.fee_items ? null : finance.error,
  };

  const scholarships: Resource<Scholarship[]> = {
    data: asArray<Scholarship>(financeData?.scholarships),
    error: financeData?.scholarships ? null : finance.error,
  };

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
