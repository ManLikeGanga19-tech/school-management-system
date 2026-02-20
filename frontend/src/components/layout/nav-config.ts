import type { AppNavItem } from "@/components/layout/AppShell";

export type FinanceSection = "fee-structures" | "invoices" | "payments" | "receipts";
export type EnrollmentSection = "intake" | "students";

export function directorFinanceHref(section: FinanceSection) {
  return `/tenant/finance?section=${section}`;
}

export function directorEnrollmentsHref(section: EnrollmentSection) {
  return `/tenant/enrollments?section=${section}`;
}

export function secretaryFinanceHref(section: FinanceSection) {
  return `/tenant/secretary/finance?section=${section}`;
}

export function secretaryEnrollmentsHref(section: EnrollmentSection) {
  return `/tenant/secretary/enrollments?section=${section}`;
}

export const directorNav: AppNavItem[] = [
  { href: "/tenant/director/dashboard", label: "Dashboard" },
  {
    href: directorEnrollmentsHref("intake"),
    label: "Enrollments",
    children: [
      { href: directorEnrollmentsHref("intake"), label: "Intake" },
      { href: directorEnrollmentsHref("students"), label: "Students" },
    ],
  },
  {
    href: directorFinanceHref("fee-structures"),
    label: "Finance",
    children: [
      { href: directorFinanceHref("fee-structures"), label: "Fee Structures" },
      { href: directorFinanceHref("invoices"), label: "Invoices" },
      { href: directorFinanceHref("payments"), label: "Payments" },
      { href: directorFinanceHref("receipts"), label: "Receipts" },
    ],
  },
  { href: "/tenant/users", label: "Users" },
  { href: "/tenant/rbac", label: "RBAC" },
  { href: "/tenant/audit", label: "Audit Logs" },
];

export const secretaryNav: AppNavItem[] = [
  { href: "/tenant/secretary/dashboard", label: "Dashboard" },
  {
    href: secretaryEnrollmentsHref("intake"),
    label: "Enrollments",
    children: [
      { href: secretaryEnrollmentsHref("intake"), label: "Intake" },
      { href: secretaryEnrollmentsHref("students"), label: "Students" },
    ],
  },
  {
    href: secretaryFinanceHref("fee-structures"),
    label: "Finance",
    children: [
      { href: secretaryFinanceHref("fee-structures"), label: "Fee Structures" },
      { href: secretaryFinanceHref("invoices"), label: "Invoices" },
      { href: secretaryFinanceHref("payments"), label: "Payments" },
      { href: secretaryFinanceHref("receipts"), label: "Receipts" },
    ],
  },
  { href: "/tenant/secretary/users", label: "Users" },
  { href: "/tenant/secretary/audit", label: "Audit Logs" },
];
