"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  ClipboardCheck,
  CreditCard,
  GraduationCap,
  ShieldCheck,
  Waypoints,
} from "lucide-react";

import { CookieConsentBanner } from "@/components/marketing/CookieConsentBanner";
import { ProspectEngagementPanel } from "@/components/marketing/ProspectEngagementPanel";
import { PublicFooter } from "@/components/marketing/PublicFooter";
import { PublicNavbar } from "@/components/marketing/PublicNavbar";
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
    detail: "Shared control plane, isolated tenant workspaces, domain-aware routing.",
  },
  {
    label: "Operational span",
    value: "Admissions to collections",
    detail: "Student lifecycle, finance, timetable, HR, exams, notifications, and audit.",
  },
  {
    label: "Control posture",
    value: "Role- and policy-driven",
    detail: "Tenant permissions, SaaS oversight, and traceable operational history.",
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
    title: "Qualify the institution",
    description:
      "A prospect contact creates controlled access, declares the institution profile, and opens the right onboarding track.",
  },
  {
    step: "02",
    title: "Assign the school workspace",
    description:
      "The SaaS team validates the requested subdomain, shapes the rollout plan, and provisions the tenant cleanly.",
  },
  {
    step: "03",
    title: "Activate daily operations",
    description:
      "Directors, principals, and secretaries move into their own workspace while the control plane stays on the admin host.",
  },
];

const navItems = [
  { href: "#engage", label: "Request desk" },
  { href: "#platform", label: "Platform" },
  { href: "#security", label: "Security" },
  { href: "#rollout", label: "Rollout" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-300/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-sm backdrop-blur">
      <BadgeCheck className="size-3.5 text-amber-600" />
      {children}
    </span>
  );
}

