"use client";

import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { SaasPageHeader, SaasSurface } from "@/components/saas/page-chrome";
import {
  ShieldCheck,
  Layers,
  ArrowRight,
  Lock,
  Globe,
  Building2,
} from "lucide-react";

// ─── Module cards ─────────────────────────────────────────────────────────────

const modules = [
  {
    href:        "/saas/rbac/permissions",
    icon:        ShieldCheck,
    iconColor:   "bg-purple-50 text-purple-600",
    borderHover: "hover:border-purple-200",
    title:       "Permission Catalog",
    description: "Define the canonical permission codes used by all access tokens, role mappings, and per-user overrides across the platform.",
    bullets: [
      "Dot-notation codes (e.g. finance.invoices.manage)",
      "Create, edit, and cascade-safe delete",
      "Grouped by category for fast scanning",
    ],
    badge: "Foundational",
    badgeColor: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  },
  {
    href:        "/saas/rbac/roles",
    icon:        Layers,
    iconColor:   "bg-blue-50 text-blue-600",
    borderHover: "hover:border-blue-200",
    title:       "Role Catalog",
    description: "Manage global and tenant-scoped roles. Assign permission sets, inspect effective access, and create roles for any institution.",
    bullets: [
      "Global roles (platform-wide)",
      "Tenant-scoped roles per institution",
      "Inspect & manage permission sets",
    ],
    badge: "RBAC Core",
    badgeColor: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  },
];

// ─── How it works steps ───────────────────────────────────────────────────────

const steps = [
  {
    icon:  ShieldCheck,
    color: "bg-purple-100 text-purple-600",
    title: "1. Define Permissions",
    desc:  "Create permission codes in the catalog. These are the atomic units of access — e.g. finance.invoices.view.",
  },
  {
    icon:  Layers,
    color: "bg-blue-100 text-blue-600",
    title: "2. Create Roles",
    desc:  "Group permissions into global or tenant-scoped roles. Roles are assigned to users by directors.",
  },
  {
    icon:  Building2,
    color: "bg-amber-100 text-amber-600",
    title: "3. Assign to Users",
    desc:  "Directors assign roles to users within their tenant. Overrides can grant or deny specific permissions.",
  },
  {
    icon:  Lock,
    color: "bg-emerald-100 text-emerald-600",
    title: "4. Enforce at API",
    desc:  "Every request is checked against the user's effective permissions — roles + overrides combined.",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SaaSRbacHubPage() {
  return (
    <AppShell title="Super Admin" nav={saasNav} activeHref="/saas/rbac">
      <div className="space-y-6">

        {/* ── Header ── */}
        <SaasPageHeader
          title="Role-Based Access Control"
          description="Define the platform permission catalog, govern global and tenant-scoped roles, and shape effective access with less drift."
          badges={[
            { label: "Super Admin", icon: ShieldCheck },
            { label: "Platform RBAC", icon: Globe },
          ]}
        />

        {/* ── Module cards ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          {modules.map((m) => (
            <Link key={m.href} href={m.href}>
              <div className={`dashboard-surface group h-full rounded-[1.6rem] border-0 p-6 transition hover:-translate-y-0.5 ${m.borderHover}`}>
                <div className="mb-4 flex items-start justify-between">
                  <div className={`inline-flex rounded-xl p-3 ${m.iconColor}`}>
                    <m.icon className="h-6 w-6" />
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${m.badgeColor}`}>
                    {m.badge}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <h2 className="text-base font-semibold text-slate-900 transition group-hover:text-blue-700">
                    {m.title}
                  </h2>
                  <ArrowRight className="h-4 w-4 translate-x-0 text-slate-300 opacity-0 transition-all group-hover:translate-x-1 group-hover:opacity-100 group-hover:text-blue-500" />
                </div>

                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {m.description}
                </p>

                <ul className="mt-4 space-y-1.5">
                  {m.bullets.map((b) => (
                    <li key={b} className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            </Link>
          ))}
        </div>

        {/* ── How it works ── */}
        <SaasSurface className="p-6">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">How Platform RBAC Works</h2>
          <p className="mb-5 text-xs text-slate-400">
            The four-step model from permission definition to API enforcement
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step) => (
              <div key={step.title} className="flex flex-col gap-3">
                <div className={`inline-flex w-fit rounded-xl p-2.5 ${step.color}`}>
                  <step.icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-800">{step.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </SaasSurface>

      </div>
    </AppShell>
  );
}
