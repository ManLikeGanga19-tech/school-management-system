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
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import {
  DashboardModuleCard,
  DashboardSectionLabel,
  DashboardStatCard,
} from "@/components/dashboard/dashboard-primitives";
import { TodayAtSchool } from "@/components/dashboard/TodayAtSchool";
import {
  CollectionRateGauge,
  DemographicsDonut,
  DemographicsLegend,
  FinanceByClassChart,
  FinanceByProviderChart,
  FinanceByTermChart,
  TopOutstandingChart,
} from "@/components/dashboard/finance-charts";
import { DirectorFinanceExportButtons } from "@/components/dashboard/DirectorFinanceExportButtons";
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
  const todayAtSchool = kpis?.today_at_school ?? null;
  const recentPayments = kpis?.recent_payments ?? [];
  const demographics  = kpis?.demographics ?? null;
  const breakdowns    = kpis?.finance_breakdowns ?? {
    by_class: [], by_term: [], by_provider: [], top_outstanding: [],
  };

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

        {/* ── Today at School ── */}
        <TodayAtSchool data={todayAtSchool} />

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

        {/* ── All-time finance KPIs + gauge + exports ── */}
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <DashboardSectionLabel>Finance — All Time</DashboardSectionLabel>
            <DirectorFinanceExportButtons scope="all-time" />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="dashboard-surface rounded-[1.6rem] p-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <TrendingUp className="h-4 w-4 text-slate-400" />
                Collection Rate
              </div>
              <CollectionRateGauge
                ratePct={collectionRate}
                billed={totalBilled}
                collected={totalCollected}
                height={200}
              />
            </div>
          </div>
        </div>

        {/* ── Current-term finance KPIs (by-date selection) ── */}
        {termFinance && (
          <div>
            <DashboardSectionLabel>
              Finance — {termFinance.term_name ?? activeTerm?.name ?? "Current Term"}
              {termFinance.academic_year != null && termFinance.term_number != null && (
                <span className="ml-2 text-[10px] font-medium tracking-normal text-slate-400">
                  Term {termFinance.term_number} · {termFinance.academic_year}
                </span>
              )}
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

        {/* ── Student demographics (donut + breakdown) ── */}
        <div>
          <DashboardSectionLabel>Student Demographics</DashboardSectionLabel>
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="dashboard-surface rounded-[1.6rem] p-5 lg:col-span-1">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Gender Distribution</h3>
              <DemographicsDonut data={demographics} height={220} />
            </div>
            <div className="dashboard-surface rounded-[1.6rem] p-5 lg:col-span-2">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Breakdown</h3>
              {demographics ? <DemographicsLegend data={demographics} /> : (
                <p className="text-sm text-slate-400">No student records yet</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Finance analytics: per-class billed vs collected ── */}
        <div>
          <DashboardSectionLabel>Finance Analytics</DashboardSectionLabel>
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="dashboard-surface rounded-[1.6rem] p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Billed vs Collected by Class</h3>
                <span className="text-xs text-slate-400">
                  {breakdowns.by_class.length} class{breakdowns.by_class.length === 1 ? "" : "es"}
                </span>
              </div>
              <FinanceByClassChart rows={breakdowns.by_class} height={280} />
            </div>
            <div className="dashboard-surface rounded-[1.6rem] p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Term-over-Term Trend</h3>
                <span className="text-xs text-slate-400">
                  {breakdowns.by_term.length} term{breakdowns.by_term.length === 1 ? "" : "s"}
                </span>
              </div>
              <FinanceByTermChart rows={breakdowns.by_term} height={280} />
            </div>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
            <div className="dashboard-surface rounded-[1.6rem] p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Payment Channel Mix</h3>
              <FinanceByProviderChart rows={breakdowns.by_provider} height={260} />
            </div>
            <div className="dashboard-surface rounded-[1.6rem] p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Top Outstanding Balances</h3>
                <span className="text-xs text-slate-400">
                  {breakdowns.top_outstanding.length} student{breakdowns.top_outstanding.length === 1 ? "" : "s"}
                </span>
              </div>
              <TopOutstandingChart rows={breakdowns.top_outstanding} height={320} />
            </div>
          </div>
        </div>

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