export function PublicSite({
  adminHost = "admin.shulehq.co.ke",
  tenantBaseHost = "shulehq.co.ke",
}: {
  adminHost?: string;
  tenantBaseHost?: string;
}) {
  const tenantExampleHost = `novel-school.${tenantBaseHost}`;

  return (
    <main className="relative isolate overflow-hidden bg-[linear-gradient(180deg,#efe3c8_0%,#f7f2e8_34%,#fcfbf7_100%)] text-slate-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="hero-float absolute -left-24 top-10 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(191,83,37,0.20),rgba(191,83,37,0))]" />
        <div className="hero-float absolute right-[-7rem] top-28 h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(18,85,101,0.20),rgba(18,85,101,0))]" />
        <div className="absolute inset-x-0 top-0 h-[32rem] bg-[linear-gradient(135deg,rgba(255,255,255,0.65),rgba(255,255,255,0.08))]" />
        <div className="marketing-grid absolute inset-0 opacity-60" />
      </div>

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-16 pt-4 sm:px-6 lg:px-10">
        <PublicNavbar navItems={navItems} />

        <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(20rem,0.98fr)] lg:py-18">
          <div className="space-y-8">
            <div className="hero-rise hero-delay-1 space-y-6">
              <SectionLabel>Run school rollout with control</SectionLabel>
              <div className="space-y-5">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.05em] text-balance text-slate-950 sm:text-6xl lg:text-7xl">
                  Public onboarding at the front, SaaS control in the admin plane, schools on their own subdomains.
                </h1>
                <p className="max-w-2xl text-base leading-8 text-slate-700 sm:text-xl">
                  ShuleHQ separates prospect intake, platform administration, and school operations so each part of the system lives on the right host with the right controls.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="rounded-full bg-[#b9512d] px-7 text-base text-white shadow-[0_16px_40px_rgba(185,81,45,0.3)] hover:bg-[#9f4525]">
                  <Link href="/create-access">
                    Create access and start
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="rounded-full border-slate-300 bg-white/85 px-7 text-base text-slate-900"
                >
                  <Link href="#platform">View platform coverage</Link>
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

          <div className="hero-rise hero-delay-3 space-y-4">
            <article className="rounded-[2rem] border border-slate-200 bg-white/88 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.09)] backdrop-blur">
              <SectionLabel>Access map</SectionLabel>
              <div className="mt-5 space-y-4">
                <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Public site</p>
                  <p className="mt-2 text-base font-semibold text-slate-950">{tenantBaseHost}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Prospect access, rollout requests, demo planning, and implementation intake.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Admin host</p>
                    <p className="mt-2 text-base font-semibold text-slate-950">{adminHost}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      SaaS dashboard, rollout oversight, tenant management, and platform operations.
                    </p>
                  </div>
                  <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">School host</p>
                    <p className="mt-2 text-base font-semibold text-slate-950">{tenantExampleHost}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Director, principal, and secretary workspaces isolated to each tenant.
                    </p>
                  </div>
                </div>
              </div>
            </article>

            <article className="rounded-[2rem] border border-slate-200 bg-[#132129] p-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
              <SectionLabel>Delivery controls</SectionLabel>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  "Host-separated routing for public, admin, and tenant entrypoints",
                  "TLS at the edge with loopback-only application exposure behind the proxy",
                  "Controlled prospect workspace before any rollout conversation starts",
                  "Tenant provisioning aligned to requested school subdomain ownership",
                ].map((item) => (
                  <div key={item} className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4 text-sm leading-6 text-slate-200">
                    {item}
                  </div>
                ))}
              </div>
            </article>
          </div>
        </div>
      </section>

      <section id="engage" className="relative border-y border-slate-200/70 bg-white/75 py-20 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start">
            <div className="space-y-6">
              <SectionLabel>Request desk</SectionLabel>
              <div>
                <h2 className="text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">
                  Start implementation from a dedicated onboarding section.
                </h2>
                <p className="mt-4 text-base leading-8 text-slate-600 sm:text-lg">
                  This intake surface is intentionally separate from tenant login and SaaS administration. Institution contacts create prospect access first, then raise the right request for demo, enquiry, or school visit.
                </p>
              </div>

              <div className="grid gap-4">
                {[
                  {
                    title: "Create controlled prospect access",
                    description:
                      "One institution contact record anchors rollout requests, follow-up, and subdomain allocation without mixing public traffic into tenant auth.",
                  },
                  {
                    title: "Request the right engagement path",
                    description:
                      "Demo, enquiry, and school-visit workflows stay on one operational record so the rollout team can move faster with less ambiguity.",
                  },
                  {
                    title: "Promote cleanly into the tenant host",
                    description:
                      "Once approved, the school is activated on its own subdomain and operational users sign in there, not through the public site.",
                  },
                ].map((item, index) => (
                  <article
                    key={item.title}
                    className="rounded-[1.75rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(247,242,232,0.78))] p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">
                        0{index + 1}
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

            <ProspectEngagementPanel />
          </div>
        </div>
      </section>

      <section id="platform" className="relative bg-white/88 py-20 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="max-w-3xl">
            <SectionLabel>Platform coverage</SectionLabel>
            <h2 className="mt-5 text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">
              Designed for real school operations, not disconnected modules.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              The platform is structured so that finance, academics, staffing, and support can operate from one tenant-aware system without sacrificing operator oversight.
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
        <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,1.1fr)] lg:px-10">
          <div className="rounded-[2rem] border border-slate-200 bg-[#132129] p-8 text-white shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
            <SectionLabel>Security posture</SectionLabel>
            <h2 className="mt-5 text-4xl font-semibold tracking-[-0.04em] text-white">
              Infrastructure choices that respect school data.
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-300">
              The deployment model keeps databases, Redis, backend, and frontend bound privately while host-level TLS terminates traffic at the edge. That reduces accidental exposure and keeps the public entry point narrow.
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

      <section className="relative pb-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="overflow-hidden rounded-[2.25rem] border border-slate-200 bg-[linear-gradient(135deg,#1f2937_0%,#0f172a_45%,#6a2d16_100%)] px-6 py-10 text-white shadow-[0_30px_100px_rgba(15,23,42,0.18)] sm:px-8">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <SectionLabel>Next actions</SectionLabel>
                <h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                  Keep the control plane, public onboarding, and school workspaces separated.
                </h2>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-200">
                  The public site handles prospect engagement. Platform operations stay on the admin host, and each school runs on its own tenant subdomain.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Button asChild size="lg" className="rounded-full bg-white text-slate-950 hover:bg-slate-100">
                  <Link href="/create-access">Create access</Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                >
                  <Link href="/sign-in">Sign in</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PublicFooter adminHost={adminHost} />
      <CookieConsentBanner />
    </main>
  );
}
