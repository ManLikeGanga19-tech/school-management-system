import type { AppNavItem } from "@/components/layout/AppShell";

export type FinanceSection =
  | "overview"
  | "fee-structures"
  | "invoices"
  | "payments"
  | "receipts";
export type EnrollmentSection = "intake" | "students";
export type SchoolSetupSection = "terms" | "classes" | "subjects" | "timetable";
export type StudentSection = "all" | "fee-balance" | "clearance";
export type HrSection = "staff" | "teachers" | "assets";
export type ExamSection = "setup" | "timetable" | "progress";

// ───────────────────────────────────────────────────────────────
// Director (App Router) paths: /tenant/director/*
// ───────────────────────────────────────────────────────────────

export function directorFinanceHref(section: FinanceSection) {
  return `/tenant/director/finance?section=${section}`;
}

export function directorEnrollmentsHref(section: EnrollmentSection) {
  return `/tenant/director/enrollments?section=${section}`;
}

export function directorSchoolSetupHref(section: SchoolSetupSection) {
  return `/tenant/director/school-setup/${section}`;
}

export function directorStudentsHref(section: StudentSection) {
  return `/tenant/director/students/${section}`;
}

export function directorHrHref(section: HrSection) {
  return `/tenant/director/hr/${section}`;
}

export function directorNotificationsHref() {
  return "/tenant/director/notifications";
}

export function directorExamsHref(section: ExamSection = "setup") {
  return `/tenant/director/exams?section=${section}`;
}

export function directorEventsHref() {
  return "/tenant/director/events";
}

// ───────────────────────────────────────────────────────────────
// Secretary paths remain under /tenant/secretary/*
// ───────────────────────────────────────────────────────────────

export function secretaryFinanceHref(section: FinanceSection) {
  return `/tenant/secretary/finance?section=${section}`;
}

export function secretaryEnrollmentsHref(section: EnrollmentSection) {
  return `/tenant/secretary/enrollments?section=${section}`;
}

export function secretarySchoolSetupHref(section: SchoolSetupSection) {
  return `/tenant/secretary/school-setup/${section}`;
}

export function secretaryStudentsHref(section: StudentSection) {
  return `/tenant/secretary/students/${section}`;
}

export function secretaryHrHref(section: HrSection) {
  return `/tenant/secretary/hr/${section}`;
}

export function secretaryNotificationsHref() {
  return "/tenant/secretary/notifications";
}

export function secretaryExamsHref(section: ExamSection = "setup") {
  return `/tenant/secretary/exams?section=${section}`;
}

export function secretaryEventsHref() {
  return "/tenant/secretary/events";
}

// ───────────────────────────────────────────────────────────────
// Principal / Head Teacher paths under /tenant/principal/*
// ───────────────────────────────────────────────────────────────

export function principalSchoolSetupHref(section: SchoolSetupSection) {
  return `/tenant/principal/school-setup/${section}`;
}

export function principalStudentsHref(section: StudentSection) {
  return `/tenant/principal/students/${section}`;
}

export function principalHrHref(section: HrSection) {
  return `/tenant/principal/hr/${section}`;
}

export function principalNotificationsHref() {
  return "/tenant/principal/notifications";
}

export function principalExamsHref(section: ExamSection = "setup") {
  return `/tenant/principal/exams?section=${section}`;
}

export function principalEventsHref() {
  return "/tenant/principal/events";
}

// ───────────────────────────────────────────────────────────────
// Nav configs
// ───────────────────────────────────────────────────────────────

export const saasNav: AppNavItem[] = [
  { href: "/saas/dashboard", label: "SaaS Summary", icon: "LayoutDashboard" },
  { href: "/saas/tenants", label: "Tenants", icon: "Building2" },
  { href: "/saas/subscriptions", label: "Subscriptions", icon: "CreditCard" },
  { href: "/saas/rbac/permissions", label: "Permissions", icon: "ShieldCheck" },
  { href: "/saas/rbac/roles", label: "Roles", icon: "Layers" },
  { href: "/saas/audit", label: "Audit Logs", icon: "ScrollText" },
];

