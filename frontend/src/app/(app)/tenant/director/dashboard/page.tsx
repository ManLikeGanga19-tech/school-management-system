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
  CalendarDays,
  BookOpenText,
  BriefcaseBusiness,
  Banknote,
  CalendarCheck,
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
import { formatKes } from "@/lib/format";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function providerLabel(p: string) {
  const m: Record<string, string> = { MPESA: "M-Pesa", CASH: "Cash", BANK: "Bank", CHEQUE: "Cheque" };
  return m[p] || p;
}

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

  const kpis = data.kpis.data;
  const hasKpiError = Boolean(data.kpis.error);

  // Destructure with safe fallbacks
  const finance       = kpis?.finance;
  const termFinance   = kpis?.term_finance ?? null;
  const enrollments   = kpis?.enrollments;
  const school        = kpis?.school;
  const activeTerm    = kpis?.active_term ?? null;
  const recentPayments = kpis?.recent_payments ?? [];

  const totalBilled      = finance?.total_billed      ?? 0;
  const totalCollected   = finance?.total_collected   ?? 0;
  const totalOutstanding = finance?.total_outstanding ?? 0;
  const collectionRate   = finance?.collection_rate_pct ?? 0;
  const invoiceCount     = finance?.invoice_count    ?? 0;

  const totalEnrolled  = enrollments?.total_enrolled ?? 0;
  const pendingIntake  = enrollments?.pending_intake  ?? 0;

  const tenantSlug = data.me.data.tenant.slug;
  const tenantName = (data.me.data.tenant as { name?: string }).name ?? tenantSlug;

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
    { label: "Users",     value: school?.total_users      ?? 0 },
    { label: "Enrolled",  value: totalEnrolled                  },
    { label: "Invoices",  value: invoiceCount                   },
    { label: "Pending",   value: pendingIntake                  },
  ];

  return (
    <AppShell title="Director" nav={directorNav} activeHref="/tenant/director/dashboard">
      <div className="space-y-5">

        {/* ── Hero ── */}
        <div className="dashboard-hero rounded-[2rem] p-6 text-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                  <ShieldCheck className="h-3 w-3" /> Director
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/75">
                  <Building2 className="h-3 w-3" /> {tenantSlug}
                </span>
                {activeTerm && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/75">
                    <CalendarCheck className="h-3 w-3" /> {activeTerm.name}
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold">{tenantName}</h1>
              <p className="mt-0.5 text-sm text-white/80">
                Operations overview — enrollments, finance &amp; school activity
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

        {/* ── KPI error ── */}
        {hasKpiError && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <div className="font-semibold">Dashboard data unavailable</div>
              <div className="mt-0.5 text-xs text-amber-600">{data.kpis.error}</div>
            </div>
          </div>
        )}

        {/* ── All-time finance KPIs ── */}
        <div>
          <DashboardSectionLabel>
            Finance — All Time
          </DashboardSectionLabel>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <DashboardStatCard
              label="Total Billed"
              value={formatKes(totalBilled)}
              sub={`${invoiceCount} invoice${invoiceCount !== 1 ? "s" : ""}`}
              icon={Receipt}
              tone="secondary"
            />
            <DashboardStatCard
              label="Collected"
              value={formatKes(totalCollected)}
              sub={`${collectionRate}% collection rate`}
              icon={CheckCircle}
              tone="sage"
            />
            <DashboardStatCard
              label="Outstanding"
              value={formatKes(totalOutstanding)}
              sub={totalOutstanding > 0 ? "Pending collection" : "All clear"}
              icon={CircleDollarSign}
              tone={totalOutstanding > 0 ? "warning" : "sage"}
            />
            <DashboardStatCard
              label="Payments"
              value={finance?.payment_count ?? 0}
              sub="recorded transactions"
              icon={Banknote}
              tone="neutral"
            />
          </div>
        </div>

        {/* ── Current-term finance KPIs ── */}
        {termFinance && (
          <div>
            <DashboardSectionLabel>
              Finance — {activeTerm?.name ?? "Current Term"}
            </DashboardSectionLabel>
            <div className="grid gap-4 sm:grid-cols-3">
              <DashboardStatCard
                label="Term Billed"
                value={formatKes(termFinance.term_billed)}
                sub={`${termFinance.term_invoice_count} invoice${termFinance.term_invoice_count !== 1 ? "s" : ""} this term`}
                icon={Receipt}
                tone="secondary"
              />
              <DashboardStatCard
                label="Term Collected"
                value={formatKes(termFinance.term_collected)}
                sub={`${termFinance.term_collection_rate_pct}% collection rate`}
                icon={CheckCircle}
                tone="sage"
              />
              <DashboardStatCard
                label="Term Outstanding"
                value={formatKes(termFinance.term_outstanding)}
                sub={termFinance.term_outstanding > 0 ? "Pending this term" : "Term cleared"}
                icon={CircleDollarSign}
                tone={termFinance.term_outstanding > 0 ? "warning" : "sage"}
              />
            </div>
          </div>
        )}

        {/* ── Collection progress bar (all-time) ── */}
        {totalBilled > 0 && (
          <div className="dashboard-surface rounded-[1.6rem] p-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <TrendingUp className="h-4 w-4 text-slate-400" />
                Overall Fee Collection Progress
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
              <span>Collected {formatKes(totalCollected)}</span>
              <span>Target {formatKes(totalBilled)}</span>
            </div>
          </div>
        )}

        {/* ── Enrollment + school meta KPIs ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DashboardStatCard
            label="Enrolled Students"
            value={totalEnrolled}
            sub={`${(enrollments?.by_status?.WITHDRAWN ?? 0) + (enrollments?.by_status?.REJECTED ?? 0)} inactive`}
            icon={GraduationCap}
            tone="sage"
          />
          <DashboardStatCard
            label="Pending Intake"
            value={pendingIntake}
            sub={pendingIntake > 0 ? "Awaiting review" : "Queue clear"}
            icon={ClipboardList}
            tone={pendingIntake > 0 ? "warning" : "sage"}
          />
          <DashboardStatCard
            label="Users"
            value={school?.total_users ?? 0}
            sub={`${school?.total_roles ?? 0} role assignment${(school?.total_roles ?? 0) !== 1 ? "s" : ""}`}
            icon={Users}
            tone="neutral"
          />
          <DashboardStatCard
            label="Fee Categories"
            value={school?.fee_categories ?? 0}
            sub={`${school?.fee_items ?? 0} fee item${(school?.fee_items ?? 0) !== 1 ? "s" : ""}`}
            icon={CreditCard}
            tone="accent"
          />
        </div>

        {/* ── Recent payments ── */}
        {recentPayments.length > 0 && (
          <div className="dashboard-surface rounded-[1.6rem] p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Recent Payments</p>
              <a
                href="/tenant/director/finance?section=payments"
                className="text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                View all →
              </a>
            </div>

            {/* Mobile: card list */}
            <div className="space-y-2 sm:hidden">
              {recentPayments.map((pay) => (
                <div key={pay.payment_id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{pay.student_name ?? "—"}</p>
                    <p className="text-xs text-slate-500">
                      {fmtDate(pay.received_at)} · {providerLabel(pay.provider)}
                    </p>
                  </div>
                  <p className="font-bold tabular-nums text-slate-800">{formatKes(pay.amount)}</p>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-hidden rounded-xl border border-slate-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5">Student</th>
                    <th className="px-4 py-2.5">Method</th>
                    <th className="px-4 py-2.5">Ref</th>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((pay) => (
                    <tr key={pay.payment_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{pay.student_name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600">{providerLabel(pay.provider)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                        {pay.receipt_no || pay.reference || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(pay.received_at)}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-800">
                        {formatKes(pay.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Notifications overview ── */}
        <TenantNotificationsOverview
          notifications={notifications}
          unreadCount={unreadNotifications}
          totalCount={totalNotifications}
          viewAllHref="/tenant/director/notifications"
          subtitle="Latest tenant notifications requiring attention"
        />

        {/* ── Module quick links ── */}
        <div>
          <DashboardSectionLabel>Module Navigation</DashboardSectionLabel>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DashboardModuleCard
              href="/tenant/director/enrollments?section=intake"
              icon={GraduationCap}
              title="Enrollments"
              description="Manage student intake, approve or reject applications, and track the enrollment pipeline."
              badge={pendingIntake > 0 ? `${pendingIntake} pending` : "Up to date"}
              tone="secondary"
              badgeTone={pendingIntake > 0 ? "warning" : "sage"}
            />
            <DashboardModuleCard
              href="/tenant/director/finance?section=overview"
              icon={CreditCard}
              title="Finance"
              description="Fee structures, invoice management, payment recording, and collection reporting."
              badge={totalOutstanding > 0 ? formatKes(totalOutstanding) + " due" : "Up to date"}
              tone="sage"
              badgeTone={totalOutstanding > 0 ? "warning" : "sage"}
            />
            <DashboardModuleCard
              href="/tenant/director/students/all"
              icon={Users}
              title="Students"
              description="View enrolled students, fee balances, and clearance status across all classes and terms."
              badge={`${totalEnrolled} enrolled`}
              tone="neutral"
              badgeTone="neutral"
            />
            <DashboardModuleCard
              href="/tenant/director/exams?section=setup"
              icon={BookOpenText}
              title="Exams"
              description="Set up exam schedules, manage timetables, and view student progress reports."
              tone="accent"
            />
            <DashboardModuleCard
              href="/tenant/director/school-setup/terms"
              icon={CalendarDays}
              title="School Setup"
              description="Configure academic terms, class structures, subjects, timetables, and the school calendar."
              tone="warning"
            />
            <DashboardModuleCard
              href="/tenant/director/hr/staff"
              icon={BriefcaseBusiness}
              title="HR"
              description="Staff registry, teacher assignments, and school assets management."
              tone="neutral"
            />
            <DashboardModuleCard
              href="/tenant/director/users"
              icon={Users}
              title="Users"
              description="View all tenant users, monitor active sessions, and manage account status."
              badge={`${school?.total_users ?? 0} users`}
              tone="neutral"
              badgeTone="neutral"
            />
            <DashboardModuleCard
              href="/tenant/director/rbac"
              icon={ShieldCheck}
              title="RBAC & Roles"
              description="Configure roles, assign permissions, and control what each user can access."
              badge={`${school?.total_roles ?? 0} assignments`}
              tone="accent"
              badgeTone="accent"
            />
            <DashboardModuleCard
              href="/tenant/director/audit"
              icon={Search}
              title="Audit Logs"
              description="Full audit trail of all system events. Filter by action type, resource, or time range."
              badge={`${school?.total_audit_logs ?? 0} events`}
              tone="neutral"
              badgeTone="neutral"
            />
            <DashboardModuleCard
              href="/tenant/director/settings"
              icon={Settings}
              title="Settings"
              description="Tenant configuration, policy settings, and system-level preferences."
              tone="warning"
            />
          </div>
        </div>

      </div>
    </AppShell>
  );
}
