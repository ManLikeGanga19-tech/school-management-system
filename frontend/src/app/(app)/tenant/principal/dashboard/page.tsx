import { redirect } from "next/navigation";
import {
  BellRing,
  BookOpenCheck,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  Presentation,
  School,
  TriangleAlert,
  Users,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import {
  DashboardModuleCard,
  DashboardSectionLabel,
  DashboardStatCard,
} from "@/components/dashboard/dashboard-primitives";
import {
  principalEventsHref,
  principalExamsHref,
  principalHrHref,
  principalNav,
  principalNotificationsHref,
  principalSchoolSetupHref,
  principalStudentsHref,
} from "@/components/layout/nav-config";
import {
  hasDirectorRole,
  hasPrincipalRole,
  hasSecretaryRole,
} from "@/lib/auth/tenant-dashboard";
import { getPrincipalDashboardData } from "@/server/principal/dashboard";

function timeAgo(dateString: string) {
  const diff = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diff < 60) return `${Math.max(diff, 0)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export default async function PrincipalDashboardPage() {
  const data = await getPrincipalDashboardData();

  if (!data.me.data) {
    redirect("/login");
  }

  const roles = data.me.data.roles || [];
  const isPrincipal = hasPrincipalRole(roles);
  if (!isPrincipal) {
    if (hasDirectorRole(roles)) redirect("/tenant/director/dashboard");
    if (hasSecretaryRole(roles)) redirect("/tenant/secretary/dashboard");
    redirect("/tenant/dashboard");
  }

  const enrollments = data.enrollments.data || [];
  const exams = data.exams.data || [];
  const events = data.events.data || [];
  const teacherAssignments = data.teacherAssignments.data || [];
  const timetableEntries = data.timetableEntries.data || [];
  const notifications = data.notifications.data || [];
  const unreadNotifications =
    typeof data.notificationsUnreadCount.data === "number"
      ? data.notificationsUnreadCount.data
      : notifications.filter((item) => item.unread).length;

  const todayIso = new Date().toISOString().slice(0, 10);
  const activeStudents = enrollments.filter((row) =>
    ["ENROLLED", "APPROVED"].includes((row.status || "").toUpperCase())
  ).length;
  const upcomingExams = exams
    .filter((row) => row.start_date >= todayIso)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 5);
  const upcomingEvents = events
    .filter((row) => row.start_date >= todayIso)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 5);
  const activeTeacherAssignments = teacherAssignments.filter((row) => row.is_active).length;
  const activeTimetableEntries = timetableEntries.filter((row) => row.is_active).length;

  const tenantName = data.me.data.tenant.name || data.me.data.tenant.slug;
  const tenantSlug = data.me.data.tenant.slug;

  const hasLoadIssue = Boolean(
    data.summary.error ||
      data.enrollments.error ||
      data.exams.error ||
      data.events.error ||
      data.teacherAssignments.error ||
      data.timetableEntries.error
  );

  return (
    <AppShell title="Principal" nav={principalNav} activeHref="/tenant/principal/dashboard">
      <div className="space-y-5">
        <div className="dashboard-hero rounded-[2rem] p-6 text-white">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium">
                <School className="h-3.5 w-3.5" />
                Principal
              </div>
              <h1 className="text-2xl font-bold">{tenantName}</h1>
              <p className="mt-0.5 text-sm text-white/80">
                Academic leadership dashboard for learning delivery, assessments, and timetable quality.
              </p>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2 text-right">
              <div className="text-xs text-white/70">Tenant</div>
              <div className="font-mono text-sm font-semibold text-white">{tenantSlug}</div>
            </div>
          </div>
        </div>

        {hasLoadIssue && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <div className="font-semibold">Some academic widgets are in degraded mode.</div>
              <div className="mt-0.5 text-xs text-amber-700">
                Data is still available where permissions allow. Open module pages for full details.
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <DashboardStatCard label="Active Students" value={activeStudents} sub={`${enrollments.length} tracked`} icon={Users} tone="secondary" />
          <DashboardStatCard label="Upcoming Exams" value={upcomingExams.length} sub={`${exams.length} total`} icon={ClipboardList} tone="warning" />
          <DashboardStatCard label="Upcoming Events" value={upcomingEvents.length} sub={`${events.length} total`} icon={CalendarDays} tone="accent" />
          <DashboardStatCard
            label="Teaching Assignments"
            value={activeTeacherAssignments}
            sub={`${teacherAssignments.length} mapped`}
            icon={Presentation}
            tone="sage"
          />
          <DashboardStatCard
            label="Unread Notifications"
            value={unreadNotifications}
            sub={`${activeTimetableEntries} timetable slots`}
            icon={BellRing}
            tone="neutral"
          />
        </div>

        <div>
          <DashboardSectionLabel>Academic Modules</DashboardSectionLabel>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DashboardModuleCard
              href={principalStudentsHref("all")}
              title="Student Directory"
              description="Search learners, review profiles, and inspect student-level academic context."
              icon={GraduationCap}
              tone="secondary"
            />
            <DashboardModuleCard
              href={principalExamsHref("setup")}
              title="Exam Setup"
              description="Schedule term exams with class scope, invigilation, and exam controls."
              icon={ClipboardList}
              tone="warning"
            />
            <DashboardModuleCard
              href={principalExamsHref("timetable")}
              title="Exam Timetable"
              description="Use table/calendar view to verify coverage and avoid exam-time conflicts."
              icon={CalendarClock}
              tone="accent"
            />
            <DashboardModuleCard
              href={principalExamsHref("marks-review")}
              title="Progress Reports"
              description="Track marks by subject and class to monitor academic performance trends."
              icon={BookOpenCheck}
              tone="sage"
            />
            <DashboardModuleCard
              href={principalSchoolSetupHref("subjects")}
              title="Subject & Class Setup"
              description="Maintain subject list, class list, and core academic structures for delivery."
              icon={School}
              tone="neutral"
            />
            <DashboardModuleCard
              href={principalHrHref("teachers")}
              title="Teacher Assignments"
              description="Map teachers to classes/subjects and keep assignment coverage current."
              icon={Presentation}
              tone="sage"
            />
            <DashboardModuleCard
              href={principalSchoolSetupHref("timetable")}
              title="School Timetable"
              description="Manage lesson timetable, breaks, and daily coverage for all class streams."
              icon={CalendarDays}
              tone="accent"
            />
            <DashboardModuleCard
              href={principalEventsHref()}
              title="Academic Events"
              description="Plan school and class events tied to terms with student/class targeting."
              icon={CalendarDays}
              tone="warning"
            />
            <DashboardModuleCard
              href={principalNotificationsHref()}
              title="Notifications"
              description="Review critical operational alerts and academic action items in real time."
              icon={BellRing}
              tone="secondary"
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="dashboard-surface rounded-[1.6rem] p-5">
            <h2 className="text-sm font-semibold text-slate-900">Upcoming Exams</h2>
            <p className="mt-0.5 text-xs text-slate-500">Next exam windows by date and class scope.</p>
            <div className="mt-4 space-y-2">
              {upcomingExams.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No upcoming exams scheduled.
                </div>
              ) : (
                upcomingExams.map((row) => (
                  <a
                    key={row.id}
                    href={principalExamsHref("timetable")}
                    className="block rounded-xl border border-[#eadfce] bg-[#f8f3eb] px-3 py-2 transition hover:border-[#d7b699] hover:bg-[#f5ede3]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{row.name}</div>
                        <div className="text-xs text-slate-500">
                          {row.class_code || "Class not set"} • {row.status}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs text-slate-500">{formatDate(row.start_date)}</div>
                    </div>
                  </a>
                ))
              )}
            </div>
          </div>

          <div className="dashboard-surface rounded-[1.6rem] p-5">
            <h2 className="text-sm font-semibold text-slate-900">Notifications Overview</h2>
            <p className="mt-0.5 text-xs text-slate-500">Latest tenant notifications and unresolved academic alerts.</p>
            <div className="mt-4 space-y-2">
              {notifications.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No notifications available.
                </div>
              ) : (
                notifications.map((item) => (
                  <a
                    key={item.id}
                    href={principalNotificationsHref()}
                    className={`block rounded-xl border px-3 py-2 transition ${
                      item.unread
                        ? "border-[#d8e5e7] bg-[#eef5f5] hover:bg-[#e7f0f1]"
                        : "border-[#eadfce] bg-[#f8f3eb] hover:bg-[#f2ece4]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{item.title}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{item.message}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs text-slate-400">{timeAgo(item.created_at)}</div>
                        {item.unread && (
                          <span className="mt-1 inline-flex rounded-full bg-[#dce9eb] px-2 py-0.5 text-[10px] font-semibold text-[#173f49]">
                            Unread
                          </span>
                        )}
                      </div>
                    </div>
                  </a>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
