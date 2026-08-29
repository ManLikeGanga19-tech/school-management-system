"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { AppShell } from "@/components/layout/AppShell";
import { secretaryNav } from "@/components/layout/nav-config";
import {
  DashboardSectionLabel,
  DashboardStatCard,
  dashboardBadgeClasses,
} from "@/components/dashboard/tenant-dashboard-primitives";
import {
  TodayAtSchool,
  type TodayAtSchoolData,
} from "@/components/dashboard/TodayAtSchool";
import {
  DemographicsDonut,
  DemographicsLegend,
  type DemographicsData,
} from "@/components/dashboard/finance-charts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Users,
  GraduationCap,
  ClipboardList,
  Activity,
  ShieldCheck,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  FileText,
  UserCheck,
  AlertCircle,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { TenantNotificationsOverview } from "@/components/notifications/TenantNotificationsOverview";
import {
  normalizeTenantNotificationPreviews,
  parseTenantUnreadCount,
  type TenantNotificationPreview,
} from "@/lib/tenant-notifications";
// ─── Types ────────────────────────────────────────────────────────────────────

type DashboardResponse = {
  me: {
    tenant: { slug: string; name: string };
    roles: string[];
  } | null;
  summary: { total_users: number; total_roles: number; total_audit_logs: number } | null;
  enrollments: { id: string; status: string; payload?: Record<string, unknown> }[];
  invoices: {
    id: string;
    invoice_type: string;
    status: string;
    total_amount: string | number;
    paid_amount: string | number;
    balance_amount: string | number;
  }[];
  users: { id: string; is_active: boolean; email: string; full_name?: string | null }[];
  audit: { id: string; action: string; resource: string; created_at: string }[];
  health: Record<string, boolean>;
  today_at_school?: TodayAtSchoolData | null;
  demographics?: DemographicsData | null;
  finance_outstanding?: {
    total_outstanding: number;
    invoice_count: number;
  } | null;
};

// ─── Chart config ─────────────────────────────────────────────────────────────

const enrollmentChartConfig = {
  count: { label: "Enrollments", color: "#c2680f" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function enrollmentName(payload?: Record<string, unknown>) {
  if (!payload) return "Unknown student";
  for (const key of ["student_name", "studentName", "full_name", "fullName", "name"]) {
    if (typeof payload[key] === "string" && (payload[key] as string).trim())
      return payload[key] as string;
  }
  return "Unknown student";
}

function enrollmentClass(payload?: Record<string, unknown>) {
  if (!payload) return "";
  for (const key of ["admission_class", "class_code", "classCode", "grade"]) {
    if (typeof payload[key] === "string" && (payload[key] as string).trim())
      return payload[key] as string;
  }
  return "";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <DashboardSectionLabel className="mb-3">{children}</DashboardSectionLabel>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
  action,
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="dashboard-surface overflow-hidden rounded-[1.6rem]">
      <div className="flex flex-col gap-3 border-b border-[var(--tenant-border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-[var(--tenant-muted)]" />}
          <div>
            <h2 className="text-sm font-semibold text-[var(--tenant-ink)]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-[var(--tenant-muted)]">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="self-start sm:self-auto">{action}</div>}
      </div>
      <div className="p-4 sm:p-6">{children}</div>
    </div>
  );
}

function EnrollmentStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const styles: Record<string, string> = {
    ENROLLED:           "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    APPROVED:           "bg-[var(--tenant-primary-soft)] text-[var(--tenant-primary)] ring-1 ring-[var(--tenant-primary)]/20",
    SUBMITTED:          "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    DRAFT:              "bg-[var(--tenant-surface-2)] text-[var(--tenant-muted)] ring-1 ring-[var(--tenant-border)]",
    REJECTED:           "bg-red-50 text-red-600 ring-1 ring-red-200",
    TRANSFER_REQUESTED: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[s] ?? "bg-[var(--tenant-surface-2)] text-[var(--tenant-muted)] ring-1 ring-[var(--tenant-border)]"}`}>
      {s.replace(/_/g, " ")}
    </span>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center text-sm text-[var(--tenant-muted)]">
        {message}
      </TableCell>
    </TableRow>
  );
}

function HealthDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-flex h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SecretaryDashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [notifications, setNotifications] = useState<TenantNotificationPreview[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [totalNotifications, setTotalNotifications] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const [dashboardRes, notificationsRes, unreadCountRes] = await Promise.allSettled([
      api.get<DashboardResponse>("/tenants/secretary/dashboard", { tenantRequired: true }),
      api.get<unknown>("/tenants/notifications?limit=20&offset=0", {
        tenantRequired: true,
        noRedirect: true,
      }),
      api.get<unknown>("/tenants/notifications/unread-count", {
        tenantRequired: true,
        noRedirect: true,
      }),
    ]);

    if (dashboardRes.status === "fulfilled") {
      setData(dashboardRes.value as DashboardResponse);
      setLastUpdated(new Date());
      setError(null);
    } else {
      const err: any = dashboardRes.reason;
      setError(typeof err?.message === "string" ? err.message : "Failed to load dashboard");
      setData(null);
    }

    const allNotifications =
      notificationsRes.status === "fulfilled"
        ? normalizeTenantNotificationPreviews(notificationsRes.value)
        : [];
    setTotalNotifications(allNotifications.length);
    setNotifications(allNotifications.slice(0, 2));

    const unreadFromEndpoint =
      unreadCountRes.status === "fulfilled"
        ? parseTenantUnreadCount(unreadCountRes.value)
        : null;
    const unreadFallback = allNotifications.filter((item) => item.unread).length;
    setUnreadNotifications(unreadFromEndpoint ?? unreadFallback);

    if (!silent) setLoading(false);
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 20_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const enrollments = Array.isArray(data?.enrollments) ? data.enrollments : [];
  const users       = Array.isArray(data?.users)       ? data.users       : [];
  const audit       = Array.isArray(data?.audit)       ? data.audit       : [];
  const health      = data?.health ?? {};

  // Secretary dashboard is operations-only — NO finance KPIs (that is the
  // director's domain). Finance data intentionally not surfaced here.
  const demographics = data?.demographics ?? null;
  const enrolledCount = enrollments.filter((e) => e.status.toUpperCase() === "ENROLLED").length;

  const enrollmentStatusData = Object.entries(
    enrollments.reduce((acc, row) => {
      const key = (row.status || "UNKNOWN").toUpperCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({ status, count }));

  const activeUsers          = users.filter((u) => u.is_active).length;
  const pendingEnrollments   = enrollments.filter((e) =>
    ["SUBMITTED", "APPROVED"].includes(e.status.toUpperCase())
  ).length;
  const healthKeys           = Object.keys(health);
  const allHealthy           = healthKeys.length === 0 || healthKeys.every((k) => health[k]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <AppShell title="Secretary" nav={secretaryNav} activeHref="/tenant/secretary/dashboard">
      <div className="space-y-5">

        {/* ── Hero header ── */}
        <div className="dashboard-hero rounded-[2rem] p-4 text-white sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                  <ClipboardList className="h-3 w-3" />
                  Secretary
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  allHealthy
                    ? "bg-emerald-500/20 text-emerald-100"
                    : "bg-red-500/20 text-red-100"
                }`}>
                  <HealthDot ok={allHealthy} />
                  {allHealthy ? "All systems operational" : "Service issue detected"}
                </span>
              </div>
              <h1 className="text-2xl font-bold">Operations Dashboard</h1>
              <p className="mt-0.5 text-sm text-white/80">
                {data?.me?.tenant?.name
                  ? `${data.me.tenant.name} · Enrollments, users & school operations`
                  : "Enrollment management, user activity & school operations"}
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
              <div className="grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
                {[
                  {
                    label: "Students",
                    value: loading ? "—" : (demographics?.total_students ?? 0).toLocaleString(),
                  },
                  { label: "Pending Intake", value: loading ? "—" : pendingEnrollments },
                  { label: "Active Users",   value: loading ? "—" : activeUsers },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur sm:px-4">
                    <div className="text-xl font-bold text-white">{item.value}</div>
                    <div className="text-xs text-white/65">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                {lastUpdated && (
                  <span className="text-xs text-white/65">
                    Updated {timeAgo(lastUpdated.toISOString())}
                  </span>
                )}
                <button
                  onClick={() => void load(true)}
                  className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white backdrop-blur transition hover:bg-white/20"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Today at School ── */}
        <TodayAtSchool data={data?.today_at_school ?? null} />

        {/* ── Error ── */}
        {error && (
          <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              {error}
            </div>
            <button
              onClick={() => void load()}
              className="text-xs font-medium text-red-600 hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Primary KPIs — school operations only (no finance) ── */}
        <SectionLabel>Operations Overview</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          <DashboardStatCard
            label="Total Students"
            value={loading ? "—" : (demographics?.total_students ?? 0).toLocaleString()}
            sub={`${enrolledCount} active enrolled`}
            icon={Users}
            tone="accent"
          />
          <DashboardStatCard
            label="Pending Intake"
            value={loading ? "—" : pendingEnrollments}
            sub={pendingEnrollments > 0 ? "Awaiting review" : "Queue clear"}
            icon={ClipboardList}
            tone={pendingEnrollments > 0 ? "warning" : "sage"}
          />
          <DashboardStatCard
            label="Intake Records"
            value={loading ? "—" : enrollments.length}
            sub="Total submissions"
            icon={FileText}
            tone="secondary"
          />
          <DashboardStatCard
            label="Active Users"
            value={loading ? "—" : `${activeUsers} / ${users.length}`}
            sub={users.length > 0 ? `${Math.round((activeUsers / users.length) * 100)}% active` : "No users yet"}
            icon={UserCheck}
            tone="secondary"
          />
          <DashboardStatCard
            label="Audit Events"
            value={loading ? "—" : (data?.summary?.total_audit_logs ?? audit.length)}
            sub={audit.length > 0 ? `Last ${timeAgo(audit[0]?.created_at)}` : "No events yet"}
            icon={Activity}
            tone="neutral"
          />
        </div>

        {/* ── Notifications — only when there is something to show ── */}
        {notifications.length > 0 && (
          <TenantNotificationsOverview
            notifications={notifications}
            unreadCount={unreadNotifications}
            totalCount={totalNotifications}
            viewAllHref="/tenant/secretary/notifications"
            subtitle="Latest alerts and action items"
          />
        )}

        {/* ── Demographics + Enrollment status, side by side ── */}
        <div className="grid gap-5 lg:grid-cols-2">

          {/* Student demographics */}
          <div className="min-w-0">
            <SectionLabel>Student Demographics</SectionLabel>
            <SectionCard title="Gender Distribution" subtitle="Active enrolled students" icon={Users}>
              {demographics && demographics.total_students > 0 ? (
                <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,150px)_1fr]">
                  <DemographicsDonut data={demographics} height={180} />
                  <DemographicsLegend data={demographics} />
                </div>
              ) : (
                <div className="flex h-[180px] items-center justify-center text-sm text-[var(--tenant-muted)]">
                  No student records yet
                </div>
              )}
            </SectionCard>
          </div>

          {/* Enrollment status */}
          <div className="min-w-0">
            <SectionLabel>Enrollment Status</SectionLabel>
            <SectionCard
              title="Intake by Status"
              subtitle={`${enrollments.length} total records`}
              icon={GraduationCap}
            >
              {enrollmentStatusData.length > 0 ? (
                <ChartContainer config={enrollmentChartConfig} className="h-[220px] w-full">
                  <BarChart data={enrollmentStatusData} accessibilityLayer>
                    <CartesianGrid vertical={false} stroke="#efe9df" />
                    <XAxis
                      dataKey="status"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tick={{ fontSize: 11, fill: "#78716c" }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={6} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
                  <GraduationCap className="h-8 w-8 text-[var(--tenant-border)]" />
                  <p className="text-sm text-[var(--tenant-muted)]">No enrollment data yet</p>
                </div>
              )}
            </SectionCard>
          </div>
        </div>

        {/* ── Staff & user accounts (full width) ── */}
        <div>
          <SectionLabel>User Activity</SectionLabel>
            <SectionCard
              title="Staff & User Accounts"
              subtitle={`${users.length} registered accounts`}
              icon={UserCheck}
              action={
                users.length > 0 ? (
                  <span className={dashboardBadgeClasses("secondary")}>
                    {activeUsers} active
                  </span>
                ) : undefined
              }
            >
              <div className="overflow-x-auto rounded-xl border border-[var(--tenant-border)] [&_table]:min-w-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[var(--tenant-surface-2)]">
                      <TableHead className="text-xs">Name / Email</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.slice(0, 6).map((u) => (
                      <TableRow key={u.id} className="hover:bg-[var(--tenant-surface-2)]">
                        <TableCell className="text-sm">
                          <div className="font-medium text-[var(--tenant-ink)]">
                            {u.full_name || "—"}
                          </div>
                          <div className="text-xs text-[var(--tenant-muted)]">{u.email}</div>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.is_active
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                              : "bg-[var(--tenant-surface-2)] text-[var(--tenant-muted)] ring-1 ring-[var(--tenant-border)]"
                          }`}>
                            {u.is_active
                              ? <CheckCircle className="h-3 w-3" />
                              : <XCircle className="h-3 w-3" />}
                            {u.is_active ? "Active" : "Inactive"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {users.length === 0 && (
                      <EmptyRow colSpan={2} message="No users found." />
                    )}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          </div>

        {/* ── Enrollment queue + Audit log ── */}
        <div className="grid gap-5 lg:grid-cols-2">

          {/* Recent enrollment queue */}
          <div className="min-w-0">
            <SectionLabel>Enrollment Queue</SectionLabel>
            <SectionCard
              title="Recent Intake Records"
              subtitle="Latest 8 submissions"
              icon={FileText}
              action={
                pendingEnrollments > 0 ? (
                  <span className={dashboardBadgeClasses("warning")}>
                    {pendingEnrollments} pending
                  </span>
                ) : enrollments.length > 0 ? (
                  <span className={dashboardBadgeClasses("sage")}>
                    All reviewed
                  </span>
                ) : undefined
              }
            >
              <div className="overflow-x-auto rounded-xl border border-[var(--tenant-border)] [&_table]:min-w-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[var(--tenant-surface-2)]">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrollments.slice(0, 8).map((row) => (
                      <TableRow key={row.id} className="cursor-pointer hover:bg-[var(--tenant-surface-2)]">
                        <TableCell className="text-sm font-medium text-[var(--tenant-ink)]">
                          <Link
                            href={`/tenant/secretary/enrollments?section=intake`}
                            className="block hover:text-[var(--tenant-primary)]"
                          >
                            {enrollmentName(row.payload)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-[var(--tenant-muted)]">
                            {enrollmentClass(row.payload) || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <EnrollmentStatusBadge status={row.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {enrollments.length === 0 && (
                      <EmptyRow colSpan={3} message="No enrollments in queue." />
                    )}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          </div>

          {/* Audit log */}
          <div className="min-w-0">
            <SectionLabel>Recent Audit Activity</SectionLabel>
            <SectionCard
              title="System Events"
              subtitle="Last 8 recorded actions"
              icon={ShieldCheck}
              action={
                audit.length > 0 ? (
                  <span className="rounded-full bg-[var(--tenant-surface-2)] px-2.5 py-0.5 text-xs font-medium text-[var(--tenant-muted)]">
                    {data?.summary?.total_audit_logs ?? audit.length} total
                  </span>
                ) : undefined
              }
            >
              <div className="overflow-x-auto rounded-xl border border-[var(--tenant-border)] [&_table]:min-w-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[var(--tenant-surface-2)]">
                      <TableHead className="text-xs">Action</TableHead>
                      <TableHead className="text-xs">Resource</TableHead>
                      <TableHead className="text-xs">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.slice(0, 8).map((entry) => (
                      <TableRow key={entry.id} className="hover:bg-[var(--tenant-surface-2)]">
                        <TableCell>
                          <span className="rounded-md bg-[var(--tenant-surface-2)] px-1.5 py-0.5 font-mono text-xs text-[var(--tenant-ink)]">
                            {entry.action}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-[var(--tenant-muted)]">{entry.resource}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs text-[var(--tenant-muted)]">
                            <Clock className="h-3 w-3" />
                            {timeAgo(entry.created_at)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {audit.length === 0 && (
                      <EmptyRow colSpan={3} message="No audit events yet." />
                    )}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          </div>
        </div>

        {/* ── System health ── */}
        {healthKeys.length > 0 && (
          <>
            <SectionLabel>System Health</SectionLabel>
            <div className="dashboard-surface overflow-hidden rounded-[1.6rem]">
              <div className="flex items-center gap-2 border-b border-[var(--tenant-border)] px-4 py-4 sm:px-6">
                <Activity className="h-4 w-4 text-[var(--tenant-muted)]" />
                <div>
                  <h2 className="text-sm font-semibold text-[var(--tenant-ink)]">Live Service Status</h2>
                  <p className="mt-0.5 text-xs text-[var(--tenant-muted)]">
                    {healthKeys.filter((k) => health[k]).length} of {healthKeys.length} services operational
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 p-4 sm:p-6">
                {healthKeys.map((key) => (
                  <div
                    key={key}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                      health[key]
                        ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                        : "border-red-100 bg-red-50 text-red-700"
                    }`}
                  >
                    <HealthDot ok={health[key]} />
                    {key.replace(/_/g, " ")}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

      </div>
    </AppShell>
  );
}
