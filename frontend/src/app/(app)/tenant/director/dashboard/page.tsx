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
import {
  DashboardModuleCard,
  DashboardSectionLabel,
  DashboardStatCard,
} from "@/components/dashboard/dashboard-primitives";
import { directorNav } from "@/components/layout/nav-config";
import { TenantNotificationsOverview } from "@/components/notifications/TenantNotificationsOverview";

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
  const notifications = Array.isArray(data.notifications.data) ? data.notifications.data : [];
  const totalNotifications =
    typeof data.notificationsTotalCount.data === "number"
      ? data.notificationsTotalCount.data
      : notifications.length;
  const unreadNotifications =
    typeof data.notificationsUnreadCount.data === "number"
      ? data.notificationsUnreadCount.data
      : notifications.filter((item) => item.unread).length;

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
        <div className="dashboard-hero rounded-[2rem] p-6 text-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                  <ShieldCheck className="h-3 w-3" />
                  Director
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/75">
                  <Building2 className="h-3 w-3" />
                  {tenantSlug}
                </span>
              </div>
              <h1 className="text-2xl font-bold">{tenantName}</h1>
              <p className="mt-0.5 text-sm text-white/80">
                Operations overview — enrollments, finance, users, RBAC &amp; audit
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
              {headerStats.map((item) => (
                <div key={item.label} className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
                  <div className="text-xl font-bold text-white">{item.value}</div>
                  <div className="text-xs text-white/65">{item.label}</div>
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
          <DashboardStatCard
            label="Total Billed"
            value={formatKes(totalBilled)}
            sub={`${invoices.length} invoice${invoices.length !== 1 ? "s" : ""}`}
            icon={Receipt}
            tone="secondary"
          />
          <DashboardStatCard
            label="Collected"
            value={formatKes(totalPaid)}
            sub={`${collectionRate}% collection rate`}
            icon={CheckCircle}
            tone="sage"
          />
          <DashboardStatCard
            label="Outstanding"
            value={formatKes(outstanding)}
            sub={outstanding > 0 ? "Pending collection" : "All clear"}
            icon={CircleDollarSign}
            tone={outstanding > 0 ? "warning" : "sage"}
          />
          <DashboardStatCard
            label="Audit Events"
            value={data.summary.data?.total_audit_logs ?? 0}
            sub="System-wide activity"
            icon={ClipboardList}
            tone="neutral"
          />
        </div>

        {/* ── Collection progress bar ── */}
        {totalBilled > 0 && (
          <div className="dashboard-surface rounded-[1.6rem] p-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <TrendingUp className="h-4 w-4 text-slate-400" />
                Fee Collection Progress
              </div>
              <span className="text-sm font-bold text-slate-800">{collectionRate}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-[#20644f] transition-all"
                style={{ width: `${collectionRate}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-400">
              <span>Collected {formatKes(totalPaid)}</span>
              <span>Target {formatKes(totalBilled)}</span>
            </div>
          </div>
        )}

        {/* ── Notifications Overview ── */}
        <TenantNotificationsOverview
          notifications={notifications}
          unreadCount={unreadNotifications}
          totalCount={totalNotifications}
          viewAllHref="/tenant/director/notifications"
          subtitle="Latest tenant notifications requiring attention"
        />

        {/* ── Module Quick Links ── */}
        <div>
          <DashboardSectionLabel>Module Navigation</DashboardSectionLabel>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DashboardModuleCard
              href="/tenant/director/enrollments"
              icon={GraduationCap}
              title="Enrollments"
              description="Manage student intake, approve or reject applications, and track the enrollment pipeline."
              badge="Pipeline"
              tone="secondary"
              badgeTone="secondary"
            />
            <DashboardModuleCard
              href="/tenant/director/finance"
              icon={CreditCard}
              title="Finance"
              description="Fee structures, invoice management, payment recording, and collection reporting."
              badge={outstanding > 0 ? formatKes(outstanding) + " due" : "Up to date"}
              tone="sage"
              badgeTone={outstanding > 0 ? "warning" : "sage"}
            />
            <DashboardModuleCard
              href="/tenant/director/users"
              icon={Users}
              title="Users"
              description="View all tenant users, monitor active sessions, and manage account status."
              badge={`${data.summary.data?.total_users ?? 0} users`}
              tone="neutral"
              badgeTone="neutral"
            />
            <DashboardModuleCard
              href="/tenant/director/rbac"
              icon={ShieldCheck}
              title="RBAC & Roles"
              description="Configure roles, assign permissions, and control what each user can access across the platform."
              badge={`${data.summary.data?.total_roles ?? 0} roles`}
              tone="accent"
              badgeTone="accent"
            />
            <DashboardModuleCard
              href="/tenant/director/audit"
              icon={Search}
              title="Audit Logs"
              description="Full audit trail of all system events. Filter by action type, resource, or time range."
              badge={`${data.summary.data?.total_audit_logs ?? 0} events`}
              tone="neutral"
              badgeTone="neutral"
            />
            <DashboardModuleCard
              href="/tenant/director/settings"
              icon={Settings}
              title="Settings"
              description="Tenant configuration, policy settings, and system-level preferences for this institution."
              tone="warning"
            />
          </div>
        </div>

        {/* ── Summary data rows ── */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="dashboard-surface rounded-[1.6rem] p-5">
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

          <div className="dashboard-surface rounded-[1.6rem] p-5">
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

          <div className="dashboard-surface rounded-[1.6rem] p-5">
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
                <span className="font-mono text-xs font-semibold text-[#173f49]">{tenantSlug}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </AppShell>
  );
}
