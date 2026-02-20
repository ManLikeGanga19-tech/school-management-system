import { redirect } from "next/navigation";
import {
  Receipt,
  CheckCircle,
  CircleDollarSign,
  ClipboardList,
  GraduationCap,
  CreditCard,
  Users,
  ShieldCheck,
  Search,
  Settings,
  TriangleAlert,
  TrendingUp,
  Building2,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";

import { getDirectorDashboardData } from "@/server/director/dashboard";

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

// ─── Types ────────────────────────────────────────────────────────────────────

type ColorKey = "blue" | "emerald" | "amber" | "slate" | "purple";
type BadgeColor = "blue" | "emerald" | "amber" | "red" | "slate" | "purple";

// ─── Sub-components ───────────────────────────────────────────────────────────

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
  color: ColorKey;
}) {
  const palettes: Record<ColorKey, { wrap: string; icon: string; val: string; sub: string }> = {
    blue:    { wrap: "border-blue-100 bg-blue-50",       icon: "bg-blue-100 text-blue-600",       val: "text-blue-900",    sub: "text-blue-400" },
    emerald: { wrap: "border-emerald-100 bg-emerald-50", icon: "bg-emerald-100 text-emerald-600", val: "text-emerald-900", sub: "text-emerald-400" },
    amber:   { wrap: "border-amber-100 bg-amber-50",     icon: "bg-amber-100 text-amber-600",     val: "text-amber-900",   sub: "text-amber-400" },
    slate:   { wrap: "border-slate-100 bg-slate-50",     icon: "bg-slate-100 text-slate-500",     val: "text-slate-900",   sub: "text-slate-400" },
    purple:  { wrap: "border-purple-100 bg-purple-50",   icon: "bg-purple-100 text-purple-600",   val: "text-purple-900",  sub: "text-purple-400" },
  };
  const p = palettes[color];

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

function ModuleCard({
  href,
  icon: Icon,
  iconColor,
  title,
  description,
  badge,
  badgeColor,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  title: string;
  description: string;
  badge?: string;
  badgeColor?: BadgeColor;
}) {
  const badgeColors: Record<BadgeColor, string> = {
    blue:    "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    amber:   "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    red:     "bg-red-50 text-red-700 ring-1 ring-red-200",
    slate:   "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    purple:  "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  };

  return (
    <a
      href={href}
      className="group flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div className={`inline-flex rounded-xl p-2.5 ${iconColor} transition group-hover:opacity-90`}>
          <Icon className="h-5 w-5" />
        </div>
        {badge && badgeColor && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeColors[badgeColor]}`}>
            {badge}
          </span>
        )}
      </div>
      <div>
        <div className="flex items-center gap-1 text-sm font-semibold text-slate-900 transition group-hover:text-blue-700">
          {title}
          <span className="translate-x-0 opacity-0 transition-all group-hover:translate-x-1 group-hover:opacity-100">
            →
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>
      </div>
    </a>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DirectorDashboardPage() {
  const data = await getDirectorDashboardData();

  if (!data.me.data) {
    redirect("/login");
  }

  const roles = new Set((data.me.data.roles || []).map((r) => r.toUpperCase()));
  if (!roles.has("DIRECTOR")) {
    if (roles.has("SECRETARY")) redirect("/tenant/secretary/dashboard");
    redirect("/tenant/dashboard");
  }

  const invoices = data.invoices.data || [];
  const totalBilled    = invoices.reduce((sum, inv) => sum + toNumber(inv.total_amount),   0);
  const totalPaid      = invoices.reduce((sum, inv) => sum + toNumber(inv.paid_amount),    0);
  const outstanding    = invoices.reduce((sum, inv) => sum + toNumber(inv.balance_amount), 0);
  const collectionRate = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;

  const tenantSlug = data.me.data.tenant.slug;
  const tenantName = (data.me.data.tenant as any).name ?? tenantSlug;
  const hasSummaryError = Boolean(data.summary.error);

  const headerStats = [
    { label: "Users",      value: data.summary.data?.total_users      ?? 0 },
    { label: "Roles",      value: data.summary.data?.total_roles      ?? 0 },
    { label: "Invoices",   value: invoices.length                         },
    { label: "Audit Logs", value: data.summary.data?.total_audit_logs ?? 0 },
  ];

  return (
    <AppShell title="Director" nav={directorNav} activeHref="/tenant/director/dashboard">
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-700 to-blue-500 p-6 text-white shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                  <ShieldCheck className="h-3 w-3" />
                  Director
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-blue-100">
                  <Building2 className="h-3 w-3" />
                  {tenantSlug}
                </span>
              </div>
              <h1 className="text-2xl font-bold">{tenantName}</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Operations overview — enrollments, finance, users, RBAC &amp; audit
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
              {headerStats.map((item) => (
                <div key={item.label} className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
                  <div className="text-xl font-bold text-white">{item.value}</div>
                  <div className="text-xs text-blue-200">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Degraded alert ── */}
        {hasSummaryError && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <div className="font-semibold">Summary service degraded</div>
              <div className="mt-0.5 text-xs text-amber-600">{data.summary.error}</div>
            </div>
          </div>
        )}

        {/* ── Finance KPI cards ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Billed"
            value={formatKes(totalBilled)}
            sub={`${invoices.length} invoice${invoices.length !== 1 ? "s" : ""}`}
            icon={Receipt}
            color="blue"
          />
          <StatCard
            label="Collected"
            value={formatKes(totalPaid)}
            sub={`${collectionRate}% collection rate`}
            icon={CheckCircle}
            color="emerald"
          />
          <StatCard
            label="Outstanding"
            value={formatKes(outstanding)}
            sub={outstanding > 0 ? "Pending collection" : "All clear"}
            icon={CircleDollarSign}
            color={outstanding > 0 ? "amber" : "emerald"}
          />
          <StatCard
            label="Audit Events"
            value={data.summary.data?.total_audit_logs ?? 0}
            sub="System-wide activity"
            icon={ClipboardList}
            color="slate"
          />
        </div>

        {/* ── Collection progress bar ── */}
        {totalBilled > 0 && (
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <TrendingUp className="h-4 w-4 text-slate-400" />
                Fee Collection Progress
              </div>
              <span className="text-sm font-bold text-slate-800">{collectionRate}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${collectionRate}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-400">
              <span>Collected {formatKes(totalPaid)}</span>
              <span>Target {formatKes(totalBilled)}</span>
            </div>
          </div>
        )}

        {/* ── Module Quick Links ── */}
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Module Navigation
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ModuleCard
              href="/tenant/director/enrollments"
              icon={GraduationCap}
              iconColor="bg-blue-50 text-blue-600"
              title="Enrollments"
              description="Manage student intake, approve or reject applications, and track the enrollment pipeline."
              badge="Pipeline"
              badgeColor="blue"
            />
            <ModuleCard
              href="/tenant/director/finance"
              icon={CreditCard}
              iconColor="bg-emerald-50 text-emerald-600"
              title="Finance"
              description="Fee structures, invoice management, payment recording, and collection reporting."
              badge={outstanding > 0 ? formatKes(outstanding) + " due" : "Up to date"}
              badgeColor={outstanding > 0 ? "amber" : "emerald"}
            />
            <ModuleCard
              href="/tenant/director/users"
              icon={Users}
              iconColor="bg-slate-100 text-slate-600"
              title="Users"
              description="View all tenant users, monitor active sessions, and manage account status."
              badge={`${data.summary.data?.total_users ?? 0} users`}
              badgeColor="slate"
            />
            <ModuleCard
              href="/tenant/director/rbac"
              icon={ShieldCheck}
              iconColor="bg-purple-50 text-purple-600"
              title="RBAC & Roles"
              description="Configure roles, assign permissions, and control what each user can access across the platform."
              badge={`${data.summary.data?.total_roles ?? 0} roles`}
              badgeColor="purple"
            />
            <ModuleCard
              href="/tenant/director/audit"
              icon={Search}
              iconColor="bg-slate-100 text-slate-600"
              title="Audit Logs"
              description="Full audit trail of all system events. Filter by action type, resource, or time range."
              badge={`${data.summary.data?.total_audit_logs ?? 0} events`}
              badgeColor="slate"
            />
            <ModuleCard
              href="/tenant/director/settings"
              icon={Settings}
              iconColor="bg-slate-100 text-slate-600"
              title="Settings"
              description="Tenant configuration, policy settings, and system-level preferences for this institution."
              badgeColor="slate"
            />
          </div>
        </div>

        {/* ── Summary data rows ── */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Users className="h-3.5 w-3.5" />
              Users &amp; Roles
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Total users</span>
                <span className="font-semibold text-slate-800">{data.summary.data?.total_users ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Total roles</span>
                <span className="font-semibold text-slate-800">{data.summary.data?.total_roles ?? "—"}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <CreditCard className="h-3.5 w-3.5" />
              Finance Summary
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Total billed</span>
                <span className="font-semibold text-slate-800">{formatKes(totalBilled)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Outstanding</span>
                <span className={`font-semibold ${outstanding > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                  {formatKes(outstanding)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <ClipboardList className="h-3.5 w-3.5" />
              System Activity
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Audit events</span>
                <span className="font-semibold text-slate-800">{data.summary.data?.total_audit_logs ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Tenant</span>
                <span className="font-mono text-xs font-semibold text-blue-700">{tenantSlug}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </AppShell>
  );
}