export const directorNav: AppNavItem[] = [
  { href: "/tenant/director/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  {
    href: directorEnrollmentsHref("intake"),
    label: "Enrollments",
    icon: "ClipboardCheck",
    children: [
      { href: directorEnrollmentsHref("intake"), label: "Intake", icon: "UserRoundPlus" },
    ],
  },
  {
    href: directorStudentsHref("all"),
    label: "Students",
    icon: "Users",
    children: [
      { href: directorStudentsHref("all"), label: "All Students", icon: "List" },
      {
        href: directorStudentsHref("fee-balance"),
        label: "Student Fee Balance",
        icon: "WalletCards",
      },
      {
        href: directorStudentsHref("clearance"),
        label: "Clearance",
        icon: "ShieldCheck",
      },
    ],
  },
  {
    href: directorFinanceHref("overview"),
    label: "Finance",
    icon: "Landmark",
    children: [
      { href: directorFinanceHref("overview"), label: "Finance Control Overview", icon: "ShieldCheck" },
      { href: directorFinanceHref("fee-structures"), label: "Fee Structures", icon: "FileSpreadsheet" },
      { href: directorFinanceHref("invoices"), label: "Invoices", icon: "FileText" },
      { href: directorFinanceHref("payments"), label: "Payments", icon: "HandCoins" },
      { href: directorFinanceHref("receipts"), label: "Receipts", icon: "Receipt" },
    ],
  },
  {
    href: directorExamsHref("setup"),
    label: "Exams",
    icon: "CalendarDays",
    children: [
      { href: directorExamsHref("setup"), label: "Exam Setup", icon: "FileSpreadsheet" },
      { href: directorExamsHref("timetable"), label: "Exam Timetable", icon: "CalendarDays" },
      {
        href: directorExamsHref("progress"),
        label: "Student Progress Report",
        icon: "ClipboardCheck",
      },
    ],
  },
  {
    href: directorEventsHref(),
    label: "Events",
    icon: "CalendarDays",
  },
  {
    href: directorSchoolSetupHref("terms"),
    label: "School Setup",
    icon: "Settings2",
    children: [
      { href: directorSchoolSetupHref("terms"), label: "Terms", icon: "CalendarDays" },
      { href: directorSchoolSetupHref("classes"), label: "Classes", icon: "School" },
      { href: directorSchoolSetupHref("subjects"), label: "Subjects", icon: "BookOpenText" },
      { href: directorSchoolSetupHref("timetable"), label: "School Timetable", icon: "CalendarDays" },
    ],
  },
  {
    href: directorHrHref("staff"),
    label: "HR",
    icon: "BriefcaseBusiness",
    children: [
      { href: directorHrHref("staff"), label: "Staff Registry", icon: "IdCard" },
      { href: directorHrHref("teachers"), label: "Teacher Assignment", icon: "Presentation" },
      { href: directorHrHref("assets"), label: "School Assets", icon: "Package" },
    ],
  },
  {
    href: directorNotificationsHref(),
    label: "Notifications",
    icon: "Bell",
    showUnreadBadge: true,
  },
  { href: "/tenant/director/users", label: "Users", icon: "UserCog" },
  { href: "/tenant/director/rbac", label: "RBAC", icon: "KeyRound" },
  { href: "/tenant/director/audit", label: "Audit Logs", icon: "ScrollText" },
  { href: "/tenant/director/subscriptions", label: "Subscription", icon: "BadgeDollarSign" },
];

