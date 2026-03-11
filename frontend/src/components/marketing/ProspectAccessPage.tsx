import Link from "next/link";
import { Building2, ShieldCheck, Waypoints } from "lucide-react";

import { CookieConsentBanner } from "@/components/marketing/CookieConsentBanner";
import { ProspectAccessCard } from "@/components/marketing/ProspectAccessCard";
import { PublicFooter } from "@/components/marketing/PublicFooter";
import { PublicNavbar } from "@/components/marketing/PublicNavbar";

const navItems = [
  { href: "/#engage", label: "Request desk" },
  { href: "/#platform", label: "Platform" },
  { href: "/#security", label: "Security" },
  { href: "/#rollout", label: "Rollout" },
];

export function ProspectAccessPage({ mode }: { mode: "register" | "login" }) {
  return (
    <main className="relative isolate overflow-hidden bg-[linear-gradient(180deg,#efe3c8_0%,#f7f2e8_34%,#fcfbf7_100%)] text-slate-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="hero-float absolute -left-24 top-10 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(191,83,37,0.20),rgba(191,83,37,0))]" />
        <div className="hero-float absolute right-[-7rem] top-28 h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(18,85,101,0.20),rgba(18,85,101,0))]" />
        <div className="marketing-grid absolute inset-0 opacity-60" />
      </div>

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-12 pt-4 sm:px-6 lg:px-10">
        <PublicNavbar navItems={navItems} />

        <div className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:py-16">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-300/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-sm backdrop-blur">
              <ShieldCheck className="size-3.5 text-amber-600" />
              Prospect onboarding
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-[-0.05em] text-balance text-slate-950 sm:text-5xl lg:text-6xl">
                {mode === "register"
                  ? "Create access before opening your institution rollout track."
                  : "Sign back in to continue your institution onboarding process."}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
                {mode === "register"
                  ? "This access record is for your institution contact, not for school users. After access is created, you will continue from the guided rollout desk on the public site."
                  : "Prospect sign-in returns you to the guided rollout desk, where your previous requests and requested subdomain stay attached to the same institution record."}
              </p>
            </div>

            <div className="grid gap-4">
              <article className="rounded-[1.75rem] border border-slate-200 bg-white/88 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                <div className="flex items-start gap-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                    <Building2 className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-slate-950">Institution-first onboarding</h2>
                    <p className="mt-2 text-sm leading-7 text-slate-600">
                      Demo, enquiry, and school-visit requests stay attached to one prospect workspace before the tenant is provisioned.
                    </p>
                  </div>
                </div>
              </article>

              <article className="rounded-[1.75rem] border border-slate-200 bg-white/88 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                <div className="flex items-start gap-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                    <Waypoints className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-slate-950">Separate from school and SaaS auth</h2>
                    <p className="mt-2 text-sm leading-7 text-slate-600">
                      Tenant users later sign into their own subdomain, while the platform team stays on the admin host. This page is only for prospect onboarding.
                    </p>
                  </div>
                </div>
              </article>

              <p className="text-sm text-slate-500">
                Need the full public brief first? <Link href="/" className="font-medium text-slate-900 underline-offset-4 hover:underline">Return to the homepage</Link>.
              </p>
            </div>
          </div>

          <ProspectAccessCard mode={mode} />
        </div>
      </section>

      <PublicFooter />
      <CookieConsentBanner />
    </main>
  );
}
