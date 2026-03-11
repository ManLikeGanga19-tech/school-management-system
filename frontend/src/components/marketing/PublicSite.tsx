import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Building2,
  ClipboardCheck,
  CreditCard,
  GraduationCap,
  School,
  ShieldCheck,
  Users2,
  Waypoints,
} from "lucide-react";

import { Button } from "@/components/ui/button";

type Stat = {
  label: string;
  value: string;
  detail: string;
};

type Capability = {
  title: string;
  description: string;
  icon: LucideIcon;
};

type RolloutStep = {
  step: string;
  title: string;
  description: string;
};

const stats: Stat[] = [
  {
    label: "Platform model",
    value: "Multi-tenant by design",
    detail: "Shared control plane, isolated tenant operations, domain-aware routing.",
  },
  {
    label: "Operational span",
    value: "Admissions to collections",
    detail: "Student lifecycle, finance, timetable, HR, exams, notifications, and audit.",
  },
  {
    label: "Control posture",
    value: "Role- and policy-driven",
    detail: "Tenant-level permissions, director overrides, traceable activity history.",
  },
];

const capabilities: Capability[] = [
  {
    title: "School onboarding",
    description:
      "Provision tenant workspaces, issue director credentials, and standardize rollout by school or education group.",
    icon: Building2,
  },
  {
    title: "Academic operations",
    description:
      "Coordinate classes, terms, timetable, exams, events, and student records from one operational system.",
    icon: GraduationCap,
  },
  {
    title: "Revenue controls",
    description:
      "Manage fee structures, invoices, discounts, scholarships, collections, and subscription visibility with discipline.",
    icon: CreditCard,
  },
  {
    title: "Access governance",
    description:
      "Use tenant-aware RBAC, SaaS-level administration, and audit evidence to reduce operational drift.",
    icon: ShieldCheck,
  },
  {
    title: "Support and escalation",
    description:
      "Route support into the platform so operators and schools share the same operational truth.",
    icon: ClipboardCheck,
  },
  {
    title: "Network-wide visibility",
    description:
      "Run multiple institutions under one product surface without collapsing them into one unsafe data plane.",
    icon: Waypoints,
  },
];

const rolloutSteps: RolloutStep[] = [
  {
    step: "01",
    title: "Establish the operator layer",
    description:
      "Super admin configures tenancy rules, plans, roles, and support guardrails before any school traffic is opened.",
  },
  {
    step: "02",
    title: "Provision each school cleanly",
    description:
      "Every tenant receives its own identity, domain mapping, user membership model, and operational defaults.",
  },
  {
    step: "03",
    title: "Run daily work from one system",
    description:
      "Directors, principals, and secretaries move inside the same governed workflows for finance, academics, and admin.",
  },
];

const securityPoints = [
  "Loopback-only app edge behind host TLS termination",
  "Cookie-secured auth flows for HTTPS environments",
  "Audit-oriented workflows across SaaS and tenant scopes",
  "Deployment model designed for immutable image rollouts",
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-300/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-sm backdrop-blur">
      <BadgeCheck className="size-3.5 text-amber-600" />
      {children}
    </span>
  );
}