export const secretaryNav: AppNavItem[] = [
  { href: "/tenant/secretary/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  {
    href: secretaryEnrollmentsHref("intake"),
    label: "Enrollments",
    icon: "ClipboardCheck",
    children: [
      { href: secretaryEnrollmentsHref("intake"), label: "Intake", icon: "UserRoundPlus" },
    ],
  },
  {
    href: secretaryStudentsHref("all"),
    label: "Students",
    icon: "Users",
    children: [
      { href: secretaryStudentsHref("all"), label: "All Students", icon: "List" },
      {
        href: secretaryStudentsHref("fee-balance"),
        label: "Student Fee Balance",
        icon: "WalletCards",
      },
      {
        href: secretaryStudentsHref("clearance"),
        label: "Clearance",
        icon: "ShieldCheck",
      },
    ],
  },
  {
    href: secretaryFinanceHref("fee-structures"),
    label: "Finance",
    icon: "Landmark",
    children: [
      { href: secretaryFinanceHref("fee-structures"), label: "Fee Structures", icon: "FileSpreadsheet" },
      { href: secretaryFinanceHref("invoices"), label: "Invoices", icon: "FileText" },
      { href: secretaryFinanceHref("payments"), label: "Payments", icon: "HandCoins" },
      { href: secretaryFinanceHref("receipts"), label: "Receipts", icon: "Receipt" },
    ],
  },
  {
    href: secretaryExamsHref("setup"),
    label: "Exams",
    icon: "CalendarDays",
    children: [
      { href: secretaryExamsHref("setup"), label: "Exam Setup", icon: "FileSpreadsheet" },
      { href: secretaryExamsHref("timetable"), label: "Exam Timetable", icon: "CalendarDays" },
      {
        href: secretaryExamsHref("progress"),
        label: "Student Progress Report",
        icon: "ClipboardCheck",
      },
    ],
  },
  {
    href: secretaryEventsHref(),
    label: "Events",
    icon: "CalendarDays",
  },
  {
    href: secretarySchoolSetupHref("terms"),
    label: "School Setup",
    icon: "Settings2",
    children: [
      { href: secretarySchoolSetupHref("terms"), label: "Terms", icon: "CalendarDays" },
      { href: secretarySchoolSetupHref("classes"), label: "Classes", icon: "School" },
      { href: secretarySchoolSetupHref("subjects"), label: "Subjects", icon: "BookOpenText" },
      { href: secretarySchoolSetupHref("timetable"), label: "School Timetable", icon: "CalendarDays" },
    ],
  },
  {
    href: secretaryHrHref("teachers"),
    label: "HR",
    icon: "BriefcaseBusiness",
    children: [
      { href: secretaryHrHref("staff"), label: "Staff Registry", icon: "IdCard" },
      { href: secretaryHrHref("teachers"), label: "Teacher Assignment", icon: "Presentation" },
      { href: secretaryHrHref("assets"), label: "School Assets", icon: "Package" },
    ],
  },
  {
    href: secretaryNotificationsHref(),
    label: "Notifications",
    icon: "Bell",
    showUnreadBadge: true,
  },
  { href: "/tenant/secretary/users", label: "Users", icon: "UserCog" },
  { href: "/tenant/secretary/audit", label: "Audit Logs", icon: "ScrollText" },
];

export const principalNav: AppNavItem[] = [
  { href: "/tenant/principal/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  {
    href: principalStudentsHref("all"),
    label: "Students",
    icon: "Users",
    children: [
      { href: principalStudentsHref("all"), label: "All Students", icon: "List" },
    ],
  },
  {
    href: principalExamsHref("setup"),
    label: "Exams",
    icon: "CalendarDays",
    children: [
      { href: principalExamsHref("setup"), label: "Exam Setup", icon: "FileSpreadsheet" },
      { href: principalExamsHref("timetable"), label: "Exam Timetable", icon: "CalendarDays" },
      {
        href: principalExamsHref("progress"),
        label: "Student Progress Report",
        icon: "ClipboardCheck",
      },
    ],
  },
  {
    href: principalEventsHref(),
    label: "Events",
    icon: "CalendarDays",
  },
  {
    href: principalSchoolSetupHref("terms"),
    label: "School Setup",
    icon: "Settings2",
    children: [
      { href: principalSchoolSetupHref("terms"), label: "Terms", icon: "CalendarDays" },
      { href: principalSchoolSetupHref("classes"), label: "Classes", icon: "School" },
      { href: principalSchoolSetupHref("subjects"), label: "Subjects", icon: "BookOpenText" },
      {
        href: principalSchoolSetupHref("timetable"),
        label: "School Timetable",
        icon: "CalendarDays",
      },
    ],
  },
  {
    href: principalHrHref("teachers"),
    label: "Academic Staff",
    icon: "BriefcaseBusiness",
    children: [
      {
        href: principalHrHref("teachers"),
        label: "Teacher Assignment",
        icon: "Presentation",
      },
    ],
  },
  {
    href: principalNotificationsHref(),
    label: "Notifications",
    icon: "Bell",
    showUnreadBadge: true,
  },
];
