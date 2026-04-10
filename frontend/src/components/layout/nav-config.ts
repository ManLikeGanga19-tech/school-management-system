import type { AppNavItem } from "@/components/layout/AppShell";

export type FinanceSection =
  | "overview"
  | "fee-structures"
  | "invoices"
  | "payments"
  | "receipts"
  | "scan-receipt";
export type EnrollmentSection = "intake" | "students";
export type SchoolSetupSection = "terms" | "classes" | "subjects" | "timetable" | "calendar" | "print-settings" | "curriculum" | "admission-number";
export type StudentSection = "all" | "fee-balance" | "clearance" | "attendance";
export type HrSection = "staff" | "teachers" | "assets";
export type ExamSection = "setup" | "timetable" | "enter-marks" | "marks-review" | "report-cards";
export type CbcSection = "assessments" | "curriculum" | "reports";
export type IgcseSection = "assessments" | "subjects" | "reports";
export type DisciplineSection = "incidents" | "new";
export type SmsSection = "send" | "broadcast" | "history" | "templates" | "credits";

// ───────────────────────────────────────────────────────────────
// Director (App Router) paths: /tenant/director/*
// ───────────────────────────────────────────────────────────────

export function directorFinanceHref(section: FinanceSection) {
  if (section === "scan-receipt") return "/tenant/director/finance/scan-receipt";
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

export function directorContactAdminHref() {
  return "/tenant/director/contact-admin";
}

export function directorExamsHref(section: ExamSection = "setup") {
  if (section === "enter-marks") return "/tenant/director/exams/enter-marks";
  if (section === "marks-review") return "/tenant/director/exams/marks-review";
  if (section === "report-cards") return "/tenant/director/exams/report-cards";
  return `/tenant/director/exams?section=${section}`;
}

export function directorEventsHref() {
  return "/tenant/director/events";
}

export function directorCbcHref(section: CbcSection = "assessments") {
  return `/tenant/director/cbc?section=${section}`;
}

export function directorIgcseHref(section: IgcseSection = "assessments") {
  return `/tenant/director/igcse?section=${section}`;
}

export function directorDisciplineHref(section: DisciplineSection = "incidents") {
  return `/tenant/director/discipline?section=${section}`;
}

export function directorSmsHref(section: SmsSection = "send") {
  return `/tenant/director/messages?section=${section}`;
}

// ───────────────────────────────────────────────────────────────
// Secretary paths remain under /tenant/secretary/*
// ───────────────────────────────────────────────────────────────

export function secretaryFinanceHref(section: FinanceSection) {
  if (section === "scan-receipt") return "/tenant/secretary/finance/scan-receipt";
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

export function secretaryContactAdminHref() {
  return "/tenant/secretary/contact-admin";
}

export function secretaryExamsHref(section: ExamSection = "setup") {
  if (section === "enter-marks") return "/tenant/secretary/exams/enter-marks";
  if (section === "marks-review") return "/tenant/secretary/exams/marks-review";
  if (section === "report-cards") return "/tenant/secretary/exams/report-cards";
  return `/tenant/secretary/exams?section=${section}`;
}

export function secretaryEventsHref() {
  return "/tenant/secretary/events";
}

export function secretaryCbcHref(section: CbcSection = "assessments") {
  return `/tenant/secretary/cbc?section=${section}`;
}

export function secretaryIgcseHref(section: IgcseSection = "assessments") {
  return `/tenant/secretary/igcse?section=${section}`;
}

export function secretaryDisciplineHref(section: DisciplineSection = "incidents") {
  return `/tenant/secretary/discipline?section=${section}`;
}

export function secretarySmsHref(section: SmsSection = "send") {
  return `/tenant/secretary/messages?section=${section}`;
}

// ───────────────────────────────────────────────────────────────
// Principal paths under /tenant/principal/*
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
  if (section === "enter-marks") return "/tenant/principal/exams/enter-marks";
  if (section === "marks-review") return "/tenant/principal/exams/marks-review";
  if (section === "report-cards") return "/tenant/principal/exams/report-cards";
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
  { href: "/saas/rollout", label: "Rollout Desk", icon: "Rocket", badgeKey: "saasRollout" },
  { href: "/saas/tenants", label: "Tenants", icon: "Building2" },
  { href: "/saas/subscriptions", label: "Subscriptions", icon: "CreditCard" },
  { href: "/saas/payment-history", label: "Payment History", icon: "HandCoins" },
  { href: "/saas/academic-calendar", label: "Academic Calendar", icon: "CalendarDays" },
  { href: "/saas/support", label: "Support Inbox", icon: "Headset", badgeKey: "saasSupport" },
  { href: "/saas/rbac/permissions", label: "Permissions", icon: "ShieldCheck" },
  { href: "/saas/rbac/roles", label: "Roles", icon: "Layers" },
  { href: "/saas/audit", label: "Audit Logs", icon: "ScrollText" },
  { href: "/saas/verify-receipt", label: "Verify Receipt", icon: "ShieldCheck" },
  { href: "/saas/sms", label: "SMS Credits", icon: "MessageSquare" },
];

export const directorNav: AppNavItem[] = [
  { href: "/tenant/director/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  {
    href: directorEnrollmentsHref("intake"),
    label: "Enrollments",
    icon: "ClipboardCheck",
    children: [
      { href: directorEnrollmentsHref("intake"), label: "Intake", icon: "UserRoundPlus" },
      { href: directorEnrollmentsHref("students"), label: "Student Registry", icon: "BookUser" },
    ],
  },
  {
    href: directorStudentsHref("all"),
    label: "Students",
    icon: "Users",
    children: [
      { href: directorStudentsHref("all"), label: "All Students", icon: "List" },
      {
        href: directorStudentsHref("attendance"),
        label: "Attendance",
        icon: "CalendarCheck",
      },
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
      { href: directorFinanceHref("overview"), label: "Finance Overview", icon: "ShieldCheck" },
      { href: "/tenant/director/finance/fee-structures", label: "Fee Structures", icon: "FileSpreadsheet" },
      { href: "/tenant/director/finance/categories", label: "Categories & Items", icon: "Tag" },
      { href: "/tenant/director/finance/scholarships", label: "Scholarships", icon: "GraduationCap" },
      { href: "/tenant/director/finance/policy", label: "Finance Policy", icon: "SlidersHorizontal" },
      { href: "/tenant/director/finance/payment-settings", label: "Payment Settings", icon: "CreditCard" },
      { href: directorFinanceHref("invoices"), label: "Invoices", icon: "FileText" },
      { href: directorFinanceHref("payments"), label: "Payments", icon: "HandCoins" },
      { href: directorFinanceHref("receipts"), label: "Receipts", icon: "Receipt" },
      { href: directorFinanceHref("scan-receipt"), label: "Scan Receipt", icon: "ScanLine" },
    ],
  },
  {
    href: directorExamsHref("setup"),
    label: "Exams",
    icon: "CalendarDays",
    curriculumGate: ["8-4-4"],
    children: [
      { href: directorExamsHref("setup"), label: "Exam Setup", icon: "FileSpreadsheet" },
      { href: directorExamsHref("timetable"), label: "Exam Timetable", icon: "CalendarDays" },
      { href: directorExamsHref("enter-marks"), label: "Enter Marks", icon: "PenLine" },
      { href: directorExamsHref("marks-review"), label: "Marks Review", icon: "ClipboardList" },
      { href: directorExamsHref("report-cards"), label: "Report Cards", icon: "FileBarChart" },
    ],
  },
  {
    href: directorCbcHref("assessments"),
    label: "CBC",
    icon: "BookOpenCheck",
    curriculumGate: ["CBC"],
    children: [
      { href: directorCbcHref("assessments"), label: "Assessments", icon: "ClipboardList" },
      { href: directorCbcHref("curriculum"),  label: "Curriculum", icon: "BookOpenText" },
      { href: directorCbcHref("reports"),     label: "Progress Reports", icon: "FileBarChart" },
    ],
  },
  {
    href: directorIgcseHref("assessments"),
    label: "IGCSE",
    icon: "BookOpenCheck",
    curriculumGate: ["IGCSE"],
    children: [
      { href: directorIgcseHref("assessments"), label: "Assessments", icon: "ClipboardList" },
      { href: directorIgcseHref("subjects"),    label: "Subjects", icon: "BookOpenText" },
      { href: directorIgcseHref("reports"),     label: "Progress Reports", icon: "FileBarChart" },
    ],
  },
  {
    href: directorDisciplineHref("incidents"),
    label: "Discipline",
    icon: "Shield",
    children: [
      { href: directorDisciplineHref("incidents"), label: "Incidents", icon: "ClipboardList" },
      { href: directorDisciplineHref("new"), label: "New Incident", icon: "Plus" },
    ],
  },
  {
    href: directorEventsHref(),
    label: "Events",
    icon: "CalendarDays",
  },
  {
    href: directorSmsHref("send"),
    label: "Messages",
    icon: "MessageSquare",
    children: [
      { href: directorSmsHref("send"),      label: "Send Message",    icon: "Send" },
      { href: directorSmsHref("broadcast"), label: "Broadcast",       icon: "Megaphone" },
      { href: directorSmsHref("history"),   label: "Message History", icon: "History" },
      { href: directorSmsHref("templates"), label: "Templates",       icon: "FileText" },
      { href: directorSmsHref("credits"),   label: "Buy Credits",     icon: "Coins" },
    ],
  },
  {
    href: directorSchoolSetupHref("terms"),
    label: "School Setup",
    icon: "Settings2",
    children: [
      { href: directorSchoolSetupHref("curriculum"), label: "Curriculum Type", icon: "BookOpenText" },
      { href: directorSchoolSetupHref("terms"), label: "Terms", icon: "CalendarDays" },
      { href: directorSchoolSetupHref("classes"), label: "Classes", icon: "School" },
      { href: directorSchoolSetupHref("subjects"), label: "Subjects", icon: "BookOpenText" },
      { href: directorSchoolSetupHref("timetable"), label: "School Timetable", icon: "CalendarDays" },
      { href: directorSchoolSetupHref("calendar"), label: "Calendar & Exams", icon: "CalendarDays" },
      { href: directorSchoolSetupHref("print-settings"), label: "Print Settings", icon: "Printer" },
      { href: directorSchoolSetupHref("admission-number"), label: "Admission Number Counter", icon: "Hash" },
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
    badgeKey: "tenantNotifications",
  },
  { href: directorContactAdminHref(), label: "Contact Admin", icon: "Headset" },
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
      { href: secretaryEnrollmentsHref("students"), label: "Student Registry", icon: "BookUser" },
    ],
  },
  {
    href: secretaryStudentsHref("all"),
    label: "Students",
    icon: "Users",
    children: [
      { href: secretaryStudentsHref("all"), label: "All Students", icon: "List" },
      {
        href: secretaryStudentsHref("attendance"),
        label: "Attendance",
        icon: "CalendarCheck",
      },
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
    href: "/tenant/secretary/finance/fee-structures",
    label: "Finance",
    icon: "Landmark",
    children: [
      { href: "/tenant/secretary/finance/fee-structures", label: "Fee Structures", icon: "FileSpreadsheet" },
      { href: "/tenant/secretary/finance/categories", label: "Categories & Items", icon: "Tag" },
      { href: "/tenant/secretary/finance/scholarships", label: "Scholarships", icon: "GraduationCap" },
      { href: "/tenant/secretary/finance/payment-settings", label: "Payment Settings", icon: "CreditCard" },
      { href: secretaryFinanceHref("invoices"), label: "Invoices", icon: "FileText" },
      { href: secretaryFinanceHref("payments"), label: "Payments", icon: "HandCoins" },
      { href: secretaryFinanceHref("receipts"), label: "Receipts", icon: "Receipt" },
      { href: secretaryFinanceHref("scan-receipt"), label: "Scan Receipt", icon: "ScanLine" },
    ],
  },
  {
    href: secretaryExamsHref("setup"),
    label: "Exams",
    icon: "CalendarDays",
    curriculumGate: ["8-4-4"],
    children: [
      { href: secretaryExamsHref("setup"), label: "Exam Setup", icon: "FileSpreadsheet" },
      { href: secretaryExamsHref("timetable"), label: "Exam Timetable", icon: "CalendarDays" },
      { href: secretaryExamsHref("enter-marks"), label: "Enter Marks", icon: "PenLine" },
      { href: secretaryExamsHref("marks-review"), label: "Marks Review", icon: "ClipboardList" },
      { href: secretaryExamsHref("report-cards"), label: "Report Cards", icon: "FileBarChart" },
    ],
  },
  {
    href: secretaryCbcHref("assessments"),
    label: "CBC",
    icon: "BookOpenCheck",
    curriculumGate: ["CBC"],
    children: [
      { href: secretaryCbcHref("assessments"), label: "Assessments", icon: "ClipboardList" },
      { href: secretaryCbcHref("curriculum"),  label: "Curriculum", icon: "BookOpenText" },
      { href: secretaryCbcHref("reports"),     label: "Progress Reports", icon: "FileBarChart" },
    ],
  },
  {
    href: secretaryIgcseHref("assessments"),
    label: "IGCSE",
    icon: "BookOpenCheck",
    curriculumGate: ["IGCSE"],
    children: [
      { href: secretaryIgcseHref("assessments"), label: "Assessments", icon: "ClipboardList" },
      { href: secretaryIgcseHref("subjects"),    label: "Subjects", icon: "BookOpenText" },
      { href: secretaryIgcseHref("reports"),     label: "Progress Reports", icon: "FileBarChart" },
    ],
  },
  {
    href: secretaryDisciplineHref("incidents"),
    label: "Discipline",
    icon: "Shield",
    children: [
      { href: secretaryDisciplineHref("incidents"), label: "Incidents", icon: "ClipboardList" },
      { href: secretaryDisciplineHref("new"), label: "New Incident", icon: "Plus" },
    ],
  },
  {
    href: secretaryEventsHref(),
    label: "Events",
    icon: "CalendarDays",
  },
  {
    href: secretarySmsHref("send"),
    label: "Messages",
    icon: "MessageSquare",
    children: [
      { href: secretarySmsHref("send"),      label: "Send Message",    icon: "Send" },
      { href: secretarySmsHref("broadcast"), label: "Broadcast",       icon: "Megaphone" },
      { href: secretarySmsHref("history"),   label: "Message History", icon: "History" },
      { href: secretarySmsHref("templates"), label: "Templates",       icon: "FileText" },
      { href: secretarySmsHref("credits"),   label: "Buy Credits",     icon: "Coins" },
    ],
  },
  {
    href: secretarySchoolSetupHref("terms"),
    label: "School Setup",
    icon: "Settings2",
    children: [
      { href: secretarySchoolSetupHref("curriculum"), label: "Curriculum Type", icon: "BookOpenText" },
      { href: secretarySchoolSetupHref("terms"), label: "Terms", icon: "CalendarDays" },
      { href: secretarySchoolSetupHref("classes"), label: "Classes", icon: "School" },
      { href: secretarySchoolSetupHref("subjects"), label: "Subjects", icon: "BookOpenText" },
      { href: secretarySchoolSetupHref("timetable"), label: "School Timetable", icon: "CalendarDays" },
      { href: secretarySchoolSetupHref("calendar"), label: "Calendar & Exams", icon: "CalendarDays" },
      { href: secretarySchoolSetupHref("admission-number"), label: "Admission Number Counter", icon: "Hash" },
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
    badgeKey: "tenantNotifications",
  },
  { href: secretaryContactAdminHref(), label: "Contact Admin", icon: "Headset" },
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
      { href: principalExamsHref("marks-review"), label: "Marks Review", icon: "ClipboardList" },
      { href: principalExamsHref("report-cards"), label: "Report Cards", icon: "FileBarChart" },
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
      { href: principalSchoolSetupHref("calendar"), label: "Calendar & Exams", icon: "CalendarDays" },
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
    badgeKey: "tenantNotifications",
  },
];
