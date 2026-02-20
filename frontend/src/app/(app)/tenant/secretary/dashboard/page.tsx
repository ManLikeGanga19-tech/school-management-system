"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Pie, PieChart, XAxis, Cell } from "recharts";

import { AppShell } from "@/components/layout/AppShell";
import { secretaryNav } from "@/components/layout/nav-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

// ─── Chart Configs ────────────────────────────────────────────────────────────

const enrollmentChartConfig = {
  count: { label: "Count", color: "#3b82f6" },
};

const financeChartConfig = {
  paid: { label: "Collected", color: "#10b981" },
  outstanding: { label: "Outstanding", color: "#f59e0b" },
};

const FINANCE_COLORS = ["#10b981", "#f59e0b"];

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
  const options = [payload.student_name, payload.studentName, payload.full_name, payload.fullName, payload.name];
  for (const item of options) {
    if (typeof item === "string" && item.trim()) return item;
  }
  return "Unknown student";
}

function enrollmentClass(payload?: Record<string, unknown>) {
  if (!payload) return "";
  const options = [payload.admission_class, payload.class_code, payload.classCode, payload.grade];
  for (const item of options) {
    if (typeof item === "string" && item.trim()) return item;
  }
  return "";
}

function timeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EnrollmentStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const styles: Record<string, string> = {
    ENROLLED: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    APPROVED: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    SUBMITTED: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    DRAFT: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
    REJECTED: "bg-red-50 text-red-600 ring-1 ring-red-200",
    TRANSFER_REQUESTED: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[s] ?? "bg-slate-100 text-slate-600 ring-1 ring-slate-200"}`}>
      {s.replace("_", " ")}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  trend,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
  trend?: string;
  color: "blue" | "emerald" | "amber" | "slate" | "red";
}) {
  const palettes = {
    blue:    { bg: "bg-blue-50",    icon: "bg-blue-100 text-blue-600",    val: "text-blue-900",    sub: "text-blue-500" },
    emerald: { bg: "bg-emerald-50", icon: "bg-emerald-100 text-emerald-600", val: "text-emerald-900", sub: "text-emerald-500" },
    amber:   { bg: "bg-amber-50",   icon: "bg-amber-100 text-amber-600",   val: "text-amber-900",   sub: "text-amber-500" },
    slate:   { bg: "bg-slate-50",   icon: "bg-slate-100 text-slate-500",   val: "text-slate-900",   sub: "text-slate-400" },
    red:     { bg: "bg-red-50",     icon: "bg-red-100 text-red-600",       val: "text-red-900",     sub: "text-red-400" },
  };
  const p = palettes[color];
  return (
    <div className={`rounded-2xl border border-slate-100 ${p.bg} p-5 shadow-sm`}>
      <div className="flex items-start justify-between">
        <div className={`rounded-xl p-2.5 text-xl ${p.icon}`}>{icon}</div>
        {trend && <span className="text-xs font-medium text-slate-400">{trend}</span>}
      </div>
      <div className={`mt-4 text-2xl font-bold tracking-tight ${p.val}`}>{value}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-600">{label}</div>
      {sub && <div className={`mt-0.5 text-xs ${p.sub}`}>{sub}</div>}
    </div>
  );
}

function SectionCard({ title, subtitle, children, action }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center">
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl">📋</span>
          <span className="text-sm text-slate-400">{message}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

function HealthDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-flex h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default function SecretaryDashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function load() {
    const res = await fetch("/api/tenant/secretary/dashboard", { method: "GET" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body?.detail === "string" ? body.detail : "Failed to load dashboard");
      setData(null);
      return;
    }
    setData(body as DashboardResponse);
    setLastUpdated(new Date());
    setError(null);
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20000);
    return () => clearInterval(timer);
  }, []);

  const enrollments = Array.isArray(data?.enrollments) ? data.enrollments : [];
  const invoices = Array.isArray(data?.invoices) ? data.invoices : [];
  const users = Array.isArray(data?.users) ? data.users : [];
  const audit = Array.isArray(data?.audit) ? data.audit : [];
  const health = data?.health ?? {};

  const enrollmentStatusData = Object.entries(
    enrollments.reduce((acc, row) => {
      const key = (row.status || "UNKNOWN").toUpperCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({ status, count }));

  const totals = invoices.reduce(
    (acc, inv) => {
      acc.total += toNumber(inv.total_amount);
      acc.paid += toNumber(inv.paid_amount);
      acc.balance += toNumber(inv.balance_amount);
      return acc;
    },
    { total: 0, paid: 0, balance: 0 }
  );

  const financeChartData = [
    { name: "paid", value: totals.paid },
    { name: "outstanding", value: totals.balance },
  ];

  const activeUsers = users.filter((u) => u.is_active).length;
  const pendingEnrollments = enrollments.filter((e) => ["SUBMITTED", "APPROVED"].includes(e.status.toUpperCase())).length;
  const healthKeys = Object.keys(health);
  const allHealthy = healthKeys.length === 0 || healthKeys.every((k) => health[k]);
  const collectionRate = totals.total > 0 ? Math.round((totals.paid / totals.total) * 100) : 0;

  return (
    <AppShell title="Secretary" nav={secretaryNav} activeHref="/tenant/secretary/dashboard">
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold">Secretary Dashboard</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                {data?.me?.tenant?.name
                  ? `${data.me.tenant.name} · Workflow center for enrollment, finance & operations`
                  : "Workflow center for enrollment, finance, and operations"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${allHealthy ? "bg-emerald-500/20 text-emerald-100" : "bg-red-500/20 text-red-100"}`}>
                <HealthDot ok={allHealthy} />
                {allHealthy ? "All systems operational" : "Service issues detected"}
              </div>
              {data?.me?.tenant?.slug && (
                <div className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                  {data.me.tenant.slug}
                </div>
              )}
              {lastUpdated && (
                <div className="text-xs text-blue-200">
                  Updated {timeAgo(lastUpdated.toISOString())}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* ── Stat Cards ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active Users"
            value={`${activeUsers} / ${users.length}`}
            sub={users.length > 0 ? `${Math.round((activeUsers / users.length) * 100)}% active` : "No users yet"}
            icon="👥"
            color="blue"
          />
          <StatCard
            label="Total Enrollments"
            value={enrollments.length}
            sub={pendingEnrollments > 0 ? `${pendingEnrollments} pending review` : "All up to date"}
            icon="🎓"
            color="emerald"
          />
          <StatCard
            label="Outstanding Balance"
            value={formatKes(totals.balance)}
            sub={totals.total > 0 ? `${collectionRate}% collected` : "No invoices yet"}
            icon="💰"
            color={totals.balance > 0 ? "amber" : "emerald"}
          />
          <StatCard
            label="Audit Events"
            value={data?.summary?.total_audit_logs ?? audit.length}
            sub={audit.length > 0 ? `Last: ${timeAgo(audit[0]?.created_at)}` : "No events yet"}
            icon="📋"
            color="slate"
          />
        </div>

        {/* ── Finance Summary Strip ── */}
        {totals.total > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs font-medium text-slate-500">Total Billed</p>
              <p className="mt-0.5 text-lg font-bold text-slate-800">{formatKes(totals.total)}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
              <p className="text-xs font-medium text-emerald-600">Collected</p>
              <p className="mt-0.5 text-lg font-bold text-emerald-800">{formatKes(totals.paid)}</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
              <p className="text-xs font-medium text-amber-600">Outstanding</p>
              <p className="mt-0.5 text-lg font-bold text-amber-800">{formatKes(totals.balance)}</p>
            </div>
          </div>
        )}

        {/* ── Charts Row ── */}
        <div className="grid gap-5 lg:grid-cols-2">
          <SectionCard
            title="Enrollment Status Breakdown"
            subtitle={`${enrollments.length} total records`}
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
              <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">
                No enrollment data yet
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Finance Collection"
            subtitle="KES · Total billed vs collected"
          >
            {totals.total > 0 ? (
              <div className="flex items-center gap-6">
                <ChartContainer config={financeChartConfig} className="h-[220px] flex-1">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                    <Pie
                      data={financeChartData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={95}
                      strokeWidth={2}
                    >
                      {financeChartData.map((entry, index) => (
                        <Cell key={entry.name} fill={FINANCE_COLORS[index % FINANCE_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="space-y-3 text-sm shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-emerald-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-800">{collectionRate}%</div>
                      <div className="text-xs text-slate-400">Collected</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-amber-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-800">{100 - collectionRate}%</div>
                      <div className="text-xs text-slate-400">Outstanding</div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-xs text-slate-400">Total invoices</div>
                    <div className="font-semibold text-slate-700">{invoices.length}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">
                No invoice data yet
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── Tables Row ── */}
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Recent Enrollment Queue */}
          <SectionCard
            title="Recent Enrollment Queue"
            subtitle="Latest 8 intake records"
            action={
              enrollments.length > 0 ? (
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 ring-1 ring-blue-100">
                  {enrollments.length} total
                </span>
              ) : undefined
            }
          >
            <div className="rounded-xl border border-slate-100 overflow-hidden">
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
                      <TableCell className="text-sm font-medium">
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

          {/* Audit Log */}
          <SectionCard
            title="Recent Audit Activity"
            subtitle="Last 8 system events"
            action={
              audit.length > 0 ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                  {data?.summary?.total_audit_logs ?? audit.length} total
                </span>
              ) : undefined
            }
          >
            <div className="rounded-xl border border-slate-100 overflow-hidden">
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
                      <TableCell className="text-xs text-slate-400">{timeAgo(entry.created_at)}</TableCell>
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

        {/* ── System Health ── */}
        {healthKeys.length > 0 && (
          <SectionCard
            title="System Health"
            subtitle="Live service status"
          >
            <div className="flex flex-wrap gap-2">
              {healthKeys.map((key) => (
                <div
                  key={key}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${
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
          </SectionCard>
        )}
      </div>
    </AppShell>
  );
}