export function PublicSite() {
  return (
    <main className="relative isolate overflow-hidden bg-[linear-gradient(180deg,#efe3c8_0%,#f7f2e8_34%,#fcfbf7_100%)] text-slate-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="hero-float absolute -left-24 top-10 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(191,83,37,0.20),rgba(191,83,37,0))]" />
        <div className="hero-float absolute right-[-7rem] top-28 h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(18,85,101,0.20),rgba(18,85,101,0))]" />
        <div className="absolute inset-x-0 top-0 h-[32rem] bg-[linear-gradient(135deg,rgba(255,255,255,0.65),rgba(255,255,255,0.08))]" />
        <div className="marketing-grid absolute inset-0 opacity-60" />
      </div>

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 pb-16 pt-6 sm:px-8 lg:px-10">
        <header className="hero-rise flex flex-col gap-4 rounded-[2rem] border border-white/60 bg-white/65 px-5 py-4 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
              <School className="size-6" />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">ShuleHQ</div>
              <p className="text-sm text-slate-600">
                Enterprise school operations platform for multi-campus and SaaS-managed delivery.
              </p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <a className="transition hover:text-slate-950" href="#platform">
              Platform
            </a>
            <a className="transition hover:text-slate-950" href="#security">
              Security
            </a>
            <a className="transition hover:text-slate-950" href="#rollout">
              Rollout
            </a>
            <Button asChild size="sm" variant="outline" className="rounded-full border-slate-300 bg-white/90">
              <Link href="/choose-tenant">School login</Link>
            </Button>
            <Button asChild size="sm" className="rounded-full bg-slate-950 text-white hover:bg-slate-800">
              <Link href="/saas/login">SaaS admin</Link>
            </Button>
          </nav>
        </header>

        <div className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)] lg:py-20">
          <div className="space-y-8">
            <div className="hero-rise hero-delay-1 space-y-6">
              <SectionLabel>Run schools with control, not patchwork</SectionLabel>
              <div className="space-y-5">
                <h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.05em] text-balance text-slate-950 sm:text-6xl lg:text-7xl">
                  One operating system for school groups, campus teams, and SaaS administration.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-slate-700 sm:text-xl">
                  ShuleHQ brings admissions, finance, academic operations, HR, support, and audit into a
                  single tenant-aware platform that can scale from one school to an entire network.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="rounded-full bg-[#b9512d] px-7 text-base text-white shadow-[0_16px_40px_rgba(185,81,45,0.3)] hover:bg-[#9f4525]"
                >
                  <Link href="/choose-tenant">
                    Enter school workspace
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="rounded-full border-slate-300 bg-white/85 px-7 text-base text-slate-900"
                >
                  <Link href="/saas/login">Open operator console</Link>
                </Button>
              </div>
            </div>

            <div className="hero-rise hero-delay-2 grid gap-4 md:grid-cols-3">
              {stats.map((stat) => (
                <article
                  key={stat.label}
                  className="rounded-[1.6rem] border border-white/60 bg-white/80 p-5 shadow-[0_16px_50px_rgba(15,23,42,0.07)] backdrop-blur"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{stat.label}</p>
                  <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-950">{stat.value}</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{stat.detail}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="hero-rise hero-delay-3 relative">
            <div className="absolute inset-x-8 top-6 h-full rounded-[2rem] bg-slate-950/8 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-slate-200/80 bg-slate-950 px-6 py-6 text-white shadow-[0_30px_90px_rgba(15,23,42,0.25)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-amber-300">Operator overview</p>
                  <h2 className="mt-2 text-3xl font-semibold tracking-tight">ShuleHQ control plane</h2>
                </div>
                <div className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-200">
                  live model
                </div>
              </div>

              <div className="mt-8 grid gap-4">
                <article className="rounded-[1.5rem] border border-white/10 bg-white/6 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-[#163b44] p-3 text-[#9be2ee]">
                        <Users2 className="size-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold">Tenant workforce</h3>
                        <p className="text-sm text-slate-300">Role-driven access across director, principal, and secretary desks.</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                      isolated
                    </span>
                  </div>
                </article>

                <article className="grid gap-4 rounded-[1.5rem] border border-white/10 bg-white/6 p-5 md:grid-cols-2">
                  <div className="rounded-[1.25rem] bg-white/8 p-4">
                    <BookOpenCheck className="size-5 text-amber-300" />
                    <h3 className="mt-4 font-semibold">Academic cadence</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      Terms, classes, exams, events, and timetable stay aligned inside one data model.
                    </p>
                  </div>
                  <div className="rounded-[1.25rem] bg-white/8 p-4">
                    <CreditCard className="size-5 text-cyan-300" />
                    <h3 className="mt-4 font-semibold">Finance visibility</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      Fee structures, collections, scholarships, and subscription controls remain auditable.
                    </p>
                  </div>
                </article>

                <article className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(135deg,rgba(185,81,45,0.26),rgba(30,41,59,0.2))] p-5">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="size-5 text-amber-200" />
                    <h3 className="font-semibold">Security and governance</h3>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {securityPoints.map((item) => (
                      <div key={item} className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-slate-100">
                        {item}
                      </div>
                    ))}
                  </div>
                </article>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="relative border-y border-slate-200/70 bg-white/80 py-20 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-10">
          <div className="max-w-3xl">
            <SectionLabel>Platform coverage</SectionLabel>
            <h2 className="mt-5 text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">
              Designed for real school operations, not disconnected modules.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              The platform is structured so that finance, academics, staffing, and support can operate from one
              tenant-aware system without sacrificing operator oversight.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {capabilities.map((item) => (
              <article
                key={item.title}
                className="rounded-[1.75rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(247,242,232,0.78))] p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]"
              >
                <div className="flex size-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <item.icon className="size-5" />
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-slate-950">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="security" className="relative py-20">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,1.1fr)] lg:px-10">
          <div className="rounded-[2rem] border border-slate-200 bg-[#132129] p-8 text-white shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
            <SectionLabel>Security posture</SectionLabel>
            <h2 className="mt-5 text-4xl font-semibold tracking-[-0.04em] text-white">
              Infrastructure choices that respect school data.
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-300">
              The deployment model keeps databases, Redis, backend, and frontend bound privately while host-level
              TLS terminates traffic at the edge. That reduces accidental exposure and keeps the public entry point
              narrow.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {[
                { label: "Edge policy", value: "HTTPS + HSTS" },
                { label: "Runtime exposure", value: "Loopback-only internal services" },
                { label: "Access model", value: "Tenant and SaaS scope separation" },
                { label: "Evidence trail", value: "Audit-first operations" },
              ].map((item) => (
                <div key={item.label} className="rounded-[1.25rem] border border-white/10 bg-white/6 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
                  <p className="mt-3 text-base font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div id="rollout" className="rounded-[2rem] border border-slate-200 bg-white/88 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
            <SectionLabel>Rollout path</SectionLabel>
            <h2 className="mt-5 text-4xl font-semibold tracking-[-0.04em] text-slate-950">
              A cleaner onboarding sequence for each school.
            </h2>
            <div className="mt-8 space-y-5">
              {rolloutSteps.map((item) => (
                <article key={item.step} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">
                      {item.step}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold tracking-tight text-slate-950">{item.title}</h3>
                      <p className="mt-2 text-sm leading-7 text-slate-600">{item.description}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative pb-20">
        <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-10">
          <div className="overflow-hidden rounded-[2.25rem] border border-slate-200 bg-[linear-gradient(135deg,#1f2937_0%,#0f172a_45%,#6a2d16_100%)] px-8 py-10 text-white shadow-[0_30px_100px_rgba(15,23,42,0.18)]">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <SectionLabel>Next actions</SectionLabel>
                <h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                  Open the right doorway depending on whether you run the platform or a school.
                </h2>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-200">
                  School teams continue through tenant login. Platform operators use the SaaS admin console to manage
                  tenancy, subscriptions, permissions, support, and rollout.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <Button
                  asChild
                  size="lg"
                  className="rounded-full bg-white px-7 text-slate-950 hover:bg-slate-100"
                >
                  <Link href="/choose-tenant">School login</Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="rounded-full border-white/30 bg-white/10 px-7 text-white hover:bg-white/15"
                >
                  <Link href="/saas/login">SaaS admin login</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
