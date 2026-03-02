"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { AppShell } from "@/components/layout/AppShell";
import { secretaryNav } from "@/components/layout/nav-config";
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
  AlertTriangle,
  Activity,
  ShieldCheck,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  FileText,
  UserCheck,
  BellRing,
  AlertCircle,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
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
};

// ─── Chart config ─────────────────────────────────────────────────────────────

const enrollmentChartConfig = {
  count: { label: "Enrollments", color: "#3b82f6" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function formatKes(value: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

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

function timeAgo(dateString: string) {
  const diff = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
      {children}
    </h2>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "emerald" | "amber" | "slate" | "red";
}) {
  const p = {
    blue:    { wrap: "border-blue-100 bg-blue-50",       icon: "bg-blue-100 text-blue-600",       val: "text-blue-900",    sub: "text-blue-400" },
    emerald: { wrap: "border-emerald-100 bg-emerald-50", icon: "bg-emerald-100 text-emerald-600", val: "text-emerald-900", sub: "text-emerald-400" },
    amber:   { wrap: "border-amber-100 bg-amber-50",     icon: "bg-amber-100 text-amber-600",     val: "text-amber-900",   sub: "text-amber-400" },
    slate:   { wrap: "border-slate-100 bg-slate-50",     icon: "bg-slate-100 text-slate-500",     val: "text-slate-900",   sub: "text-slate-400" },
    red:     { wrap: "border-red-100 bg-red-50",         icon: "bg-red-100 text-red-600",         val: "text-red-900",     sub: "text-red-400" },
  }[color];

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${p.wrap}`}>
      <div className={`inline-flex rounded-xl p-2.5 ${p.icon}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className={`mt-4 text-2xl font-bold tracking-tight ${p.val}`}>{value}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-600">{label}</div>
      {sub && <div className={`mt-0.5 text-xs ${p.sub}`}>{sub}</div>}
    </div>
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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-slate-400" />}
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
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
    APPROVED:           "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    SUBMITTED:          "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    DRAFT:              "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
    REJECTED:           "bg-red-50 text-red-600 ring-1 ring-red-200",
    TRANSFER_REQUESTED: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[s] ?? "bg-slate-100 text-slate-600 ring-1 ring-slate-200"}`}>
      {s.replace(/_/g, " ")}
    </span>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center text-sm text-slate-400">
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const [dashboardRes, notificationsRes, unreadCountRes] = await Promise.allSettled([
      api.get<DashboardResponse>("/tenants/secretary/dashboard", { tenantRequired: true }),
      api.get<unknown>("/tenants/notifications?limit=5&offset=0", {
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

    const nextNotifications =
      notificationsRes.status === "fulfilled"
        ? normalizeTenantNotificationPreviews(notificationsRes.value).slice(0, 5)
        : [];
    setNotifications(nextNotifications);

    const unreadFromEndpoint =
      unreadCountRes.status === "fulfilled"
        ? parseTenantUnreadCount(unreadCountRes.value)
        : null;
    const unreadFallback = nextNotifications.filter((item) => item.unread).length;
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
  const invoices    = Array.isArray(data?.invoices)    ? data.invoices    : [];
  const users       = Array.isArray(data?.users)       ? data.users       : [];
  const audit       = Array.isArray(data?.audit)       ? data.audit       : [];
  const health      = data?.health ?? {};

  // Secretary only sees the outstanding balance — no revenue breakdown
  const outstandingBalance = invoices.reduce(
    (acc, inv) => acc + toNumber(inv.balance_amount),
    0
  );

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
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-700 via-blue-600 to-blue-500 p-4 text-white shadow-sm sm:p-6">
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
              <p className="mt-0.5 text-sm text-blue-100">
                {data?.me?.tenant?.name
                  ? `${data.me.tenant.name} · Enrollments, users & school operations`
                  : "Enrollment management, user activity & school operations"}
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
              <div className="grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
                {[
                  { label: "Enrollments",  value: loading ? "—" : enrollments.length },
                  { label: "Pending",      value: loading ? "—" : pendingEnrollments },
                  { label: "Active Users", value: loading ? "—" : activeUsers },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur sm:px-4">
                    <div className="text-xl font-bold text-white">{item.value}</div>
                    <div className="text-xs text-blue-200">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                {lastUpdated && (
                  <span className="text-xs text-blue-200">
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

        {/* ── Stat cards + notifications overview ── */}
        <SectionLabel>School Operations Overview</SectionLabel>
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard
                label="Active Users"
                value={loading ? "—" : `${activeUsers} / ${users.length}`}
                sub={users.length > 0
                  ? `${Math.round((activeUsers / users.length) * 100)}% active`
                  : "No users yet"}
                icon={Users}
                color="blue"
              />
              <StatCard
                label="Total Enrollments"
                value={loading ? "—" : enrollments.length}
                sub={pendingEnrollments > 0
                  ? `${pendingEnrollments} pending review`
                  : "All up to date"}
                icon={GraduationCap}
                color="emerald"
              />
              <StatCard
                label="Outstanding Balance"
                value={loading ? "—" : formatKes(outstandingBalance)}
                sub="Contact director for full finance report"
                icon={AlertTriangle}
                color={outstandingBalance > 0 ? "amber" : "emerald"}
              />
              <StatCard
                label="Audit Events"
                value={loading ? "—" : (data?.summary?.total_audit_logs ?? audit.length)}
                sub={audit.length > 0
                  ? `Last: ${timeAgo(audit[0]?.created_at)}`
                  : "No events yet"}
                icon={Activity}
                color="slate"
              />
            </div>
          </div>
          <div className="xl:col-span-1">
            <SectionCard
              title="Notifications Overview"
              subtitle="Latest alerts and action items"
              icon={BellRing}
              action={
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
                    {unreadNotifications} unread
                  </span>
                  <a
                    href="/tenant/secretary/notifications"
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
                  >
                    View all
                  </a>
                </div>
              }
            >
              <div className="space-y-2">
                {notifications.length > 0 ? (
                  notifications.map((row) => (
                    <a
                      key={row.id}
                      href="/tenant/secretary/notifications"
                      className={`block rounded-xl border px-3 py-2 transition ${
                        row.unread
                          ? "border-blue-100 bg-blue-50/60 hover:bg-blue-50"
                          : "border-slate-100 bg-slate-50 hover:bg-slate-100"
                      }`}
                    >
                      <div className="text-xs font-semibold text-slate-900">{row.title}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{row.message}</div>
                      <div className="mt-1 text-[11px] text-slate-400">{timeAgo(row.created_at)}</div>
                    </a>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    No notifications available right now.
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </div>

        {/* ── Enrollment pipeline + Chart ── */}
        <div className="grid gap-5 lg:grid-cols-2">

          {/* Enrollment breakdown chart */}
          <div>
            <SectionLabel>Enrollment Status Breakdown</SectionLabel>
            <SectionCard
              title="Intake by Status"
              subtitle={`${enrollments.length} total records`}
              icon={GraduationCap}
            >
              {enrollmentStatusData.length > 0 ? (
                <ChartContainer config={enrollmentChartConfig} className="h-[220px] w-full">
                  <BarChart data={enrollmentStatusData} accessibilityLayer>
                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="status"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={6} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
                  <GraduationCap className="h-8 w-8 text-slate-200" />
                  <p className="text-sm text-slate-400">No enrollment data yet</p>
                </div>
              )}
            </SectionCard>
          </div>

          {/* User activity summary */}
          <div>
            <SectionLabel>User Activity</SectionLabel>
            <SectionCard
              title="Staff & User Accounts"
              subtitle={`${users.length} registered accounts`}
              icon={UserCheck}
              action={
                users.length > 0 ? (
                  <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 ring-1 ring-blue-100">
                    {activeUsers} active
                  </span>
                ) : undefined
              }
            >
              <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Name / Email</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.slice(0, 6).map((u) => (
                      <TableRow key={u.id} className="hover:bg-slate-50">
                        <TableCell className="text-sm">
                          <div className="font-medium text-slate-800">
                            {u.full_name || "—"}
                          </div>
                          <div className="text-xs text-slate-400">{u.email}</div>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.is_active
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                              : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
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
        </div>

        {/* ── Enrollment queue + Audit log ── */}
        <div className="grid gap-5 lg:grid-cols-2">

          {/* Recent enrollment queue */}
          <div>
            <SectionLabel>Enrollment Queue</SectionLabel>
            <SectionCard
              title="Recent Intake Records"
              subtitle="Latest 8 submissions"
              icon={FileText}
              action={
                pendingEnrollments > 0 ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                    {pendingEnrollments} pending
                  </span>
                ) : enrollments.length > 0 ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                    All reviewed
                  </span>
                ) : undefined
              }
            >
              <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrollments.slice(0, 8).map((row) => (
                      <TableRow key={row.id} className="hover:bg-slate-50">
                        <TableCell className="text-sm font-medium text-slate-800">
                          {enrollmentName(row.payload)}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-slate-400">
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
          <div>
            <SectionLabel>Recent Audit Activity</SectionLabel>
            <SectionCard
              title="System Events"
              subtitle="Last 8 recorded actions"
              icon={ShieldCheck}
              action={
                audit.length > 0 ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                    {data?.summary?.total_audit_logs ?? audit.length} total
                  </span>
                ) : undefined
              }
            >
              <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Action</TableHead>
                      <TableHead className="text-xs">Resource</TableHead>
                      <TableHead className="text-xs">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.slice(0, 8).map((entry) => (
                      <TableRow key={entry.id} className="hover:bg-slate-50">
                        <TableCell>
                          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 font-mono text-xs text-blue-700">
                            {entry.action}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">{entry.resource}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs text-slate-400">
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
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-4 sm:px-6">
                <Activity className="h-4 w-4 text-slate-400" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Live Service Status</h2>
                  <p className="mt-0.5 text-xs text-slate-400">
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
